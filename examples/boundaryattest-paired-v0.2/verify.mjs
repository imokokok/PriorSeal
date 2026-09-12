#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchUniqueContextCommitment } from '../../sdk/dist/index.js';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';
import { jcsCanonicalBytes } from './jcs.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const requiredClaimFields = ['receipt_version', 'receipt_role', 'event_id', 'timestamp', 'action_type', 'status'];

function readJson(name) {
  return JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function externalKeyId(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

function parseWholeSecondTimestamp(value) {
  const seconds = Date.parse(value) / 1000;
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function checkFreshness({ timestamp, authorizationTime, maxAgeSeconds, maxFutureSkewSeconds, invalidCode, futureCode, staleCode }) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0 || !Number.isSafeInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0) {
    return { ok: false, code: 'INVALID_COMPOSITION_FRESHNESS_POLICY' };
  }
  const observedTime = parseWholeSecondTimestamp(timestamp);
  if (observedTime === null) return { ok: false, code: invalidCode };
  if (observedTime > authorizationTime + maxFutureSkewSeconds) return { ok: false, code: futureCode };
  if (authorizationTime - observedTime > maxAgeSeconds) return { ok: false, code: staleCode };
  return { ok: true, code: 'OK' };
}

export function verifyBoundaryAttestReceipt(receipt, publicKeyPem) {
  if (!isRecord(receipt)) return { ok: false, code: 'INVALID_BOUNDARYATTEST_RECEIPT' };
  if (Object.keys(receipt).sort().join(',') !== 'claim,public_key_id,signature') return { ok: false, code: 'INVALID_BOUNDARYATTEST_ENVELOPE' };
  if (!isRecord(receipt.claim) || typeof receipt.signature !== 'string' || typeof receipt.public_key_id !== 'string') return { ok: false, code: 'INVALID_BOUNDARYATTEST_RECEIPT' };
  for (const field of requiredClaimFields) if (!Object.hasOwn(receipt.claim, field)) return { ok: false, code: `MISSING_BOUNDARYATTEST_FIELD:${field}` };
  if (receipt.claim.receipt_version !== '0.2') return { ok: false, code: 'UNSUPPORTED_BOUNDARYATTEST_VERSION' };
  if (!['client_observed', 'server_attested'].includes(receipt.claim.receipt_role)) return { ok: false, code: 'UNSUPPORTED_BOUNDARYATTEST_ROLE' };
  try {
    if (receipt.public_key_id !== externalKeyId(publicKeyPem)) return { ok: false, code: 'BOUNDARYATTEST_KEY_ID_MISMATCH' };
    const valid = verify(null, jcsCanonicalBytes(receipt.claim), publicKeyPem, Buffer.from(receipt.signature, 'base64'));
    return valid ? { ok: true, code: 'OK' } : { ok: false, code: 'INVALID_BOUNDARYATTEST_SIGNATURE' };
  } catch {
    return { ok: false, code: 'INVALID_BOUNDARYATTEST_SIGNATURE' };
  }
}

export async function verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected, usedSignedExports = new Set(), usedDecisionIds = new Set() }) {
  const external = verifyBoundaryAttestReceipt(externalReceipt, externalPublicKey);
  if (!external.ok) return external;

  const priorSeal = await verifyReceiptLocally(priorSealReceipt, { trustedKeys: trustedIssuerKeys, now: priorSealReceipt.issuedAt });
  if (!priorSeal.valid) return { ok: false, code: `PRIORSEAL_${priorSeal.code}` };
  if (priorSeal.verificationScope !== 'LOCAL_COMPLETE') return { ok: false, code: 'PRIORSEAL_EXTERNAL_CHECK_REQUIRED' };

  const intent = priorSealReceipt.authorizationEvidence.authorization.intent;
  const digest = `0x${createHash('sha256').update(jcsCanonicalBytes(externalReceipt.claim)).digest('hex')}`;
  if (digest !== expected.digest) return { ok: false, code: 'BOUNDARYATTEST_CLAIM_DIGEST_MISMATCH' };
  const commitment = matchUniqueContextCommitment(intent, { namespace: expected.namespace, algorithm: expected.algorithm, digest });
  if (!commitment.matched) return { ok: false, code: commitment.code };

  const decision = externalReceipt.claim.decision_record;
  const expectedActionRef = `${expected.expectedActionRefPrefix}${intent.intentId}`;
  if (!isRecord(decision) || !isRecord(decision.subject) || decision.subject.action_ref !== expectedActionRef || decision.subject.action_type !== expected.expectedSubjectActionType) return { ok: false, code: 'EXTERNAL_SUBJECT_MISMATCH' };

  const authorizationTime = priorSealReceipt.authorizationEvidence.authorization.issuedAt;
  const exportFreshness = checkFreshness({
    timestamp: externalReceipt.claim.timestamp,
    authorizationTime,
    maxAgeSeconds: expected.maxExportAgeSecondsAtAuthorization,
    maxFutureSkewSeconds: expected.maxExportFutureSkewSecondsAtAuthorization,
    invalidCode: 'INVALID_EXTERNAL_EXPORT_TIMESTAMP',
    futureCode: 'EXTERNAL_EXPORT_FROM_FUTURE',
    staleCode: 'STALE_EXTERNAL_EXPORT',
  });
  if (!exportFreshness.ok) return exportFreshness;

  if (!isRecord(decision.resolution)) return { ok: false, code: 'MISSING_EXTERNAL_DECISION_RESOLUTION' };
  const decisionFreshness = checkFreshness({
    timestamp: decision.resolution.timestamp,
    authorizationTime,
    maxAgeSeconds: expected.maxDecisionAgeSecondsAtAuthorization,
    maxFutureSkewSeconds: expected.maxDecisionFutureSkewSecondsAtAuthorization,
    invalidCode: 'INVALID_EXTERNAL_DECISION_TIMESTAMP',
    futureCode: 'EXTERNAL_DECISION_FROM_FUTURE',
    staleCode: 'STALE_EXTERNAL_DECISION',
  });
  if (!decisionFreshness.ok) return decisionFreshness;

  const eventId = externalReceipt.claim.event_id;
  if (typeof eventId !== 'string' || eventId.length === 0) return { ok: false, code: 'INVALID_BOUNDARYATTEST_EVENT_ID' };
  const signedExportReplayKey = JSON.stringify([externalReceipt.public_key_id, eventId]);
  if (usedSignedExports.has(signedExportReplayKey)) return { ok: false, code: 'EXTERNAL_EXPORT_REPLAYED' };

  const decisionId = decision.decision_id;
  if (expected.consumeDecisionOnce) {
    if (typeof decisionId !== 'string' || decisionId.length === 0) return { ok: false, code: 'INVALID_BOUNDARYATTEST_DECISION_ID' };
    if (usedDecisionIds.has(decisionId)) return { ok: false, code: 'EXTERNAL_DECISION_REPLAYED' };
  }

  usedSignedExports.add(signedExportReplayKey);
  if (expected.consumeDecisionOnce) usedDecisionIds.add(decisionId);
  return {
    ok: true,
    code: 'OK',
    boundaryAttestEventId: eventId,
    boundaryAttestDecisionId: decisionId,
    boundaryAttestSignedExportReplayKey: signedExportReplayKey,
    boundaryAttestDigest: digest,
    priorSealReceiptId: priorSealReceipt.receiptId,
    executionStatus: priorSeal.executionStatus,
    complianceStatus: priorSeal.complianceStatus,
  };
}

export async function runFixtureChecks({ log = console.log } = {}) {
  const externalReceipt = readJson('boundaryattest-receipt.json');
  const externalPublicKey = readFileSync(resolve(directory, 'boundaryattest-public-key.pem'), 'utf8');
  const priorSealReceipt = readJson('priorseal-receipt.json');
  const wrongDigestReceipt = readJson('priorseal-receipt-wrong-digest.json');
  const staleReceipt = readJson('priorseal-receipt-stale-evidence.json');
  const trustedIssuerKeys = readJson('priorseal-trusted-issuer-keys.json');
  const expected = readJson('expected.json');

  const results = [];
  const check = (name, result, expectedCode) => {
    if (result.code !== expectedCode) throw new Error(`${name}: expected ${expectedCode}, received ${result.code}`);
    results.push({ name, code: result.code });
    log(`PASS ${name}: ${result.code}`);
  };

  const usedSignedExports = new Set([JSON.stringify(['sha256:unrelated-signer', externalReceipt.claim.event_id])]);
  check('matching pair with signer-scoped export replay key', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected, usedSignedExports }), 'OK');
  check('replayed exact signed export', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected, usedSignedExports }), 'EXTERNAL_EXPORT_REPLAYED');
  check('valid PriorSeal receipt with wrong committed digest', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt: wrongDigestReceipt, trustedIssuerKeys, expected }), 'CONTEXT_COMMITMENT_DIGEST_MISMATCH');
  check('stale external export at authorization time', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt: staleReceipt, trustedIssuerKeys, expected }), 'STALE_EXTERNAL_EXPORT');

  const strictDecisionFreshness = { ...expected, maxDecisionAgeSecondsAtAuthorization: 180 };
  check('fresh export with stale underlying decision', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected: strictDecisionFreshness }), 'STALE_EXTERNAL_DECISION');

  const oneTimeDecision = { ...expected, consumeDecisionOnce: true };
  const usedDecisionIds = new Set([externalReceipt.claim.decision_record.decision_id]);
  check('previously consumed decision under optional one-time policy', await verifyPair({ externalReceipt, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected: oneTimeDecision, usedDecisionIds }), 'EXTERNAL_DECISION_REPLAYED');

  const tampered = structuredClone(externalReceipt);
  tampered.claim.decision_record.resolution.verdict = 'allow';
  check('tampered BoundaryAttest claim', await verifyPair({ externalReceipt: tampered, externalPublicKey, priorSealReceipt, trustedIssuerKeys, expected }), 'INVALID_BOUNDARYATTEST_SIGNATURE');
  const wrongExternalKey = trustedIssuerKeys.keys[0].publicKey;
  check('wrong independently supplied BoundaryAttest key', await verifyPair({ externalReceipt, externalPublicKey: wrongExternalKey, priorSealReceipt, trustedIssuerKeys, expected }), 'BOUNDARYATTEST_KEY_ID_MISMATCH');

  log('LIMIT neither signature proves the other system\'s semantic truth, and the digest match is not transaction authority.');
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runFixtureChecks();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
