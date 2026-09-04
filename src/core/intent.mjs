import { hashJson } from './hashing.mjs';
import { RunProofError } from './errors.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';
import { chainId, evmAddress, protocolId, uintString, unixSeconds } from '../domain/values.mjs';

export const INTENT_SCHEMA = 'runproof.intent.v1';
const required = ['intentId', 'chainId', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil'];
export function buildIntent(input) {
  assertSafeJson(input);
  assertOnlyFields(input, ['intentId', 'chainId', 'chainIds', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil', 'nonce', 'constraints'], 'intent');
  if (!input || required.some((key) => input[key] === undefined || input[key] === null)) throw new RunProofError('INVALID_INTENT', `Missing intent field: ${required.find((key) => input?.[key] == null)}`);
  const constraints = input.constraints ?? undefined;
  if (constraints !== undefined) {
    assertOnlyFields(constraints, ['minConfirmations', 'maxGasUsed'], 'intent.constraints');
    if (constraints.minConfirmations != null && (!Number.isSafeInteger(Number(constraints.minConfirmations)) || Number(constraints.minConfirmations) < 0)) throw new RunProofError('INVALID_CONSTRAINT', 'minConfirmations must be a non-negative integer');
    if (constraints.maxGasUsed != null) uintString(constraints.maxGasUsed, 'maxGasUsed');
  }
  const intent = { schema: INTENT_SCHEMA, intentId: protocolId(input.intentId, 'intentId'), chainId: chainId(input.chainId), ...(input.chainIds ? { chainIds: input.chainIds.map(chainId) } : {}), action: protocolId(input.action, 'action'), asset: String(input.asset), amount: uintString(input.amount, 'amount'), sender: evmAddress(input.sender, 'sender'), recipient: evmAddress(input.recipient, 'recipient'), validUntil: unixSeconds(input.validUntil, 'validUntil'), nonce: uintString(input.nonce ?? '0', 'nonce'), ...(constraints ? { constraints: { ...constraints, ...(constraints.maxGasUsed != null ? { maxGasUsed: String(constraints.maxGasUsed) } : {}) } } : {}) };
  if (!/^eip155:[1-9][0-9]*\/(native|erc20:0x[0-9a-fA-F]{40})$/.test(intent.asset)) throw new RunProofError('INVALID_ASSET', 'asset must be eip155:<chain>/native or eip155:<chain>/erc20:<address>');
  return { ...intent, intentHash: hashJson(intent) };
}
