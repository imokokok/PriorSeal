import { PriorSealError } from '../../domain/errors.mjs';
import { buildIntent } from '../../domain/intent.mjs';
import { buildReceipt, signReceipt } from '../../domain/receipt.mjs';
import { buildAuthorizedReceipt, verifyAuthorizedReceipt } from '../../domain/authorization.mjs';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { detectReorg } from '../../domain/execution.mjs';
import { verifyWitnessEvidence } from '../../domain/witness.mjs';
import { canonicalize, hashJson } from '../../domain/hashing.mjs';
import { verifyTimestampEvidence } from '../../domain/rfc3161.mjs';
import { txHash as normalizeTxHash } from '../../domain/values.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';
import type { Authorization } from '../../domain/authorization.mjs';
import type { BindingExecution } from '../../domain/binding.mjs';
import type { AuthorizationAcceptance } from '../../domain/authorization.mjs';
import type { WorkerObservation } from './observation-worker.mjs';
import type { IdempotencyStore } from '../idempotency.mjs';
import type { normalizeExecution } from '../../domain/execution.mjs';

type CorrelatedObservation = BindingExecution & { txHash?: string | null; intentHash?: string | null; executionDataAvailable?: boolean };
type Observation = WorkerObservation & { chainId: number | string; intentHash?: string; executedAt?: number | null; observedAt?: number | null; confirmations?: number; sender?: string | null; nonce?: string | null; action?: string | null; recipient?: string | null; target?: string | null; calldataHash?: string | null; nativeValue?: string | null; asset?: string | null; amount?: string | null; status: string };
type PolicyEvidence = NonNullable<Parameters<typeof buildAuthorizedReceipt>[0]['policyEvidence']>;
type TimestampEvidence = NonNullable<Parameters<typeof buildAuthorizedReceipt>[0]['timestampEvidence']>;
type TransparencyEvidence = NonNullable<Parameters<typeof buildAuthorizedReceipt>[0]['transparency']>;
type AcceptanceRecord = { authorization: Authorization; acceptance: AuthorizationAcceptance; policyEvidence?: { schema?: string; result?: unknown; document?: Record<string, unknown> | null }; timestampEvidence?: unknown; witnessEvidence?: unknown };
type SignedReceipt = Record<string, unknown> & { receiptId: string; intentHash: string; execution: Observation; schema: string; issuer: string; keyId: string; outcome: string; signature?: string };
type ObservationStore = IdempotencyStore<Record<string, unknown>> & {
  getAuthorization?: (id: string) => Promise<AcceptanceRecord | null | undefined>;
  getIntent: (id: string) => Promise<ReturnType<typeof buildIntent> | null | undefined>;
  getObservation?: (chainId: number | string, txHash: string) => Promise<Observation | null | undefined>;
  saveObservationReceipt?: (input: { authorizationId?: string; claimAuthorization: boolean; observation: Observation; receipt: SignedReceipt | null }) => Promise<{ ok: boolean; code?: string }>;
  bindAuthorization: (id: string, txHash: string) => Promise<{ ok: boolean; code?: string }>;
  saveObservation: (observation: Observation) => Promise<unknown>;
  saveReceipt: (receipt: SignedReceipt) => Promise<unknown>;
};
type Observer = (input: { chainId: number; txHash: string; confirmations: number; signal?: AbortSignal }) => Promise<ReturnType<typeof normalizeExecution>>;
type ContractSignatureVerifier = NonNullable<NonNullable<Parameters<typeof verifyAuthorizedReceipt>[2]>['verifyContractSignature']>;

/** Observes an execution, records evidence, and optionally issues a signed receipt. */
export async function observeExecution({ input: inputValue, store, observer, signal, privateKeyPem, publicKeyPem, issuer, keyId, idempotencyKey, transparencyProvider, authorizationAudience = 'priorseal', verifyContractSignature, now = () => Date.now() }: { input: unknown; store: ObservationStore; observer: Observer; signal?: AbortSignal; privateKeyPem?: string; publicKeyPem?: string; issuer: string; keyId: string; idempotencyKey?: string | null; transparencyProvider?: ((acceptance: AuthorizationAcceptance, options?: { before?: number }) => Promise<TransparencyEvidence>) | null; authorizationAudience?: string; verifyContractSignature?: ContractSignatureVerifier; now?: () => number }) {
  if (privateKeyPem && !publicKeyPem) throw new TypeError('Issuer public key is required for receipt verification');
  const input = assertOnlyFields(inputValue, ['intentId', 'authorizationId', 'intent', 'chainId', 'txHash', 'confirmations'], 'observation request');
  if (input.authorizationId != null && typeof input.authorizationId !== 'string') throw new PriorSealError('INVALID_REQUEST', 'authorizationId must be a string');
  if (input.intentId != null && typeof input.intentId !== 'string') throw new PriorSealError('INVALID_REQUEST', 'intentId must be a string');
  const requestedTxHash = normalizeTxHash(input.txHash);
  const idempotency = await findIdempotentReplay({ scope: 'observe-execution', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const authorizationRecord = input.authorizationId ? await store.getAuthorization?.(input.authorizationId) : null;
  if (input.authorizationId && !authorizationRecord) throw new PriorSealError('AUTHORIZATION_NOT_FOUND', 'Authorization not found');
  const intent = authorizationRecord?.authorization.intent ?? (input.intent ? buildIntent(input.intent) : input.intentId ? await store.getIntent(input.intentId) : null);
  if (!intent) throw new PriorSealError('INTENT_NOT_FOUND', 'Intent not found');
  if (input.intentId && input.intentId !== intent.intentId) throw new PriorSealError('INVALID_REQUEST', 'intentId must match the authorization');
  if (input.chainId !== undefined && Number(input.chainId) !== Number(intent.chainId)) {
    throw new PriorSealError('INVALID_REQUEST', 'chainId must match the intent');
  }

  const requestedConfirmations = input.confirmations ?? 0;
  if (typeof requestedConfirmations !== 'number' || !Number.isSafeInteger(requestedConfirmations) || requestedConfirmations < 0 || requestedConfirmations > 10_000) throw new PriorSealError('INVALID_REQUEST', 'confirmations must be an integer between 0 and 10000');
  const confirmations = Math.max(requestedConfirmations, Number((intent.constraints as { minConfirmations?: unknown } | undefined)?.minConfirmations ?? 0));
  const previous = store.getObservation ? await store.getObservation(intent.chainId, requestedTxHash) : null;
  const observed = await observer({
    chainId: intent.chainId,
    txHash: requestedTxHash,
    confirmations,
    signal,
  });
  const observedTxHash = normalizeTxHash(observed?.txHash);
  if (observedTxHash !== requestedTxHash) throw new PriorSealError('OBSERVATION_TX_HASH_MISMATCH', 'Observer transaction hash does not match the requested transaction');
  if (Number(observed?.chainId) !== Number(intent.chainId)) throw new PriorSealError('OBSERVATION_CHAIN_MISMATCH', 'Observer chain does not match the authorized intent');
  if (typeof observed.status !== 'string') throw new PriorSealError('RPC_INVALID_RESPONSE', 'Observer status is missing');
  let observation = { ...observed, txHash: observedTxHash, intentHash: intent.intentHash } as Observation;
  const observedConfirmations = Number(observation.confirmations ?? 0);
  const claimsFinalExecution = ['CONFIRMED', 'REVERTED'].includes(observation.status);
  const hasRequiredFinality = observation.finalityState === 'CONFIRMED' && Number.isSafeInteger(observedConfirmations) && observedConfirmations >= confirmations;
  if (claimsFinalExecution && !hasRequiredFinality) observation = { ...observation, status: 'PENDING', finalityState: 'INSUFFICIENT_FINALITY' };
  if (detectReorg(previous, observation)) observation = { ...observation, status: 'REORGED', finalityState: 'REORGED', previousBlockHash: previous?.blockHash };

  const executionTime = observation.executedAt ?? observation.observedAt ?? undefined;
  const transparency = authorizationRecord && transparencyProvider ? await transparencyProvider(authorizationRecord.acceptance, { before: executionTime }) : null;
  const timestampPolicy = authorizationRecord?.policyEvidence?.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = await verifyTimestampEvidence(authorizationRecord.timestampEvidence as TimestampEvidence | undefined, new TextEncoder().encode(canonicalize(authorizationRecord.authorization)), timestampPolicy, { authorizationHash: hashJson(authorizationRecord.authorization), requestedAt: authorizationRecord.acceptance.acceptedAt, before: executionTime });
    if (!timestamped.valid) throw new PriorSealError(timestamped.code, 'Valid pre-execution RFC 3161 evidence is required', timestamped);
  }
  const witnessPolicy = authorizationRecord?.policyEvidence?.document?.witnessQuorum;
  if (witnessPolicy) {
    const witnessed = verifyWitnessEvidence(authorizationRecord.witnessEvidence, authorizationRecord.authorization, witnessPolicy, { expectedRequestedAt: authorizationRecord.acceptance.acceptedAt, before: executionTime });
    if (!witnessed.valid) throw new PriorSealError(witnessed.code, 'A valid pre-execution witness quorum is required', witnessed);
  }
  const authorizationAssociation = authorizationRecord ? classifyAuthorizationAssociation(authorizationRecord.authorization, observation) : null;
  const executionCorrelation = authorizationRecord ? classifyExecutionCorrelation(authorizationRecord.authorization, observation) : null;
  const claimAuthorization = authorizationAssociation === 'FINAL';
  const receiptIssuedAt = Math.max(Math.floor(now() / 1000), observation.observedAt ?? observation.executedAt ?? 0);
  const receipt = privateKeyPem
    ? signReceipt(authorizationRecord
      ? buildAuthorizedReceipt({ authorization: authorizationRecord.authorization, acceptance: authorizationRecord.acceptance, policyEvidence: authorizationRecord.policyEvidence as PolicyEvidence | undefined, timestampEvidence: authorizationRecord.timestampEvidence as TimestampEvidence | undefined, witnessEvidence: authorizationRecord.witnessEvidence, transparency, execution: observation, issuer, keyId, issuedAt: receiptIssuedAt })
      : buildReceipt({ intent, execution: observation, issuer, keyId, issuedAt: receiptIssuedAt }), privateKeyPem)
    : null;
  let verification: Awaited<ReturnType<typeof verifyAuthorizedReceipt>> | ReturnType<typeof verifyReceipt> | null = null;
  if (receipt) {
    if (!publicKeyPem) throw new TypeError('Issuer public key is required for receipt verification');
    verification = authorizationRecord
      ? await verifyAuthorizedReceipt(receipt, publicKeyPem, { audience: authorizationAudience, verifyContractSignature })
      : verifyReceipt(receipt, publicKeyPem, { keyId });
  }
  if (verification && !verification.valid) throw new PriorSealError(verification.code, 'The generated receipt failed self-verification and was not persisted');
  const response = {
    observation,
    receipt,
    ...(authorizationAssociation ? { authorizationAssociation } : {}),
    ...(executionCorrelation ? { executionCorrelation } : {}),
    ...(verification ? { verification } : {}),
  };
  if (store.saveObservationReceipt) {
    const committed = await store.saveObservationReceipt({ authorizationId: authorizationRecord?.authorization.authorizationId, claimAuthorization, observation, receipt });
    if (!committed.ok) throw new PriorSealError(committed.code ?? 'AUTHORIZATION_ALREADY_USED', 'Authorization has already been bound to another transaction');
  } else {
    if (claimAuthorization && authorizationRecord) {
      const binding = await store.bindAuthorization(authorizationRecord.authorization.authorizationId, observation.txHash);
      if (!binding.ok) throw new PriorSealError(binding.code ?? 'AUTHORIZATION_ALREADY_USED', 'Authorization has already been bound to another transaction');
    }
    await store.saveObservation(observation);
    if (receipt) await store.saveReceipt(receipt);
  }
  return reserveIdempotentResponse({ scope: 'observe-execution', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
}

export function canClaimAuthorization(authorization: Authorization | null | undefined, observation: CorrelatedObservation | null | undefined) {
  return classifyAuthorizationAssociation(authorization, observation) === 'FINAL';
}

export function classifyAuthorizationAssociation(authorization: Authorization | null | undefined, observation: CorrelatedObservation | null | undefined) {
  if (!authorization || !observation || observation.executionDataAvailable === false) return 'UNRELATED';
  const correlated = /^0x[0-9a-fA-F]{64}$/.test(observation.txHash ?? '')
    && observation.intentHash === authorization.intentHash
    && Number(observation.chainId) === Number(authorization.intent.chainId)
    && same(observation.sender, authorization.delegate.executor)
    && String(observation.nonce ?? '') === String(authorization.intent.nonce);
  if (!correlated) return 'UNRELATED';
  if (['CONFIRMED', 'REVERTED'].includes(observation.status ?? '') && observation.finalityState === 'CONFIRMED') return 'FINAL';
  if (['CONFIRMED', 'REVERTED'].includes(observation.status ?? '')) return 'CANDIDATE';
  if (observation.status === 'PENDING') return 'CANDIDATE';
  return 'UNRELATED';
}

export function classifyExecutionCorrelation(authorization: Authorization | null | undefined, observation: CorrelatedObservation | null | undefined) {
  if (!authorization || !observation || observation.executionDataAvailable === false) return 'INDETERMINATE';
  const intent = authorization.intent;
  const exactCall = intent.executionProfile === 'priorseal.execution-profile.exact-call.v1';
  const matches = /^0x[0-9a-fA-F]{64}$/.test(observation.txHash ?? '')
    && observation.intentHash === authorization.intentHash
    && Number(observation.chainId) === Number(intent.chainId)
    && same(observation.sender, authorization.delegate.executor)
    && same(observation.action, intent.action)
    && String(observation.nonce ?? '') === String(intent.nonce)
    && (exactCall
      ? same(observation.target, intent.callTarget)
        && same(observation.calldataHash, intent.calldataHash)
        && String(observation.nativeValue ?? '') === String(intent.transactionValue)
      : same(observation.recipient, intent.recipient)
        && same(observation.asset, intent.asset)
        && String(observation.amount ?? '') === String(intent.amount));
  return matches ? 'MATCH' : 'MISMATCH';
}

function same(left: unknown, right: unknown) {
  return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();
}
