import { PriorSealError } from '../../domain/errors.mjs';
import { buildIntent } from '../../domain/intent.mjs';
import { buildReceipt, signReceipt } from '../../domain/receipt.mjs';
import { buildAuthorizedReceipt, verifyAuthorizedReceipt } from '../../domain/authorization.mjs';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { detectReorg } from '../../domain/execution.mjs';
import { verifyWitnessEvidence } from '../../domain/witness.mjs';
import { canonicalize, hashJson } from '../../domain/hashing.mjs';
import { verifyTimestampEvidence } from '../../domain/rfc3161.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';

/** Observes an execution, records evidence, and optionally issues a signed receipt. */
export async function observeExecution({ input, store, observer, signal, privateKeyPem, publicKeyPem, issuer, keyId, idempotencyKey, transparencyProvider, authorizationAudience = 'priorseal', verifyContractSignature, now = () => Date.now() }) {
  assertOnlyFields(input, ['intentId', 'authorizationId', 'intent', 'chainId', 'txHash', 'confirmations'], 'observation request');
  const idempotency = await findIdempotentReplay({ scope: 'observe-execution', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const authorizationRecord = input.authorizationId ? await store.getAuthorization?.(input.authorizationId) : null;
  if (input.authorizationId && !authorizationRecord) throw new PriorSealError('AUTHORIZATION_NOT_FOUND', 'Authorization not found');
  const intent = authorizationRecord?.authorization.intent ?? (input.intent ? buildIntent(input.intent) : await store.getIntent(input.intentId));
  if (!intent) throw new PriorSealError('INTENT_NOT_FOUND', 'Intent not found');
  if (input.intentId && input.intentId !== intent.intentId) throw new PriorSealError('INVALID_REQUEST', 'intentId must match the authorization');
  if (input.chainId !== undefined && Number(input.chainId) !== Number(intent.chainId)) {
    throw new PriorSealError('INVALID_REQUEST', 'chainId must match the intent');
  }

  const requestedConfirmations = input.confirmations ?? 0;
  if (!Number.isSafeInteger(requestedConfirmations) || requestedConfirmations < 0 || requestedConfirmations > 10_000) throw new PriorSealError('INVALID_REQUEST', 'confirmations must be an integer between 0 and 10000');
  const confirmations = Math.max(requestedConfirmations, Number(intent.constraints?.minConfirmations ?? 0));
  const previous = store.getObservation ? await store.getObservation(intent.chainId, input.txHash) : null;
  const observed = await observer({
    chainId: intent.chainId,
    txHash: input.txHash,
    confirmations,
    signal,
  });
  let observation = { ...observed, intentHash: intent.intentHash };
  if (detectReorg(previous, observation)) observation = { ...observation, status: 'REORGED', finalityState: 'REORGED', previousBlockHash: previous.blockHash };

  const transparency = authorizationRecord && transparencyProvider ? await transparencyProvider(authorizationRecord.acceptance) : null;
  const timestampPolicy = authorizationRecord?.policyEvidence?.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = await verifyTimestampEvidence(authorizationRecord.timestampEvidence, new TextEncoder().encode(canonicalize(authorizationRecord.authorization)), timestampPolicy, { authorizationHash: hashJson(authorizationRecord.authorization), requestedAt: authorizationRecord.acceptance.acceptedAt, before: observation.executedAt ?? observation.observedAt });
    if (!timestamped.valid) throw new PriorSealError(timestamped.code, 'Valid pre-execution RFC 3161 evidence is required', timestamped);
  }
  const witnessPolicy = authorizationRecord?.policyEvidence?.document?.witnessQuorum;
  if (witnessPolicy) {
    const witnessed = verifyWitnessEvidence(authorizationRecord.witnessEvidence, authorizationRecord.authorization, witnessPolicy, { expectedRequestedAt: authorizationRecord.acceptance.acceptedAt, before: observation.executedAt ?? observation.observedAt });
    if (!witnessed.valid) throw new PriorSealError(witnessed.code, 'A valid pre-execution witness quorum is required', witnessed);
  }
  const authorizationAssociation = authorizationRecord ? classifyAuthorizationAssociation(authorizationRecord.authorization, observation) : null;
  const claimAuthorization = authorizationAssociation === 'FINAL';
  const receipt = privateKeyPem
    ? signReceipt(authorizationRecord
      ? buildAuthorizedReceipt({ authorization: authorizationRecord.authorization, acceptance: authorizationRecord.acceptance, policyEvidence: authorizationRecord.policyEvidence, timestampEvidence: authorizationRecord.timestampEvidence, witnessEvidence: authorizationRecord.witnessEvidence, transparency, execution: observation, issuer, keyId, issuedAt: Math.floor(now() / 1000) })
      : buildReceipt({ intent, execution: observation, issuer, keyId, issuedAt: Math.floor(now() / 1000) }), privateKeyPem)
    : null;
  const response = {
    observation,
    receipt,
    ...(authorizationAssociation ? { authorizationAssociation } : {}),
    ...(receipt ? { verification: authorizationRecord ? await verifyAuthorizedReceipt(receipt, publicKeyPem, { audience: authorizationAudience, verifyContractSignature }) : verifyReceipt(receipt, publicKeyPem, { keyId }) } : {}),
  };
  if (store.saveObservationReceipt) {
    const committed = await store.saveObservationReceipt({ authorizationId: authorizationRecord?.authorization.authorizationId, claimAuthorization, observation, receipt });
    if (!committed.ok) throw new PriorSealError(committed.code, 'Authorization has already been bound to another transaction');
  } else {
    if (claimAuthorization) {
      const binding = await store.bindAuthorization(authorizationRecord.authorization.authorizationId, observation.txHash);
      if (!binding.ok) throw new PriorSealError(binding.code, 'Authorization has already been bound to another transaction');
    }
    await store.saveObservation(observation);
    if (receipt) await store.saveReceipt(receipt);
  }
  return reserveIdempotentResponse({ scope: 'observe-execution', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
}

export function canClaimAuthorization(authorization, observation) {
  return classifyAuthorizationAssociation(authorization, observation) === 'FINAL';
}

export function classifyAuthorizationAssociation(authorization, observation) {
  if (!authorization || !observation || observation.executionDataAvailable === false) return 'UNRELATED';
  const correlated = Number(observation.chainId) === Number(authorization.intent.chainId)
    && String(observation.sender ?? '').toLowerCase() === authorization.delegate.executor
    && String(observation.nonce ?? '') === String(authorization.intent.nonce);
  if (!correlated) return 'UNRELATED';
  if (['CONFIRMED', 'REVERTED'].includes(observation.status)) return 'FINAL';
  if (observation.status === 'PENDING') return 'CANDIDATE';
  return 'UNRELATED';
}
