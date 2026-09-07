export const BINDING_CODES = Object.freeze({
  CHAIN_MISMATCH: 'CHAIN_MISMATCH', SENDER_MISMATCH: 'SENDER_MISMATCH', RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  ASSET_MISMATCH: 'ASSET_MISMATCH', AMOUNT_MISMATCH: 'AMOUNT_MISMATCH', ACTION_MISMATCH: 'ACTION_MISMATCH',
  NONCE_MISMATCH: 'NONCE_MISMATCH', OUTSIDE_TIME_WINDOW: 'OUTSIDE_TIME_WINDOW', INSUFFICIENT_FINALITY: 'INSUFFICIENT_FINALITY',
  GAS_LIMIT_EXCEEDED: 'GAS_LIMIT_EXCEEDED', AMBIGUOUS_TRANSFER: 'AMBIGUOUS_TRANSFER', EXECUTION_UNAVAILABLE: 'EXECUTION_UNAVAILABLE',
  EXECUTOR_MISMATCH: 'EXECUTOR_MISMATCH',
  CALL_TARGET_MISMATCH: 'CALL_TARGET_MISMATCH', CALLDATA_MISMATCH: 'CALLDATA_MISMATCH', TRANSACTION_VALUE_MISMATCH: 'TRANSACTION_VALUE_MISMATCH',
  AUTHORIZATION_AFTER_EXECUTION: 'AUTHORIZATION_AFTER_EXECUTION',
  OUTSIDE_AUTHORIZATION_WINDOW: 'OUTSIDE_AUTHORIZATION_WINDOW',
});

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
export function bindIntentExecution(intent, execution, now = execution.observedAt ?? Math.floor(Date.now() / 1000)) {
  const reasons = [];
  const exactCall = intent.executionProfile === 'priorseal.execution-profile.exact-call.v1';
  if (execution?.executionDataAvailable === false) reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
  if (execution.chainId !== intent.chainId) reasons.push(BINDING_CODES.CHAIN_MISMATCH);
  if (!same(execution.action, intent.action)) reasons.push(BINDING_CODES.ACTION_MISMATCH);
  if (!same(execution.sender, intent.sender)) reasons.push(BINDING_CODES.SENDER_MISMATCH);
  if (!exactCall && !same(execution.recipient, intent.recipient)) reasons.push(BINDING_CODES.RECIPIENT_MISMATCH);
  if (!exactCall && !same(execution.asset, intent.asset)) reasons.push(BINDING_CODES.ASSET_MISMATCH);
  if (!exactCall && String(execution.amount ?? '') !== String(intent.amount)) reasons.push(BINDING_CODES.AMOUNT_MISMATCH);
  if (execution.nonce != null && String(execution.nonce) !== String(intent.nonce)) reasons.push(BINDING_CODES.NONCE_MISMATCH);
  if (intent.callTarget != null && !same(execution.target, intent.callTarget)) reasons.push(BINDING_CODES.CALL_TARGET_MISMATCH);
  if (intent.calldataHash != null && !same(execution.calldataHash, intent.calldataHash)) reasons.push(BINDING_CODES.CALLDATA_MISMATCH);
  if (intent.transactionValue != null && String(execution.nativeValue ?? '') !== String(intent.transactionValue)) reasons.push(BINDING_CODES.TRANSACTION_VALUE_MISMATCH);
  // New observations carry the block timestamp. The fallback preserves
  // compatibility with already-issued v1 receipts that only had observedAt.
  const executedAt = execution.executedAt ?? execution.observedAt;
  if (executedAt != null && executedAt > intent.validUntil) reasons.push(BINDING_CODES.OUTSIDE_TIME_WINDOW);
  const constraints = intent.constraints ?? {};
  if (constraints.minConfirmations != null && Number(execution.confirmations ?? 0) < Number(constraints.minConfirmations)) reasons.push(BINDING_CODES.INSUFFICIENT_FINALITY);
  if (constraints.maxGasUsed != null && BigInt(execution.gasUsed ?? 0) > BigInt(constraints.maxGasUsed)) reasons.push(BINDING_CODES.GAS_LIMIT_EXCEEDED);
  if (!exactCall && Array.isArray(execution.transfers) && execution.transfers.length > 1 && !execution.transferMatchUnique) reasons.push(BINDING_CODES.AMBIGUOUS_TRANSFER);
  return { bound: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}
