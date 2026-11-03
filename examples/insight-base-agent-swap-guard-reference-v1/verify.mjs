// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyBaseAgentSwapGuardReceiptBundle,
  verifyInsightBaseAgentSwapGuardDecision
} from "../../sdk/dist/index.js";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
const directory = dirname(fileURLToPath(import.meta.url));
const sha256 = (path) => createHash("sha256").update(readFileSync(join(directory, path))).digest("hex");
const readJson = (relativePath) => JSON.parse(readFileSync(join(directory, relativePath), "utf8"));
const checks = [];
const record = (id, stage, expected, actual) => checks.push({ id, stage, expected, actual, pass: expected === actual });
const decision = readJson("fixture/insight-decision.json");
const insightTrust = { keyRegistry: readJson("fixture/insight-key-registry.json"), now: 1792252800 };
const priorSealTrust = { trustedKeys: readJson("fixture/issuer-key.json"), now: 1792252821, expectedAudience: "priorseal" };
const intents = readJson("fixture/intents.json");
const approvalReceipt = readJson("fixture/receipts/approval.json");
const swapReceipt = readJson("fixture/receipts/swap.json");
const manifest = readJson("MANIFEST.json");
for (const [relativePath, expected] of Object.entries(manifest.files)) {
  record(`integrity:${relativePath}`, "review", expected.sha256, sha256(relativePath));
}
const decisionResult = await verifyInsightBaseAgentSwapGuardDecision(decision, insightTrust);
record("assess:decision-valid", "assess", "true", String(decisionResult.valid));
record("assess:reason", "assess", "OK", decisionResult.reason);
const expectedDigest = String(decision.decisionHash).toLowerCase();
for (const stage of ["approval", "swap"]) {
  const commitments = Array.isArray(intents[stage].contextCommitments) ? intents[stage].contextCommitments : [];
  const matched = commitments.some((entry) => entry.namespace === "insight.base-agent-swap-guard.v1" && entry.digest === expectedDigest);
  record(`bind:${stage}-commitment`, "bind", "true", String(matched));
}
record("bind:ordered-nonces", "bind", "1", String(BigInt(String(intents.swap.nonce)) - BigInt(String(intents.approval.nonce))));
const authorizationResult = await verifyBaseAgentSwapGuardAuthorizationBundle({
  approval: readJson("fixture/authorizations/approval.json"),
  swap: readJson("fixture/authorizations/swap.json"),
  decision
}, { keyRegistry: insightTrust.keyRegistry });
record("authorize:bundle-valid", "authorize", "true", String(authorizationResult.valid));
record("authorize:reason", "authorize", "OK", authorizationResult.reason);
for (const [stage, receipt] of [["approval", approvalReceipt], ["swap", swapReceipt]]) {
  const result = await verifyReceiptLocally(receipt, priorSealTrust);
  record(`observe:${stage}-receipt`, "observe", "true", String(result.valid));
}
const approvalExecutedAt = Number(approvalReceipt.execution.executedAt);
const swapExecutedAt = Number(swapReceipt.execution.executedAt);
record("observe:approval-before-swap", "observe", "true", String(approvalExecutedAt < swapExecutedAt));
const bundleResult = await verifyBaseAgentSwapGuardReceiptBundle({
  approvalReceipt,
  swapReceipt,
  decision,
  priorSealTrust,
  insightTrust
});
record("review:receipt-bundle", "review", "true", String(bundleResult.valid));
record("review:receipt-bundle-reason", "review", "OK", bundleResult.reason);
const tamperedSwapReceipt = structuredClone(swapReceipt);
tamperedSwapReceipt.signature = `${tamperedSwapReceipt.signature.slice(0, -1)}${tamperedSwapReceipt.signature.endsWith("A") ? "B" : "A"}`;
const tamperedResult = await verifyBaseAgentSwapGuardReceiptBundle({
  approvalReceipt,
  swapReceipt: tamperedSwapReceipt,
  decision,
  priorSealTrust,
  insightTrust
});
record("review:tampered-swap-receipt-rejected", "review", "false", String(tamperedResult.valid));
const outlivesResult = await verifyBaseAgentSwapGuardAuthorizationBundle({
  approval: readJson("fixture/authorizations/outlives.json"),
  swap: readJson("fixture/authorizations/swap.json"),
  decision
}, { keyRegistry: insightTrust.keyRegistry });
record("review:authorization-outlives-decision-rejected", "review", "AUTHORIZATION_OUTLIVES_INSIGHT_DECISION", outlivesResult.reason);
const reportPath = join(directory, "report.json");
const update = process.argv.includes("--update");
const failed = checks.filter((entry) => !entry.pass);
const summary = { result: failed.length === 0 ? "PASS" : "FAIL", total: checks.length, failed: failed.length };
const reportContent = `${JSON.stringify({ schema: "insight.base-agent-swap-guard.reference-report.v1", fixtureId: "insight-base-agent-swap-guard-reference-v1", summary, checks }, null, 2)}
`;
if (update) {
  writeFileSync(reportPath, reportContent);
} else {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const reportMatches = report.checks.length === checks.length && checks.every((entry, index) => report.checks[index].id === entry.id && report.checks[index].expected === entry.expected && report.checks[index].actual === entry.actual && report.checks[index].pass === entry.pass) && report.summary.result === summary.result;
  record("report:matches-recomputed-review", "review", "true", String(reportMatches));
  const finalFailed = checks.filter((entry) => !entry.pass);
  const finalSummary = { result: finalFailed.length === 0 ? "PASS" : "FAIL", total: checks.length, failed: finalFailed.length };
  console.log(JSON.stringify({ schema: "insight.base-agent-swap-guard.reference-report.v1", fixtureId: "insight-base-agent-swap-guard-reference-v1", summary: finalSummary, checks }, null, 2));
  if (finalSummary.result !== "PASS") process.exitCode = 1;
}
if (update) console.log(JSON.stringify({ report: "updated", summary }, null, 2));
