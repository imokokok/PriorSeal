import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompliance, classifyExecutionOutcome } from '../../src/domain/compliance.mjs';

const authorization = { intent: { chainId: 8453, nonce: '7' }, delegate: { executor: '0xaa' } };
const execution = { chainId: 8453, sender: '0xaa', nonce: '7', status: 'CONFIRMED', finalityState: 'CONFIRMED', executionDataAvailable: true };

test('migrated compliance keeps availability, correlation, and conformance separate', () => {
  assert.deepEqual(assessCompliance({ authorization, execution, binding: { bound: true, reasonCodes: [] } }), { schema: 'priorseal.compliance-assessment.v1', status: 'COMPLIANT', reasonCodes: [] });
  assert.deepEqual(assessCompliance({ authorization, execution, binding: { bound: false, reasonCodes: ['RECIPIENT_MISMATCH'] } }).reasonCodes, ['RECIPIENT_MISMATCH']);
  assert.equal(assessCompliance({ authorization, execution, binding: { bound: false, reasonCodes: ['RECIPIENT_MISMATCH'] } }).status, 'NON_COMPLIANT');
  assert.deepEqual(assessCompliance({ authorization, execution: { ...execution, status: 'REORGED' }, binding: { bound: false, reasonCodes: ['RECIPIENT_MISMATCH'] } }).reasonCodes, ['EXECUTION_REORGED']);
  assert.deepEqual(assessCompliance({ authorization, execution, binding: { bound: false, reasonCodes: ['EXECUTION_UNAVAILABLE'] } }).reasonCodes, ['EXECUTION_UNAVAILABLE']);
  assert.deepEqual(assessCompliance({ authorization, execution: { ...execution, sender: '0xbb' }, binding: { bound: false, reasonCodes: ['RECIPIENT_MISMATCH'] } }).reasonCodes, ['EXECUTOR_MISMATCH']);
});

test('migrated execution outcome preserves finality precedence', () => {
  assert.equal(classifyExecutionOutcome({ ...execution, status: 'REVERTED', finalityState: 'INSUFFICIENT_FINALITY' }), 'PENDING');
  assert.equal(classifyExecutionOutcome({ ...execution, status: 'REORGED' }), 'REORGED');
  assert.equal(classifyExecutionOutcome({ ...execution, status: 'REVERTED' }), 'FAILED');
  assert.equal(classifyExecutionOutcome(execution), 'COMPLETED');
});
