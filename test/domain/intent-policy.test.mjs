import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAuthorizationPolicy, evaluateIntentPolicy, evaluateNewIntentPolicyCompatibility } from '../../src/domain/intent-policy.mjs';
const intent = { chainId: 8453, action: 'TRANSFER', asset: 'native', amount: '100', sender: '0xaa', recipient: '0xbb', validUntil: 1100 };
test('policy permits an allowlisted intent', () => { const result = evaluateIntentPolicy(intent, { policyId: 'treasury-v1', allowedChainIds: [8453], allowedActions: ['TRANSFER'], allowedAssets: ['native'], allowedRecipients: ['0xbb'], maxAmount: '1000', maxValiditySeconds: 200 }, 1000); assert.equal(result.allowed, true); assert.deepEqual(result.reasonCodes, []); });
test('policy rejects with stable reason codes', () => { const result = evaluateIntentPolicy(intent, { allowedChainIds: [1], allowedRecipients: ['0xcc'], maxAmount: '10' }, 1000); assert.equal(result.allowed, false); assert.deepEqual(result.reasonCodes, ['POLICY_CHAIN_NOT_ALLOWED', 'POLICY_RECIPIENT_NOT_ALLOWED', 'POLICY_AMOUNT_EXCEEDED']); });
test('policy can require a signed minimum confirmation threshold', () => {
  assert.deepEqual(evaluateIntentPolicy({ ...intent, constraints: { minConfirmations: 2 } }, { minConfirmations: 12 }, 1000).reasonCodes, ['POLICY_MIN_CONFIRMATIONS_REQUIRED']);
  assert.equal(evaluateIntentPolicy({ ...intent, constraints: { minConfirmations: 12 } }, { minConfirmations: 12 }, 1000).allowed, true);
});
test('authorization policy binds a reviewed principal identity to its account type', () => {
  const account = `0x${'a'.repeat(40)}`;
  const authorization = { intent, principal: { id: 'acme-treasury', type: 'organization', account }, authorizer: { type: 'eip1271' } };
  const policy = { principals: [{ id: 'acme-treasury', type: 'organization', account, authorizerType: 'eip1271' }] };
  assert.equal(evaluateAuthorizationPolicy(authorization, policy, 1000).allowed, true);
  assert.deepEqual(evaluateAuthorizationPolicy({ ...authorization, principal: { ...authorization.principal, id: 'lookalike' } }, policy, 1000).reasonCodes, ['POLICY_PRINCIPAL_NOT_ALLOWED']);
});

test('authorization policy can require the authorizer and executor to be distinct', () => {
  const authorizer = `0x${'a'.repeat(40)}`;
  const executor = `0x${'b'.repeat(40)}`;
  const authorization = {
    intent,
    principal: { id: 'operator', type: 'user', account: authorizer },
    authorizer: { type: 'eip712', address: authorizer },
    delegate: { agentId: 'agent', executor },
  };
  const policy = { requireDistinctAuthorizerAndExecutor: true };
  assert.equal(evaluateAuthorizationPolicy(authorization, policy, 1000).allowed, true);
  assert.deepEqual(
    evaluateAuthorizationPolicy({ ...authorization, delegate: { agentId: 'agent', executor: authorizer } }, policy, 1000).reasonCodes,
    ['POLICY_AUTHORIZER_EXECUTOR_NOT_DISTINCT'],
  );
});

test('runtime policy evaluation fails closed on malformed restrictions', () => {
  assert.deepEqual(evaluateIntentPolicy(intent, { allowedRecipients: '0xcc' }, 1000).reasonCodes, ['POLICY_INVALID']);
  assert.deepEqual(evaluateAuthorizationPolicy({ intent, principal: { id: 'user', type: 'user', account: '0xaa' }, authorizer: { type: 'eip712' } }, { principals: 'everyone' }, 1000).reasonCodes, ['POLICY_INVALID']);
  assert.deepEqual(evaluateIntentPolicy(intent, { requireDistinctAuthorizerAndExecutor: 'yes' }, 1000).reasonCodes, ['POLICY_INVALID']);
});

test('new exact-call authorizations reject policies that imply unenforced transfer semantics', () => {
  const exact = { ...intent, executionProfile: 'priorseal.execution-profile.exact-call.v1' };
  assert.deepEqual(evaluateNewIntentPolicyCompatibility(exact, { allowedChainIds: [8453], minConfirmations: 12 }), { allowed: true, reasonCodes: [] });
  assert.deepEqual(evaluateNewIntentPolicyCompatibility(exact, { maxAmount: '100' }), { allowed: false, reasonCodes: ['POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED'] });
  assert.deepEqual(evaluateNewIntentPolicyCompatibility(exact, { allowedAssets: [] }), { allowed: false, reasonCodes: ['POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED'] });
  assert.deepEqual(evaluateNewIntentPolicyCompatibility(exact, { allowedRecipients: [] }), { allowed: false, reasonCodes: ['POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED'] });
});
