import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcome } from '../../src/domain/outcome.mjs';

const intent = { chainId: 8453, action: 'TRANSFER', sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '1', validUntil: 1000 };
const execution = { chainId: 8453, status: 'CONFIRMED', finalityState: 'CONFIRMED', action: 'TRANSFER', sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '1', executedAt: 900, observedAt: 1100 };

test('migrated outcome classifier preserves status precedence and binding', () => {
  assert.equal(classifyOutcome(intent, execution), 'COMPLETED');
  assert.equal(classifyOutcome(intent, { ...execution, status: 'REORGED' }), 'REORGED');
  assert.equal(classifyOutcome(intent, { ...execution, finalityState: 'REORGED' }), 'REORGED');
  assert.equal(classifyOutcome(intent, { ...execution, status: 'REVERTED', finalityState: 'INSUFFICIENT_FINALITY' }), 'PENDING');
  assert.equal(classifyOutcome(intent, { ...execution, status: 'REVERTED' }), 'FAILED');
  assert.equal(classifyOutcome(intent, { ...execution, status: 'NOT_FOUND' }), 'UNDETERMINED');
  assert.equal(classifyOutcome(intent, { ...execution, executedAt: 1001 }), 'EXPIRED');
  assert.equal(classifyOutcome(intent, { ...execution, recipient: '0xcc' }), 'UNDETERMINED');
});
