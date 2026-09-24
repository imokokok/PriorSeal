#!/usr/bin/env node
// Generated from verify.source.reference.mts by npm run core:build. Do not edit directly.
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, hashTypedData, keccak256, verifyTypedData } from "viem";
import {
  verifyAuthorization,
  verifyAuthorizationReceipt,
  verifyAuthorizedReceipt
} from "../../src/domain/authorization.mjs";
const directory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(directory, "fixture");
const requiredCases = ["N1", "N2", "N3", "N4", "N5a", "N5b"];
const uintFields = /* @__PURE__ */ new Set([
  "subjectChainId",
  "tradeAmountUsd",
  "consensusPrice",
  "maxDeviationBps",
  "manipulationRiskBps",
  "participantCount",
  "requiredParticipantCount",
  "sourceGroupCount",
  "crossProviderAgreementBps",
  "maxStablecoinDepegBps",
  "maxDataAgeSeconds",
  "recommendedMaxPositionUsd",
  "validUntil",
  "checkedAt",
  "schemaVersion",
  "requiredSourceGroupCount"
]);
const insightTypes = {
  OracleSafetyCheck: [
    ["verdict", "string"],
    ["sourceAssetId", "string"],
    ["destinationAssetId", "string"],
    ["subjectChainId", "uint256"],
    ["action", "string"],
    ["tradeAmountUsd", "uint256"],
    ["consensusPrice", "uint256"],
    ["maxDeviationBps", "uint256"],
    ["manipulationRiskBps", "uint256"],
    ["participantCount", "uint256"],
    ["requiredParticipantCount", "uint256"],
    ["coverageStatus", "string"],
    ["independenceStatus", "string"],
    ["sourceGroupCount", "uint256"],
    ["crossProviderAgreementBps", "uint256"],
    ["maxStablecoinDepegBps", "uint256"],
    ["maxDataAgeSeconds", "uint256"],
    ["recommendedMaxPositionUsd", "uint256"],
    ["reasonCodesHash", "bytes32"],
    ["requestHash", "bytes32"],
    ["evaluationScope", "string"],
    ["evaluatedAssetIdsHash", "bytes32"],
    ["providerObservationsHash", "bytes32"],
    ["validUntil", "uint256"],
    ["checkedAt", "uint256"],
    ["schemaVersion", "uint256"],
    ["requiredSourceGroupCount", "uint256"]
  ].map(([name, type]) => ({ name, type }))
};
class FixtureError extends Error {
  code;
  constructor(code, detail) {
    super(detail ?? code);
    this.code = code;
  }
}
function demand(condition, code, detail) {
  if (!condition) throw new FixtureError(code, detail);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function domainDigest(namespace, payload) {
  return `0x${sha256(`${namespace}\0${canonical(payload)}`)}`;
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseReport(value) {
  demand(isRecord(value) && value.schema === "wak-insight-priorseal.acceptance-report.v1" && value.fixtureVersion === "v1" && Array.isArray(value.cases) && value.cases.every((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.wakVersion === "string" && isRecord(entry.inputArtifactHashes) && isRecord(entry.counts)), "REPORT_SCHEMA_INVALID");
  return value;
}
function commitment(intent, namespace, algorithm, digest) {
  const matches = intent.contextCommitments?.filter((entry) => entry.namespace === namespace) ?? [];
  demand(matches.length === 1, "CONTEXT_COMMITMENT_NOT_UNIQUE", namespace);
  demand(matches[0].algorithm === algorithm && matches[0].digest === digest, "CONTEXT_COMMITMENT_MISMATCH", namespace);
}
function pair(source, destination) {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "uint16" }
  ], [source.uid, destination.uid, source.data.requestHash, destination.data.requestHash, 50]));
}
function typedData(attestation) {
  return {
    domain: { name: "Insight Oracle Safety", version: "3", chainId: 1 },
    types: insightTypes,
    primaryType: "OracleSafetyCheck",
    message: Object.fromEntries(Object.entries(attestation.data).map(([key, value]) => [key, uintFields.has(key) ? BigInt(String(value)) : value]))
  };
}
async function verifyInsight(attestation, baseline, roots) {
  demand(attestation.schemaVersion === 3 && attestation.data.schemaVersion === 3, "INSIGHT_SCHEMA_INVALID");
  demand(attestation.attester.toLowerCase() === roots.insight.attester.toLowerCase(), "INSIGHT_ATTESTER_UNTRUSTED");
  const registry = baseline.insight.keyRegistry;
  const keys = registry.public_keys.filter((key) => key.key_id === roots.insight.historicalKeyId);
  demand(keys.length === 1 && keys[0].public_key.toLowerCase() === attestation.attester.toLowerCase(), "INSIGHT_KEY_MISMATCH");
  demand(!keys[0].revoked && !registry.revoked_keys.some((entry) => entry.key_id === keys[0].key_id), "INSIGHT_KEY_REVOKED");
  demand(Date.parse(keys[0].validFrom) / 1e3 <= attestation.data.checkedAt && (keys[0].validUntil === null || attestation.data.checkedAt < Date.parse(keys[0].validUntil) / 1e3), "INSIGHT_KEY_TIME_INVALID");
  const input = typedData(attestation);
  demand(hashTypedData(input) === attestation.uid, "INSIGHT_UID_MISMATCH");
  demand(await verifyTypedData({ ...input, address: attestation.attester, signature: attestation.signature }), "INSIGHT_SIGNATURE_INVALID");
  demand(attestation.validUntil === attestation.data.validUntil && attestation.data.checkedAt < attestation.data.validUntil, "INSIGHT_WINDOW_INVALID");
  if (attestation.reasonCodes) {
    const hash = keccak256(encodeAbiParameters([{ type: "string[]" }], [attestation.reasonCodes]));
    demand(hash === attestation.data.reasonCodesHash, "INSIGHT_REASON_HASH_MISMATCH");
  }
}
function verifyManifest() {
  const manifest = readJson(join(fixtureDirectory, "manifest.json"));
  demand(manifest.schema === "wak-insight-priorseal.fixture-manifest.v1", "MANIFEST_SCHEMA_INVALID");
  const expected = ["README.md", "fixture/baseline.json", "fixture/cases.json", "fixture/trust-roots.json", "verify.mjs"];
  demand(canonical(Object.keys(manifest.files).sort()) === canonical(expected.sort()), "MANIFEST_FILE_SET_MISMATCH");
  for (const relative of expected) {
    const bytes = readFileSync(join(directory, relative));
    demand(sha256(bytes) === manifest.files[relative], "FILE_HASH_MISMATCH", relative);
  }
  return manifest;
}
async function verifyBaseline() {
  const manifest = verifyManifest();
  const baseline = readJson(join(fixtureDirectory, "baseline.json"));
  const cases = readJson(join(fixtureDirectory, "cases.json"));
  const roots = readJson(join(fixtureDirectory, "trust-roots.json"));
  demand(baseline.schema === "wak-insight-priorseal.fixture-baseline.v1" && baseline.mode === "SYNTHETIC_NO_BROADCAST", "BASELINE_SCHEMA_INVALID");
  demand(cases.schema === "wak-insight-priorseal.fixture-cases.v1" && roots.schema === "wak-insight-priorseal.trust-roots.v1" && roots.synthetic === true, "FIXTURE_SCHEMA_INVALID");
  const { transaction, wak, insight, priorSeal } = baseline;
  demand(transaction.chainId === 84532 && transaction.to !== null, "TRANSACTION_SCOPE_INVALID");
  const payload = wak.callEnvelope.payload;
  demand(payload.schema === "agent-call-envelope.v1" && payload.executionProfile === "call", "ENVELOPE_SCHEMA_INVALID");
  demand(payload.chainId === transaction.chainId && payload.executor === transaction.from && payload.nonce === transaction.nonce && payload.target === transaction.to && payload.nativeValue === transaction.value && payload.calldataHash === keccak256(transaction.data), "ENVELOPE_CALL_MISMATCH");
  demand(domainDigest("agent-call-envelope.v1", payload) === wak.callEnvelope.digest, "ENVELOPE_DIGEST_MISMATCH");
  const policy = wak.policyDecisionCommitment;
  demand(policy.payload.schema === "web3-agent-kit.policy-decision.v1" && policy.payload.callIdentity === wak.callEnvelope.digest && policy.payload.verdict === "allow", "POLICY_PAYLOAD_INVALID");
  demand(domainDigest("web3-agent-kit.policy-decision.v1", policy.payload) === policy.digest, "POLICY_DIGEST_MISMATCH");
  for (const attestation of [insight.sourceAttestation, insight.destinationAttestation, insight.blockedDestinationAttestation]) await verifyInsight(attestation, baseline, roots);
  demand(insight.sourceAttestation.data.verdict === "PASS" && insight.destinationAttestation.data.verdict === "PASS" && insight.blockedDestinationAttestation.data.verdict === "BLOCK", "INSIGHT_VERDICT_INVALID");
  demand(insight.subjectChainId === 8453 && insight.executionChainId === 84532, "INSIGHT_CROSS_NETWORK_LABEL_MISSING");
  demand(insight.sourceAttestation.data.sourceAssetId === insight.destinationAttestation.data.destinationAssetId && insight.sourceAttestation.data.destinationAssetId === insight.destinationAttestation.data.sourceAssetId, "INSIGHT_PAIR_DIRECTION_MISMATCH");
  demand(pair(insight.sourceAttestation, insight.destinationAttestation) === insight.positivePairCommitment.digest, "INSIGHT_PAIR_DIGEST_MISMATCH");
  demand(pair(insight.sourceAttestation, insight.blockedDestinationAttestation) === insight.blockedPairCommitment.digest, "INSIGHT_BLOCK_PAIR_DIGEST_MISMATCH");
  demand(baseline.evaluatedAt >= insight.sourceAttestation.data.checkedAt && baseline.evaluatedAt < insight.sourceAttestation.data.validUntil && baseline.evaluatedAt >= insight.destinationAttestation.data.checkedAt && baseline.evaluatedAt < insight.destinationAttestation.data.validUntil, "INSIGHT_BASELINE_STALE");
  const authorization = priorSeal.authorization;
  const authCheck = await verifyAuthorization(authorization, { now: authorization.issuedAt, audience: "priorseal" });
  demand(authCheck.valid, "PRIORSEAL_AUTHORIZATION_INVALID", authCheck.code);
  const acceptance = priorSeal.acceptance;
  const publicKey = roots.priorSeal.publicKeyPem;
  demand(sha256(createPublicKey(publicKey).export({ type: "spki", format: "der" })) === roots.priorSeal.publicKeySpkiSha256, "PRIORSEAL_KEY_PIN_MISMATCH");
  demand(acceptance.issuer === roots.priorSeal.issuer && acceptance.keyId === roots.priorSeal.keyId && verifyAuthorizationReceipt(acceptance, publicKey), "PRIORSEAL_ACCEPTANCE_INVALID");
  demand(acceptance.authorizationId === authorization.authorizationId && acceptance.intentHash === authorization.intentHash && acceptance.acceptedAt >= authorization.notBefore, "PRIORSEAL_ACCEPTANCE_MISMATCH");
  const intent = authorization.intent;
  demand(
    intent.chainId === transaction.chainId && intent.sender === transaction.from && intent.callTarget === transaction.to && intent.nonce === transaction.nonce && intent.calldataHash === keccak256(transaction.data) && intent.transactionValue === transaction.value,
    "PRIORSEAL_EXACT_CALL_MISMATCH"
  );
  demand(authorization.delegate.executor === transaction.from && authorization.maxUses === "1" && authorization.notBefore <= baseline.issuedAt && authorization.expiresAt <= Math.min(insight.sourceAttestation.data.validUntil, insight.destinationAttestation.data.validUntil), "PRIORSEAL_AUTHORIZATION_WINDOW_INVALID");
  commitment(intent, "agent-call-envelope.v1", "sha256", wak.callEnvelope.digest);
  commitment(intent, "web3-agent-kit.policy-decision.v1", "sha256", policy.digest);
  commitment(intent, "insight.pretrade-pair.v1", "keccak256", insight.positivePairCommitment.digest);
  const mapped = priorSeal.expectedWakEvidence;
  const response = priorSeal.response;
  demand(response.schema === "priorseal.wak-authorization-response.v1" && response.verificationResult?.valid === true && response.verificationResult?.code === "OK" && canonical(response.signedAuthorization) === canonical(authorization) && canonical(response.acceptance) === canonical(acceptance), "PRIORSEAL_RESPONSE_INVALID");
  const expectedMapping = {
    authorization_id: authorization.authorizationId,
    envelope_digest: wak.callEnvelope.digest,
    executor: transaction.from,
    authorizer: authorization.authorizer.address,
    valid_from: authorization.notBefore,
    valid_until: authorization.expiresAt,
    nonce: authorization.authorizationNonce,
    policy_commitment_digest: policy.digest,
    raw: { signedAuthorization: authorization, verificationResult: response.verificationResult, acceptance }
  };
  demand(canonical(mapped) === canonical(expectedMapping), "WAK_ADAPTER_MAPPING_MISMATCH");
  for (const [key, value] of Object.entries(expectedMapping)) demand(canonical(response[key]) === canonical(value) || key === "raw", "PRIORSEAL_RESPONSE_MAPPING_MISMATCH", key);
  const ids = cases.cases.map((entry) => entry.id);
  demand(canonical(ids) === canonical([...requiredCases, "P1"]), "CASE_SET_INVALID");
  const baselineSha256 = sha256(readFileSync(join(fixtureDirectory, "baseline.json")));
  for (const entry of cases.cases) {
    const inputBytes = canonical(entry.input);
    demand(typeof inputBytes === "string", "CASE_INPUT_INVALID", entry.id);
    demand(entry.wakVersion === "1.18.4" && entry.inputArtifactHashes?.baselineSha256 === baselineSha256 && entry.inputArtifactHashes?.caseInputSha256 === sha256(inputBytes), "CASE_INPUT_HASH_MISMATCH", entry.id);
  }
  const [n1, n2, n3, n4, n5a, n5b, p1] = cases.cases;
  demand(n1.input.insightVariant === "signed-block" && n1.counts.authorizationProvider === 0 && n1.counts.signer === 0 && n1.counts.broadcast === 0 && n1.counts.receipt === 0, "N1_VECTOR_INVALID");
  demand(typeof n2.input.now === "number" && n2.input.now >= insight.sourceAttestation.data.validUntil && n2.counts.authorizationProvider === 0 && n2.counts.signer === 0 && n2.counts.broadcast === 0 && n2.counts.receipt === 0, "N2_VECTOR_INVALID");
  demand(n3.input.mutateAfterAuthorization?.field === "data" && keccak256(n3.input.mutateAfterAuthorization.value) !== payload.calldataHash && n3.counts.signer === 0 && n3.counts.broadcast === 0 && n3.counts.receipt === 0, "N3_VECTOR_INVALID");
  demand(n4.input.mutateAfterAuthorization?.field === "nonce" && n4.input.mutateAfterAuthorization.value !== transaction.nonce && n4.counts.signer === 0 && n4.counts.broadcast === 0 && n4.counts.receipt === 0, "N4_VECTOR_INVALID");
  for (const n5 of [n5a, n5b]) demand(n5.input.attempts === 2 && n5.counts.signer === 1 && n5.counts.broadcast === 1 && n5.counts.receipt === 1, "REPLAY_VECTOR_INVALID");
  demand(n5a.input.providerReconstructed === false && n5b.input.providerReconstructed === true && n5b.input.persistedAcceptanceRequired === true, "REPLAY_RECONSTRUCTION_INVALID");
  demand(canonical(p1.conditionalOn) === canonical(requiredCases) && p1.input.actualBaseSepoliaExecutionRequired === true, "P1_GATE_INVALID");
  return { manifest, baseline, cases, roots };
}
function verifyWakReport(report, cases, baseline) {
  demand(report.schema === "wak-insight-priorseal.acceptance-report.v1" && report.fixtureVersion === "v1", "REPORT_SCHEMA_INVALID");
  demand(report.envelopeDigest === baseline.wak.callEnvelope.digest && report.policyCommitmentDigest === baseline.wak.policyDecisionCommitment.digest, "REPORT_COMMITMENT_MISMATCH");
  demand(report.instrumentation?.explicitSignerProtocol === true && report.instrumentation?.explicitBroadcastFn === true, "REPORT_INSTRUMENTATION_MISSING");
  demand(report.adapter?.newFieldTypes === 0 && report.adapterAcceptance?.expectedNewFieldTypes === 0 && report.adapterAcceptance?.actualNewFieldTypes === 0 && report.adapterAcceptance?.terminal === "PASS", "REPORT_NEW_FIELD_TYPES");
  demand(Array.isArray(report.cases), "REPORT_CASES_MISSING");
  const ids = report.cases.map((entry) => entry.id);
  demand(canonical(ids.slice(0, 6)) === canonical(requiredCases), "REPORT_NEGATIVE_ORDER_INVALID");
  for (let index = 0; index < 6; index += 1) {
    const actual = report.cases[index];
    const expected = cases.cases[index];
    demand(actual.wakVersion === expected.wakVersion && canonical(actual.inputArtifactHashes) === canonical(expected.inputArtifactHashes), "REPORT_INPUT_IDENTITY_MISMATCH", actual.id);
    demand(actual.expectedTerminal === expected.terminal && actual.actualTerminal === expected.terminal && actual.reason === expected.reason, "REPORT_NEGATIVE_OUTCOME_MISMATCH", actual.id);
    demand(canonical(actual.counts) === canonical(expected.counts), "REPORT_COUNTER_MISMATCH", actual.id);
    if (actual.id === "N5b") demand(actual.reconstruction?.differentProviderInstance === true && actual.reconstruction?.samePersistedAcceptanceId === true, "REPORT_DURABLE_REPLAY_UNPROVEN");
  }
  if (ids.length === 7) {
    const actual = report.cases[6];
    demand(actual.id === "P1" && actual.wakVersion === "1.18.4" && actual.expectedTerminal === "LIVE_RECEIPT_VERIFIED" && actual.actualTerminal === "LIVE_RECEIPT_VERIFIED" && actual.reason === "OK" && canonical(actual.counts) === canonical(cases.cases[6].counts) && /^([0-9a-f]{64})$/.test(actual.inputArtifactHashes?.liveInputSha256 ?? ""), "REPORT_P1_INVALID");
    return "P1_REPORTED_REQUIRES_RECEIPT_VERIFICATION";
  }
  demand(ids.length === 6, "REPORT_CASE_SET_INVALID");
  return "NEGATIVE_REPORT_FIELDS_VERIFIED_P1_PENDING";
}
async function verifyLiveReceipt(report, keyPin) {
  demand(/^([0-9a-f]{64})$/.test(keyPin ?? ""), "LIVE_KEY_PIN_REQUIRED");
  const live = report.p1;
  demand(live?.receipt && live?.trustedKey?.publicKey && live?.wak && live?.insightPairCommitment, "P1_EVIDENCE_MISSING");
  const key = live.trustedKey;
  demand(sha256(createPublicKey(key.publicKey).export({ type: "spki", format: "der" })) === keyPin, "P1_KEY_PIN_MISMATCH");
  const receipt = live.receipt;
  demand(receipt.outcome === "COMPLETED" && receipt.execution.chainId === 84532 && receipt.execution.status === "CONFIRMED" && receipt.compliance?.status === "COMPLIANT" && receipt.binding?.bound === true, "P1_RECEIPT_STATUS_INVALID");
  const checked = await verifyAuthorizedReceipt(receipt, key.publicKey, { key, now: receipt.issuedAt, audience: "priorseal" });
  demand(checked.valid, "P1_RECEIPT_SIGNATURE_INVALID", checked.code);
  demand(receipt.authorizationEvidence, "P1_AUTHORIZATION_EVIDENCE_MISSING");
  const intent = receipt.authorizationEvidence.authorization.intent;
  commitment(intent, "agent-call-envelope.v1", "sha256", live.wak.envelopeDigest);
  commitment(intent, "web3-agent-kit.policy-decision.v1", "sha256", live.wak.policyCommitmentDigest);
  commitment(intent, "insight.pretrade-pair.v1", "keccak256", live.insightPairCommitment);
  demand(typeof receipt.execution.txHash === "string" && /^0x[0-9a-f]{64}$/.test(receipt.execution.txHash), "P1_TX_HASH_INVALID");
  return "P1_RECEIPT_LOCALLY_VERIFIED_RPC_CHECK_STILL_REQUIRED";
}
async function runVerification({ reportPath, trustKeySha256 } = {}) {
  try {
    const { baseline, cases, manifest } = await verifyBaseline();
    let wakAcceptance = "NOT_RUN";
    if (reportPath) {
      const report = parseReport(readJson(resolve(reportPath)));
      wakAcceptance = verifyWakReport(report, cases, baseline);
      if (wakAcceptance === "P1_REPORTED_REQUIRES_RECEIPT_VERIFICATION") wakAcceptance = await verifyLiveReceipt(report, trustKeySha256);
    }
    return {
      status: "PASS",
      fixture: "CRYPTOGRAPHIC_INPUTS_AND_EXPECTED_OUTCOMES_VERIFIED",
      wakAcceptance,
      baselineEnvelopeDigest: baseline.wak.callEnvelope.digest,
      adapterNewFieldTypes: 0,
      caseIds: cases.cases.map((entry) => entry.id),
      manifestSchema: manifest.schema,
      compatibilityNote: "WAK v1.18.4 Chain enum lacks Base Sepolia; WAK P1 implementation needs renewed ownership alignment."
    };
  } catch (error) {
    return { status: "FAIL", code: error instanceof FixtureError ? error.code : "VERIFIER_ERROR", detail: error instanceof Error ? error.message : String(error) };
  }
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? void 0 : process.argv[index + 1];
  };
  const result = await runVerification({ reportPath: option("--report"), trustKeySha256: option("--trust-key-sha256") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  if (result.status !== "PASS") process.exitCode = 1;
}
export {
  runVerification
};
