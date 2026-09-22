import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { buildIntent, buildReceipt, signReceipt, verifyReceipt, verifySignature, canonicalize, createMemoryStore, hashJson } from '../../src/index.mjs';
const keys = generateKeyPairSync('ed25519'); const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
const sender = `0x${'a'.repeat(40)}`; const recipient = `0x${'b'.repeat(40)}`;
const intent = buildIntent({ intentId: 'i-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2000000000, nonce: '1' });
const execution = { chainId: 8453, txHash: '0x' + '1'.repeat(64), status: 'CONFIRMED', action: 'TRANSFER', executedAt: 90, observedAt: 100, sender, recipient, asset: 'eip155:8453/native', amount: '10', nonce: '1', finalityState: 'CONFIRMED' };
test('canonical JSON sorts objects but preserves arrays', () => { assert.equal(hashJson({ b: 2, a: 1 }), hashJson({ a: 1, b: 2 })); assert.notEqual(hashJson({ a: [1, 2] }), hashJson({ a: [2, 1] })); assert.equal(canonicalize({ a: null, b: 'x', c: 2 }), '{"a":null,"b":"x","c":2}'); });
test('receipt verifies permanently and detects mutation', () => { const receipt = signReceipt(buildReceipt({ intent: { ...intent, validUntil: 101 }, execution, issuer: 'test', keyId: 'k1', issuedAt: 100 }), priv); assert.equal(verifyReceipt(receipt, pub, { keyId: 'k1', now: 101 }).valid, true); assert.equal(verifyReceipt(receipt, pub, { keyId: 'k1', now: 10_000 }).valid, true); assert.equal(verifyReceipt(receipt, pub, { key: { issuer: 'test', keyId: 'other', algorithm: 'Ed25519', status: 'active', validFrom: null, validUntil: null } }).code, 'UNKNOWN_KEY'); assert.equal(verifyReceipt(receipt, pub, { key: { issuer: 'test', keyId: 'k1', algorithm: 'Ed25519', status: 'active', validFrom: 101, validUntil: null } }).code, 'KEY_NOT_YET_VALID'); assert.equal(verifyReceipt({ ...receipt, outcome: 'FAILED' }, pub, { keyId: 'k1', now: 101 }).code, 'INVALID_SIGNATURE'); assert.equal(verifyReceipt({ ...receipt, executionHash: 'bad' }, pub, { keyId: 'k1', now: 101 }).code, 'EXECUTION_HASH_MISMATCH'); });
test('intent fields bind to completed execution', () => { const missingNonce = { ...execution }; delete missingNonce.nonce; assert.equal(buildReceipt({ intent, execution, issuer: 'test' }).outcome, 'COMPLETED'); assert.equal(buildReceipt({ intent, execution: missingNonce, issuer: 'test' }).outcome, 'UNDETERMINED'); assert.equal(buildReceipt({ intent, execution: { ...execution, recipient: `0x${'c'.repeat(40)}` }, issuer: 'test' }).outcome, 'UNDETERMINED'); assert.equal(buildReceipt({ intent, execution: { ...execution, status: 'PENDING' }, issuer: 'test' }).outcome, 'PENDING'); });
test('memory persistence rejects different signed evidence under the same receipt ID', async () => { const store = createMemoryStore(); const receipt = signReceipt(buildReceipt({ intent, execution, issuer: 'test', keyId: 'k1', issuedAt: 100 }), priv); await store.saveReceipt(receipt); await assert.rejects(() => store.saveReceipt({ ...receipt, validUntil: receipt.validUntil + 1 }), (error) => error.code === 'RECEIPT_ID_CONFLICT'); assert.deepEqual(await store.saveReceipt(structuredClone(receipt)), receipt); });

test('receipt bytes and Ed25519 signature match the pre-migration vector', () => {
  const privateKey = createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${'71'.repeat(32)}`, 'hex'), format: 'der', type: 'pkcs8' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const vectorIntent = buildIntent({ intentId: 'receipt-migration-vector', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender, recipient, validUntil: 2_000_000_000, nonce: '1' });
  const vectorExecution = { chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 90, observedAt: 100, sender, recipient, asset: vectorIntent.asset, amount: vectorIntent.amount, nonce: vectorIntent.nonce, finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildReceipt({ intent: vectorIntent, execution: vectorExecution, issuer: 'test', keyId: 'k1', issuedAt: 100 }), privateKeyPem);
  assert.equal(vectorIntent.intentHash, 'f63a48b2ee2a1e83a5cd4ed0bba6f33348d5be2329cf60c2d7cec866f7de5f8a');
  assert.equal(receipt.executionHash, '5db2b8268e4cac9868c88fc06a9ba295643d6c02df94393c7ddda4b4caa63a4f');
  assert.equal(receipt.receiptId, 'psr_04fd70f100dda2405af1fb40355eb548');
  assert.equal(receipt.signature, 'c0OkG88P8-p0ejbxF0jItRxrQYLyQFbfABbfUvaOaLfLeR8uW5VI_JXFKo1z4JhIMKn2YuyRubddR0FRcnlgBw');
  assert.equal(verifySignature(receipt, publicKeyPem), true);
});

test('migrated receipt verifier preserves error-code precedence for untrusted input', () => {
  const receipt = signReceipt(buildReceipt({ intent, execution, issuer: 'test', keyId: 'k1', issuedAt: 100 }), priv);
  assert.equal(verifyReceipt(null, pub).code, 'MISSING_SIGNATURE');
  assert.equal(verifyReceipt({ signature: 'present', schema: 'unknown' }, pub).code, 'UNSUPPORTED_SCHEMA');
  assert.equal(verifyReceipt({ ...receipt, unexpected: true }, pub).code, 'INVALID_RECEIPT');
  assert.equal(verifyReceipt({ ...receipt, validUntil: 0 }, pub).code, 'INVALID_RECEIPT_TIMELINE');
  assert.equal(verifyReceipt({ ...receipt, executionHash: 'bad' }, pub).code, 'EXECUTION_HASH_MISMATCH');
  assert.equal(verifyReceipt({ ...receipt, receiptId: 'bad' }, pub).code, 'RECEIPT_ID_MISMATCH');
});
