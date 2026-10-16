// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchUniqueContextCommitment } from "../../sdk/dist/index.js";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
const directory = dirname(fileURLToPath(import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (relativePath) => JSON.parse(readFileSync(join(directory, relativePath), "utf8"));
const sorted = (values) => [...values].sort();
const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function fileManifest(value) {
  const candidate = record(value, "manifest");
  if (!candidate.files || Array.isArray(candidate.files)) throw new TypeError("manifest files are invalid");
  return candidate;
}
function parseSourceManifest(value) {
  const candidate = fileManifest(value);
  if (!Array.isArray(candidate.cases) || !candidate.contextMismatch) throw new TypeError("source manifest shape is invalid");
  return candidate;
}
function issuedAt(receipt) {
  if (!Number.isSafeInteger(receipt.issuedAt)) throw new TypeError("receipt issuedAt is invalid");
  return receipt.issuedAt;
}
const sourceManifest = parseSourceManifest(readJson("MANIFEST.json"));
const hashChecks = Object.entries(sourceManifest.files).map(([relativePath, expected]) => ({
  relativePath,
  expected: expected.sha256,
  actual: sha256(readFileSync(join(directory, relativePath)))
}));
const integrity = hashChecks.every((entry) => entry.actual === entry.expected);
const keyRegistry = readJson("fixture/issuer-key.json");
const cases = [];
for (const expected of sourceManifest.cases) {
  const receipt = record(readJson(expected.receipt), `${expected.id} receipt`);
  const result = await verifyReceiptLocally(receipt, { trustedKeys: keyRegistry, now: issuedAt(receipt), expectedAudience: "priorseal" });
  const binding = record(receipt.binding, `${expected.id} binding`);
  const reasonCodes = Array.isArray(binding.reasonCodes) && binding.reasonCodes.every((code) => typeof code === "string") ? binding.reasonCodes : [];
  const pass = result.valid === true && result.code === "OK" && binding.bound === expected.bound && equal(sorted(reasonCodes), sorted(expected.reasonCodes)) && result.complianceStatus === expected.complianceStatus && result.outcome === expected.outcome;
  cases.push({ id: expected.id, result, binding: { bound: binding.bound, reasonCodes }, pass });
}
const contextDocument = record(readJson(sourceManifest.contextMismatch.document), "mismatched context document");
const successReceipt = record(readJson("fixture/receipts/exact-match.json"), "success receipt");
const authorizationEvidence = record(successReceipt.authorizationEvidence, "authorization evidence");
const authorization = record(authorizationEvidence.authorization, "authorization");
const intent = record(authorization.intent, "intent");
const context = matchUniqueContextCommitment(intent, {
  namespace: "partner.reference-approval.v1",
  algorithm: "sha256",
  digest: `0x${sha256(JSON.stringify(contextDocument))}`
});
const contextPass = context.matched === false && context.code === sourceManifest.contextMismatch.code;
const bundleManifest = fileManifest(readJson("verification-bundle/MANIFEST.json"));
const bundleHashChecks = Object.entries(bundleManifest.files).map(([relativePath, expected]) => ({
  relativePath,
  expected: expected.sha256,
  actual: sha256(readFileSync(join(directory, "verification-bundle", relativePath)))
}));
const bundleIntegrity = bundleHashChecks.every((entry) => entry.actual === entry.expected);
const bundledReceipt = record(readJson("verification-bundle/receipt.json"), "bundled receipt");
const bundledKey = readJson("verification-bundle/issuer-key.json");
const bundleResult = await verifyReceiptLocally(bundledReceipt, { trustedKeys: bundledKey, now: issuedAt(bundledReceipt), expectedAudience: "priorseal" });
const tamperedReceipt = record(readJson("verification-bundle/receipt-tampered-signature.json"), "tampered receipt");
const tamperedResult = await verifyReceiptLocally(tamperedReceipt, { trustedKeys: bundledKey, now: issuedAt(tamperedReceipt), expectedAudience: "priorseal" });
const bundlePass = bundleIntegrity && bundleResult.valid === true && bundleResult.code === "OK" && bundleResult.outcome === "COMPLETED" && bundleResult.executionStatus === "CONFIRMED" && bundleResult.complianceStatus === "COMPLIANT" && tamperedResult.valid === false && tamperedResult.code === "INVALID_SIGNATURE";
const report = {
  schema: "priorseal.exact-call-partner-reference.report.v1",
  manifestIntegrity: integrity,
  cases,
  contextMismatch: { documentSha256: sha256(JSON.stringify(contextDocument)), ...context, pass: contextPass },
  portableBundle: { manifestIntegrity: bundleIntegrity, result: bundleResult, tamperedResult, pass: bundlePass },
  summary: { result: integrity && cases.every((entry) => entry.pass) && contextPass && bundlePass ? "PASS" : "FAIL" }
};
process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
if (report.summary.result !== "PASS") process.exitCode = 1;
