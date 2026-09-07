import test from 'node:test';
import assert from 'node:assert/strict';
import { bindIntentExecution } from '../../src/domain/binding.mjs';
import { buildIntent } from '../../src/domain/intent.mjs';
const intent = { chainId: 8453, action: 'TRANSFER', sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '2', validUntil: 1000, constraints: { minConfirmations: 3, maxGasUsed: '100000' } };
const execution = { chainId: 8453, action: 'TRANSFER', sender: '0xaa', recipient: '0xbb', asset: 'native', amount: '10', nonce: '2', executedAt: 900, observedAt: 1100, confirmations: 3, gasUsed: '21000', executionDataAvailable: true, transfers: [] };
test('binding returns explainable reason codes', () => { assert.deepEqual(bindIntentExecution(intent, execution).reasonCodes, []); const result = bindIntentExecution(intent, { ...execution, recipient: '0xcc', confirmations: 1, gasUsed: '200000' }); assert.equal(result.bound, false); assert.deepEqual(result.reasonCodes, ['RECIPIENT_MISMATCH', 'INSUFFICIENT_FINALITY', 'GAS_LIMIT_EXCEEDED']); });
test('multiple transfers are undetermined unless uniquely selected', () => { const result = bindIntentExecution(intent, { ...execution, transfers: [{}, {}] }); assert.equal(result.reasonCodes.includes('AMBIGUOUS_TRANSFER'), true); });
test('action and block time participate in binding', () => { assert.equal(bindIntentExecution(intent, { ...execution, action: 'CONTRACT_CALL' }).reasonCodes.includes('ACTION_MISMATCH'), true); assert.equal(bindIntentExecution(intent, { ...execution, executedAt: 1001 }).reasonCodes.includes('OUTSIDE_TIME_WINDOW'), true); assert.equal(bindIntentExecution(intent, execution).reasonCodes.includes('OUTSIDE_TIME_WINDOW'), false); });
test('exact-call profile binds transaction bytes instead of ambiguous transfer semantics', () => {
  const callTarget = `0x${'c'.repeat(40)}`;
  const calldataHash = `0x${'d'.repeat(64)}`;
  const exact = buildIntent({
    schema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
    intentId: 'insight-swap-1',
    chainId: 8453,
    action: 'CONTRACT_CALL',
    asset: 'eip155:8453/erc20:0x1111111111111111111111111111111111111111',
    amount: '1000000',
    sender: `0x${'a'.repeat(40)}`,
    recipient: callTarget,
    validUntil: 1000,
    nonce: '2',
    callTarget,
    calldataHash,
    transactionValue: '0',
    constraints: { minConfirmations: 3 },
  });
  const observed = {
    ...execution,
    sender: exact.sender,
    action: 'CONTRACT_CALL',
    target: callTarget,
    calldataHash,
    nativeValue: '0',
    recipient: `0x${'e'.repeat(40)}`,
    asset: 'eip155:8453/erc20:0x2222222222222222222222222222222222222222',
    amount: '999',
    transfers: [{}, {}, {}],
  };
  assert.deepEqual(bindIntentExecution(exact, observed).reasonCodes, []);
  assert.deepEqual(bindIntentExecution(exact, { ...observed, calldataHash: `0x${'f'.repeat(64)}` }).reasonCodes, ['CALLDATA_MISMATCH']);
  const { intentHash: _intentHash, calldataHash: _calldataHash, ...exactInput } = exact;
  assert.throws(
    () => buildIntent(exactInput),
    (error) => error.code === 'INVALID_INTENT'
  );
  assert.throws(
    () => buildIntent({ ...exactInput, calldataHash, action: 'contract_call' }),
    (error) => error.code === 'INVALID_INTENT'
  );
});
