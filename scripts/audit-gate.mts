#!/usr/bin/env node
// 审计门禁：生产依赖（--omit=dev）出现 high/critical 通告即失败，
// 仅放行下方白名单中明确登记的上游暂无补丁项；其余一律拦截。
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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

interface AuditError {
  code?: string;
  summary?: string;
  detail?: string;
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

export function parseAuditReport(raw: string): AuditReport {
  const report: unknown = JSON.parse(raw);
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('audit gate: npm audit returned an invalid report');
  }
  const error = (report as { error?: unknown }).error;
  if (error) {
    const details = error as AuditError;
    const message = [details.code, details.summary, details.detail]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(': ');
    throw new Error(`audit gate: npm audit could not complete${message ? ` (${message})` : ''}`);
  }
  return report as AuditReport;
}

export function auditViolations(report: AuditReport) {
  const violations: string[] = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!['high', 'critical'].includes(vuln.severity ?? '')) continue;
    const ids = (vuln.via ?? [])
      .filter((entry): entry is AuditViaObject => typeof entry === 'object' && Boolean(entry?.url))
      .map((entry) => String(entry.url).split('/').pop() ?? '');
    const blocked = ids.filter((id) => !ALLOWLIST.has(id));
    if (blocked.length > 0) violations.push(`${name} (${vuln.severity}): ${blocked.join(', ')}`);
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // npm audit exits non-zero when it finds vulnerabilities, so capture stdout
  // for a real report. A registry or transport error is not a clean report and
  // must fail closed instead of being misclassified as zero vulnerabilities.
  let raw: string;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
  } catch (error) {
    raw = (error as { stdout?: string }).stdout ?? '';
    if (!raw) throw error;
  }
  const violations = auditViolations(parseAuditReport(raw));
  if (violations.length > 0) {
    console.error('audit gate: BLOCKED — non-exempt high/critical advisories:');
    for (const v of violations) console.error(`- ${v}`);
    process.exitCode = 1;
  } else {
    console.log('audit gate: pass (only allowlisted advisories present; see scripts/audit-gate.mts ALLOWLIST)');
  }
}
