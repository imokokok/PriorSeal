import test from 'node:test';
import assert from 'node:assert/strict';
import { buildX402PaymentLedgerEvent, buildX402PaymentRefundLedgerEvent, assertX402PaymentLedgerEvent } from '../../src/domain/x402-payment-ledger.mjs';

const context = {
  payload: { x402Version: 2 as const, accepted: { scheme: 'exact' as const, network: 'eip155:8453', amount: '10000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: `0x${'b'.repeat(40)}`, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }, payload: { authorization: 'opaque' } },
  requirement: { scheme: 'exact' as const, network: 'eip155:8453', amount: '10000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: `0x${'b'.repeat(40)}`, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } },
};

test('x402 payment ledger records only a payload hash and keeps delivery and refund events linkable', () => {
  const delivered = buildX402PaymentLedgerEvent({
    type: 'DELIVERED', context, resourceUrl: 'https://api.example.test/v1/receipts/psr_a/bundle', occurredAt: 1_800_000_000,
    responseStatus: 200, responseBody: { schema: 'priorseal.verification-bundle.v1', bundleHash: 'c'.repeat(64) },
    settlement: { success: true, network: 'eip155:8453', transaction: `0x${'1'.repeat(64)}`, amount: '10000' }, settlementAttempts: 1,
  });
  assert.match(delivered.ledgerId, /^xpl_[0-9a-f]{32}$/);
  assert.match(delivered.eventId, /^xle_[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(delivered).includes('opaque'), false);
  assert.equal(assertX402PaymentLedgerEvent(delivered).type, 'DELIVERED');
  const refund = buildX402PaymentRefundLedgerEvent({ ledgerId: delivered.ledgerId, network: 'eip155:8453', transaction: `0x${'2'.repeat(64)}`, amount: '10000', reasonCode: 'SERVICE_UNAVAILABLE', occurredAt: 1_800_000_100 });
  assert.equal(assertX402PaymentLedgerEvent(refund).ledgerId, delivered.ledgerId);
  assert.throws(() => assertX402PaymentLedgerEvent({ ...delivered, paymentPayloadHash: 'not-a-hash' }), /Invalid persisted/);
});
