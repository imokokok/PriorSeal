import { verifySignature } from './receipt.mjs';
import { hashJson } from './hashing.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';

const RECEIPT_FIELDS = ['schema', 'domain', 'receiptId', 'intentHash', 'executionHash', 'execution', 'issuer', 'issuedAt', 'validUntil', 'outcome', 'reasonCodes', 'binding', 'algorithm', 'keyId', 'verifierVersion', 'signature'];

type VerificationKey = {
  keyId?: unknown;
  algorithm?: unknown;
  status?: string;
  issuer?: unknown;
  validFrom?: number | null;
  validUntil?: number | null;
};

type VerifyOptions = { keyId?: string; key?: VerificationKey | null; now?: number };

export function verifyReceipt(receipt: unknown, publicKeyPem: string, options: VerifyOptions = {}) {
  const candidate = receipt as Record<string, unknown> | null | undefined;
  const fail = (code: string) => ({ valid: false, code, outcome: candidate?.outcome, receiptId: candidate?.receiptId });
  try { assertSafeJson(receipt); } catch { return fail('INVALID_RECEIPT'); }
  if (!candidate?.signature) return fail('MISSING_SIGNATURE');
  if (candidate.schema !== 'priorseal.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA');
  if (candidate.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM');
  if (candidate.domain !== 'priorseal/execution-receipt/v1') return fail('INVALID_DOMAIN');
  let checked: Record<string, unknown>;
  try { checked = assertOnlyFields(receipt, RECEIPT_FIELDS, 'receipt'); } catch { return fail('INVALID_RECEIPT'); }
  if (options.keyId && checked.keyId !== options.keyId) return fail('UNKNOWN_KEY');
  if (options.key && options.key.keyId !== checked.keyId) return fail('UNKNOWN_KEY');
  if (options.key && (options.key.algorithm !== 'Ed25519' || !['active', 'retired'].includes(options.key.status as string) || options.key.issuer !== checked.issuer || !validKeyWindow(options.key))) return fail('INVALID_KEY');
  if (options.key?.validFrom != null && (checked.issuedAt as number) < options.key.validFrom) return fail('KEY_NOT_YET_VALID');
  if (options.key?.validUntil != null && (checked.issuedAt as number) > options.key.validUntil) return fail('KEY_EXPIRED');
  if (options.now !== undefined && (checked.issuedAt as number) > options.now) return fail('NOT_YET_VALID');
  if (!Number.isSafeInteger(checked.issuedAt) || (checked.issuedAt as number) <= 0 || !Number.isSafeInteger(checked.validUntil) || (checked.validUntil as number) <= 0) return fail('INVALID_RECEIPT_TIMELINE');
  const execution = checked.execution as { observedAt?: number | null; executedAt?: number | null } | null | undefined;
  const observedAt = execution?.observedAt ?? execution?.executedAt;
  if (observedAt != null && (!Number.isSafeInteger(observedAt) || (checked.issuedAt as number) < observedAt)) return fail('INVALID_RECEIPT_TIMELINE');
  // validUntil belongs to the authorization intent, not to the evidence
  // receipt. A receipt remains verifiable after the authorization window.
  if (checked.executionHash !== hashJson(checked.execution)) return fail('EXECUTION_HASH_MISMATCH');
  const expectedReceiptId = `psr_${hashJson({ intentHash: checked.intentHash, executionHash: checked.executionHash, issuer: checked.issuer, keyId: checked.keyId }).slice(0, 32)}`;
  if (checked.receiptId !== expectedReceiptId) return fail('RECEIPT_ID_MISMATCH');
  return verifySignature(checked, publicKeyPem) ? { valid: true, code: 'OK', outcome: checked.outcome, receiptId: checked.receiptId } : fail('INVALID_SIGNATURE');
}

function validKeyWindow(key: VerificationKey): boolean {
  for (const field of ['validFrom', 'validUntil'] as const) {
    const value = key[field];
    if (value != null && (!Number.isSafeInteger(value) || value <= 0)) return false;
  }
  return key.validFrom == null || key.validUntil == null || key.validFrom <= key.validUntil;
}
