import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntent } from '../../src/domain/intent.mjs';
import { validateTemporalEvidence } from '../../src/domain/temporal-evidence.mjs';

const sender = `0x${'a'.repeat(40)}`;
const recipient = `0x${'b'.repeat(40)}`;
const finalizedHash = `0x${'c'.repeat(64)}`;

test('signed finality constraints bind the frozen observation arithmetic', () => {
  const intent = buildIntent({ intentId: 'temporal-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000, nonce: '1', constraints: { minConfirmations: 2, maxToleratedReorgDepth: 2, finalityRequirement: 'RPC_FINALIZED' } });
  const execution = { status: 'CONFIRMED', finalityState: 'FINALIZED', blockNumber: 10, blockHash: finalizedHash, confirmations: 3, temporalEvidence: { schema: 'priorseal.temporal-evidence.v1', criterion: 'RPC_FINALIZED', requiredConfirmations: 3, maxToleratedReorgDepth: 2, observedHeadNumber: 12, observedHeadHash: `0x${'d'.repeat(64)}`, finalizedBlock: { number: 10, hash: finalizedHash } } };
  assert.equal(validateTemporalEvidence(intent, execution), true);
  assert.equal(validateTemporalEvidence(intent, { ...execution, confirmations: 4 }), false);
  assert.equal(validateTemporalEvidence(intent, { ...execution, temporalEvidence: { ...execution.temporalEvidence, finalizedBlock: { number: 9, hash: finalizedHash } } }), false);
  assert.equal(validateTemporalEvidence(intent, { ...execution, finalityState: 'CONFIRMED' }), false);
  assert.equal(validateTemporalEvidence(intent, { ...execution, temporalEvidence: { ...execution.temporalEvidence, maxToleratedReorgDepth: 0 } }), false);
  assert.equal(validateTemporalEvidence(intent, { ...execution, temporalEvidence: undefined }), false);
});

test('new intent constraints reject unsupported or impossible finality policies', () => {
  const base = { intentId: 'temporal-2', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender, recipient, validUntil: 2_000, nonce: '1' };
  assert.throws(() => buildIntent({ ...base, constraints: { finalityRequirement: 'FINALIZED' } }));
  assert.throws(() => buildIntent({ ...base, constraints: { maxToleratedReorgDepth: 10_000 } }));
});
