import { RunProofError } from '../../domain/errors.mjs';
import { buildIntent } from '../../domain/intent.mjs';
import { buildReceipt, signReceipt } from '../../domain/receipt.mjs';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { detectReorg } from '../../domain/execution.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';
import { findIdempotentReplay, reserveIdempotentResponse } from '../idempotency.mjs';

/** Observes an execution, records evidence, and optionally issues a signed receipt. */
export async function observeExecution({ input, store, observer, signal, privateKeyPem, publicKeyPem, issuer, keyId, idempotencyKey, now = () => Date.now() }) {
  assertOnlyFields(input, ['intentId', 'intent', 'chainId', 'txHash', 'confirmations'], 'observation request');
  const idempotency = await findIdempotentReplay({ scope: 'observe-execution', key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const intent = input.intent ? buildIntent(input.intent) : await store.getIntent(input.intentId);
  if (!intent) throw new RunProofError('INTENT_NOT_FOUND', 'Intent not found');
  if (input.chainId !== undefined && Number(input.chainId) !== Number(intent.chainId)) {
    throw new RunProofError('INVALID_REQUEST', 'chainId must match the intent');
  }

  const previous = store.getObservation ? await store.getObservation(intent.chainId, input.txHash) : null;
  const observed = await observer({
    chainId: intent.chainId,
    txHash: input.txHash,
    confirmations: input.confirmations,
    signal,
  });
  let observation = { ...observed, intentHash: intent.intentHash };
  if (detectReorg(previous, observation)) observation = { ...observation, status: 'REORGED', finalityState: 'REORGED', previousBlockHash: previous.blockHash };

  const receipt = privateKeyPem
    ? signReceipt(buildReceipt({ intent, execution: observation, issuer, keyId, issuedAt: Math.floor(now() / 1000) }), privateKeyPem)
    : null;
  const response = {
    observation,
    receipt,
    ...(receipt ? { verification: verifyReceipt(receipt, publicKeyPem, { keyId }) } : {}),
  };
  const result = await reserveIdempotentResponse({ scope: 'observe-execution', key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
  if (!result.replay) {
    await store.saveObservation(observation);
    if (receipt) await store.saveReceipt(receipt);
  }
  return result;
}
