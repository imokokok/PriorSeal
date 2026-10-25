// Generated from binding.mts by npm run core:build. Do not edit directly.
import { canonicalize } from "./hashing.mjs";
import { HYPERLIQUID_MAINNET_CHAIN_REF, HYPERLIQUID_SPOT_IOC_PROFILE, normalizeHyperliquidInfoObservationEvidence, normalizeHyperliquidSpotIocExecution, sameHyperliquidSpotIocOrder } from "./hyperliquid.mjs";
const BINDING_CODES = Object.freeze({
  CHAIN_MISMATCH: "CHAIN_MISMATCH",
  SENDER_MISMATCH: "SENDER_MISMATCH",
  RECIPIENT_MISMATCH: "RECIPIENT_MISMATCH",
  ASSET_MISMATCH: "ASSET_MISMATCH",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  ACTION_MISMATCH: "ACTION_MISMATCH",
  NONCE_MISMATCH: "NONCE_MISMATCH",
  OUTSIDE_TIME_WINDOW: "OUTSIDE_TIME_WINDOW",
  INSUFFICIENT_FINALITY: "INSUFFICIENT_FINALITY",
  GAS_LIMIT_EXCEEDED: "GAS_LIMIT_EXCEEDED",
  AMBIGUOUS_TRANSFER: "AMBIGUOUS_TRANSFER",
  EXECUTION_UNAVAILABLE: "EXECUTION_UNAVAILABLE",
  EXECUTOR_MISMATCH: "EXECUTOR_MISMATCH",
  USER_OPERATION_HASH_MISMATCH: "USER_OPERATION_HASH_MISMATCH",
  ENTRY_POINT_MISMATCH: "ENTRY_POINT_MISMATCH",
  ENTRY_POINT_VERSION_MISMATCH: "ENTRY_POINT_VERSION_MISMATCH",
  ENTRY_POINT_CODE_HASH_MISMATCH: "ENTRY_POINT_CODE_HASH_MISMATCH",
  EIP7702_DELEGATION_MISMATCH: "EIP7702_DELEGATION_MISMATCH",
  CALL_TARGET_MISMATCH: "CALL_TARGET_MISMATCH",
  CALLDATA_MISMATCH: "CALLDATA_MISMATCH",
  TRANSACTION_VALUE_MISMATCH: "TRANSACTION_VALUE_MISMATCH",
  AUTHORIZATION_AFTER_EXECUTION: "AUTHORIZATION_AFTER_EXECUTION",
  OUTSIDE_AUTHORIZATION_WINDOW: "OUTSIDE_AUTHORIZATION_WINDOW",
  CHAINREF_MISMATCH: "CHAINREF_MISMATCH",
  SOLANA_MESSAGE_MISMATCH: "SOLANA_MESSAGE_MISMATCH",
  HYPERLIQUID_ORDER_MISMATCH: "HYPERLIQUID_ORDER_MISMATCH"
});
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
function bindIntentExecution(intent, execution, now = execution.observedAt ?? Math.floor(Date.now() / 1e3)) {
  const reasons = [];
  const exactCall = intent.executionProfile === "priorseal.execution-profile.exact-call.v1";
  const erc4337 = intent.executionProfile === "priorseal.execution-profile.erc4337-user-operation.v1";
  const solanaTransaction = intent.executionProfile === "priorseal.execution-profile.solana-transaction.v2";
  const hyperliquidSpotIoc = intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE;
  const exactProfile = exactCall || solanaTransaction || hyperliquidSpotIoc;
  if (execution?.executionDataAvailable === false) reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
  if (execution.chainId !== intent.chainId) reasons.push(BINDING_CODES.CHAIN_MISMATCH);
  if ((execution.chainRef ?? null) !== (intent.chainRef ?? null)) reasons.push(BINDING_CODES.CHAINREF_MISMATCH);
  if (!same(execution.action, intent.action)) reasons.push(BINDING_CODES.ACTION_MISMATCH);
  if (!sameAddress(execution.sender, intent.sender, solanaTransaction)) reasons.push(BINDING_CODES.SENDER_MISMATCH);
  if (!exactProfile && !sameAddress(execution.recipient, intent.recipient, solanaTransaction)) reasons.push(BINDING_CODES.RECIPIENT_MISMATCH);
  if (!exactProfile && !same(execution.asset, intent.asset)) reasons.push(BINDING_CODES.ASSET_MISMATCH);
  if (!exactProfile && String(execution.amount ?? "") !== String(intent.amount)) reasons.push(BINDING_CODES.AMOUNT_MISMATCH);
  if (String(execution.nonce ?? "") !== String(intent.nonce ?? "0")) reasons.push(BINDING_CODES.NONCE_MISMATCH);
  if (intent.callTarget != null && !same(execution.target, intent.callTarget)) reasons.push(BINDING_CODES.CALL_TARGET_MISMATCH);
  if (intent.calldataHash != null && !same(execution.calldataHash, intent.calldataHash)) reasons.push(BINDING_CODES.CALLDATA_MISMATCH);
  if (intent.transactionValue != null && String(execution.nativeValue ?? "") !== String(intent.transactionValue)) reasons.push(BINDING_CODES.TRANSACTION_VALUE_MISMATCH);
  if (solanaTransaction && (!intent.solanaTransaction || !execution.solanaTransaction || canonicalize(intent.solanaTransaction) !== canonicalize(execution.solanaTransaction))) reasons.push(BINDING_CODES.SOLANA_MESSAGE_MISMATCH);
  let hyperliquidOrderMatches = false;
  if (hyperliquidSpotIoc) {
    try {
      hyperliquidOrderMatches = sameHyperliquidSpotIocOrder(intent.hyperliquidOrder, normalizeHyperliquidSpotIocExecution(execution.hyperliquidOrder));
    } catch {
      hyperliquidOrderMatches = false;
    }
    if (intent.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF || !hyperliquidOrderMatches) reasons.push(BINDING_CODES.HYPERLIQUID_ORDER_MISMATCH);
    try {
      const evidence = normalizeHyperliquidInfoObservationEvidence(execution.hyperliquidInfoObservation);
      if (!evidence.fillsComplete) reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
    } catch {
      reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
    }
  }
  if (erc4337 && !same(execution.userOperationHash, intent.userOperationHash)) reasons.push(BINDING_CODES.USER_OPERATION_HASH_MISMATCH);
  if (erc4337 && !same(execution.entryPoint, intent.entryPoint)) reasons.push(BINDING_CODES.ENTRY_POINT_MISMATCH);
  if (erc4337 && !same(execution.entryPointVersion, intent.entryPointVersion)) reasons.push(BINDING_CODES.ENTRY_POINT_VERSION_MISMATCH);
  if (erc4337 && !same(execution.entryPointCodeHash, intent.entryPointCodeHash)) reasons.push(BINDING_CODES.ENTRY_POINT_CODE_HASH_MISMATCH);
  if (intent.accountCallProfile != null && (!same(execution.accountCallProfile, intent.accountCallProfile) || !same(execution.accountCallTarget, intent.accountCallTarget) || String(execution.accountCallValue ?? "") !== String(intent.accountCallValue ?? "") || !same(execution.accountCallDataHash, intent.accountCallDataHash))) reasons.push(BINDING_CODES.CALLDATA_MISMATCH);
  if (erc4337 && intent.eip7702 != null && !matchesEip7702(intent.eip7702, execution.eip7702Delegation)) reasons.push(BINDING_CODES.EIP7702_DELEGATION_MISMATCH);
  const executedAt = execution.executedAt ?? execution.observedAt;
  if (executedAt != null && executedAt > intent.validUntil) reasons.push(BINDING_CODES.OUTSIDE_TIME_WINDOW);
  const constraints = intent.constraints ?? {};
  if (constraints.minConfirmations != null && Number(execution.confirmations ?? 0) < Number(constraints.minConfirmations)) reasons.push(BINDING_CODES.INSUFFICIENT_FINALITY);
  if (constraints.maxToleratedReorgDepth != null && Number(execution.confirmations ?? 0) <= constraints.maxToleratedReorgDepth) reasons.push(BINDING_CODES.INSUFFICIENT_FINALITY);
  if (constraints.finalityRequirement === "RPC_FINALIZED" && execution.finalityState !== "FINALIZED") reasons.push(BINDING_CODES.INSUFFICIENT_FINALITY);
  if (constraints.maxGasUsed != null) {
    if (execution.gasUsed == null) reasons.push(BINDING_CODES.EXECUTION_UNAVAILABLE);
    else if (BigInt(execution.gasUsed) > BigInt(constraints.maxGasUsed)) reasons.push(BINDING_CODES.GAS_LIMIT_EXCEEDED);
  }
  if (!exactCall && Array.isArray(execution.transfers) && execution.transfers.length > 1 && !execution.transferMatchUnique) reasons.push(BINDING_CODES.AMBIGUOUS_TRANSFER);
  return { bound: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}
function sameAddress(a, b, caseSensitive) {
  return caseSensitive ? String(a ?? "") === String(b ?? "") : same(a, b);
}
function matchesEip7702(expected, evidence) {
  if (!evidence || !same(evidence.delegateAddress, expected.delegateAddress) || !same(evidence.delegateCodeHash, expected.delegateCodeHash) || !same(evidence.authorizationTupleHash, expected.authorizationTupleHash) || evidence.authorizationIncluded !== (expected.authorizationTupleHash != null) || evidence.operationIncluded !== true) return false;
  if (evidence.outerTransactionStatus === "REVERTED" && evidence.operationSuccess === null) {
    return evidence.stateAtTransactionEnd === "ACTIVE" && same(evidence.delegateAfter, expected.delegateAddress);
  }
  return evidence.outerTransactionStatus === "SUCCESS";
}
export {
  BINDING_CODES,
  bindIntentExecution
};
