#!/usr/bin/env node
// 审计门禁：生产依赖（--omit=dev）出现 high/critical 通告即失败，
// 仅放行下方白名单中明确登记的上游暂无补丁项；其余一律拦截。
import { execFileSync } from 'node:child_process';

interface AuditViaObject {
  url?: string;
}

interface AuditVulnerability {
  severity?: string;
  via?: Array<string | AuditViaObject>;
}

interface AuditReport {
  vulnerabilities?: Record<string, AuditVulnerability>;
}

const ALLOWLIST = new Map<string, { reason: string; removeWhen: string; added: string }>([
  [
    'GHSA-mrhx-c7xc-m3w5',
    {
      // zod <4.6.6 超大集合内存耗尽。生产路径：viem@2.56.3 → abitype@1.2.3 → zod ^3.24.2
      // （dev 路径另有 @x402/core@2.28.0 → zod）。zod 3.x 无补丁版，viem/abitype/x402
      // 上游均未迁移 zod 4。服务端 zod 校验面受请求体大小限制与 Cloudflare 限流约束。
      reason:
        'zod <4.6.6 advisory introduced transitively in the production tree via viem@2.56.3 -> abitype@1.2.3 (pins zod ^3.24.2), and on the dev path via @x402/core@2.28.0; no patched zod 3.x release and no zod-4 releases of viem/abitype/@x402 exist yet.',
      removeWhen: 'viem/abitype or @x402 ships zod >= 4.6.6, or a patched zod 3.x release is published',
      added: '2026-10-24',
    },
  ],
]);

// npm audit 存在漏洞时以非零码退出，需捕获并从 stdout 解析 JSON。
let raw: string;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
} catch (error) {
  raw = (error as { stdout?: string }).stdout ?? '';
  if (!raw) throw error;
}
const report = JSON.parse(raw) as AuditReport;
const violations: string[] = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(vuln.severity ?? '')) continue;
  const ids = (vuln.via ?? [])
    .filter((entry): entry is AuditViaObject => typeof entry === 'object' && Boolean(entry?.url))
    .map((entry) => String(entry.url).split('/').pop() ?? '');
  const blocked = ids.filter((id) => !ALLOWLIST.has(id));
  if (blocked.length > 0) violations.push(`${name} (${vuln.severity}): ${blocked.join(', ')}`);
}

if (violations.length > 0) {
  console.error('audit gate: BLOCKED — non-exempt high/critical advisories:');
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}
console.log('audit gate: pass (only allowlisted advisories present; see scripts/audit-gate.mts ALLOWLIST)');
