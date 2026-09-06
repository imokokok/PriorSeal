import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAuthorizationPolicy, evaluateIntentPolicy } from '../../src/domain/intent-policy.mjs';
const intent = { chainId: 8453, action: 'TRANSFER', asset: 'native', amount: '100', sender: '0xaa', recipient: '0xbb', validUntil: 1100 };
test('policy permits an allowlisted intent', () => { const result = evaluateIntentPolicy(intent, { policyId: 'treasury-v1', allowedChainIds: [8453], allowedActions: ['TRANSFER'], allowedAssets: ['native'], allowedRecipients: ['0xbb'], maxAmount: '1000', maxValiditySeconds: 200 }, 1000); assert.equal(result.allowed, true); assert.deepEqual(result.reasonCodes, []); });
test('policy rejects with stable reason codes', () => { const result = evaluateIntentPolicy(intent, { allowedChainIds: [1], allowedRecipients: ['0xcc'], maxAmount: '10' }, 1000); assert.equal(result.allowed, false); assert.deepEqual(result.reasonCodes, ['POLICY_CHAIN_NOT_ALLOWED', 'POLICY_RECIPIENT_NOT_ALLOWED', 'POLICY_AMOUNT_EXCEEDED']); });
test('authorization policy binds a reviewed principal identity to its account type', () => {
  const account = `0x${'a'.repeat(40)}`;
  const authorization = { intent, principal: { id: 'acme-treasury', type: 'organization', account }, authorizer: { type: 'eip1271' } };
  const policy = { principals: [{ id: 'acme-treasury', type: 'organization', account, authorizerType: 'eip1271' }] };
  assert.equal(evaluateAuthorizationPolicy(authorization, policy, 1000).allowed, true);
  assert.deepEqual(evaluateAuthorizationPolicy({ ...authorization, principal: { ...authorization.principal, id: 'lookalike' } }, policy, 1000).reasonCodes, ['POLICY_PRINCIPAL_NOT_ALLOWED']);
});
