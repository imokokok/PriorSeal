import { verifySignature } from './receipt.mjs';
import { hashJson } from './hashing.mjs';
export function verifyReceipt(receipt, publicKeyPem, options = {}) {
  const fail = (code) => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId });
  if (!receipt?.signature) return fail('MISSING_SIGNATURE');
  if (receipt.schema !== 'runproof.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA');
  if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM');
  if (receipt.domain !== 'runproof/execution-receipt/v1') return fail('INVALID_DOMAIN');
  if (options.keyId && receipt.keyId !== options.keyId) return fail('UNKNOWN_KEY');
  if (options.now !== undefined && receipt.issuedAt > options.now) return fail('NOT_YET_VALID');
  if (options.now !== undefined && receipt.validUntil < options.now) return fail('EXPIRED');
  if (receipt.executionHash !== hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH');
  return verifySignature(receipt, publicKeyPem) ? { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId } : fail('INVALID_SIGNATURE');
}
