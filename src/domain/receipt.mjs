import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalize, hashJson } from './hashing.mjs';
import { classifyOutcome } from './outcome.mjs';
import { bindIntentExecution } from './binding.mjs';
export const RECEIPT_SCHEMA = 'priorseal.execution-receipt.v1';
export function buildReceipt({ intent, execution, issuer, keyId = 'default', issuedAt = Math.floor(Date.now() / 1000), verifierVersion = '1.0.0', reasonCodes = [] }) {
  const binding = bindIntentExecution(intent, execution, issuedAt);
  const executionHash = hashJson(execution);
  // Receipt IDs include the complete observed evidence hash. Re-observation after a
  // reorg produces a new, non-overwriting evidence record rather than silently
  // replacing a prior signed statement.
  const unsigned = { schema: RECEIPT_SCHEMA, domain: 'priorseal/execution-receipt/v1', receiptId: `psr_${hashJson({ intentHash: intent.intentHash, executionHash, issuer, keyId }).slice(0, 32)}`, intentHash: intent.intentHash, executionHash, execution, issuer, issuedAt, validUntil: intent.validUntil, outcome: classifyOutcome(intent, execution), reasonCodes: [...new Set([...reasonCodes, ...binding.reasonCodes])], binding, algorithm: 'Ed25519', keyId, verifierVersion };
  return unsigned;
}
export function signReceipt(receipt, privateKeyPem) { const key = createPrivateKey(privateKeyPem); return { ...receipt, signature: sign(null, Buffer.from(canonicalize(receipt)), key).toString('base64url') }; }
export function verifySignature(receipt, publicKeyPem) { const { signature, ...unsigned } = receipt ?? {}; if (!signature) return false; try { return verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')); } catch { return false; } }
