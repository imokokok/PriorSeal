import { AUTHORIZATION_SCHEMA, buildAuthorization, buildAuthorizationReceipt, signAuthorizationReceipt, verifyAuthorization } from '../../domain/authorization.mjs';
import { PriorSealError } from '../../domain/errors.mjs';
import { canonicalize, hashJson } from '../../domain/hashing.mjs';
import { evaluateAuthorizationPolicy } from '../../domain/intent-policy.mjs';
import { verifyTimestampEvidence } from '../../domain/rfc3161.mjs';
import { verifyWitnessEvidence } from '../../domain/witness.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';

export async function authorizeIntent({ input, idempotencyKey, store, privateKeyPem, issuer, keyId, policy = null, audience = 'priorseal', verifyContractSignature, timestampProvider = null, requireTimestamp = false, witnessProvider = null, requireWitnessQuorum = false, now = () => Date.now() }) {
  const idempotency = await findIdempotentReplay({ scope: 'authorize-intent', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  if (!privateKeyPem) throw new PriorSealError('ISSUER_NOT_CONFIGURED', 'Issuer signing is required to accept an authorization');
  const acceptedAt = Math.floor(now() / 1000);
  const authorization = buildAuthorization(input);
  if (authorization.schema !== AUTHORIZATION_SCHEMA) throw new PriorSealError('INVALID_AUTHORIZATION', 'Legacy authorization schemas are verification-only');
  const verification = await verifyAuthorization(authorization, { now: acceptedAt, audience, verifyContractSignature });
  if (!verification.valid) throw new PriorSealError(verification.code, 'Authorization signature could not be accepted');
  const expectedPolicyHash = policy ? `0x${hashJson(policy)}` : `0x${'0'.repeat(64)}`;
  if (authorization.policyHash !== expectedPolicyHash) throw new PriorSealError('AUTHORIZATION_POLICY_MISMATCH', 'Authorization policyHash does not match the active policy');
  const policyResult = policy ? evaluateAuthorizationPolicy(authorization, policy, acceptedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: acceptedAt };
  if (!policyResult.allowed) throw new PriorSealError('POLICY_REJECTED', 'Intent rejected by policy', policyResult);
  const existing = await store.getAuthorization?.(authorization.authorizationId);
  if (existing) return { replay: true, response: { authorization: existing.authorization, acceptance: existing.acceptance, policy: existing.policyEvidence?.result ?? existing.policy, policyEvidence: existing.policyEvidence, ...(existing.timestampEvidence ? { timestampEvidence: existing.timestampEvidence } : {}), ...(existing.witnessEvidence ? { witnessEvidence: existing.witnessEvidence } : {}) } };
  const orderingReference = { acceptedAt };
  const policyEvidence = { schema: 'priorseal.policy-evidence.v1', policyHash: expectedPolicyHash, document: policy, result: policyResult };
  const timestampPolicy = policy?.timestampPolicy;
  if (requireTimestamp && !timestampPolicy) throw new PriorSealError('INVALID_TIMESTAMP_POLICY', 'The active authorization policy must define timestampPolicy');
  if (timestampPolicy && !timestampProvider) throw new PriorSealError('TIMESTAMP_NOT_CONFIGURED', 'RFC 3161 timestamping is required by the signed policy');
  const timestampEvidence = timestampPolicy ? await timestampProvider({ authorization, acceptance: orderingReference, policy: timestampPolicy }) : null;
  if (timestampEvidence) {
    const timestampVerification = await verifyTimestampEvidence(timestampEvidence, new TextEncoder().encode(canonicalize(authorization)), timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: orderingReference.acceptedAt });
    if (!timestampVerification.valid) throw new PriorSealError(timestampVerification.code, 'RFC 3161 timestamp could not be verified', timestampVerification);
  }
  const witnessPolicy = policy?.witnessQuorum;
  if (requireWitnessQuorum && !witnessPolicy) throw new PriorSealError('INVALID_WITNESS_POLICY', 'The active authorization policy must define witnessQuorum');
  if (witnessPolicy && !witnessProvider) throw new PriorSealError('WITNESS_NOT_CONFIGURED', 'Witness quorum collection is required by the signed policy');
  const witnessEvidence = witnessPolicy ? await witnessProvider({ authorization, acceptance: orderingReference }) : null;
  if (witnessEvidence) {
    const witnessVerification = verifyWitnessEvidence(witnessEvidence, authorization, witnessPolicy, { expectedRequestedAt: orderingReference.acceptedAt });
    if (!witnessVerification.valid) throw new PriorSealError(witnessVerification.code, 'Witness quorum could not be verified', witnessVerification);
  }
  const createRecord = (log) => {
    const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({ authorization, issuer, keyId, acceptedAt: log.acceptedAt, sequence: log.sequence, previousEntryHash: log.previousEntryHash }), privateKeyPem);
    return { authorization, acceptance, policy: policyResult, policyEvidence, ...(timestampEvidence ? { timestampEvidence } : {}), ...(witnessEvidence ? { witnessEvidence } : {}), status: 'ACCEPTED', boundTxHash: null, uses: 0 };
  };
  let saved;
  if (store.saveAcceptedAuthorization) saved = await store.saveAcceptedAuthorization({ authorization, acceptedAt, createRecord });
  else {
    const log = await store.appendAuthorizationLog({ authorizationHash: hashJson(authorization), acceptedAt });
    await store.saveIntent(authorization.intent); saved = await store.saveAuthorization(createRecord(log));
  }
  const response = { authorization: saved.authorization, acceptance: saved.acceptance, policy: saved.policyEvidence?.result ?? saved.policy, policyEvidence: saved.policyEvidence, ...(saved.timestampEvidence ? { timestampEvidence: saved.timestampEvidence } : {}), ...(saved.witnessEvidence ? { witnessEvidence: saved.witnessEvidence } : {}) };
  return reserveIdempotentResponse({ scope: 'authorize-intent', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
}
