import { RunProofError } from '../../domain/errors.mjs';
import { buildIntent } from '../../domain/intent.mjs';
import { buildReceipt, signReceipt } from '../../domain/receipt.mjs';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';

/** Observes an execution, records evidence, and optionally issues a signed receipt. */
export async function observeExecution({ input, store, observer, signal, privateKeyPem, publicKeyPem, issuer, keyId }) {
  assertOnlyFields(input, ['intentId', 'intent', 'chainId', 'txHash', 'confirmations'], 'observation request');
  const intent = input.intent ? buildIntent(input.intent) : await store.getIntent(input.intentId);
  if (!intent) throw new RunProofError('INTENT_NOT_FOUND', 'Intent not found');
  if (input.chainId !== undefined && Number(input.chainId) !== Number(intent.chainId)) {
    throw new RunProofError('INVALID_REQUEST', 'chainId must match the intent');
  }

  const observation = await observer({
    chainId: intent.chainId,
    txHash: input.txHash,
    confirmations: input.confirmations,
    signal,
  });
  await store.saveObservation(observation);

  const receipt = privateKeyPem
    ? signReceipt(buildReceipt({ intent, execution: observation, issuer, keyId }), privateKeyPem)
    : null;
  if (receipt) await store.saveReceipt(receipt);
  return {
    observation,
    receipt,
    ...(receipt ? { verification: verifyReceipt(receipt, publicKeyPem, { keyId }) } : {}),
  };
}
