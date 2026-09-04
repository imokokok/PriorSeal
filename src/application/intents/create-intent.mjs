import { buildIntent } from '../../domain/intent.mjs';
import { RunProofError } from '../../domain/errors.mjs';
import { hashJson } from '../../domain/hashing.mjs';
import { evaluateIntentPolicy } from '../../domain/intent-policy.mjs';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Builds and persists an intent as one application operation.
 * The store is intentionally injected so this use case has no persistence dependency.
 */
export async function createIntent({ input, idempotencyKey, store, policy = null, now = () => Date.now() }) {
  const intent = buildIntent(input);
  const policyResult = policy
    ? evaluateIntentPolicy(intent, policy, Math.floor(now() / 1000))
    : { allowed: true, reasonCodes: [], policyId: null };
  if (!policyResult.allowed) throw new RunProofError('POLICY_REJECTED', 'Intent rejected by policy', policyResult);

  const response = { intent, intentHash: intent.intentHash, policy: policyResult };
  const result = await reserveIdempotency({ idempotencyKey, store, request: input, response, now });
  if (!result.replay) await store.saveIntent(intent);
  return result;
}

async function reserveIdempotency({ idempotencyKey, store, request, response, now }) {
  if (!idempotencyKey) return { replay: false, response };
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new RunProofError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1-128 safe characters');
  }
  if (!store.reserveIdempotency) return { replay: false, response };
  return store.reserveIdempotency({
    scope: 'create-intent',
    key: idempotencyKey,
    requestHash: hashJson(request),
    response,
    expiresAt: now() + 86_400_000,
  });
}
