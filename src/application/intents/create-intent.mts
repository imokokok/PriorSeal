import { assertIssuableIntentInput, buildIntent } from '../../domain/intent.mjs';
import { PriorSealError } from '../../domain/errors.mjs';
import { evaluateIntentPolicy, evaluateNewIntentPolicyCompatibility } from '../../domain/intent-policy.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';
import type { IdempotencyStore } from '../idempotency.mjs';

type Intent = ReturnType<typeof buildIntent>;
type IntentResponse = { intent: Intent; intentHash: string; policy: { allowed: boolean; reasonCodes: readonly string[]; policyId: unknown; evaluatedAt?: number } };
type IntentStore = IdempotencyStore<IntentResponse> & { saveIntent: (intent: Intent) => Promise<unknown> };

/**
 * Builds and persists an intent as one application operation.
 * The store is intentionally injected so this use case has no persistence dependency.
 */
export async function createIntent({ input, idempotencyKey, store, policy = null, now = () => Date.now() }: { input: unknown; idempotencyKey?: string | null; store: IntentStore; policy?: Record<string, unknown> | null; now?: () => number }) {
  const idempotency = await findIdempotentReplay({ scope: 'create-intent', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const intent = buildIntent(assertIssuableIntentInput(input));
  const policyResult = policy
    ? evaluateIntentPolicy(intent, policy, Math.floor(now() / 1000))
    : { allowed: true, reasonCodes: [], policyId: null };
  const compatibility = evaluateNewIntentPolicyCompatibility(intent, policy ?? {});
  if (!compatibility.allowed) throw new PriorSealError('POLICY_REJECTED', 'Intent policy cannot enforce descriptive exact-call semantics', { ...policyResult, ...compatibility, policyId: policyResult.policyId ?? null });
  if (!policyResult.allowed) throw new PriorSealError('POLICY_REJECTED', 'Intent rejected by policy', policyResult);

  const response = { intent, intentHash: intent.intentHash, policy: policyResult };
  const result = await reserveIdempotentResponse({ scope: 'create-intent', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
  if (!result.replay) await store.saveIntent(intent);
  return result;
}
