// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideConsumerDisposition, parseVerifiedCase } from "./decide.mjs";
const directory = dirname(fileURLToPath(import.meta.url));
const defaultInput = resolve(directory, "../open-evidence-lab-exact-call-matrix-v1/report.json");
const args = process.argv.slice(2);
const write = args.includes("--write");
if (args.some((argument) => argument !== "--write")) throw new Error("Usage: node verify.mjs [--write]");
const inputBytes = readFileSync(defaultInput);
const sourceSha256 = createHash("sha256").update(inputBytes).digest("hex");
const expectedSourceSha256 = "223db1554639f242eae559b1f010dcabe3e9466e610cfa95aefe2e1ce564a363";
if (sourceSha256 !== expectedSourceSha256) throw new Error("Pinned OEL matrix report hash does not match");
const input = JSON.parse(inputBytes.toString("utf8"));
if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Input report must be an object");
const matrix = input;
if (matrix.schema !== "oel.exact-call-matrix.report.v1") throw new Error("Unsupported input report schema");
if (matrix.contractVersion !== "1.0.1") throw new Error("This adapter is pinned to contract v1.0.1");
if (matrix.profile !== "priorseal.execution-profile.exact-call.v1" || matrix.claim !== "envelope-matching-only") {
  throw new Error("Input report profile or claim does not match the pinned example");
}
const summary = matrix.summary;
if (typeof summary !== "object" || summary === null || Array.isArray(summary)) throw new Error("Input report summary must be an object");
const summaryRecord = summary;
if (summaryRecord.result !== "PASS") throw new Error("Input verifier report must have result PASS");
const rawCases = matrix.cases;
if (!Array.isArray(rawCases) || rawCases.length === 0) throw new Error("Input report must contain cases");
if (summaryRecord.cases !== rawCases.length || summaryRecord.envelopeBindingCases !== 5 || summaryRecord.evidenceAvailabilityCases !== 1) {
  throw new Error("Input verifier summary does not match the pinned six-case matrix");
}
const signature = matrix.signature;
if (typeof signature !== "object" || signature === null || Array.isArray(signature)) throw new Error("Input report signature summary must be an object");
const signatureRecord = signature;
if (signatureRecord.authorizerMatches !== true || signatureRecord.acceptanceSignatureValid !== true || signatureRecord.authorizationValidAtNotBefore !== true) {
  throw new Error("Input report must record successful authorization and acceptance signature checks");
}
const caseResults = rawCases.map((entry, index) => parseVerifiedCase(entry, index));
if (new Set(caseResults.map((entry) => entry.caseId)).size !== caseResults.length) throw new Error("Input report has duplicate case ids");
const expectations = {
  "case-00-exact-call-observed-match": { disposition: "ACCEPT_RECORD", reasonCode: "EXACT_CALL_CONFIRMED" },
  "case-01-call-target-mismatch": { disposition: "REJECT_RECORD", reasonCode: "AUTHORIZED_ENVELOPE_MISMATCH" },
  "case-02-calldata-mismatch": { disposition: "REJECT_RECORD", reasonCode: "AUTHORIZED_ENVELOPE_MISMATCH" },
  "case-03-transaction-value-mismatch": { disposition: "REJECT_RECORD", reasonCode: "AUTHORIZED_ENVELOPE_MISMATCH" },
  "case-04-execution-evidence-unavailable": { disposition: "HOLD_FOR_REVIEW", reasonCode: "EVIDENCE_INCOMPLETE" },
  "case-05-time-window-expired": { disposition: "REJECT_RECORD", reasonCode: "AUTHORIZED_ENVELOPE_MISMATCH" }
};
if (caseResults.length !== Object.keys(expectations).length) throw new Error("Input case count does not match the pinned six-case example");
const decisions = caseResults.map((entry) => {
  const decision = decideConsumerDisposition(entry);
  const expected = expectations[entry.caseId];
  if (!expected || decision.disposition !== expected.disposition || decision.reasonCode !== expected.reasonCode) {
    throw new Error(`Unexpected consumer disposition for ${entry.caseId}`);
  }
  return decision;
});
const result = {
  schema: "priorseal.consumer-disposition.report.v1",
  sourceSchema: matrix.schema,
  sourceContractVersion: matrix.contractVersion,
  sourceSha256,
  policy: "Accept only a valid, completed, fully bound COMPLIANT record; reject mismatches; hold unavailable or undetermined evidence for review.",
  decisions,
  summary: {
    cases: decisions.length,
    accepted: decisions.filter((entry) => entry.disposition === "ACCEPT_RECORD").length,
    rejected: decisions.filter((entry) => entry.disposition === "REJECT_RECORD").length,
    held: decisions.filter((entry) => entry.disposition === "HOLD_FOR_REVIEW").length,
    result: "PASS"
  },
  doesNotEstablish: [
    "that the report is signed by an external observer; the source hash pins the checked-in synthetic report bytes only",
    "that any real action was blocked, reversed, settled, or changed",
    "that this example policy is suitable for any production consumer",
    "that PriorSeal or this consumer adapter was adopted or endorsed by the Open Evidence Lab",
    "any chain observation, economic outcome, or security audit"
  ]
};
const serialized = `${JSON.stringify(result, null, 2)}
`;
if (write) writeFileSync(join(directory, "report.json"), serialized);
process.stdout.write(serialized);
