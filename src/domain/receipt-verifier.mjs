import { verifySignature } from './receipt.mjs';
import { hashJson } from './hashing.mjs';
import { assertSafeJson } from '../shared/safe-json.mjs';
export function verifyReceipt(receipt, publicKeyPem, options = {}) {
  const fail = (code) => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId });
  try { assertSafeJson(receipt); } catch { return fail('INVALID_RECEIPT'); }
  if (!receipt?.signature) return fail('MISSING_SIGNATURE');
  if (receipt.schema !== 'runproof.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA');
  if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM');
  if (receipt.domain !== 'runproof/execution-receipt/v1') return fail('INVALID_DOMAIN');
  if (options.keyId && receipt.keyId !== options.keyId) return fail('UNKNOWN_KEY');
  if (options.key && (options.key.algorithm !== 'Ed25519' || options.key.status === 'revoked' || options.key.issuer !== receipt.issuer)) return fail('INVALID_KEY');
  if (options.now !== undefined && options.key?.validFrom != null && receipt.issuedAt < options.key.validFrom) return fail('KEY_NOT_YET_VALID');
  if (options.now !== undefined && options.key?.validUntil != null && receipt.issuedAt > options.key.validUntil) return fail('KEY_EXPIRED');
  if (options.now !== undefined && receipt.issuedAt > options.now) return fail('NOT_YET_VALID');
  // validUntil belongs to the authorization intent, not to the evidence
  // receipt. A receipt remains verifiable after the authorization window.
  if (receipt.executionHash !== hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH');
  return verifySignature(receipt, publicKeyPem) ? { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId } : fail('INVALID_SIGNATURE');
}
