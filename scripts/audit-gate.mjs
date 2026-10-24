#!/usr/bin/env node
// 审计门禁：生产依赖（--omit=dev）出现 high/critical 通告即失败，
// 仅放行下方白名单中明确登记的上游暂无补丁项；其余一律拦截。
import { execFileSync } from 'node:child_process';

const ALLOWLIST = new Map([
  [
    'GHSA-mrhx-c7xc-m3w5',
    {
      // zod <4.6.6 超大集合内存耗尽；由 @x402/core@2.28.0（锁 zod ^3.24.2）传递引入，
      // zod 3.x 无补丁版、x402 SDK 尚无 zod-4 发布。服务端仅暴露于付款头校验，
      // 受 HTTP 头大小限制与 Cloudflare 限流约束。
      reason:
        'zod <4.6.6 advisory introduced transitively by @x402/core@2.28.0 (pins zod ^3.24.2); no patched zod 3.x release and no zod-4 SDK release exist yet.',
      removeWhen: '@x402/core ships zod >= 4.6.6, or a patched zod 3.x release is published',
      added: '2026-10-24',
    },
  ],
]);

// npm audit 存在漏洞时以非零码退出，需捕获并从 stdout 解析 JSON。
let raw;
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
} catch (error) {
  raw = error.stdout;
  if (!raw) throw error;
}
const report = JSON.parse(raw);
const violations = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!['high', 'critical'].includes(vuln.severity)) continue;
  const ids = (vuln.via ?? [])
    .filter((entry) => typeof entry === 'object' && entry?.url)
    .map((entry) => String(entry.url).split('/').pop());
  const blocked = ids.filter((id) => !ALLOWLIST.has(id));
  if (blocked.length > 0) violations.push({ name, severity: vuln.severity, blocked });
}

if (violations.length > 0) {
  console.error('audit gate: BLOCKED — non-exempt high/critical advisories:');
  for (const v of violations) console.error(`- ${v.name} (${v.severity}): ${v.blocked.join(', ')}`);
  process.exit(1);
}
console.log('audit gate: pass (only allowlisted advisories present; see scripts/audit-gate.mjs ALLOWLIST)');
