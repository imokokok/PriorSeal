import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildX402PaymentEvidence, signX402PaymentEvidence, verifyX402PaymentEvidence } from '../../src/domain/x402-payment-evidence.mjs';

test('x402 payment evidence signs a settlement-to-service binding and rejects tampering', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const unsigned = buildX402PaymentEvidence({
    paymentPayload: { x402Version: 2, accepted: { network: 'eip155:8453' }, payload: { authorization: 'opaque' } },
    requirement: { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: `0x${'b'.repeat(40)}`, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } },
    settlement: { success: true, network: 'eip155:8453', transaction: `0x${'1'.repeat(64)}`, payer: `0x${'a'.repeat(40)}`, amount: '10000' },
    service: { resourceUrl: 'https://api.example.test/v1/receipts/psr_a/bundle', responseStatus: 200, responseHash: 'c'.repeat(64) },
    issuer: 'priorseal.example', keyId: 'active-1', issuedAt: 1_800_000_000,
  });
  const evidence = signX402PaymentEvidence(unsigned, privateKeyPem);
  assert.deepEqual(verifyX402PaymentEvidence(evidence, publicKeyPem, 1_800_000_001), { valid: true, code: 'OK', paymentEvidenceId: evidence.paymentEvidenceId });
  assert.equal(verifyX402PaymentEvidence({ ...evidence, service: { ...evidence.service, responseHash: 'd'.repeat(64) } }, publicKeyPem).code, 'PAYMENT_EVIDENCE_ID_MISMATCH');
});
