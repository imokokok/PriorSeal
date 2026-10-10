// One-command runner for the Open Evidence Lab exact-call envelope matrix.
//
// It runs two independent paths over the same frozen inputs:
//
//   1. `reader.mjs`  — the Open Evidence Lab reader. An independent
//                      implementation of the published field map. It imports
//                      nothing from PriorSeal; only `viem` and the Node
//                      standard library.
//   2. `../../src`   — the PriorSeal exact-call profile itself. It produces the
//                      signed authorization acceptance check, the envelope
//                      binding and its own compliance/outcome vocabulary.
//
// The two results are compared with each other and with `expected.json`. The
// process exits non-zero if any of them disagree. Attribution stays separate:
// the binding result belongs to the PriorSeal profile, the comparison belongs
// to the reader, and neither result is evidence about the other project.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAuthorizedReceipt,
  validateAuthorizedReceiptClaims,
  verifyAuthorization,
  verifyAuthorizationReceipt,
} from '../../src/index.mjs';
import { bindEnvelope, recoverAuthorizer } from './reader.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

type ExpectedCase = {
  id: string;
  className: string;
  observed: string;
  note: string;
  expected: {
    bound: boolean;
    reasonCodes: string[];
    complianceStatus: string;
    complianceReasonCodes: string[];
    outcome: string;
  };
};

const readJson = (relativePath: string) => JSON.parse(readFileSync(join(directory, relativePath), 'utf8'));
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const equalSets = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export async function runMatrix() {
  const sourceRecord = readJson('fixture/signed-authorization.json');
  const keys = readJson('fixture/public-test-keys.json');
  const expected = readJson('expected.json');
  const authorization = sourceRecord.authorization;

  const authorizerRecovery = await recoverAuthorizer(authorization);
  const authorizationCheck = await verifyAuthorization(authorization, { now: authorization.notBefore });
  const acceptanceSignatureValid = verifyAuthorizationReceipt(sourceRecord.acceptance, keys.issuer.publicKeyPem);

  const cases = [];
  for (const spec of expected.cases as ExpectedCase[]) {
    const observed = readJson(spec.observed);
    const reader = bindEnvelope(authorization.intent, observed);
    const receipt = buildAuthorizedReceipt({
      authorization,
      acceptance: sourceRecord.acceptance,
      execution: observed,
      issuer: sourceRecord.acceptance.issuer,
      keyId: sourceRecord.acceptance.keyId,
      issuedAt: observed.observedAt,
    });
    const claims = validateAuthorizedReceiptClaims(receipt);
    const profile = {
      receiptClaimsValid: claims.valid,
      bound: receipt.binding.bound,
      reasonCodes: sorted(receipt.binding.reasonCodes),
      complianceStatus: receipt.compliance?.status ?? null,
      complianceReasonCodes: sorted(receipt.compliance?.reasonCodes ?? []),
      outcome: receipt.outcome,
    };
    const expectedReasonCodes = sorted(spec.expected.reasonCodes);
    const expectedComplianceReasonCodes = sorted(spec.expected.complianceReasonCodes);
    const agreement = {
      readerMatchesProfileBinding: reader.bound === profile.bound && equalSets(reader.reasonCodes, profile.reasonCodes),
      profileMatchesExpectedBinding: profile.bound === spec.expected.bound && equalSets(profile.reasonCodes, expectedReasonCodes),
      profileMatchesExpectedCompliance:
        profile.complianceStatus === spec.expected.complianceStatus &&
        equalSets(profile.complianceReasonCodes, expectedComplianceReasonCodes),
      profileMatchesExpectedOutcome: profile.outcome === spec.expected.outcome,
    };
    cases.push({
      id: spec.id,
      className: spec.className,
      note: spec.note,
      observed: spec.observed,
      reader: { bound: reader.bound, reasonCodes: reader.reasonCodes },
      profile,
      expected: spec.expected,
      agreement,
      pass: Object.values(agreement).every(Boolean) && profile.receiptClaimsValid,
    });
  }

  const report = {
    schema: 'oel.exact-call-matrix.report.v1',
    matrixId: expected.matrixId,
    profile: expected.profile,
    claim: expected.claim,
    inputs: {
      sourceRecord: 'fixture/signed-authorization.json',
      testKeys: 'fixture/public-test-keys.json',
      expected: 'expected.json',
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
      authorizationCode: authorizationCheck.code,
    },
    cases,
    summary: {
      cases: cases.length,
      envelopeBindingCases: cases.filter((entry) => entry.className === 'envelope-binding').length,
      evidenceAvailabilityCases: cases.filter((entry) => entry.className === 'evidence-availability').length,
      result: cases.every((entry) => entry.pass) && authorizerRecovery.matchesDeclaredAuthorizer && acceptanceSignatureValid && authorizationCheck.valid
        ? 'PASS'
        : 'FAIL',
    },
    doesNotEstablish: expected.doesNotEstablish,
  };
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const report = await runMatrix();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(directory, 'report.json'), serialized);
  }
  process.stdout.write(serialized);
  if (report.summary.result !== 'PASS') process.exitCode = 1;
}
