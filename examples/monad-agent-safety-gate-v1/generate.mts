#!/usr/bin/env node

/**
 * A deterministic, no-broadcast Monad reference for the public Agent Safety
 * Gate walkthrough. All signing material is deliberately public test material.
 * It must never receive funds or be used by a deployed service.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTypedData, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  canonicalize,
  signReceipt,
} from '../../src/index.mjs';
import { signAuthorizationReceipt } from '../../src/domain/authorization.mjs';
import { matchUniqueContextCommitment } from '../../sdk/dist/context-commitment.js';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';

const directory = dirname(fileURLToPath(import.meta.url));
const CHAIN_ID = 143;
const EXECUTOR = '0x2222222222222222222222222222222222222222';
const CALL_TARGET = '0x3333333333333333333333333333333333333333';
const CALLDATA_HASH = `0x${'6a'.repeat(32)}`;
const NATIVE_VALUE = '1000000000000000';
const NONCE = '17';
const CHECKED_AT = 1_792_540_800; // 2026-10-21T00:00:00Z
const DECIDED_AT = CHECKED_AT + 30;
const AUTHORIZED_AT = CHECKED_AT + 60;
const EXECUTED_AT = CHECKED_AT + 90;
const OBSERVED_AT = CHECKED_AT + 95;
const VALID_UNTIL = CHECKED_AT + 300;
const ISSUER = 'priorseal.monad-agent-safety-gate-fixture';
const KEY_ID = 'priorseal-monad-agent-safety-gate-fixture-1';

const INSIGHT_DOMAIN = { name: 'Insight Oracle Safety', version: '3', chainId: 1 } as const;
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
const UINT_FIELDS = [
  'subjectChainId', 'tradeAmountUsd', 'consensusPrice', 'maxDeviationBps',
  'manipulationRiskBps', 'participantCount', 'requiredParticipantCount',
  'sourceGroupCount', 'crossProviderAgreementBps', 'maxStablecoinDepegBps',
  'maxDataAgeSeconds', 'recommendedMaxPositionUsd', 'validUntil', 'checkedAt',
  'schemaVersion', 'requiredSourceGroupCount',
] as const;
const HASH_FIELDS = ['reasonCodesHash', 'requestHash', 'evaluatedAssetIdsHash', 'providerObservationsHash'] as const;

type InsightData = {
  verdict: 'PASS' | 'CAUTION' | 'DANGER' | 'BLOCK';
  sourceAssetId: string;
  destinationAssetId: string;
  subjectChainId: number;
  action: string;
  tradeAmountUsd: number;
  consensusPrice: number;
  maxDeviationBps: number;
  manipulationRiskBps: number;
  participantCount: number;
  requiredParticipantCount: number;
  coverageStatus: string;
  independenceStatus: string;
  sourceGroupCount: number;
  crossProviderAgreementBps: number;
  maxStablecoinDepegBps: number;
  maxDataAgeSeconds: number;
  recommendedMaxPositionUsd: number;
  reasonCodesHash: `0x${string}`;
  requestHash: `0x${string}`;
  evaluationScope: string;
  evaluatedAssetIdsHash: `0x${string}`;
  providerObservationsHash: `0x${string}`;
  validUntil: number;
  checkedAt: number;
  schemaVersion: number;
  requiredSourceGroupCount: number;
};
type InsightAttestation = {
  schema: 'insight.oracle-safety-attestation.v3';
  uid: `0x${string}`;
  attester: `0x${string}`;
  signature: `0x${string}`;
  validUntil: number;
  data: InsightData;
};
type RecordValue = Record<string, unknown>;

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function record(value: unknown, code: string): RecordValue {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  return value as RecordValue;
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalHash(value: unknown): `0x${string}` {
  return `0x${hash(canonicalize(value))}`;
}

function seededEd25519(seedByte: string) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seedByte.repeat(32), 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    fingerprint: hash(publicKey.export({ type: 'spki', format: 'der' })),
  };
}

function typedMessage(data: InsightData): Record<string, string | bigint> {
  const message: Record<string, string | bigint> = {};
  for (const [field, value] of Object.entries(data)) {
    message[field] = typeof value === 'number' ? BigInt(value) : value;
  }
  return message;
}

function typedAttestation(data: InsightData) {
  return {
    domain: INSIGHT_DOMAIN,
    types: INSIGHT_TYPES,
    primaryType: 'OracleSafetyCheck' as const,
    message: typedMessage(data),
  };
}

function gateEffect(verdict: InsightData['verdict']) {
  if (verdict === 'PASS') return 'PROCEED_TO_PRINCIPAL_AUTHORIZATION' as const;
  if (verdict === 'CAUTION') return 'REQUIRE_PRINCIPAL_CONFIRMATION' as const;
  return 'DENY' as const;
}

async function writeJson(name: string, value: unknown) {
  await writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function generate() {
  await mkdir(directory, { recursive: true });
  const insightAccount = privateKeyToAccount(`0x${'4'.repeat(64)}`);
  const principal = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const issuerKey = seededEd25519('88');
  const data: InsightData = {
    verdict: 'PASS',
    sourceAssetId: 'eip155:143/native',
    destinationAssetId: 'eip155:143/erc20:0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    subjectChainId: CHAIN_ID,
    action: 'swap',
    tradeAmountUsd: 25_000_000,
    consensusPrice: 2_500_000_000,
    maxDeviationBps: 12,
    manipulationRiskBps: 140,
    participantCount: 3,
    requiredParticipantCount: 3,
    coverageStatus: 'SUFFICIENT',
    independenceStatus: 'ASSESSED',
    sourceGroupCount: 3,
    crossProviderAgreementBps: 9_988,
    maxStablecoinDepegBps: 3,
    maxDataAgeSeconds: 20,
    recommendedMaxPositionUsd: 50_000_000,
    reasonCodesHash: `0x${'00'.repeat(32)}`,
    requestHash: `0x${'11'.repeat(32)}`,
    evaluationScope: 'PRE_TRADE_ORACLE_RISK',
    evaluatedAssetIdsHash: `0x${'22'.repeat(32)}`,
    providerObservationsHash: `0x${'33'.repeat(32)}`,
    validUntil: VALID_UNTIL,
    checkedAt: CHECKED_AT,
    schemaVersion: 3,
    requiredSourceGroupCount: 2,
  };
  const typedData = typedAttestation(data);
  const attestation: InsightAttestation = {
    schema: 'insight.oracle-safety-attestation.v3',
    uid: hashTypedData(typedData as Parameters<typeof hashTypedData>[0]),
    attester: insightAccount.address,
    signature: await insightAccount.signTypedData(typedData as Parameters<typeof insightAccount.signTypedData>[0]),
    validUntil: data.validUntil,
    data,
  };
  const insightCommitment = {
    namespace: 'insight.oracle-safety-attestation.v3',
    algorithm: 'sha256' as const,
    digest: canonicalHash(attestation),
  };
  const policy = {
    schema: 'monad.agent-safety-gate-policy.v1',
    finalDecisionPoint: 'integrator-owned-agent-policy',
    insightRole: 'signed-advisory-risk-input',
    priorSealRole: 'principal-authorization-and-execution-evidence',
    allowedChainId: CHAIN_ID,
    allowedCallTarget: CALL_TARGET,
    verdictMapping: {
      PASS: 'PROCEED_TO_PRINCIPAL_AUTHORIZATION',
      CAUTION: 'REQUIRE_PRINCIPAL_CONFIRMATION',
      DANGER: 'DENY',
      BLOCK: 'DENY',
    },
  };
  const decision = {
    schema: 'monad.agent-safety-gate-decision.v1',
    evaluatedAt: DECIDED_AT,
    attestationUid: attestation.uid,
    policyDigest: canonicalHash(policy),
    effect: gateEffect(attestation.data.verdict),
    requiresPrincipalAuthorization: true,
  };
  const decisionCommitment = {
    namespace: 'monad.agent-safety-gate-decision.v1',
    algorithm: 'sha256' as const,
    digest: canonicalHash(decision),
  };
  const authorizationDraft = buildAuthorization({
    intent: {
      schema: 'priorseal.intent.v2',
      executionProfile: 'priorseal.execution-profile.exact-call.v1',
      intentId: 'monad-agent-safety-gate-fixture-0001',
      chainId: CHAIN_ID,
      action: 'CONTRACT_CALL',
      asset: 'eip155:143/native',
      amount: NATIVE_VALUE,
      sender: EXECUTOR,
      recipient: CALL_TARGET,
      validUntil: VALID_UNTIL,
      nonce: NONCE,
      callTarget: CALL_TARGET,
      calldataHash: CALLDATA_HASH,
      transactionValue: NATIVE_VALUE,
      contextCommitments: [insightCommitment, decisionCommitment],
    },
    principal: { type: 'user', id: 'monad-agent-safety-gate-fixture-principal', account: principal.address },
    authorizer: { type: 'eip712', address: principal.address },
    delegate: { agentId: 'monad-agent-safety-gate-fixture-agent', executor: EXECUTOR },
    issuedAt: AUTHORIZED_AT,
    notBefore: AUTHORIZED_AT,
    expiresAt: VALID_UNTIL,
    authorizationNonce: `0x${'91'.repeat(32)}`,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: `0x${'00'.repeat(32)}`,
  });
  const authorization = buildAuthorization({
    ...authorizationDraft,
    signature: await principal.signTypedData(authorizationTypedData(authorizationDraft)),
  });
  const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
    authorization,
    issuer: ISSUER,
    keyId: KEY_ID,
    acceptedAt: AUTHORIZED_AT + 1,
  }), issuerKey.privateKeyPem);
  const execution = {
    schema: 'priorseal.execution-observation.v1',
    chainId: CHAIN_ID,
    txHash: `0x${'ab'.repeat(32)}`,
    status: 'CONFIRMED',
    blockNumber: 3_200_001,
    blockHash: `0x${'cd'.repeat(32)}`,
    executedAt: EXECUTED_AT,
    observedAt: OBSERVED_AT,
    action: 'CONTRACT_CALL',
    nonce: NONCE,
    sender: EXECUTOR,
    recipient: CALL_TARGET,
    target: CALL_TARGET,
    calldataHash: CALLDATA_HASH,
    asset: 'eip155:143/native',
    amount: NATIVE_VALUE,
    transfers: [],
    transferMatchUnique: false,
    nativeValue: NATIVE_VALUE,
    tokenValue: null,
    gasUsed: '180000',
    fee: null,
    executionDataAvailable: true,
    observationSource: 'synthetic-offline-fixture',
    finalityState: 'CONFIRMED',
    confirmations: 12,
  };
  const receipt = signReceipt(buildAuthorizedReceipt({
    authorization,
    acceptance,
    execution,
    issuer: ISSUER,
    keyId: KEY_ID,
    issuedAt: OBSERVED_AT,
  }), issuerKey.privateKeyPem);
  const keyRegistry = {
    schema: 'priorseal.keys.v1',
    issuer: ISSUER,
    keys: [{
      issuer: ISSUER,
      keyId: KEY_ID,
      algorithm: 'Ed25519',
      publicKey: issuerKey.publicKeyPem,
      status: 'active',
      validFrom: null,
      validUntil: null,
    }],
  };
  const unsignedBundle = {
    schema: 'monad.agent-safety-gate-evidence.v1',
    fixtureMode: 'SYNTHETIC_NO_BROADCAST',
    assembledAt: OBSERVED_AT + 30,
    insight: { attestation, commitment: insightCommitment },
    gate: { policy, decision, commitment: decisionCommitment },
    priorSeal: { receipt, keyRegistry },
    limits: {
      synthetic: true,
      paidX402RequestIncluded: false,
      transactionBroadcastIncluded: false,
      economicSafetyGuaranteed: false,
    },
  };
  const bundle = { ...unsignedBundle, bundleHash: canonicalHash(unsignedBundle) };
  const trustRoots = {
    schema: 'monad.agent-safety-gate-trust-roots.v1',
    fixtureMode: 'SYNTHETIC_NO_BROADCAST',
    insight: { attester: insightAccount.address },
    priorSeal: { issuer: ISSUER, keyId: KEY_ID, publicKeySpkiSha256: issuerKey.fingerprint },
    warning: 'Public fixture keys prove reproducibility only. Production consumers must establish their own issuer and registry trust roots.',
  };
  await writeJson('evidence-bundle.json', bundle);
  await writeJson('trust-roots.json', trustRoots);
  return bundle;
}

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, name), 'utf8'));
}

function insightFrom(value: unknown): InsightAttestation {
  const candidate = record(value, 'INSIGHT_ATTESTATION_MALFORMED');
  assert(candidate.schema === 'insight.oracle-safety-attestation.v3', 'INSIGHT_SCHEMA_UNSUPPORTED');
  assert(typeof candidate.uid === 'string' && typeof candidate.attester === 'string' && typeof candidate.signature === 'string', 'INSIGHT_SIGNATURE_FIELDS_MALFORMED');
  assert(typeof candidate.validUntil === 'number', 'INSIGHT_EXPIRY_MALFORMED');
  const data = record(candidate.data, 'INSIGHT_DATA_MALFORMED') as unknown as InsightData;
  for (const field of UINT_FIELDS) assert(Number.isSafeInteger(data[field]) && data[field] >= 0, `INSIGHT_${field.toUpperCase()}_MALFORMED`);
  for (const field of HASH_FIELDS) assert(typeof data[field] === 'string' && /^0x[0-9a-f]{64}$/i.test(data[field]), `INSIGHT_${field.toUpperCase()}_MALFORMED`);
  assert(['PASS', 'CAUTION', 'DANGER', 'BLOCK'].includes(data.verdict), 'INSIGHT_VERDICT_MALFORMED');
  return candidate as unknown as InsightAttestation;
}

async function verifyInsight(attestation: InsightAttestation, expectedAttester: string) {
  assert(attestation.attester.toLowerCase() === expectedAttester.toLowerCase(), 'INSIGHT_ATTESTER_UNTRUSTED');
  assert(attestation.data.subjectChainId === CHAIN_ID, 'INSIGHT_SUBJECT_CHAIN_MISMATCH');
  assert(attestation.validUntil === attestation.data.validUntil, 'INSIGHT_EXPIRY_MISMATCH');
  const typedData = typedAttestation(attestation.data);
  assert(hashTypedData(typedData as Parameters<typeof hashTypedData>[0]) === attestation.uid, 'INSIGHT_UID_MISMATCH');
  const valid = await verifyTypedData({
    ...typedData,
    address: attestation.attester,
    signature: attestation.signature,
  } as Parameters<typeof verifyTypedData>[0]);
  assert(valid, 'INSIGHT_SIGNATURE_INVALID');
}

async function verify() {
  const bundle = record(await readJson('evidence-bundle.json'), 'BUNDLE_MALFORMED');
  const roots = record(await readJson('trust-roots.json'), 'TRUST_ROOTS_MALFORMED');
  assert(bundle.schema === 'monad.agent-safety-gate-evidence.v1', 'BUNDLE_SCHEMA_UNSUPPORTED');
  assert(bundle.fixtureMode === 'SYNTHETIC_NO_BROADCAST', 'BUNDLE_MODE_INVALID');
  const { bundleHash, ...unsignedBundle } = bundle;
  assert(typeof bundleHash === 'string' && bundleHash === canonicalHash(unsignedBundle), 'BUNDLE_HASH_MISMATCH');
  const insight = record(bundle.insight, 'BUNDLE_INSIGHT_MALFORMED');
  const attestation = insightFrom(insight.attestation);
  const rootInsight = record(roots.insight, 'TRUST_ROOTS_INSIGHT_MALFORMED');
  assert(typeof rootInsight.attester === 'string', 'TRUST_ROOTS_INSIGHT_MALFORMED');
  await verifyInsight(attestation, rootInsight.attester);
  const gate = record(bundle.gate, 'BUNDLE_GATE_MALFORMED');
  const policy = record(gate.policy, 'GATE_POLICY_MALFORMED');
  const decision = record(gate.decision, 'GATE_DECISION_MALFORMED');
  assert(policy.allowedChainId === CHAIN_ID && policy.allowedCallTarget === CALL_TARGET, 'GATE_SCOPE_MISMATCH');
  assert(decision.effect === gateEffect(attestation.data.verdict), 'GATE_DECISION_MISMATCH');
  assert(decision.effect === 'PROCEED_TO_PRINCIPAL_AUTHORIZATION' && decision.requiresPrincipalAuthorization === true, 'GATE_AUTHORIZATION_BYPASS');
  assert(typeof decision.policyDigest === 'string' && decision.policyDigest === canonicalHash(policy), 'GATE_POLICY_DIGEST_MISMATCH');
  const commitment = record(insight.commitment, 'INSIGHT_COMMITMENT_MALFORMED');
  assert(commitment.namespace === 'insight.oracle-safety-attestation.v3' && commitment.algorithm === 'sha256' && commitment.digest === canonicalHash(attestation), 'INSIGHT_COMMITMENT_MISMATCH');
  const priorSeal = record(bundle.priorSeal, 'BUNDLE_PRIORSEAL_MALFORMED');
  const receipt = record(priorSeal.receipt, 'PRIORSEAL_RECEIPT_MALFORMED');
  const keyRegistry = priorSeal.keyRegistry;
  const rootPriorSeal = record(roots.priorSeal, 'TRUST_ROOTS_PRIORSEAL_MALFORMED');
  const registry = record(keyRegistry, 'PRIORSEAL_KEYS_MALFORMED');
  assert(registry.issuer === rootPriorSeal.issuer && Array.isArray(registry.keys), 'PRIORSEAL_ISSUER_UNTRUSTED');
  const key = registry.keys.find((entry) => record(entry, 'PRIORSEAL_KEY_MALFORMED').keyId === rootPriorSeal.keyId);
  assert(key !== undefined, 'PRIORSEAL_KEY_UNKNOWN');
  const keyRecord = record(key, 'PRIORSEAL_KEY_MALFORMED');
  assert(typeof keyRecord.publicKey === 'string', 'PRIORSEAL_PUBLIC_KEY_MALFORMED');
  const fingerprint = hash(createPublicKey(keyRecord.publicKey).export({ type: 'spki', format: 'der' }));
  assert(fingerprint === rootPriorSeal.publicKeySpkiSha256, 'PRIORSEAL_KEY_FINGERPRINT_MISMATCH');
  const assembledAt = bundle.assembledAt;
  assert(Number.isSafeInteger(assembledAt), 'BUNDLE_ASSEMBLED_AT_MALFORMED');
  const receiptResult = await verifyReceiptLocally(receipt, { trustedKeys: keyRegistry as never, now: assembledAt as number, expectedAudience: 'priorseal' });
  assert(receiptResult.valid && receiptResult.code === 'OK', `PRIORSEAL_${receiptResult.code}`);
  const authorizationEvidence = record(receipt.authorizationEvidence, 'PRIORSEAL_AUTHORIZATION_EVIDENCE_MALFORMED');
  const authorization = record(authorizationEvidence.authorization, 'PRIORSEAL_AUTHORIZATION_MALFORMED');
  const intent = record(authorization.intent, 'PRIORSEAL_INTENT_MALFORMED');
  assert(intent.chainId === CHAIN_ID && intent.callTarget === CALL_TARGET && intent.calldataHash === CALLDATA_HASH && intent.transactionValue === NATIVE_VALUE, 'PRIORSEAL_EXACT_CALL_MISMATCH');
  const context = matchUniqueContextCommitment(intent as never, commitment as never);
  assert(context.matched, `PRIORSEAL_${context.code}`);
  const receiptExecution = record(receipt.execution, 'PRIORSEAL_EXECUTION_MALFORMED');
  assert(receiptExecution.chainId === CHAIN_ID && receiptExecution.target === CALL_TARGET && receiptExecution.calldataHash === CALLDATA_HASH, 'PRIORSEAL_OBSERVATION_MISMATCH');
  assert(attestation.data.checkedAt <= Number(decision.evaluatedAt)
    && Number(decision.evaluatedAt) <= Number(authorization.issuedAt)
    && Number(authorization.issuedAt) <= Number(receiptExecution.executedAt)
    && Number(receiptExecution.executedAt) <= attestation.data.validUntil, 'EVIDENCE_TIMELINE_INVALID');

  const tamperedAttestation = structuredClone(attestation);
  tamperedAttestation.data.verdict = 'DANGER';
  let tamperedInsightRejected = false;
  try { await verifyInsight(tamperedAttestation, rootInsight.attester as string); } catch { tamperedInsightRejected = true; }
  const tamperedReceipt = structuredClone(receipt);
  const originalSignature = String(tamperedReceipt.signature);
  tamperedReceipt.signature = `${originalSignature.slice(0, -1)}${originalSignature.endsWith('A') ? 'B' : 'A'}`;
  const tamperedReceiptResult = await verifyReceiptLocally(tamperedReceipt, { trustedKeys: keyRegistry as never, now: assembledAt as number, expectedAudience: 'priorseal' });
  const report = {
    schema: 'monad.agent-safety-gate-report.v1',
    status: tamperedInsightRejected && !tamperedReceiptResult.valid && gateEffect('DANGER') === 'DENY' ? 'PASS' : 'FAIL',
    gate: {
      subjectChainId: CHAIN_ID,
      verdict: attestation.data.verdict,
      effect: decision.effect,
      principalAuthorizationRequired: decision.requiresPrincipalAuthorization,
    },
    evidence: {
      insightSignature: 'VALID',
      priorSealReceipt: receiptResult.code,
      exactCallBound: true,
      timelineOrdered: true,
    },
    mutations: {
      changedInsightVerdict: tamperedInsightRejected ? 'REJECTED_SIGNATURE' : 'UNEXPECTEDLY_ACCEPTED',
      dangerVerdictEffect: gateEffect('DANGER'),
      tamperedReceipt: tamperedReceiptResult.code,
    },
    limits: bundle.limits,
  };
  return report;
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  if (!verifyOnly) await generate();
  if (process.argv.includes('--verify') || verifyOnly) {
    const report = await verify();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'PASS') process.exitCode = 1;
  }
}

await main();
