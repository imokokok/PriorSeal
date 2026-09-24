#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as verifyEd25519,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  verifyTypedData,
} from 'viem';
import { matchUniqueContextCommitment } from '../../sdk/dist/index.js';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';
import { jcsCanonicalBytes } from './jcs.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const REQUIRED_BOUNDARY_FIELDS = [
  'receipt_version',
  'receipt_role',
  'event_id',
  'timestamp',
  'action_type',
  'status',
];
const INSIGHT_UINT_FIELDS = [
  'subjectChainId',
  'tradeAmountUsd',
  'consensusPrice',
  'maxDeviationBps',
  'manipulationRiskBps',
  'participantCount',
  'requiredParticipantCount',
  'sourceGroupCount',
  'crossProviderAgreementBps',
  'maxStablecoinDepegBps',
  'maxDataAgeSeconds',
  'recommendedMaxPositionUsd',
  'validUntil',
  'checkedAt',
  'schemaVersion',
  'requiredSourceGroupCount',
];

const INSIGHT_DOMAIN = {
  name: 'Insight Oracle Safety',
  version: '3',
  chainId: 1,
};
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    { name: 'verdict', type: 'string' },
    { name: 'sourceAssetId', type: 'string' },
    { name: 'destinationAssetId', type: 'string' },
    { name: 'subjectChainId', type: 'uint256' },
    { name: 'action', type: 'string' },
    { name: 'tradeAmountUsd', type: 'uint256' },
    { name: 'consensusPrice', type: 'uint256' },
    { name: 'maxDeviationBps', type: 'uint256' },
    { name: 'manipulationRiskBps', type: 'uint256' },
    { name: 'participantCount', type: 'uint256' },
    { name: 'requiredParticipantCount', type: 'uint256' },
    { name: 'coverageStatus', type: 'string' },
    { name: 'independenceStatus', type: 'string' },
    { name: 'sourceGroupCount', type: 'uint256' },
    { name: 'crossProviderAgreementBps', type: 'uint256' },
    { name: 'maxStablecoinDepegBps', type: 'uint256' },
    { name: 'maxDataAgeSeconds', type: 'uint256' },
    { name: 'recommendedMaxPositionUsd', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' },
    { name: 'requestHash', type: 'bytes32' },
    { name: 'evaluationScope', type: 'string' },
    { name: 'evaluatedAssetIdsHash', type: 'bytes32' },
    { name: 'providerObservationsHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'requiredSourceGroupCount', type: 'uint256' },
  ],
} as const;
const CANONICAL_REQUEST_DOMAIN = {
  name: 'Insight Canonical Pre-Trade Request',
  version: '1',
  chainId: 1,
};
const CANONICAL_REQUEST_TYPES = {
  CanonicalPreTradeRequest: [
    { name: 'subjectChainId', type: 'uint256' },
    { name: 'sourceAssetId', type: 'string' },
    { name: 'destinationAssetId', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'tradeAmountUsd', type: 'uint256' },
  ],
};
const BOUNDARY_SCOPE_FIELDS = [
  'chainId',
  'executor',
  'transactionNonce',
  'callTarget',
  'calldataHash',
  'nativeValue',
];

function readJson(name: any) {
  return JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
}

function isRecord(value: any) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: string, detail?: string) {
  return { ok: false as const, code, ...(detail ? { detail } : {}) };
}

function sha256HexBytes(bytes: any) {
  return `0x${createHash('sha256').update(bytes).digest('hex')}`;
}

function externalKeyId(publicKeyPem: any) {
  const der = createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

function insightMessage(data: any) {
  const message = { ...data };
  for (const field of INSIGHT_UINT_FIELDS) {
    if (!Number.isSafeInteger(data?.[field]) || data[field] < 0) {
      throw new TypeError(`${field} must be a non-negative safe integer`);
    }
    message[field] = BigInt(data[field]);
  }
  return message;
}

function recomputeInsightRequestHash(data: any) {
  return hashTypedData({
    domain: CANONICAL_REQUEST_DOMAIN,
    types: CANONICAL_REQUEST_TYPES,
    primaryType: 'CanonicalPreTradeRequest',
    message: {
      subjectChainId: BigInt(data.subjectChainId),
      sourceAssetId: data.sourceAssetId,
      destinationAssetId: data.destinationAssetId,
      action: data.action,
      tradeAmountUsd: BigInt(data.tradeAmountUsd),
    },
  });
}

export async function verifyInsightAttestation(
  attestation: any,
  expectedAttester: any,
  authorizationTime: any,
) {
  if (!isRecord(attestation) || !isRecord(attestation.data))
    return fail('ATTESTATION_INVALID');
  if (
    attestation.schemaVersion !== 3 ||
    attestation.data.schemaVersion !== 3 ||
    typeof attestation.uid !== 'string' ||
    typeof attestation.signature !== 'string' ||
    typeof attestation.attester !== 'string'
  ) {
    return fail('ATTESTATION_INVALID');
  }
  if (attestation.attester.toLowerCase() !== expectedAttester.toLowerCase()) {
    return fail('SIGNER_UNTRUSTED');
  }
  try {
    const args = {
      domain: INSIGHT_DOMAIN,
      types: INSIGHT_TYPES,
      primaryType: 'OracleSafetyCheck' as const,
      message: insightMessage(attestation.data),
    };
    if (hashTypedData(args) !== attestation.uid) return fail('UID_MISMATCH');
    if (
      !(await verifyTypedData({
        ...args,
        address: attestation.attester,
        signature: attestation.signature,
      }))
    ) {
      return fail('SIGNATURE_INVALID');
    }
  } catch {
    return fail('SIGNATURE_INVALID');
  }
  try {
    if (
      recomputeInsightRequestHash(attestation.data) !==
      attestation.data.requestHash
    ) {
      return fail('REQUEST_HASH_MISMATCH');
    }
  } catch {
    return fail('REQUEST_HASH_MISMATCH');
  }
  if (attestation.data.verdict !== 'PASS') return fail('RISK_NOT_PASSING');
  if (attestation.data.checkedAt > authorizationTime)
    return fail('EVIDENCE_FROM_FUTURE');
  if (authorizationTime > attestation.data.validUntil)
    return fail('EVIDENCE_EXPIRED');
  if (
    attestation.validUntil !== attestation.data.validUntil ||
    attestation.data.requiredSourceGroupCount !== 2 ||
    attestation.data.sourceGroupCount <
      attestation.data.requiredSourceGroupCount ||
    attestation.data.participantCount <
      attestation.data.requiredParticipantCount
  ) {
    return fail('SIGNED_POLICY_NOT_SATISFIED');
  }
  return { ok: true as const, code: 'OK', uid: attestation.uid, data: attestation.data };
}

export function computeInsightPairCommitment(
  source: any,
  destination: any,
  maxSlippageBps: any,
) {
  if (
    !Number.isSafeInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > 65_535
  ) {
    throw new TypeError('maxSlippageBps must fit uint16');
  }
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32', name: 'sourceUid' },
      { type: 'bytes32', name: 'destinationUid' },
      { type: 'bytes32', name: 'sourceRequestHash' },
      { type: 'bytes32', name: 'destinationRequestHash' },
      { type: 'uint16', name: 'maxSlippageBps' },
    ],
    [
      source.uid,
      destination.uid,
      source.data.requestHash,
      destination.data.requestHash,
      maxSlippageBps,
    ],
  );
  return {
    namespace: 'insight.pretrade-pair.v1',
    algorithm: 'keccak256' as const,
    digest: keccak256(encoded),
  };
}

export function verifyBoundaryAttestReceipt(receipt: any, expectedPublicKey: any) {
  if (!isRecord(receipt)) return fail('BOUNDARYATTEST_RECEIPT_INVALID');
  if (
    Object.keys(receipt).sort().join(',') !== 'claim,public_key_id,signature'
  ) {
    return fail('BOUNDARYATTEST_ENVELOPE_INVALID');
  }
  if (!isRecord(receipt.claim) || typeof receipt.signature !== 'string') {
    return fail('BOUNDARYATTEST_RECEIPT_INVALID');
  }
  for (const field of REQUIRED_BOUNDARY_FIELDS) {
    if (!Object.hasOwn(receipt.claim, field))
      return fail(`BOUNDARYATTEST_FIELD_MISSING:${field}`);
  }
  if (receipt.claim.receipt_version !== '0.2')
    return fail('BOUNDARYATTEST_VERSION_UNSUPPORTED');
  try {
    if (receipt.public_key_id !== externalKeyId(expectedPublicKey)) {
      return fail('BOUNDARYATTEST_KEY_ID_MISMATCH');
    }
    if (
      !verifyEd25519(
        null,
        jcsCanonicalBytes(receipt.claim),
        expectedPublicKey,
        Buffer.from(receipt.signature, 'base64'),
      )
    ) {
      return fail('BOUNDARYATTEST_SIGNATURE_INVALID');
    }
  } catch {
    return fail('BOUNDARYATTEST_SIGNATURE_INVALID');
  }
  if (
    receipt.claim.receipt_role !== 'server_attested' ||
    receipt.claim.action_type !== 'governance.decision_evidence_exported' ||
    receipt.claim.status !== 'exported'
  ) {
    return fail('BOUNDARYATTEST_CORE_EVENT_SEMANTICS_INVALID');
  }
  const decision = receipt.claim.decision_record;
  if (
    !isRecord(decision) ||
    !isRecord(decision.subject) ||
    !isRecord(decision.resolution)
  ) {
    return fail('BOUNDARYATTEST_DECISION_RECORD_INVALID');
  }
  if (
    ![
      'proceed_to_principal_authorization',
      'stop_before_principal_authorization',
    ].includes(decision.resolution.verdict) ||
    decision.resolution.chosen_option !== decision.resolution.verdict
  ) {
    return fail('BOUNDARYATTEST_GOVERNANCE_VERDICT_INVALID');
  }

  const expectedOptions = [
    'proceed_to_principal_authorization',
    'stop_before_principal_authorization',
  ];
  const expectedAdjudicationOutcome =
    decision.resolution.verdict === 'proceed_to_principal_authorization'
      ? 'released_to_principal_authorization'
      : 'stopped_before_principal_authorization';
  if (
    Object.keys(decision.subject).sort().join(',') !==
      'action_ref,action_type' ||
    typeof decision.decision_id !== 'string' ||
    decision.decision_id.length === 0 ||
    !Array.isArray(decision.opened?.options) ||
    decision.opened.options.length !== expectedOptions.length ||
    !expectedOptions.every((option) =>
      decision.opened.options.includes(option),
    ) ||
    !Array.isArray(decision.inputs) ||
    decision.inputs.length === 0 ||
    decision.inputs.some(
      (input: any) =>
        !isRecord(input) ||
        input.decision_id !== decision.decision_id ||
        input.evidence_bundle_digest !== decision.evidence?.bundle_digest,
    ) ||
    decision.adjudication?.decision_id !== decision.decision_id ||
    decision.adjudication?.outcome !== expectedAdjudicationOutcome ||
    decision.execution_observation?.state !== 'not_observed'
  ) {
    return fail('BOUNDARYATTEST_DECISION_RECORD_INVALID');
  }
  return { ok: true as const, code: 'OK', claim: receipt.claim, decision };
}

function parseWholeSecondTimestamp(value: any) {
  const seconds = Date.parse(value) / 1000;
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function checkFreshness({
  timestamp,
  authorizationTime,
  maxAge,
  maxFutureSkew,
  invalid,
  future,
  stale,
}: any) {
  const observed = parseWholeSecondTimestamp(timestamp);
  if (observed === null) return fail(invalid);
  if (observed > authorizationTime + maxFutureSkew) return fail(future);
  if (authorizationTime - observed > maxAge) return fail(stale);
  return { ok: true as const, code: 'OK', observed };
}

function priorSealPublicKeyFingerprint(publicKeyPem: any) {
  const der = createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  });
  return createHash('sha256').update(der).digest('hex');
}

function mapScopeMismatch(scope: any, intent: any) {
  if (
    !isRecord(scope) ||
    Object.keys(scope).length !== BOUNDARY_SCOPE_FIELDS.length ||
    !Object.keys(scope).every((field) =>
      BOUNDARY_SCOPE_FIELDS.includes(field),
    ) ||
    !Number.isSafeInteger(scope.chainId) ||
    scope.chainId < 1 ||
    typeof scope.executor !== 'string' ||
    !/^0x[0-9a-f]{40}$/.test(scope.executor) ||
    typeof scope.callTarget !== 'string' ||
    !/^0x[0-9a-f]{40}$/.test(scope.callTarget) ||
    typeof scope.transactionNonce !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(scope.transactionNonce) ||
    typeof scope.nativeValue !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(scope.nativeValue) ||
    typeof scope.calldataHash !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(scope.calldataHash)
  ) {
    return fail('BOUNDARYATTEST_SCOPE_INVALID');
  }
  if (scope.chainId !== intent.chainId)
    return fail('BOUNDARYATTEST_SCOPE_CHAIN_MISMATCH');
  if (scope.executor !== intent.sender)
    return fail('BOUNDARYATTEST_SCOPE_EXECUTOR_MISMATCH');
  if (scope.transactionNonce !== intent.nonce)
    return fail('BOUNDARYATTEST_SCOPE_NONCE_MISMATCH');
  if (scope.callTarget !== intent.callTarget)
    return fail('BOUNDARYATTEST_SCOPE_TARGET_MISMATCH');
  if (scope.calldataHash !== intent.calldataHash)
    return fail('BOUNDARYATTEST_SCOPE_CALLDATA_MISMATCH');
  if (scope.nativeValue !== intent.transactionValue)
    return fail('BOUNDARYATTEST_SCOPE_VALUE_MISMATCH');
  return { ok: true as const, code: 'OK' };
}

export function evaluateBoundaryAttestValue(deletionTest: any) {
  if (
    !isRecord(deletionTest) ||
    typeof deletionTest.exactFact !== 'string' ||
    deletionTest.exactFact.length === 0 ||
    typeof deletionTest.materialFactLost !== 'boolean' ||
    typeof deletionTest.providerReason !== 'string' ||
    deletionTest.providerReason.length === 0
  ) {
    return fail('BOUNDARYATTEST_DELETION_TEST_INVALID');
  }
  const materialFactLost = deletionTest.materialFactLost;
  return {
    ok: true as const,
    code: 'OK',
    valueConclusion: materialFactLost
      ? 'BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF'
      : 'BOUNDARYATTEST_REFERENCE_ONLY',
    deletionTest: {
      removedObject: 'BoundaryAttest',
      unverifiableFact: materialFactLost ? deletionTest.exactFact : null,
      result: materialFactLost ? 'MATERIAL_FACT_LOST' : 'NO_MATERIAL_FACT_LOST',
    },
    providerReason: deletionTest.providerReason,
  };
}

export async function verifyThreeObjectFlow({
  insightSource,
  insightDestination,
  boundaryReceipt,
  boundaryPublicKey,
  priorSealReceipt,
  trustedIssuerKeys,
  expected,
  usedSignedExports = new Set(),
  usedDecisionIds = new Set(),
}: any) {
  if (!isRecord(priorSealReceipt)) return fail('PRIORSEAL_RECEIPT_MISSING');
  const authorizationTime =
    priorSealReceipt?.authorizationEvidence?.authorization?.issuedAt;
  if (!Number.isSafeInteger(authorizationTime))
    return fail('PRIORSEAL_AUTHORIZATION_TIME_INVALID');

  const source = await verifyInsightAttestation(
    insightSource,
    expected.insight.expectedAttester,
    authorizationTime,
  );
  if (!source.ok) return fail(`INSIGHT_SOURCE_${source.code}`);
  const destination = await verifyInsightAttestation(
    insightDestination,
    expected.insight.expectedAttester,
    authorizationTime,
  );
  if (!destination.ok) return fail(`INSIGHT_DESTINATION_${destination.code}`);
  if (
    source.data.subjectChainId !== destination.data.subjectChainId ||
    source.data.sourceAssetId !== destination.data.destinationAssetId ||
    source.data.destinationAssetId !== destination.data.sourceAssetId ||
    source.data.action !== 'swap' ||
    destination.data.action !== 'swap'
  ) {
    return fail('INSIGHT_PAIR_CORRELATION_MISMATCH');
  }
  const insightCommitment = computeInsightPairCommitment(
    insightSource,
    insightDestination,
    expected.insight.maxSlippageBps,
  );

  const boundary = verifyBoundaryAttestReceipt(
    boundaryReceipt,
    boundaryPublicKey,
  );
  if (!boundary.ok) return boundary;

  const trustedKey = trustedIssuerKeys?.keys?.find(
    (entry: any) =>
      entry.issuer === expected.priorSeal.issuer &&
      entry.keyId === expected.priorSeal.keyId,
  );
  if (
    !trustedKey ||
    trustedIssuerKeys.issuer !== expected.priorSeal.issuer ||
    !['active', 'retired'].includes(trustedKey.status) ||
    priorSealPublicKeyFingerprint(trustedKey.publicKey) !==
      expected.priorSeal.publicKeySpkiSha256
  ) {
    return fail('PRIORSEAL_UNKNOWN_KEY');
  }
  const priorSeal = await verifyReceiptLocally(priorSealReceipt, {
    trustedKeys: trustedKey,
    now: priorSealReceipt.issuedAt,
  });
  if (!priorSeal.valid) return fail(`PRIORSEAL_${priorSeal.code}`);
  if (priorSeal.verificationScope !== 'LOCAL_COMPLETE') {
    return fail('PRIORSEAL_EXTERNAL_CHECK_REQUIRED');
  }
  if (
    priorSeal.executionStatus !== 'CONFIRMED' ||
    priorSeal.complianceStatus !== 'COMPLIANT'
  ) {
    return fail('PRIORSEAL_RECEIPT_NOT_COMPLIANT');
  }
  const intent = priorSealReceipt.authorizationEvidence.authorization.intent;
  if (
    intent.schema !== 'priorseal.intent.v2' ||
    intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1'
  ) {
    return fail('PRIORSEAL_EXACT_CALL_REQUIRED');
  }

  let commitment = matchUniqueContextCommitment(intent, insightCommitment);
  if (!commitment.matched) return fail(`INSIGHT_${commitment.code}`);

  const boundaryDigest = sha256HexBytes(
    jcsCanonicalBytes(boundaryReceipt.claim),
  );
  commitment = matchUniqueContextCommitment(intent, {
    namespace: expected.boundaryAttest.namespace,
    algorithm: 'sha256',
    digest: boundaryDigest,
  });
  if (!commitment.matched) return fail(`BOUNDARYATTEST_${commitment.code}`);

  const signerDigest = `0x${boundaryReceipt.public_key_id.slice('sha256:'.length)}`;
  commitment = matchUniqueContextCommitment(intent, {
    namespace: expected.boundaryAttest.signerNamespace,
    algorithm: 'sha256',
    digest: signerDigest,
  });
  if (!commitment.matched)
    return fail(`BOUNDARYATTEST_SIGNER_${commitment.code}`);

  const decision = boundary.decision;
  if (decision.resolution.verdict !== 'proceed_to_principal_authorization') {
    return fail('BOUNDARYATTEST_GOVERNANCE_STOPPED');
  }
  if (decision.subject.action_ref !== intent.intentId) {
    return fail('BOUNDARYATTEST_SUBJECT_ACTION_REF_MISMATCH');
  }
  if (decision.subject.action_type !== 'evm.exact-call') {
    return fail('BOUNDARYATTEST_SUBJECT_ACTION_TYPE_MISMATCH');
  }
  const expectedInsightRef = `${insightCommitment.namespace}:${insightCommitment.digest}`;
  if (decision.evidence?.source_ref !== expectedInsightRef) {
    return fail('BOUNDARYATTEST_INSIGHT_REFERENCE_MISMATCH');
  }
  const scope = decision.opened?.scope;
  if (!isRecord(scope)) return fail('BOUNDARYATTEST_SCOPE_INVALID');
  const scopeResult = mapScopeMismatch(scope, intent);
  if (!scopeResult.ok) return scopeResult;
  if (source.data.subjectChainId !== intent.chainId)
    return fail('INSIGHT_PRIORSEAL_CHAIN_MISMATCH');

  const exportFreshness = checkFreshness({
    timestamp: boundary.claim.timestamp,
    authorizationTime,
    maxAge: expected.boundaryAttest.maxExportAgeSeconds,
    maxFutureSkew: expected.boundaryAttest.maxFutureSkewSeconds,
    invalid: 'BOUNDARYATTEST_EXPORT_TIMESTAMP_INVALID',
    future: 'BOUNDARYATTEST_EXPORT_FROM_FUTURE',
    stale: 'BOUNDARYATTEST_EXPORT_STALE',
  });
  if (!exportFreshness.ok) return exportFreshness;
  const decisionFreshness = checkFreshness({
    timestamp: decision.resolution.timestamp,
    authorizationTime,
    maxAge: expected.boundaryAttest.maxDecisionAgeSeconds,
    maxFutureSkew: expected.boundaryAttest.maxFutureSkewSeconds,
    invalid: 'BOUNDARYATTEST_DECISION_TIMESTAMP_INVALID',
    future: 'BOUNDARYATTEST_DECISION_FROM_FUTURE',
    stale: 'BOUNDARYATTEST_DECISION_STALE',
  });
  if (!decisionFreshness.ok) return decisionFreshness;

  const earliestEvidenceExpiry = Math.min(
    source.data.validUntil,
    destination.data.validUntil,
    decisionFreshness.observed + expected.boundaryAttest.maxDecisionAgeSeconds,
  );
  if (intent.validUntil > earliestEvidenceExpiry) {
    return fail('PRIORSEAL_VALIDITY_EXCEEDS_EVIDENCE');
  }

  const eventId = boundary.claim.event_id;
  const decisionId = decision.decision_id;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return fail('BOUNDARYATTEST_EVENT_ID_INVALID');
  }
  if (typeof decisionId !== 'string' || decisionId.length === 0) {
    return fail('BOUNDARYATTEST_DECISION_ID_INVALID');
  }
  const exportReplayKey = JSON.stringify([
    boundaryReceipt.public_key_id,
    eventId,
  ]);
  if (usedSignedExports.has(exportReplayKey))
    return fail('BOUNDARYATTEST_EXPORT_REPLAYED');
  if (usedDecisionIds.has(decisionId))
    return fail('BOUNDARYATTEST_DECISION_REPLAYED');

  const valueEvaluation = evaluateBoundaryAttestValue(
    expected.boundaryAttest.deletionTest,
  );
  if (!valueEvaluation.ok) return valueEvaluation;

  usedSignedExports.add(exportReplayKey);
  usedDecisionIds.add(decisionId);
  return {
    ok: true as const,
    code: 'OK',
    valueConclusion: valueEvaluation.valueConclusion,
    deletionTest: valueEvaluation.deletionTest,
    providerReason: valueEvaluation.providerReason,
    insightCommitment,
    boundaryAttestDigest: boundaryDigest,
    boundaryAttestSignerDigest: signerDigest,
    boundaryAttestEventId: eventId,
    boundaryAttestDecisionId: decisionId,
    priorSealReceiptId: priorSealReceipt.receiptId,
    executionStatus: priorSeal.executionStatus,
    complianceStatus: priorSeal.complianceStatus,
  };
}

function applyMutation(caseDefinition: any, source: any, boundaryReceipt: any) {
  if (caseDefinition.mutation === 'tamper-insight-source-verdict') {
    source.data.verdict = 'BLOCK';
  }
  if (caseDefinition.mutation === 'tamper-boundary-verdict') {
    boundaryReceipt.claim.decision_record.resolution.verdict =
      'stop_before_principal_authorization';
  }
}

export async function runFixtureChecks({ log = console.log } = {}) {
  const expected = readJson('expected.json');
  const trustedIssuerKeys = readJson('priorseal-trusted-issuer-keys.json');
  const boundaryPublicKey = readFileSync(
    resolve(directory, 'boundaryattest-public-key.pem'),
    'utf8',
  );
  const results = [];

  for (const caseDefinition of expected.cases) {
    const source = readJson(
      caseDefinition.insightSource ?? 'insight-source.json',
    );
    const destination = readJson(
      caseDefinition.insightDestination ?? 'insight-destination.json',
    );
    const boundaryReceipt = readJson(
      caseDefinition.boundaryReceipt ?? 'boundaryattest-receipt.json',
    );
    const priorSealReceipt = readJson(
      caseDefinition.priorSealReceipt ?? 'priorseal-receipt-matching.json',
    );
    applyMutation(caseDefinition, source, boundaryReceipt);
    const usedSignedExports = new Set();
    const usedDecisionIds = new Set();
    if (caseDefinition.preloadExportReplay) {
      usedSignedExports.add(
        JSON.stringify([
          boundaryReceipt.public_key_id,
          boundaryReceipt.claim.event_id,
        ]),
      );
    }
    if (caseDefinition.preloadDecisionReplay) {
      usedDecisionIds.add(boundaryReceipt.claim.decision_record.decision_id);
    }
    const result = await verifyThreeObjectFlow({
      insightSource: source,
      insightDestination: destination,
      boundaryReceipt,
      boundaryPublicKey,
      priorSealReceipt,
      trustedIssuerKeys,
      expected,
      usedSignedExports,
      usedDecisionIds,
    });
    if (result.code !== caseDefinition.expectedCode) {
      throw new Error(
        `${caseDefinition.name}: expected ${caseDefinition.expectedCode}, received ${result.code}`,
      );
    }
    if (
      caseDefinition.expectedValueConclusion &&
      (!result.ok || result.valueConclusion !== caseDefinition.expectedValueConclusion)
    ) {
      throw new Error(
        `${caseDefinition.name}: expected ${caseDefinition.expectedValueConclusion}, received ${result.ok ? result.valueConclusion : result.code}`,
      );
    }
    results.push({ name: caseDefinition.name, ...result });
    log(`PASS ${caseDefinition.name}: ${result.code}`);
  }
  const passing = results.find((result) => result.ok);
  if (!passing || !passing.ok) throw new Error('Expected a passing composition vector');
  log(`VALUE ${passing.valueConclusion}`);
  log(`DELETION TEST ${passing.deletionTest.unverifiableFact}`);
  log(`PROVIDER REASON ${passing.providerReason}`);
  log(
    "LIMIT no signature proves another system's semantic truth; a passing composition is not economic safety, transaction authority, production readiness, adoption, or endorsement.",
  );
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runFixtureChecks();
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
