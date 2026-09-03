export const BINDING_CODES = Object.freeze({
  CHAIN_MISMATCH: 'CHAIN_MISMATCH', SENDER_MISMATCH: 'SENDER_MISMATCH', RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  ASSET_MISMATCH: 'ASSET_MISMATCH', AMOUNT_MISMATCH: 'AMOUNT_MISMATCH', ACTION_MISMATCH: 'ACTION_MISMATCH',
  NONCE_MISMATCH: 'NONCE_MISMATCH', OUTSIDE_TIME_WINDOW: 'OUTSIDE_TIME_WINDOW', INSUFFICIENT_FINALITY: 'INSUFFICIENT_FINALITY',
  GAS_LIMIT_EXCEEDED: 'GAS_LIMIT_EXCEEDED', AMBIGUOUS_TRANSFER: 'AMBIGUOUS_TRANSFER', EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
});

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
export function bindIntentExecution(intent, execution, now = execution.observedAt ?? Math.floor(Date.now() / 1000)) {
  const reasons = [];
  if (execution?.executionDataAvailable === false) reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
  if (execution.chainId !== intent.chainId) reasons.push(BINDING_CODES.CHAIN_MISMATCH);
  if (!same(execution.sender, intent.sender)) reasons.push(BINDING_CODES.SENDER_MISMATCH);
  if (!same(execution.recipient, intent.recipient)) reasons.push(BINDING_CODES.RECIPIENT_MISMATCH);
  if (!same(execution.asset, intent.asset)) reasons.push(BINDING_CODES.ASSET_MISMATCH);
  if (String(execution.amount ?? '') !== String(intent.amount)) reasons.push(BINDING_CODES.AMOUNT_MISMATCH);
  if (execution.nonce != null && String(execution.nonce) !== String(intent.nonce)) reasons.push(BINDING_CODES.NONCE_MISMATCH);
  if (execution.observedAt > intent.validUntil || now < 0) reasons.push(BINDING_CODES.OUTSIDE_TIME_WINDOW);
  const constraints = intent.constraints ?? {};
  if (constraints.minConfirmations != null && Number(execution.confirmations ?? 0) < Number(constraints.minConfirmations)) reasons.push(BINDING_CODES.INSUFFICIENT_FINALITY);
  if (constraints.maxGasUsed != null && BigInt(execution.gasUsed ?? 0) > BigInt(constraints.maxGasUsed)) reasons.push(BINDING_CODES.GAS_LIMIT_EXCEEDED);
  if (Array.isArray(execution.transfers) && execution.transfers.length > 1 && !execution.transferMatchUnique) reasons.push(BINDING_CODES.AMBIGUOUS_TRANSFER);
  return { bound: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}
