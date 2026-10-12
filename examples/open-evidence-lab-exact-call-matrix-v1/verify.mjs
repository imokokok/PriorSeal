// Generated from verify.mts by npm run core:build. Do not edit directly.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthorizedReceipt,
  validateAuthorizedReceiptClaims,
  verifyAuthorization,
  verifyAuthorizationReceipt
} from "../../src/index.mjs";
import { bindEnvelope, recoverAuthorizer } from "./reader.mjs";
const directory = dirname(fileURLToPath(import.meta.url));
const AVAILABILITY_CLASS = /* @__PURE__ */ new Set(["EXECUTION_UNAVAILABLE"]);
const readJson = (relativePath) => JSON.parse(readFileSync(join(directory, relativePath), "utf8"));
const sorted = (values) => [...new Set(values)].sort();
const equalSets = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
async function runMatrix() {
  const sourceRecord = readJson("fixture/signed-authorization.json");
  const keys = readJson("fixture/public-test-keys.json");
  const expected = readJson("expected.json");
  const authorization = sourceRecord.authorization;
  const authorizerRecovery = await recoverAuthorizer(authorization);
  const authorizationCheck = await verifyAuthorization(authorization, { now: authorization.notBefore });
  const acceptanceSignatureValid = verifyAuthorizationReceipt(sourceRecord.acceptance, keys.issuer.publicKeyPem);
  const cases = [];
  for (const spec of expected.cases) {
    const observed = readJson(spec.observed);
    const reader = bindEnvelope(authorization, observed);
    const receipt = buildAuthorizedReceipt({
      authorization,
      acceptance: sourceRecord.acceptance,
      execution: observed,
      issuer: sourceRecord.acceptance.issuer,
      keyId: sourceRecord.acceptance.keyId,
      issuedAt: observed.observedAt
    });
    const claims = validateAuthorizedReceiptClaims(receipt);
    const rawReasonCodes = sorted(receipt.binding.reasonCodes);
    const profile = {
      receiptClaimsValid: claims.valid,
      rawBinding: { bound: receipt.binding.bound, reasonCodes: rawReasonCodes },
      partitionedBinding: {
        bound: !rawReasonCodes.some((code) => !AVAILABILITY_CLASS.has(code)),
        mismatchCodes: rawReasonCodes.filter((code) => !AVAILABILITY_CLASS.has(code)),
        availabilityCodes: rawReasonCodes.filter((code) => AVAILABILITY_CLASS.has(code))
      },
      complianceStatus: receipt.compliance?.status ?? null,
      complianceReasonCodes: sorted(receipt.compliance?.reasonCodes ?? []),
      outcome: receipt.outcome
    };
    const expectedReasonCodes = sorted(spec.expected.reasonCodes);
    const expectedAvailabilityCodes = sorted(spec.expected.availabilityCodes);
    const expectedComplianceReasonCodes = sorted(spec.expected.complianceReasonCodes);
    const agreement = {
      readerMatchesProfileBinding: reader.bound === profile.partitionedBinding.bound && equalSets(reader.mismatchCodes, profile.partitionedBinding.mismatchCodes) && equalSets(reader.availabilityCodes, profile.partitionedBinding.availabilityCodes),
      profileMatchesExpectedBinding: profile.partitionedBinding.bound === spec.expected.bound && equalSets(profile.partitionedBinding.mismatchCodes, expectedReasonCodes) && equalSets(profile.partitionedBinding.availabilityCodes, expectedAvailabilityCodes),
      profileMatchesExpectedCompliance: profile.complianceStatus === spec.expected.complianceStatus && equalSets(profile.complianceReasonCodes, expectedComplianceReasonCodes),
      profileMatchesExpectedOutcome: profile.outcome === spec.expected.outcome
    };
    cases.push({
      id: spec.id,
      className: spec.className,
      note: spec.note,
      observed: spec.observed,
      reader,
      profile,
      expected: spec.expected,
      agreement,
      pass: Object.values(agreement).every(Boolean) && profile.receiptClaimsValid
    });
  }
  const report = {
    schema: "oel.exact-call-matrix.report.v1",
    matrixId: expected.matrixId,
    contractVersion: expected.contractVersion,
    profile: expected.profile,
    claim: expected.claim,
    semantics: {
      boundRule: expected.boundRule,
      stringComparison: expected.stringComparison,
      profilePartition: "the shipped profile's raw binding reads EXECUTION_UNAVAILABLE into its deciding set; the comparison applies the published v1.0.1 partition to both implementations and records the raw binding beside it"
    },
    inputs: {
      sourceRecord: "fixture/signed-authorization.json",
      testKeys: "fixture/public-test-keys.json",
      expected: "expected.json"
    },
    signature: {
      authorizerScheme: keys.authorizer.scheme,
      declaredAuthorizer: authorizerRecovery.declaredAuthorizer,
      recoveredAuthorizer: authorizerRecovery.recovered,
      authorizerMatches: authorizerRecovery.matchesDeclaredAuthorizer,
      eip712Digest: authorizerRecovery.digest,
      acceptanceIssuer: sourceRecord.acceptance.issuer,
      acceptanceKeyId: sourceRecord.acceptance.keyId,
      acceptanceSignatureValid,
      authorizationValidAtNotBefore: authorizationCheck.valid,
      authorizationCode: authorizationCheck.code
    },
    cases,
    summary: {
      cases: cases.length,
      envelopeBindingCases: cases.filter((entry) => entry.className === "envelope-binding").length,
      evidenceAvailabilityCases: cases.filter((entry) => entry.className === "evidence-availability").length,
      result: cases.every((entry) => entry.pass) && authorizerRecovery.matchesDeclaredAuthorizer && acceptanceSignatureValid && authorizationCheck.valid ? "PASS" : "FAIL"
    },
    doesNotEstablish: expected.doesNotEstablish
  };
  return report;
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const report = await runMatrix();
  const serialized = `${JSON.stringify(report, null, 2)}
`;
  if (process.argv.includes("--write")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(directory, "report.json"), serialized);
  }
  process.stdout.write(serialized);
  if (report.summary.result !== "PASS") process.exitCode = 1;
}
export {
  runMatrix
};
