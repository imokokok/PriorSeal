#!/usr/bin/env node
// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  verifyTypedData
} from "viem";
import { matchUniqueContextCommitment } from "../../sdk/dist/context-commitment.js";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
const directory = dirname(fileURLToPath(import.meta.url));
const SWAP_ABI = [{
  type: "function",
  name: "swapExactETHForTokens",
  stateMutability: "payable",
  inputs: [
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" }
  ],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}];
const INSIGHT_DOMAIN = { name: "Insight Oracle Safety", version: "3", chainId: 1 };
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    { name: "verdict", type: "string" },
    { name: "sourceAssetId", type: "string" },
    { name: "destinationAssetId", type: "string" },
    { name: "subjectChainId", type: "uint256" },
    { name: "action", type: "string" },
    { name: "tradeAmountUsd", type: "uint256" },
    { name: "consensusPrice", type: "uint256" },
    { name: "maxDeviationBps", type: "uint256" },
    { name: "manipulationRiskBps", type: "uint256" },
    { name: "participantCount", type: "uint256" },
    { name: "requiredParticipantCount", type: "uint256" },
    { name: "coverageStatus", type: "string" },
    { name: "independenceStatus", type: "string" },
    { name: "sourceGroupCount", type: "uint256" },
    { name: "crossProviderAgreementBps", type: "uint256" },
    { name: "maxStablecoinDepegBps", type: "uint256" },
    { name: "maxDataAgeSeconds", type: "uint256" },
    { name: "recommendedMaxPositionUsd", type: "uint256" },
    { name: "reasonCodesHash", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "evaluationScope", type: "string" },
    { name: "evaluatedAssetIdsHash", type: "bytes32" },
    { name: "providerObservationsHash", type: "bytes32" },
    { name: "validUntil", type: "uint256" },
    { name: "checkedAt", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
    { name: "requiredSourceGroupCount", type: "uint256" }
  ]
};
const INSIGHT_UINT_FIELDS = [
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
];
const CANONICAL_REQUEST_DOMAIN = {
  name: "Insight Canonical Pre-Trade Request",
  version: "1",
  chainId: 1
};
const CANONICAL_REQUEST_TYPES = {
  CanonicalPreTradeRequest: [
    { name: "subjectChainId", type: "uint256" },
    { name: "sourceAssetId", type: "string" },
    { name: "destinationAssetId", type: "string" },
    { name: "action", type: "string" },
    { name: "tradeAmountUsd", type: "uint256" }
  ]
};
const OBSERVATION_ABI = [
  { name: "provider", type: "string" },
  { name: "feedId", type: "string" },
  { name: "value", type: "uint256" },
  { name: "timestamp", type: "uint256" },
  { name: "dataAgeSeconds", type: "uint256" },
  { name: "included", type: "bool" },
  { name: "exclusionReason", type: "string" }
];
class VerificationFailure extends Error {
  code;
  detail;
  constructor(code, detail) {
    super(detail ?? code);
    this.code = code;
    this.detail = detail;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireClaim(condition, code, detail) {
  if (!condition) throw new VerificationFailure(code, detail);
}
function hex(value, code) {
  requireClaim(/^0x(?:[0-9a-fA-F]{2})*$/.test(value), code);
  return value;
}
function readEvidenceBundle() {
  const value = JSON.parse(readFileSync(resolve(directory, "evidence-bundle.json"), "utf8"));
  requireClaim(isRecord(value), "BUNDLE_MALFORMED");
  requireClaim(isRecord(value.insight) && isRecord(value.governor) && isRecord(value.transactionDraft) && isRecord(value.priorSeal) && isRecord(value.sources), "BUNDLE_MALFORMED");
  return value;
}
function readTrustRoots() {
  const value = JSON.parse(readFileSync(resolve(directory, "trust-roots.json"), "utf8"));
  requireClaim(isRecord(value), "TRUST_ROOTS_MALFORMED");
  requireClaim(isRecord(value.insight) && isRecord(value.priorSeal) && isRecord(value.expectedSourceCommits), "TRUST_ROOTS_MALFORMED");
  return value;
}
function canonicalize(value) {
  if (value === void 0) throw new TypeError("undefined is not canonical JSON");
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("non-finite number is not canonical JSON");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function sha256Canonical(value) {
  return `0x${sha256(canonicalize(value))}`;
}
function insightMessage(data) {
  const message = { ...data };
  for (const field of INSIGHT_UINT_FIELDS) {
    requireClaim(Number.isSafeInteger(data?.[field]) && data[field] >= 0, "INSIGHT_MALFORMED", `${field} must be a non-negative safe integer`);
    message[field] = BigInt(data[field]);
  }
  for (const field of ["reasonCodesHash", "requestHash", "evaluatedAssetIdsHash", "providerObservationsHash"]) {
    message[field] = hex(data[field], "INSIGHT_BYTES32_MALFORMED");
  }
  return message;
}
function observationsHash(observations) {
  const hashes = observations.map((entry) => keccak256(encodeAbiParameters(OBSERVATION_ABI, [
    entry.provider,
    entry.feedId,
    BigInt(entry.value),
    BigInt(entry.timestamp),
    BigInt(entry.dataAgeSeconds),
    entry.included,
    entry.exclusionReason
  ]))).sort();
  return hashes.length ? keccak256(concat(hashes)) : keccak256("0x");
}
function agreementBps(observations) {
  const included = observations.filter((entry) => entry.included).map((entry) => Number(entry.value));
  if (!included.length) return 0;
  const max = Math.max(...included);
  const min = Math.min(...included);
  return Math.round((max > 0 ? 1 - (max - min) / max : 1) * 1e4);
}
async function verifyInsight(attestation, registry, roots, decisionTime, executionTime) {
  requireClaim(attestation.schemaVersion === 3 && attestation.data?.schemaVersion === 3, "INSIGHT_SCHEMA_UNSUPPORTED");
  requireClaim(attestation.attester.toLowerCase() === roots.insight.attester.toLowerCase(), "INSIGHT_SIGNER_UNTRUSTED");
  const key = registry.public_keys.find((entry) => entry.key_id === roots.insight.historicalKeyId);
  requireClaim(key && key.public_key.toLowerCase() === attestation.attester.toLowerCase(), "INSIGHT_KEY_UNKNOWN");
  requireClaim(key.role !== "sample", "INSIGHT_SAMPLE_KEY_REJECTED");
  requireClaim(!key.revoked && !registry.revoked_keys.some((entry) => entry.key_id === key.key_id), "INSIGHT_KEY_REVOKED");
  const checkedAtMs = attestation.data.checkedAt * 1e3;
  requireClaim(checkedAtMs >= Date.parse(key.validFrom), "INSIGHT_KEY_OUTSIDE_WINDOW");
  requireClaim(key.validUntil === null || checkedAtMs < Date.parse(key.validUntil), "INSIGHT_KEY_OUTSIDE_WINDOW");
  const typedData = {
    domain: INSIGHT_DOMAIN,
    types: INSIGHT_TYPES,
    primaryType: "OracleSafetyCheck",
    message: insightMessage(attestation.data)
  };
  requireClaim(hashTypedData(typedData) === hex(attestation.uid, "INSIGHT_UID_MALFORMED"), "INSIGHT_UID_MISMATCH");
  requireClaim(await verifyTypedData({
    ...typedData,
    address: hex(attestation.attester, "INSIGHT_ATTESTER_MALFORMED"),
    signature: hex(attestation.signature, "INSIGHT_SIGNATURE_MALFORMED")
  }), "INSIGHT_SIGNATURE_INVALID");
  const expectedRequestHash = hashTypedData({
    domain: CANONICAL_REQUEST_DOMAIN,
    types: CANONICAL_REQUEST_TYPES,
    primaryType: "CanonicalPreTradeRequest",
    message: {
      subjectChainId: BigInt(attestation.data.subjectChainId),
      sourceAssetId: attestation.data.sourceAssetId,
      destinationAssetId: attestation.data.destinationAssetId,
      action: attestation.data.action,
      tradeAmountUsd: BigInt(attestation.data.tradeAmountUsd)
    }
  });
  requireClaim(expectedRequestHash === attestation.data.requestHash, "INSIGHT_REQUEST_HASH_MISMATCH");
  const observations = attestation.evidence?.providerObservations ?? [];
  requireClaim(observationsHash(observations) === attestation.data.providerObservationsHash, "INSIGHT_OBSERVATIONS_HASH_MISMATCH");
  requireClaim(observations.filter((entry) => entry.included).length === attestation.data.participantCount, "INSIGHT_PARTICIPANT_COUNT_MISMATCH");
  requireClaim(agreementBps(observations) === attestation.data.crossProviderAgreementBps, "INSIGHT_AGREEMENT_MISMATCH");
  const providerGroups = attestation.evidence.providerGroups;
  const groups = new Set(observations.filter((entry) => entry.included).map((entry) => providerGroups[entry.provider]).filter((group) => group && group !== "derived"));
  requireClaim(groups.size === attestation.data.sourceGroupCount, "INSIGHT_SOURCE_GROUP_COUNT_MISMATCH");
  requireClaim(attestation.data.participantCount >= attestation.data.requiredParticipantCount, "INSIGHT_COVERAGE_GATE_FAILED");
  requireClaim(attestation.data.sourceGroupCount >= attestation.data.requiredSourceGroupCount, "INSIGHT_INDEPENDENCE_GATE_FAILED");
  requireClaim(attestation.data.checkedAt <= decisionTime && decisionTime <= attestation.data.validUntil, "INSIGHT_STALE_AT_DECISION");
  requireClaim(attestation.data.checkedAt <= executionTime && executionTime <= attestation.data.validUntil, "INSIGHT_STALE_AT_EXECUTION");
  requireClaim(attestation.validUntil === attestation.data.validUntil, "INSIGHT_ENVELOPE_EXPIRY_MISMATCH");
  return {
    uid: attestation.uid,
    verdict: attestation.data.verdict,
    checkedAt: attestation.data.checkedAt,
    validUntil: attestation.data.validUntil,
    historicalKeyId: key.key_id,
    keyValidAtIssuance: true,
    keyRotatedAtAssembly: key.validUntil !== null && Date.parse(key.validUntil) / 1e3 <= registrySnapshotTime(registry)
  };
}
function registrySnapshotTime(registry) {
  const successorTimes = registry.public_keys.map((entry) => Date.parse(entry.validFrom) / 1e3).filter(Number.isSafeInteger);
  return Math.max(...successorTimes);
}
function computePairCommitment(source, destination, maxSlippageBps) {
  return {
    namespace: "insight.pretrade-pair.v1",
    algorithm: "keccak256",
    digest: keccak256(encodeAbiParameters([
      { type: "bytes32", name: "sourceUid" },
      { type: "bytes32", name: "destinationUid" },
      { type: "bytes32", name: "sourceRequestHash" },
      { type: "bytes32", name: "destinationRequestHash" },
      { type: "uint16", name: "maxSlippageBps" }
    ], [
      hex(source.uid, "INSIGHT_UID_MALFORMED"),
      hex(destination.uid, "INSIGHT_UID_MALFORMED"),
      hex(source.data.requestHash, "INSIGHT_REQUEST_HASH_MALFORMED"),
      hex(destination.data.requestHash, "INSIGHT_REQUEST_HASH_MALFORMED"),
      maxSlippageBps
    ]))
  };
}
function wakIntentId(draft) {
  return sha256(canonicalize({
    action: draft.action,
    amount_base_units: 0,
    calldata: draft.data.slice(2),
    chain: draft.chain,
    contract: draft.to,
    native_value_wei: Number(draft.value),
    recipient: null,
    sender: draft.from,
    token: null
  }));
}
function verifyDraft(draft) {
  requireClaim(draft.chain === "base" && draft.chainId === 8453, "DRAFT_CHAIN_MISMATCH");
  requireClaim(keccak256(hex(draft.data, "DRAFT_CALLDATA_MALFORMED")) === draft.calldataHash, "DRAFT_CALLDATA_HASH_MISMATCH");
  requireClaim(wakIntentId(draft) === draft.intentId, "WAK_INTENT_ID_MISMATCH");
  const decoded = decodeFunctionData({ abi: SWAP_ABI, data: hex(draft.data, "DRAFT_CALLDATA_MALFORMED") });
  requireClaim(decoded.functionName === "swapExactETHForTokens", "DRAFT_FUNCTION_MISMATCH");
  const [amountOutMin, path, recipient, deadline] = decoded.args;
  requireClaim(String(amountOutMin) === draft.decodedCall.amountOutMin, "DRAFT_AMOUNT_OUT_MIN_MISMATCH");
  requireClaim(path.map((entry) => entry.toLowerCase()).join(":") === draft.decodedCall.path.join(":"), "DRAFT_PATH_MISMATCH");
  requireClaim(recipient.toLowerCase() === draft.from && recipient.toLowerCase() === draft.decodedCall.recipient, "DRAFT_RECIPIENT_MISMATCH");
  requireClaim(Number(deadline) === draft.decodedCall.deadline, "DRAFT_DEADLINE_MISMATCH");
  return { functionName: decoded.functionName, amountOutMin: String(amountOutMin), deadline: Number(deadline) };
}
function evaluateGovernor(policy, decision, draft, source, destination, pairCommitment) {
  requireClaim(decision.policyId === policy.policyId, "GOVERNOR_POLICY_ID_MISMATCH");
  requireClaim(
    policy.composition.passWithNativeConfirmation === "PROCEED_TO_PRINCIPAL_AUTHORIZATION" && policy.composition.passWithoutNativeConfirmation === "PROCEED_TO_PRINCIPAL_AUTHORIZATION",
    "GOVERNOR_AUTHORIZATION_GATE_BYPASS"
  );
  requireClaim(decision.policyDigest === sha256Canonical(policy), "GOVERNOR_POLICY_DIGEST_MISMATCH");
  requireClaim(decision.intentId === draft.intentId, "GOVERNOR_INTENT_MISMATCH");
  const nativeReasons = [];
  if (!policy.nativePolicy.allowedChains.includes(draft.chain)) nativeReasons.push("chain_not_allowed");
  if (!policy.nativePolicy.allowedActions.includes(draft.action)) nativeReasons.push("action_not_allowed");
  if (!policy.nativePolicy.allowedContracts.includes(draft.to)) nativeReasons.push("contract_not_allowed");
  if (BigInt(draft.value) > BigInt(policy.nativePolicy.maxNativeValueWei)) nativeReasons.push("native_value_exceeded");
  const nativeAllowed = nativeReasons.length === 0;
  requireClaim(decision.nativePolicyResult.allowed === nativeAllowed, "GOVERNOR_NATIVE_RESULT_MISMATCH");
  requireClaim(canonicalize(decision.nativePolicyResult.reasons) === canonicalize(nativeReasons), "GOVERNOR_NATIVE_REASONS_MISMATCH");
  requireClaim(decision.nativePolicyResult.requiresConfirmation === policy.nativePolicy.requireConfirmation, "GOVERNOR_CONFIRMATION_RULE_MISMATCH");
  requireClaim(decision.insightResult.sourceUid === source.uid && decision.insightResult.destinationUid === destination.uid, "GOVERNOR_INSIGHT_REFERENCE_MISMATCH");
  requireClaim(decision.insightResult.pairCommitment === pairCommitment.digest, "GOVERNOR_INSIGHT_COMMITMENT_MISMATCH");
  const verdicts = [source.data.verdict, destination.data.verdict];
  const insightEffect = verdicts.some((verdict) => ["DANGER", "BLOCK"].includes(verdict)) ? "DENY" : verdicts.some((verdict) => verdict === "CAUTION") ? "REQUIRE_PRINCIPAL_CONFIRMATION" : verdicts.every((verdict) => verdict === "PASS") ? "ELIGIBLE" : "DENY";
  requireClaim(decision.insightResult.effect === insightEffect, "GOVERNOR_INSIGHT_EFFECT_MISMATCH");
  let finalDecision = "DENY";
  if (nativeAllowed && insightEffect === "ELIGIBLE") {
    finalDecision = "PROCEED_TO_PRINCIPAL_AUTHORIZATION";
  } else if (nativeAllowed && insightEffect === "REQUIRE_PRINCIPAL_CONFIRMATION") {
    finalDecision = "REQUIRE_PRINCIPAL_CONFIRMATION";
  }
  requireClaim(decision.decision === finalDecision, "GOVERNOR_DECISION_MISMATCH");
  const exactCallChecks = [
    ["chainId", draft.chainId],
    ["executor", draft.from],
    ["transactionNonce", draft.nonce],
    ["callTarget", draft.to],
    ["calldataHash", draft.calldataHash],
    ["nativeValue", draft.value]
  ];
  for (const [field, expected] of exactCallChecks) {
    requireClaim(String(decision.exactCall[field]).toLowerCase() === String(expected).toLowerCase(), `GOVERNOR_EXACT_CALL_${field.toUpperCase()}_MISMATCH`);
  }
  return { nativeAllowed, nativeReasons, insightEffect, finalDecision };
}
function keyFingerprint(publicKeyPem) {
  return sha256(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }));
}
function matchCommitment(intent, expected, code) {
  requireClaim(Array.isArray(intent.contextCommitments), "CONTEXT_COMMITMENTS_MALFORMED");
  const contextCommitments = intent.contextCommitments.map((entry) => {
    requireClaim(entry && typeof entry.namespace === "string" && (entry.algorithm === "keccak256" || entry.algorithm === "sha256") && typeof entry.digest === "string", "CONTEXT_COMMITMENTS_MALFORMED");
    return { namespace: entry.namespace, algorithm: entry.algorithm, digest: entry.digest };
  });
  const checkedIntent = { contextCommitments };
  const match = matchUniqueContextCommitment(checkedIntent, expected);
  requireClaim(match.matched, code, match.code);
}
async function verifyEvidenceBundle(bundle, roots) {
  try {
    requireClaim(bundle.schema === "web3-agent-kit.base-swap-evidence.v2", "BUNDLE_SCHEMA_UNSUPPORTED");
    requireClaim(bundle.fixtureMode === "SYNTHETIC_NO_BROADCAST", "BUNDLE_MODE_INVALID");
    const { bundleHash, ...unsigned } = bundle;
    requireClaim(bundleHash === sha256Canonical(unsigned), "BUNDLE_HASH_MISMATCH");
    for (const [name, expected] of Object.entries(roots.expectedSourceCommits)) {
      const source2 = bundle.sources[name];
      requireClaim(source2?.commit === expected, "SOURCE_COMMIT_MISMATCH", name);
    }
    const draftResult = verifyDraft(bundle.transactionDraft);
    const receipt = bundle.priorSeal.receipt;
    const executionTime = receipt.execution.executedAt;
    const sourceResult = await verifyInsight(
      bundle.insight.sourceAttestation,
      bundle.insight.keyRegistry,
      roots,
      bundle.governor.decision.evaluatedAt,
      executionTime
    );
    const destinationResult = await verifyInsight(
      bundle.insight.destinationAttestation,
      bundle.insight.keyRegistry,
      roots,
      bundle.governor.decision.evaluatedAt,
      executionTime
    );
    const source = bundle.insight.sourceAttestation;
    const destination = bundle.insight.destinationAttestation;
    requireClaim(source.data.sourceAssetId === destination.data.destinationAssetId && source.data.destinationAssetId === destination.data.sourceAssetId, "INSIGHT_PAIR_DIRECTION_MISMATCH");
    requireClaim(source.data.tradeAmountUsd === destination.data.tradeAmountUsd, "INSIGHT_PAIR_AMOUNT_MISMATCH");
    const pairCommitment = computePairCommitment(source, destination, bundle.insight.maxSlippageBps);
    requireClaim(pairCommitment.digest === bundle.insight.pairCommitment.digest, "INSIGHT_PAIR_COMMITMENT_MISMATCH");
    const quotedUsdAt1e6 = BigInt(bundle.transactionDraft.value) * BigInt(source.data.consensusPrice) / 10n ** 18n / 100n;
    requireClaim(quotedUsdAt1e6 === BigInt(source.data.tradeAmountUsd), "INSIGHT_TRADE_AMOUNT_MISMATCH");
    const expectedMinOut = BigInt(source.data.tradeAmountUsd) * 1000000n / BigInt(destination.data.consensusPrice) * BigInt(1e4 - bundle.insight.maxSlippageBps) / 10000n * 100n;
    requireClaim(expectedMinOut === BigInt(draftResult.amountOutMin), "DRAFT_SLIPPAGE_BOUND_MISMATCH");
    const policyDigest = sha256Canonical(bundle.governor.policy);
    const decisionDigest = sha256Canonical(bundle.governor.decision);
    const governorResult = evaluateGovernor(
      bundle.governor.policy,
      bundle.governor.decision,
      bundle.transactionDraft,
      source,
      destination,
      pairCommitment
    );
    const registry = bundle.priorSeal.keyRegistry;
    requireClaim(registry.issuer === roots.priorSeal.issuer, "PRIORSEAL_ISSUER_UNTRUSTED");
    const keys = registry.keys.filter((entry) => entry.keyId === roots.priorSeal.keyId && entry.issuer === roots.priorSeal.issuer);
    requireClaim(keys.length === 1, keys.length ? "PRIORSEAL_KEY_AMBIGUOUS" : "PRIORSEAL_KEY_UNKNOWN");
    const key = keys[0];
    requireClaim(keyFingerprint(key.publicKey) === roots.priorSeal.publicKeySpkiSha256, "PRIORSEAL_KEY_FINGERPRINT_MISMATCH");
    const receiptVerification = await verifyReceiptLocally(receipt, {
      trustedKeys: registry,
      now: bundle.assembledAt
    });
    requireClaim(receiptVerification.valid, `PRIORSEAL_${receiptVerification.code}`);
    requireClaim(receiptVerification.verificationScope === "LOCAL_COMPLETE", "PRIORSEAL_EXTERNAL_CHECK_REQUIRED");
    const authorization = receipt.authorizationEvidence.authorization;
    const intent = authorization.intent;
    requireClaim(receipt.compliance?.status === "COMPLIANT" && receipt.binding?.bound === true, "PRIORSEAL_RECEIPT_NOT_COMPLIANT");
    const intentChecks = [
      ["chainId", bundle.transactionDraft.chainId],
      ["callTarget", bundle.transactionDraft.to],
      ["calldataHash", bundle.transactionDraft.calldataHash],
      ["nonce", bundle.transactionDraft.nonce],
      ["transactionValue", bundle.transactionDraft.value],
      ["sender", bundle.transactionDraft.from]
    ];
    for (const [field, expected] of intentChecks) {
      requireClaim(String(intent[field]).toLowerCase() === String(expected).toLowerCase(), `PRIORSEAL_INTENT_${field.toUpperCase()}_MISMATCH`);
    }
    matchCommitment(intent, pairCommitment, "INSIGHT_CONTEXT_COMMITMENT_MISMATCH");
    matchCommitment(intent, {
      namespace: "web3-agent-kit.execution-policy.jcs.v1",
      algorithm: "sha256",
      digest: policyDigest
    }, "GOVERNOR_POLICY_CONTEXT_COMMITMENT_MISMATCH");
    matchCommitment(intent, {
      namespace: "web3-agent-kit.policy-decision.jcs.v1",
      algorithm: "sha256",
      digest: decisionDigest
    }, "GOVERNOR_DECISION_CONTEXT_COMMITMENT_MISMATCH");
    requireClaim(intent.validUntil <= source.data.validUntil && intent.validUntil <= destination.data.validUntil, "AUTHORIZATION_EXCEEDS_INSIGHT_VALIDITY");
    const acceptance = receipt.authorizationEvidence.acceptance;
    const times = [
      bundle.transactionDraft.createdAt,
      source.data.checkedAt,
      bundle.governor.decision.evaluatedAt,
      authorization.issuedAt,
      acceptance.acceptedAt,
      receipt.execution.executedAt,
      receipt.execution.observedAt,
      receipt.issuedAt
    ];
    requireClaim(times.every(Number.isSafeInteger), "TIMELINE_MALFORMED");
    requireClaim(times.every((time, index) => index === 0 || time >= times[index - 1]), "TIMELINE_ORDER_INVALID");
    requireClaim(draftResult.deadline >= receipt.execution.executedAt, "ROUTER_DEADLINE_EXPIRED");
    return {
      ok: true,
      code: "OK",
      fixtureMode: bundle.fixtureMode,
      authority: {
        finalPolicyDecisionPoint: bundle.governor.policy.authority.finalPolicyDecisionPoint,
        insightRole: bundle.governor.policy.authority.insightRole,
        governorDecision: governorResult.finalDecision,
        principalAuthorizationVerified: true
      },
      authorization: {
        authorizationId: authorization.authorizationId,
        intentHash: authorization.intentHash,
        exactCallMatched: true,
        acceptedAt: acceptance.acceptedAt
      },
      timing: {
        draftCreatedAt: times[0],
        insightCheckedAt: times[1],
        governorEvaluatedAt: times[2],
        authorizationIssuedAt: times[3],
        authorizationAcceptedAt: times[4],
        executedAt: times[5],
        observedAt: times[6],
        authorizationValidUntil: authorization.expiresAt,
        insightValidUntil: Math.min(sourceResult.validUntil, destinationResult.validUntil),
        orderVerified: true,
        broadcastTimestampAttested: false
      },
      compliance: {
        status: receipt.compliance.status,
        reasonCodes: receipt.compliance.reasonCodes,
        receiptId: receipt.receiptId,
        txHash: receipt.execution.txHash,
        confirmations: receipt.execution.confirmations
      },
      historicalVerification: {
        insightHistoricalKeyValidAtIssuance: sourceResult.keyValidAtIssuance && destinationResult.keyValidAtIssuance,
        insightKeyRotatedByBundleAssembly: sourceResult.keyRotatedAtAssembly && destinationResult.keyRotatedAtAssembly,
        priorSealHistoricalKeyStatus: key.status,
        oldReceiptStillVerifies: true,
        ordinaryExpiryDoesNotEraseHistory: true,
        revocationWouldBeReportedSeparately: true
      },
      limits: bundle.limits
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof VerificationFailure ? error.code : "UNEXPECTED_VERIFIER_ERROR",
      ...error instanceof VerificationFailure && error.detail ? { detail: error.detail } : {}
    };
  }
}
function withRehashedMutation(bundle, mutate) {
  const clone = structuredClone(bundle);
  mutate(clone);
  const { bundleHash: _ignored, ...unsigned } = clone;
  clone.bundleHash = sha256Canonical(unsigned);
  return clone;
}
async function runFixtureChecks() {
  const bundle = readEvidenceBundle();
  const roots = readTrustRoots();
  const baseline = await verifyEvidenceBundle(bundle, roots);
  const cases = [
    { name: "complete exported evidence", expected: "OK", result: baseline },
    {
      name: "tampered governor decision",
      expected: "GOVERNOR_DECISION_MISMATCH",
      result: await verifyEvidenceBundle(withRehashedMutation(bundle, (copy) => {
        copy.governor.decision.decision = "ALLOW_EXECUTION";
      }), roots)
    },
    {
      name: "authorization gate bypass policy",
      expected: "GOVERNOR_AUTHORIZATION_GATE_BYPASS",
      result: await verifyEvidenceBundle(withRehashedMutation(bundle, (copy) => {
        copy.governor.policy.composition.passWithoutNativeConfirmation = "ALLOW_EXECUTION";
      }), roots)
    },
    {
      name: "tampered raw calldata",
      expected: "DRAFT_CALLDATA_HASH_MISMATCH",
      result: await verifyEvidenceBundle(withRehashedMutation(bundle, (copy) => {
        copy.transactionDraft.data = "0x1234";
      }), roots)
    },
    {
      name: "historical Insight key revoked",
      expected: "INSIGHT_KEY_REVOKED",
      result: await verifyEvidenceBundle(withRehashedMutation(bundle, (copy) => {
        copy.insight.keyRegistry.public_keys[0].revoked = true;
      }), roots)
    },
    {
      name: "tampered observed execution",
      expected: "PRIORSEAL_INVALID_SIGNATURE",
      result: await verifyEvidenceBundle(withRehashedMutation(bundle, (copy) => {
        copy.priorSeal.receipt.execution.calldataHash = `0x${"ff".repeat(32)}`;
      }), roots)
    }
  ];
  const mismatches = cases.filter((entry) => entry.result.code !== entry.expected);
  return {
    status: mismatches.length ? "FAIL" : "PASS",
    cases: cases.map((entry) => ({
      name: entry.name,
      expected: entry.expected,
      actual: entry.result.code
    })),
    report: baseline
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = await runFixtureChecks();
  process.stdout.write(`${JSON.stringify(output, null, 2)}
`);
  if (output.status !== "PASS") process.exitCode = 1;
}
export {
  runFixtureChecks,
  verifyEvidenceBundle
};
