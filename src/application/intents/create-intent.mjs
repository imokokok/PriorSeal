import { buildIntent } from '../../domain/intent.mjs';
import { RunProofError } from '../../domain/errors.mjs';
import { evaluateIntentPolicy } from '../../domain/intent-policy.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';

/**
 * Builds and persists an intent as one application operation.
 * The store is intentionally injected so this use case has no persistence dependency.
 */
export async function createIntent({ input, idempotencyKey, store, policy = null, now = () => Date.now() }) {
  const idempotency = await findIdempotentReplay({ scope: 'create-intent', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const intent = buildIntent(input);
  const policyResult = policy
    ? evaluateIntentPolicy(intent, policy, Math.floor(now() / 1000))
    : { allowed: true, reasonCodes: [], policyId: null };
  if (!policyResult.allowed) throw new RunProofError('POLICY_REJECTED', 'Intent rejected by policy', policyResult);

  const response = { intent, intentHash: intent.intentHash, policy: policyResult };
  const result = await reserveIdempotentResponse({ scope: 'create-intent', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
  if (!result.replay) await store.saveIntent(intent);
  return result;
}
