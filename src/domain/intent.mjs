import { hashJson } from './hashing.mjs';
import { PriorSealError } from './errors.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';
import { chainId, evmAddress, protocolId, uintString, unixSeconds } from './values.mjs';

export const INTENT_SCHEMA = 'priorseal.intent.v1';
const required = ['intentId', 'chainId', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil'];
export function buildIntent(input) {
  assertSafeJson(input);
  assertOnlyFields(input, ['intentId', 'chainId', 'chainIds', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil', 'nonce', 'callTarget', 'calldataHash', 'transactionValue', 'constraints'], 'intent');
  if (!input || required.some((key) => input[key] === undefined || input[key] === null)) throw new PriorSealError('INVALID_INTENT', `Missing intent field: ${required.find((key) => input?.[key] == null)}`);
  const constraints = input.constraints ?? undefined;
  if (constraints !== undefined) {
    assertOnlyFields(constraints, ['minConfirmations', 'maxGasUsed'], 'intent.constraints');
    if (constraints.minConfirmations != null && (!Number.isSafeInteger(Number(constraints.minConfirmations)) || Number(constraints.minConfirmations) < 0 || Number(constraints.minConfirmations) > 10_000)) throw new PriorSealError('INVALID_CONSTRAINT', 'minConfirmations must be an integer between 0 and 10000');
    if (constraints.maxGasUsed != null) uintString(constraints.maxGasUsed, 'maxGasUsed');
  }
  if (input.calldataHash != null && !/^0x[0-9a-fA-F]{64}$/.test(input.calldataHash)) throw new PriorSealError('INVALID_INTENT', 'calldataHash must be a 32-byte hex value');
  const intent = { schema: INTENT_SCHEMA, intentId: protocolId(input.intentId, 'intentId'), chainId: chainId(input.chainId), ...(input.chainIds ? { chainIds: input.chainIds.map(chainId) } : {}), action: protocolId(input.action, 'action'), asset: String(input.asset), amount: uintString(input.amount, 'amount'), sender: evmAddress(input.sender, 'sender'), recipient: evmAddress(input.recipient, 'recipient'), validUntil: unixSeconds(input.validUntil, 'validUntil'), nonce: uintString(input.nonce ?? '0', 'nonce'), ...(input.callTarget != null ? { callTarget: evmAddress(input.callTarget, 'callTarget') } : {}), ...(input.calldataHash != null ? { calldataHash: input.calldataHash.toLowerCase() } : {}), ...(input.transactionValue != null ? { transactionValue: uintString(input.transactionValue, 'transactionValue') } : {}), ...(constraints ? { constraints: { ...constraints, ...(constraints.maxGasUsed != null ? { maxGasUsed: String(constraints.maxGasUsed) } : {}) } } : {}) };
  const assetMatch = /^eip155:([1-9][0-9]*)\/(native|erc20:0x[0-9a-fA-F]{40})$/.exec(intent.asset);
  if (!assetMatch) throw new PriorSealError('INVALID_ASSET', 'asset must be eip155:<chain>/native or eip155:<chain>/erc20:<address>');
  if (Number(assetMatch[1]) !== intent.chainId) throw new PriorSealError('INVALID_ASSET', 'asset chain must match intent.chainId');
  return { ...intent, intentHash: hashJson(intent) };
}
