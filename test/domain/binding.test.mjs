import test from 'node:test';
import assert from 'node:assert/strict';
import { bindIntentExecution } from '../../src/domain/binding.mjs';
const intent = { chainId: 8453, sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '2', validUntil: 1000, constraints: { minConfirmations: 3, maxGasUsed: '100000' } };
const execution = { chainId: 8453, sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '2', observedAt: 900, confirmations: 3, gasUsed: '21000', executionDataAvailable: true, transfers: [] };
test('binding returns explainable reason codes', () => { assert.deepEqual(bindIntentExecution(intent, execution).reasonCodes, []); const result = bindIntentExecution(intent, { ...execution, recipient: '0xcc', confirmations: 1, gasUsed: '200000' }); assert.equal(result.bound, false); assert.deepEqual(result.reasonCodes, ['RECIPIENT_MISMATCH', 'INSUFFICIENT_FINALITY', 'GAS_LIMIT_EXCEEDED']); });
test('multiple transfers are undetermined unless uniquely selected', () => { const result = bindIntentExecution(intent, { ...execution, transfers: [{}, {}] }); assert.equal(result.reasonCodes.includes('AMBIGUOUS_TRANSFER'), true); });
