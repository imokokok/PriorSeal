import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReorg, normalizeExecution, EXECUTION_SCHEMA } from '../../src/domain/execution.mjs';

test('migrated execution normalization preserves defaults and address casing', () => {
  const result = normalizeExecution({ chainId: 8453, txHash: '0xAB', status: 'PENDING', sender: '0xAA', recipient: '0xBB', target: '0xCC', calldataHash: '0xDD', observedAt: 100 });
  assert.equal(result.schema, EXECUTION_SCHEMA);
  assert.equal(result.txHash, '0xab');
  assert.equal(result.sender, '0xaa');
  assert.equal(result.recipient, '0xbb');
  assert.equal(result.target, '0xcc');
  assert.equal(result.calldataHash, '0xdd');
  assert.equal(result.executedAt, null);
  assert.deepEqual(result.transfers, []);
  assert.equal(result.executionDataAvailable, true);
  assert.equal(result.finalityState, 'UNKNOWN');
  assert.equal(result.confirmations, 0);
});

test('migrated reorg detection requires the same transaction and prior block', () => {
  assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', blockHash: '0xb' }), true);
  assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x1', status: 'NOT_FOUND' }), true);
  assert.equal(detectReorg({ txHash: '0x1', blockHash: '0xa' }, { txHash: '0x2', blockHash: '0xb' }), false);
  assert.equal(detectReorg(null, { txHash: '0x1', blockHash: '0xb' }), false);
});
