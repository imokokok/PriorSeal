import { verifySignature } from './receipt.mjs';
import { hashJson } from './hashing.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';

const RECEIPT_FIELDS = ['schema', 'domain', 'receiptId', 'intentHash', 'executionHash', 'execution', 'issuer', 'issuedAt', 'validUntil', 'outcome', 'reasonCodes', 'binding', 'algorithm', 'keyId', 'verifierVersion', 'signature'];
export function verifyReceipt(receipt, publicKeyPem, options = {}) {
  const fail = (code) => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId });
  try { assertSafeJson(receipt); } catch { return fail('INVALID_RECEIPT'); }
  if (!receipt?.signature) return fail('MISSING_SIGNATURE');
  if (receipt.schema !== 'priorseal.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA');
  if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM');
  if (receipt.domain !== 'priorseal/execution-receipt/v1') return fail('INVALID_DOMAIN');
  try { assertOnlyFields(receipt, RECEIPT_FIELDS, 'receipt'); } catch { return fail('INVALID_RECEIPT'); }
  if (options.keyId && receipt.keyId !== options.keyId) return fail('UNKNOWN_KEY');
  if (options.key && options.key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY');
  if (options.key && (options.key.algorithm !== 'Ed25519' || !['active', 'retired'].includes(options.key.status) || options.key.issuer !== receipt.issuer || !validKeyWindow(options.key))) return fail('INVALID_KEY');
  if (options.key?.validFrom != null && receipt.issuedAt < options.key.validFrom) return fail('KEY_NOT_YET_VALID');
  if (options.key?.validUntil != null && receipt.issuedAt > options.key.validUntil) return fail('KEY_EXPIRED');
  if (options.now !== undefined && receipt.issuedAt > options.now) return fail('NOT_YET_VALID');
  if (!Number.isSafeInteger(receipt.issuedAt) || receipt.issuedAt <= 0 || !Number.isSafeInteger(receipt.validUntil) || receipt.validUntil <= 0) return fail('INVALID_RECEIPT_TIMELINE');
  const observedAt = receipt.execution?.observedAt ?? receipt.execution?.executedAt;
  if (observedAt != null && (!Number.isSafeInteger(observedAt) || receipt.issuedAt < observedAt)) return fail('INVALID_RECEIPT_TIMELINE');
  // validUntil belongs to the authorization intent, not to the evidence
  // receipt. A receipt remains verifiable after the authorization window.
  if (receipt.executionHash !== hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH');
  const expectedReceiptId = `psr_${hashJson({ intentHash: receipt.intentHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId }).slice(0, 32)}`;
  if (receipt.receiptId !== expectedReceiptId) return fail('RECEIPT_ID_MISMATCH');
  return verifySignature(receipt, publicKeyPem) ? { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId } : fail('INVALID_SIGNATURE');
}

function validKeyWindow(key) {
  for (const field of ['validFrom', 'validUntil']) if (key[field] != null && (!Number.isSafeInteger(key[field]) || key[field] <= 0)) return false;
  return key.validFrom == null || key.validUntil == null || key.validFrom <= key.validUntil;
}
