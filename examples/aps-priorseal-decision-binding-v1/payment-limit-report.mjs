// Generated from payment-limit-report.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { loadApsCase, verifyPair, verifySourceIntegrity } from "./adapter.mjs";
import { REFERENCE_TIME } from "./trust.mjs";
const PRODUCER_COMMIT = "948f99b85343bef2c6fa677c8543965caacfc087";
const POSITIVE_FILE = "payment-within-limit.json";
const NEGATIVE_FILE = "payment-over-limit.json";
const EXPECTED_CAP_WEI = "5000000000000000";
const EXPECTED_CALL_WEI = "1000000000000000";
const EXPECTED_OVER_LIMIT_WEI = "6000000000000000";
const EXPECTED_UNIT = "eip155:31337:native:wei";
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function object(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value;
}
function member(value, key, label) {
  return object(object(value, label)[key], `${label}.${key}`);
}
function decimal(value, label) {
  assert.ok(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), label);
  return value;
}
function readFixture(file) {
  const bytes = readFileSync(new URL(`./priorseal-inputs/${file}`, import.meta.url), "utf8");
  return { bytes, value: object(JSON.parse(bytes), file) };
}
async function runPaymentLimitReport() {
  const source = verifySourceIntegrity();
  const apsInput = loadApsCase("permit");
  const selectedChain = apsInput.evidence.authority_state.selected_chain;
  assert.ok(Array.isArray(selectedChain) && selectedChain.length > 0, "APS authority chain");
  const spend = member(member(selectedChain.at(-1), "authority", "APS delegation"), "spend", "APS authority");
  assert.equal(spend.mode, "bounded");
  assert.equal(spend.unit, EXPECTED_UNIT);
  const capWei = decimal(spend.per_action, "APS spend.per_action");
  const requestedCallWei = decimal(apsInput.evidence.policy_input.requested_call.value_wei, "APS requested call");
  assert.equal(capWei, EXPECTED_CAP_WEI);
  assert.equal(requestedCallWei, EXPECTED_CALL_WEI);
  const positive = readFixture(POSITIVE_FILE);
  const negative = readFixture(NEGATIVE_FILE);
  const positiveAuthorization = member(
    member(positive.value, "authorizationEvidence", POSITIVE_FILE),
    "authorization",
    POSITIVE_FILE
  );
  const negativeAuthorization = member(
    member(negative.value, "authorizationEvidence", NEGATIVE_FILE),
    "authorization",
    NEGATIVE_FILE
  );
  assert.ok(isDeepStrictEqual(positiveAuthorization, negativeAuthorization), "same principal-signed authorization");
  const authorizationHash = positive.value.authorizationHash;
  assert.ok(typeof authorizationHash === "string" && /^[0-9a-f]{64}$/.test(authorizationHash));
  assert.equal(authorizationHash, negative.value.authorizationHash);
  const intent = member(positiveAuthorization, "intent", "authorization");
  const signedCallWei = decimal(intent.transactionValue, "PriorSeal exact-call value");
  assert.equal(signedCallWei, requestedCallWei);
  assert.equal(intent.amount, signedCallWei);
  assert.equal(intent.asset, "eip155:31337/native");
  assert.equal(intent.chainId, 31337);
  const positiveExecution = member(positive.value, "execution", POSITIVE_FILE);
  const negativeExecution = member(negative.value, "execution", NEGATIVE_FILE);
  for (const [label, execution] of [[POSITIVE_FILE, positiveExecution], [NEGATIVE_FILE, negativeExecution]]) {
    assert.equal(execution.observationSource, "fixture", `${label}: synthetic source`);
    assert.equal(execution.chainId, intent.chainId, `${label}: chain`);
    assert.equal(execution.asset, intent.asset, `${label}: asset`);
    assert.equal(execution.target, intent.callTarget, `${label}: target`);
    assert.equal(execution.calldataHash, intent.calldataHash, `${label}: calldata`);
    assert.equal(execution.nonce, intent.nonce, `${label}: nonce`);
  }
  const positiveObservedWei = decimal(positiveExecution.nativeValue, "positive observed native value");
  const negativeObservedWei = decimal(negativeExecution.nativeValue, "negative observed native value");
  assert.equal(positiveObservedWei, signedCallWei);
  assert.equal(negativeObservedWei, EXPECTED_OVER_LIMIT_WEI);
  assert.ok(BigInt(positiveObservedWei) <= BigInt(capWei), "positive within APS cap");
  assert.ok(BigInt(negativeObservedWei) > BigInt(capWei), "negative above APS cap");
  assert.ok(BigInt(negativeObservedWei) > BigInt(signedCallWei), "negative above signed call");
  const positiveResult = await verifyPair(apsInput, positive.value);
  const negativeResult = await verifyPair(apsInput, negative.value);
  for (const [label, result] of [[POSITIVE_FILE, positiveResult], [NEGATIVE_FILE, negativeResult]]) {
    assert.equal(result.aps.ok, true, `${label}: APS evidence`);
    assert.equal(result.priorSeal.valid, true, `${label}: PriorSeal receipt`);
    assert.equal(result.priorSeal.verificationScope, "LOCAL_COMPLETE", `${label}: verification scope`);
    assert.equal(result.composition.code, "DECISION_AUTHORIZATION_CORRELATED", `${label}: correlation`);
  }
  assert.equal(positiveResult.priorSeal.complianceStatus, "COMPLIANT");
  assert.equal(negativeResult.priorSeal.complianceStatus, "NON_COMPLIANT");
  const positiveCompliance = member(positive.value, "compliance", POSITIVE_FILE);
  const negativeCompliance = member(negative.value, "compliance", NEGATIVE_FILE);
  assert.ok(isDeepStrictEqual(positiveCompliance.reasonCodes, []), "positive reason codes");
  assert.ok(isDeepStrictEqual(negativeCompliance.reasonCodes, ["TRANSACTION_VALUE_MISMATCH"]), "negative reason code");
  const positiveComposition = positiveResult.composition;
  const negativeComposition = negativeResult.composition;
  assert.ok("decisionRef" in positiveComposition && "authorizationId" in positiveComposition);
  assert.ok("decisionRef" in negativeComposition && "authorizationId" in negativeComposition);
  assert.equal(positiveComposition.decisionRef, negativeComposition.decisionRef);
  assert.equal(positiveComposition.authorizationId, negativeComposition.authorizationId);
  assert.notEqual(positive.value.signature, negative.value.signature, "separately signed execution receipts");
  const apsFiles = ["action-intent-receipt.json", "policy-decision-receipt.json", "decision-evidence.json"];
  const apsSourceSha256 = Object.fromEntries(apsFiles.map((file) => [file, sha256(readFileSync(
    new URL(`./aps-inputs/cases/permit/${file}`, import.meta.url),
    "utf8"
  ))]));
  return {
    profile: "aps-priorseal-payment-limit-offline-report.v1",
    producer: {
      commit: PRODUCER_COMMIT,
      manifestSha256: source.manifestSha256,
      manifestFiles: source.files,
      permitSourceSha256: apsSourceSha256
    },
    dependencies: { aps: "6.0.1", priorseal: "0.4.0" },
    referenceTime: REFERENCE_TIME,
    payment: {
      unit: EXPECTED_UNIT,
      apsPerActionCapWei: capWei,
      apsRequestedCallWei: requestedCallWei,
      priorSealSignedCallWei: signedCallWei,
      sharedAuthorizationHash: authorizationHash,
      sharedDecisionRef: positiveComposition.decisionRef
    },
    positive: {
      file: POSITIVE_FILE,
      sha256: sha256(positive.bytes),
      observedNativeValueWei: positiveObservedWei,
      withinApsCap: true,
      matchesSignedCall: true,
      aps: positiveResult.aps.code,
      priorSealReceiptValid: positiveResult.priorSeal.valid,
      priorSealCompliance: "COMPLIANT",
      composition: positiveResult.composition.code,
      pass: true
    },
    overLimitNegative: {
      file: NEGATIVE_FILE,
      sha256: sha256(negative.bytes),
      observedNativeValueWei: negativeObservedWei,
      aboveApsCap: true,
      matchesSignedCall: false,
      aps: negativeResult.aps.code,
      priorSealReceiptValid: negativeResult.priorSeal.valid,
      priorSealCompliance: "NON_COMPLIANT",
      reasonCodes: negativeCompliance.reasonCodes,
      composition: negativeResult.composition.code,
      pass: true
    },
    scope: {
      syntheticObservations: true,
      independentlyVerifiedChainExecution: false,
      liveApsCurrencyEstablished: false,
      apsDecisionSingleUseEstablished: false,
      newApsFixtureRequired: false,
      realTransactionSent: false
    },
    allChecksPassed: true
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runPaymentLimitReport(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
export {
  runPaymentLimitReport
};
