import { bindIntentExecution } from './binding.mjs';
import { signEd25519Statement, verifyEd25519Statement } from './ed25519.mjs';
import { hashJson } from './hashing.mjs';
import type { Authorization } from './authorization.mjs';
import type { ExecutionInput } from './execution.mjs';

/** A newly signed, read-only observation of the transaction named by a receipt. */
export const FRESH_EVIDENCE_CHECK_SCHEMA = 'priorseal.fresh-evidence-check.v1';
export const FRESH_EVIDENCE_CHECK_DOMAIN = 'priorseal/fresh-evidence-check/v1';

type ReceiptSubject = { receiptId: string; issuer: string; keyId: string; executionHash: string; authorizationHash: string };

function assertString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new TypeError(`Fresh evidence check ${field} is invalid`);
  return value;
}

/**
 * Builds a statement that has value beyond a static receipt export: its
 * execution result was fetched again at `checkedAt` and rebound to the
 * original signed authorization.  This does not assert a future guarantee or
 * replace independent chain/RPC verification.
 */
export function buildFreshEvidenceCheck({ receipt, authorization, currentExecution, issuer, keyId = 'default', checkedAt = Math.floor(Date.now() / 1000) }: { receipt: ReceiptSubject; authorization: Authorization; currentExecution: ExecutionInput; issuer: string; keyId?: string; checkedAt?: number }) {
  if (!Number.isSafeInteger(checkedAt) || checkedAt <= 0) throw new TypeError('Fresh evidence check checkedAt must be a positive Unix timestamp');
  const subject = {
    receiptId: assertString(receipt.receiptId, 'receiptId'),
    issuer: assertString(receipt.issuer, 'receipt issuer'),
    keyId: assertString(receipt.keyId, 'receipt keyId'),
    executionHash: assertString(receipt.executionHash, 'executionHash'),
    authorizationHash: assertString(receipt.authorizationHash, 'authorizationHash'),
  };
  const txHash = assertString(currentExecution.txHash, 'transaction hash');
  const binding = bindIntentExecution(authorization.intent, currentExecution, checkedAt);
  const current = {
    chainId: currentExecution.chainId ?? authorization.intent.chainId,
    ...(currentExecution.chainRef ? { chainRef: currentExecution.chainRef } : {}),
    txHash,
    status: String(currentExecution.status ?? 'UNKNOWN'),
    finalityState: String(currentExecution.finalityState ?? 'UNKNOWN'),
    confirmations: Number(currentExecution.confirmations ?? 0),
    observedAt: currentExecution.observedAt ?? null,
    executedAt: currentExecution.executedAt ?? null,
    blockNumber: currentExecution.blockNumber ?? null,
    blockHash: currentExecution.blockHash ?? null,
    binding,
  };
  const checkId = `psc_${hashJson({ subject, current, issuer, keyId, checkedAt }).slice(0, 32)}`;
  return {
    schema: FRESH_EVIDENCE_CHECK_SCHEMA,
    domain: FRESH_EVIDENCE_CHECK_DOMAIN,
    checkId,
    checkedAt,
    subject,
    receiptVerification: { valid: true, code: 'OK' },
    current,
    limitations: [
      'A fresh check re-observes one already-recorded transaction; it does not authorize, submit, or custody an action.',
      'Independent reviewers should verify this signature using the published issuer key and evaluate their own RPC trust assumptions.',
    ],
    issuer: assertString(issuer, 'issuer'),
    keyId: assertString(keyId, 'keyId'),
    algorithm: 'Ed25519',
  };
}

export function signFreshEvidenceCheck<T extends Record<string, unknown>>(check: T, privateKeyPem: string) {
  return signEd25519Statement(check, privateKeyPem);
}

export function verifyFreshEvidenceCheck(value: Record<string, unknown> | null | undefined, publicKeyPem: string) {
  if (!value || value.schema !== FRESH_EVIDENCE_CHECK_SCHEMA || value.domain !== FRESH_EVIDENCE_CHECK_DOMAIN || value.algorithm !== 'Ed25519') return false;
  return verifyEd25519Statement(value, publicKeyPem);
}
