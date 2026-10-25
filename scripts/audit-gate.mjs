#!/usr/bin/env node
// Generated from audit-gate.mts by npm run core:build. Do not edit directly.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const ALLOWLIST = /* @__PURE__ */ new Map([
  [
    "GHSA-mrhx-c7xc-m3w5",
    {
      // zod <4.6.6 超大集合内存耗尽。生产路径：viem@2.56.3 → abitype@1.2.3 → zod ^3.24.2
      // （dev 路径另有 @x402/core@2.28.0 → zod）。zod 3.x 无补丁版，viem/abitype/x402
      // 上游均未迁移 zod 4。服务端 zod 校验面受请求体大小限制与 Cloudflare 限流约束。
      reason: "zod <4.6.6 advisory introduced transitively in the production tree via viem@2.56.3 -> abitype@1.2.3 (pins zod ^3.24.2), and on the dev path via @x402/core@2.28.0; no patched zod 3.x release and no zod-4 releases of viem/abitype/@x402 exist yet.",
      removeWhen: "viem/abitype or @x402 ships zod >= 4.6.6, or a patched zod 3.x release is published",
      added: "2026-10-24"
    }
  ]
]);
function parseAuditReport(raw) {
  const report = JSON.parse(raw);
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("audit gate: npm audit returned an invalid report");
  }
  const error = report.error;
  if (error) {
    const details = error;
    const message = [details.code, details.summary, details.detail].filter((value) => typeof value === "string" && value.length > 0).join(": ");
    throw new Error(`audit gate: npm audit could not complete${message ? ` (${message})` : ""}`);
  }
  return report;
}
function auditViolations(report) {
  const violations = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!["high", "critical"].includes(vuln.severity ?? "")) continue;
    const ids = (vuln.via ?? []).filter((entry) => typeof entry === "object" && Boolean(entry?.url)).map((entry) => String(entry.url).split("/").pop() ?? "");
    const blocked = ids.filter((id) => !ALLOWLIST.has(id));
    if (blocked.length > 0) violations.push(`${name} (${vuln.severity}): ${blocked.join(", ")}`);
  }
  return violations;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
  } catch (error) {
    raw = error.stdout ?? "";
    if (!raw) throw error;
  }
  const violations = auditViolations(parseAuditReport(raw));
  if (violations.length > 0) {
    console.error("audit gate: BLOCKED \u2014 non-exempt high/critical advisories:");
    for (const v of violations) console.error(`- ${v}`);
    process.exitCode = 1;
  } else {
    console.log("audit gate: pass (only allowlisted advisories present; see scripts/audit-gate.mts ALLOWLIST)");
  }
}
export {
  auditViolations,
  parseAuditReport
};
