import assert from 'node:assert/strict';
import test from 'node:test';

import { assertZeroExCommercialLedgerEvent, buildZeroExCommercialLedgerEvent, reconcileZeroExCommercialLedger } from '../../src/domain/zeroex-commercial-ledger.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RECIPIENT = 'FYj2K9vJqCgGq5FHWg3HQTdTSXtripR1k6ZsWfSCNqrq';

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = '';
  while (value > 0n) { result = alphabet[Number(value % 58n)]! + result; value /= 58n; }
  return result;
}

function event(type: 'RELAY_ATTEMPTED' | 'RELAY_SUBMITTED' | 'RELAY_UNKNOWN' | 'RELAY_NOT_CLAIMED', occurredAt: number) {
  return buildZeroExCommercialLedgerEvent({
    type, occurredAt, authorizationId: 'authorization-1', intentHash: 'a'.repeat(64), messageHash: `0x${'b'.repeat(64)}`,
    transactionSignature: base58(new Uint8Array(64).fill(7)),
    commercial: {
      schema: 'priorseal.zeroex-commercial-record.v1', provider: '0x', tenantId: 'partner-a',
      fee: { profileId: 'partner-a-usdc-5bps', side: 'sell', mint: USDC, feePpm: 500, recipientTokenAccount: RECIPIENT, expectedAmountAtomic: '500' },
      commitment: { namespace: 'priorseal.zeroex-commercial-record.v1', algorithm: 'sha256', digest: `0x${'c'.repeat(64)}` },
    },
  });
}

test('0x commercial ledger binds disclosed fee terms to a relay without claiming settlement', () => {
  const attempted = event('RELAY_ATTEMPTED', 1_800_000_000_000);
  const submitted = event('RELAY_SUBMITTED', 1_800_000_001_000);
  assert.equal(attempted.ledgerId, submitted.ledgerId);
  assert.notEqual(attempted.eventId, submitted.eventId);
  assert.deepEqual(assertZeroExCommercialLedgerEvent(attempted), attempted);
  const reconciliation = reconcileZeroExCommercialLedger([submitted, attempted]);
  assert.equal(reconciliation.relayStatus, 'RELAYED_UNCONFIRMED');
  assert.equal(reconciliation.expectedFeeAtomic, '500');
  assert.equal(reconciliation.tenantId, 'partner-a');
});

test('0x commercial ledger rejects a persisted event whose fee terms were changed', () => {
  const attempted = event('RELAY_ATTEMPTED', 1_800_000_000_000);
  const tampered = { ...attempted, commercial: { ...attempted.commercial, fee: { ...attempted.commercial.fee, expectedAmountAtomic: '501' } } };
  assert.throws(() => assertZeroExCommercialLedgerEvent(tampered), /deterministic identity/);
});
