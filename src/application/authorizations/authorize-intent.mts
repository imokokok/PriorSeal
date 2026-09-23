import { AUTHORIZATION_SCHEMA, assertIssuableAuthorization, buildAuthorization, buildAuthorizationReceipt, signAuthorizationReceipt, verifyAuthorization } from '../../domain/authorization.mjs';
import { PriorSealError } from '../../domain/errors.mjs';
import { canonicalize, hashJson } from '../../domain/hashing.mjs';
import { evaluateAuthorizationPolicy, evaluateNewIntentPolicyCompatibility } from '../../domain/intent-policy.mjs';
import { verifyTimestampEvidence } from '../../domain/rfc3161.mjs';
import { verifyWitnessEvidence, type WitnessEvidence } from '../../domain/witness.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';
import { assertIssuableIntentInput } from '../../domain/intent.mjs';
import type { Authorization, AuthorizationAcceptance } from '../../domain/authorization.mjs';
import type { TimestampEvidence, TimestampPolicy } from '../../domain/rfc3161.mjs';
import type { IdempotencyStore } from '../idempotency.mjs';

type PolicyDocument = Record<string, unknown> & { timestampPolicy?: TimestampPolicy; witnessQuorum?: unknown };
type PolicyEvidence = { schema: string; policyHash: string; document: Record<string, unknown> | null; result: unknown };
type AuthorizationRecord = { authorization: Authorization; acceptance: AuthorizationAcceptance; policy?: unknown; policyEvidence?: PolicyEvidence; timestampEvidence?: unknown; witnessEvidence?: unknown; status: string; boundTxHash: string | null; uses: number };
type AuthorizationResponse = { authorization: Authorization; acceptance: AuthorizationAcceptance; policy: unknown; policyEvidence?: PolicyEvidence; timestampEvidence?: unknown; witnessEvidence?: WitnessEvidence };
type LogEntry = { sequence: number; authorizationHash: string; acceptedAt: number; previousEntryHash: string | null; entryHash: string };
type AuthorizationStore = IdempotencyStore<AuthorizationResponse> & {
  getAuthorization?: (id: string) => Promise<AuthorizationRecord | null | undefined>;
  saveAcceptedAuthorization?: (input: { authorization: Authorization; acceptedAt: number; createRecord: (log: LogEntry) => AuthorizationRecord }) => Promise<AuthorizationRecord>;
  appendAuthorizationLog: (input: { authorizationHash: string; acceptedAt: number }) => Promise<LogEntry>;
  saveIntent: (intent: Authorization['intent']) => Promise<unknown>;
  saveAuthorization: (record: AuthorizationRecord) => Promise<AuthorizationRecord | undefined>;
};
type ContractSignatureVerifier = NonNullable<NonNullable<Parameters<typeof verifyAuthorization>[1]>['verifyContractSignature']>;

export async function authorizeIntent({ input, idempotencyKey, store, privateKeyPem, issuer, keyId, policy = null, audience = 'priorseal', verifyContractSignature, timestampProvider = null, requireTimestamp = false, witnessProvider = null, requireWitnessQuorum = false, now = () => Date.now() }: { input: unknown; idempotencyKey?: string | null; store: AuthorizationStore; privateKeyPem?: string; issuer: string; keyId: string; policy?: PolicyDocument | null; audience?: string; verifyContractSignature?: ContractSignatureVerifier; timestampProvider?: ((input: { authorization: Authorization; acceptance: { acceptedAt: number }; policy: TimestampPolicy }) => Promise<TimestampEvidence>) | null; requireTimestamp?: boolean; witnessProvider?: ((input: { authorization: Authorization; acceptance: { acceptedAt: number } }) => Promise<WitnessEvidence>) | null; requireWitnessQuorum?: boolean; now?: () => number }) {
  const idempotency = await findIdempotentReplay({ scope: 'authorize-intent', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  if (!privateKeyPem) throw new PriorSealError('ISSUER_NOT_CONFIGURED', 'Issuer signing is required to accept an authorization');
  const request = input && typeof input === 'object' ? input as Record<string, unknown> : null;
  assertIssuableIntentInput(request?.intent);
  const acceptedAt = Math.floor(now() / 1000);
  const authorization = assertIssuableAuthorization(buildAuthorization(input));
  if (authorization.schema !== AUTHORIZATION_SCHEMA) throw new PriorSealError('INVALID_AUTHORIZATION', 'Legacy authorization schemas are verification-only');
  const verification = await verifyAuthorization(authorization, { now: acceptedAt, audience, verifyContractSignature });
  if (!verification.valid) throw new PriorSealError(verification.code, 'Authorization signature could not be accepted');
  const expectedPolicyHash = policy ? `0x${hashJson(policy)}` : `0x${'0'.repeat(64)}`;
  if (authorization.policyHash !== expectedPolicyHash) throw new PriorSealError('AUTHORIZATION_POLICY_MISMATCH', 'Authorization policyHash does not match the active policy');
  const policyResult = policy ? evaluateAuthorizationPolicy(authorization, policy, acceptedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: acceptedAt };
  const compatibility = evaluateNewIntentPolicyCompatibility(authorization.intent, policy ?? {});
  if (!compatibility.allowed) throw new PriorSealError('POLICY_REJECTED', 'Authorization policy cannot enforce descriptive exact-call semantics', { ...policyResult, ...compatibility, policyId: policyResult.policyId ?? null });
  if (!policyResult.allowed) throw new PriorSealError('POLICY_REJECTED', 'Intent rejected by policy', policyResult);
  const witnessPolicy = policy?.witnessQuorum;
  const existing = await store.getAuthorization?.(authorization.authorizationId);
  if (existing) {
    const existingWitnessEvidence = verifiedWitnessEvidence(existing.witnessEvidence, existing.authorization, witnessPolicy, existing.acceptance.acceptedAt);
    return { replay: true, response: { authorization: existing.authorization, acceptance: existing.acceptance, policy: existing.policyEvidence?.result ?? existing.policy, policyEvidence: existing.policyEvidence, ...(existing.timestampEvidence ? { timestampEvidence: existing.timestampEvidence } : {}), ...(existingWitnessEvidence ? { witnessEvidence: existingWitnessEvidence } : {}) } };
  }
  const orderingReference = { acceptedAt };
  const policyEvidence = { schema: 'priorseal.policy-evidence.v1', policyHash: expectedPolicyHash, document: policy, result: policyResult };
  const timestampPolicy = policy?.timestampPolicy;
  if (requireTimestamp && !timestampPolicy) throw new PriorSealError('INVALID_TIMESTAMP_POLICY', 'The active authorization policy must define timestampPolicy');
  if (timestampPolicy && !timestampProvider) throw new PriorSealError('TIMESTAMP_NOT_CONFIGURED', 'RFC 3161 timestamping is required by the signed policy');
  const timestampEvidence = timestampPolicy ? await timestampProvider!({ authorization, acceptance: orderingReference, policy: timestampPolicy }) : null;
  if (timestampEvidence) {
    const timestampVerification = await verifyTimestampEvidence(timestampEvidence, new TextEncoder().encode(canonicalize(authorization)), timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: orderingReference.acceptedAt });
    if (!timestampVerification.valid) throw new PriorSealError(timestampVerification.code, 'RFC 3161 timestamp could not be verified', timestampVerification);
  }
  if (requireWitnessQuorum && !witnessPolicy) throw new PriorSealError('INVALID_WITNESS_POLICY', 'The active authorization policy must define witnessQuorum');
  if (witnessPolicy && !witnessProvider) throw new PriorSealError('WITNESS_NOT_CONFIGURED', 'Witness quorum collection is required by the signed policy');
  const witnessEvidence = witnessPolicy ? await witnessProvider!({ authorization, acceptance: orderingReference }) : null;
  if (witnessEvidence) {
    const witnessVerification = verifyWitnessEvidence(witnessEvidence, authorization, witnessPolicy, { expectedRequestedAt: orderingReference.acceptedAt });
    if (!witnessVerification.valid) throw new PriorSealError(witnessVerification.code, 'Witness quorum could not be verified', witnessVerification);
  }
  const createRecord = (log: { acceptedAt: number; sequence: number; previousEntryHash: string | null }) => {
    const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({ authorization, issuer, keyId, acceptedAt: log.acceptedAt, sequence: log.sequence, previousEntryHash: log.previousEntryHash }), privateKeyPem);
    return { authorization, acceptance, policy: policyResult, policyEvidence, ...(timestampEvidence ? { timestampEvidence } : {}), ...(witnessEvidence ? { witnessEvidence } : {}), status: 'ACCEPTED', boundTxHash: null, uses: 0 };
  };
  let saved;
  if (store.saveAcceptedAuthorization) saved = await store.saveAcceptedAuthorization({ authorization, acceptedAt, createRecord });
  else {
    const log = await store.appendAuthorizationLog({ authorizationHash: hashJson(authorization), acceptedAt });
    await store.saveIntent(authorization.intent); saved = await store.saveAuthorization(createRecord(log));
  }
  if (!saved) throw new Error('Authorization store did not return a record');
  const savedWitnessEvidence = verifiedWitnessEvidence(saved.witnessEvidence, saved.authorization, witnessPolicy, saved.acceptance.acceptedAt);
  const response: AuthorizationResponse = { authorization: saved.authorization, acceptance: saved.acceptance, policy: saved.policyEvidence?.result ?? saved.policy, policyEvidence: saved.policyEvidence, ...(saved.timestampEvidence ? { timestampEvidence: saved.timestampEvidence } : {}), ...(savedWitnessEvidence ? { witnessEvidence: savedWitnessEvidence } : {}) };
  return reserveIdempotentResponse({ scope: 'authorize-intent', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
}

function verifiedWitnessEvidence(value: unknown, authorization: Authorization, policy: unknown, acceptedAt: number): WitnessEvidence | undefined {
  if (!value) return undefined;
  const verification = verifyWitnessEvidence(value, authorization, policy, { expectedRequestedAt: acceptedAt });
  if (!verification.valid) throw new PriorSealError(verification.code, 'Stored witness quorum evidence could not be verified', verification);
  return value as WitnessEvidence;
}
