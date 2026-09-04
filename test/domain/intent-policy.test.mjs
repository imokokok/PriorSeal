import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIntentPolicy } from '../../src/domain/intent-policy.mjs';
const intent = { chainId: 8453, action: 'TRANSFER', asset: 'native', amount: '100', sender: '0xaa', recipient: '0xbb', validUntil: 1100 };
test('policy permits an allowlisted intent', () => { const result = evaluateIntentPolicy(intent, { policyId: 'treasury-v1', allowedChainIds: [8453], allowedActions: ['TRANSFER'], allowedAssets: ['native'], allowedRecipients: ['0xbb'], maxAmount: '1000', maxValiditySeconds: 200 }, 1000); assert.equal(result.allowed, true); assert.deepEqual(result.reasonCodes, []); });
test('policy rejects with stable reason codes', () => { const result = evaluateIntentPolicy(intent, { allowedChainIds: [1], allowedRecipients: ['0xcc'], maxAmount: '10' }, 1000); assert.equal(result.allowed, false); assert.deepEqual(result.reasonCodes, ['POLICY_CHAIN_NOT_ALLOWED', 'POLICY_RECIPIENT_NOT_ALLOWED', 'POLICY_AMOUNT_EXCEEDED']); });
