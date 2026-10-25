// Generated from observe-execution.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../domain/errors.mjs";
import { buildIntent } from "../../domain/intent.mjs";
import { buildReceipt, signReceipt } from "../../domain/receipt.mjs";
import { buildAuthorizedReceipt, verifyAuthorizedReceipt } from "../../domain/authorization.mjs";
import { verifyReceipt } from "../../domain/receipt-verifier.mjs";
import { detectReorg } from "../../domain/execution.mjs";
import { validateTemporalEvidence } from "../../domain/temporal-evidence.mjs";
import { verifyWitnessEvidence } from "../../domain/witness.mjs";
import { canonicalize, hashJson } from "../../domain/hashing.mjs";
import { verifyTimestampEvidence } from "../../domain/rfc3161.mjs";
import { txHash as normalizeTxHash } from "../../domain/values.mjs";
import { decodeBase58, SOLANA_MAINNET_CAIP2, SOLANA_TRANSACTION_PROFILE } from "../../domain/solana.mjs";
import { HYPERLIQUID_MAINNET_CHAIN_REF, HYPERLIQUID_SPOT_IOC_PROFILE, isHyperliquidCloid } from "../../domain/hyperliquid.mjs";
import { assertOnlyFields } from "../../shared/safe-json.mjs";
import { findIdempotentReplay, reserveIdempotentResponse } from "../idempotency.mjs";
async function observeExecution({ input: inputValue, store, observer, signal, privateKeyPem, publicKeyPem, issuer, keyId, idempotencyKey, transparencyProvider, authorizationAudience = "priorseal", verifyContractSignature, now = () => Date.now() }) {
  if (privateKeyPem && !publicKeyPem) throw new TypeError("Issuer public key is required for receipt verification");
  const input = assertOnlyFields(inputValue, ["intentId", "authorizationId", "intent", "chainId", "txHash", "confirmations"], "observation request");
  if (input.authorizationId != null && typeof input.authorizationId !== "string") throw new PriorSealError("INVALID_REQUEST", "authorizationId must be a string");
  if (input.intentId != null && typeof input.intentId !== "string") throw new PriorSealError("INVALID_REQUEST", "intentId must be a string");
  const idempotency = await findIdempotentReplay({ scope: "observe-execution", key: idempotencyKey, request: input, store, now });
  if (idempotency.replay) return idempotency.replay;
  const authorizationRecord = input.authorizationId ? await store.getAuthorization?.(input.authorizationId) : null;
  if (input.authorizationId && !authorizationRecord) throw new PriorSealError("AUTHORIZATION_NOT_FOUND", "Authorization not found");
  const intent = authorizationRecord?.authorization.intent ?? (input.intent ? buildIntent(input.intent) : input.intentId ? await store.getIntent(input.intentId) : null);
  if (!intent) throw new PriorSealError("INTENT_NOT_FOUND", "Intent not found");
  const solana = intent.executionProfile === SOLANA_TRANSACTION_PROFILE;
  const hyperliquid = intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE;
  const requestedTxHash = solana ? normalizeSolanaSignature(input.txHash) : hyperliquid ? normalizeHyperliquidCloid(input.txHash) : normalizeTxHash(input.txHash);
  if (input.intentId && input.intentId !== intent.intentId) throw new PriorSealError("INVALID_REQUEST", "intentId must match the authorization");
  if (input.chainId !== void 0 && String(input.chainId) !== String(intent.chainId)) {
    throw new PriorSealError("INVALID_REQUEST", "chainId must match the intent");
  }
  const requestedConfirmations = input.confirmations ?? 0;
  if (typeof requestedConfirmations !== "number" || !Number.isSafeInteger(requestedConfirmations) || requestedConfirmations < 0 || requestedConfirmations > 1e4) throw new PriorSealError("INVALID_REQUEST", "confirmations must be an integer between 0 and 10000");
  const constraints = intent.constraints;
  const maxToleratedReorgDepth = constraints?.maxToleratedReorgDepth ?? null;
  const finalityRequirement = constraints?.finalityRequirement ?? "CONFIRMATIONS";
  const confirmations = solana || hyperliquid ? Math.max(requestedConfirmations, Number(constraints?.minConfirmations ?? 0)) : Math.max(requestedConfirmations, Number(constraints?.minConfirmations ?? 0), maxToleratedReorgDepth == null ? 0 : maxToleratedReorgDepth + 1);
  const erc4337 = intent.executionProfile === "priorseal.execution-profile.erc4337-user-operation.v1" ? { entryPoint: String(intent.entryPoint), entryPointCodeHash: String(intent.entryPointCodeHash), entryPointVersion: intent.entryPointVersion, userOperationHash: String(intent.userOperationHash), ...intent.accountCallProfile ? { accountCallProfile: intent.accountCallProfile, accountCallTarget: String(intent.accountCallTarget), accountCallValue: String(intent.accountCallValue), accountCallDataHash: String(intent.accountCallDataHash) } : {}, ...intent.eip7702 ? { eip7702: intent.eip7702 } : {} } : void 0;
  const previous = store.getObservation ? await store.getObservation(intent.chainId, requestedTxHash) : null;
  const observed = await observer({
    chainId: intent.chainId,
    txHash: requestedTxHash,
    confirmations,
    finalityRequirement,
    maxToleratedReorgDepth,
    ...solana ? { solanaTransaction: intent.solanaTransaction } : {},
    ...hyperliquid ? { hyperliquidOrder: intent.hyperliquidOrder, hyperliquidNonce: intent.nonce, hyperliquidUser: intent.sender } : {},
    ...erc4337 ? { erc4337 } : {},
    signal
  });
  const observedTxHash = solana ? normalizeSolanaSignature(observed?.txHash) : hyperliquid ? normalizeHyperliquidCloid(observed?.txHash) : normalizeTxHash(observed?.txHash);
  if (observedTxHash !== requestedTxHash) throw new PriorSealError("OBSERVATION_TX_HASH_MISMATCH", "Observer transaction hash does not match the requested transaction");
  if (String(observed?.chainId) !== String(intent.chainId) || solana && observed?.chainRef !== SOLANA_MAINNET_CAIP2 || hyperliquid && observed?.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF) throw new PriorSealError("OBSERVATION_CHAIN_MISMATCH", "Observer chain does not match the authorized intent");
  if (typeof observed.status !== "string") throw new PriorSealError("RPC_INVALID_RESPONSE", "Observer status is missing");
  let observation = { ...observed, txHash: observedTxHash, intentHash: intent.intentHash };
  const observedConfirmations = Number(observation.confirmations ?? 0);
  const claimsFinalExecution = ["CONFIRMED", "REVERTED"].includes(observation.status);
  const finalityStateMatches = finalityRequirement === "RPC_FINALIZED" ? observation.finalityState === "FINALIZED" : ["CONFIRMED", "FINALIZED"].includes(observation.finalityState ?? "");
  const hasRequiredFinality = finalityStateMatches && Number.isSafeInteger(observedConfirmations) && observedConfirmations >= confirmations;
  if (claimsFinalExecution && !hasRequiredFinality) observation = { ...observation, status: "PENDING", finalityState: "INSUFFICIENT_FINALITY" };
  if (detectReorg(previous, observation)) observation = { ...observation, status: "REORGED", finalityState: "REORGED", previousBlockHash: previous?.blockHash };
  if (!validateTemporalEvidence(intent, observation)) throw new PriorSealError("INVALID_TEMPORAL_EVIDENCE", "Observer temporal evidence is inconsistent with the signed intent");
  const executionTime = observation.executedAt ?? observation.observedAt ?? void 0;
  const transparency = authorizationRecord && transparencyProvider ? await transparencyProvider(authorizationRecord.acceptance, { before: executionTime }) : null;
  const timestampPolicy = authorizationRecord?.policyEvidence?.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = await verifyTimestampEvidence(authorizationRecord.timestampEvidence, new TextEncoder().encode(canonicalize(authorizationRecord.authorization)), timestampPolicy, { authorizationHash: hashJson(authorizationRecord.authorization), requestedAt: authorizationRecord.acceptance.acceptedAt, before: executionTime });
    if (!timestamped.valid) throw new PriorSealError(timestamped.code, "Valid pre-execution RFC 3161 evidence is required", timestamped);
  }
  const witnessPolicy = authorizationRecord?.policyEvidence?.document?.witnessQuorum;
  if (witnessPolicy) {
    const witnessed = verifyWitnessEvidence(authorizationRecord.witnessEvidence, authorizationRecord.authorization, witnessPolicy, { expectedRequestedAt: authorizationRecord.acceptance.acceptedAt, before: executionTime });
    if (!witnessed.valid) throw new PriorSealError(witnessed.code, "A valid pre-execution witness quorum is required", witnessed);
  }
  const authorizationAssociation = authorizationRecord ? classifyAuthorizationAssociation(authorizationRecord.authorization, observation) : null;
  const executionCorrelation = authorizationRecord ? classifyExecutionCorrelation(authorizationRecord.authorization, observation) : null;
  const claimAuthorization = authorizationAssociation === "FINAL";
  const receiptIssuedAt = Math.max(Math.floor(now() / 1e3), observation.observedAt ?? observation.executedAt ?? 0);
  let receipt = null;
  if (privateKeyPem) {
    if (!issuer || !keyId) throw new TypeError("Issuer and keyId are required for signed receipts");
    receipt = signReceipt(authorizationRecord ? buildAuthorizedReceipt({ authorization: authorizationRecord.authorization, acceptance: authorizationRecord.acceptance, policyEvidence: authorizationRecord.policyEvidence, timestampEvidence: authorizationRecord.timestampEvidence, witnessEvidence: authorizationRecord.witnessEvidence, transparency, execution: observation, issuer, keyId, issuedAt: receiptIssuedAt }) : buildReceipt({ intent, execution: observation, issuer, keyId, issuedAt: receiptIssuedAt }), privateKeyPem);
  }
  let verification = null;
  if (receipt) {
    if (!publicKeyPem) throw new TypeError("Issuer public key is required for receipt verification");
    verification = authorizationRecord ? await verifyAuthorizedReceipt(receipt, publicKeyPem, { audience: authorizationAudience, verifyContractSignature }) : verifyReceipt(receipt, publicKeyPem, { keyId });
  }
  if (verification && !verification.valid) throw new PriorSealError(verification.code, "The generated receipt failed self-verification and was not persisted");
  const response = {
    observation,
    receipt,
    ...authorizationAssociation ? { authorizationAssociation } : {},
    ...executionCorrelation ? { executionCorrelation } : {},
    ...verification ? { verification } : {}
  };
  if (store.saveObservationReceipt) {
    const committed = await store.saveObservationReceipt({ authorizationId: authorizationRecord?.authorization.authorizationId, claimAuthorization, observation, receipt });
    if (!committed.ok) throw new PriorSealError(committed.code ?? "AUTHORIZATION_ALREADY_USED", "Authorization has already been bound to another transaction");
  } else {
    if (claimAuthorization && authorizationRecord) {
      const binding = await store.bindAuthorization(authorizationRecord.authorization.authorizationId, observation.txHash);
      if (!binding.ok) throw new PriorSealError(binding.code ?? "AUTHORIZATION_ALREADY_USED", "Authorization has already been bound to another transaction");
    }
    await store.saveObservation(observation);
    if (receipt) await store.saveReceipt(receipt);
  }
  return reserveIdempotentResponse({ scope: "observe-execution", key: idempotencyKey, request: input, requestHash: idempotency.requestHash, response, store, now });
}
function canClaimAuthorization(authorization, observation) {
  return classifyAuthorizationAssociation(authorization, observation) === "FINAL";
}
function classifyAuthorizationAssociation(authorization, observation) {
  if (!authorization || !observation || observation.executionDataAvailable === false) return "UNRELATED";
  if (!validateTemporalEvidence(authorization.intent, observation)) return "UNRELATED";
  const solana = authorization.intent.executionProfile === SOLANA_TRANSACTION_PROFILE;
  const hyperliquid = authorization.intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE;
  const correlated = validTransactionSignature(observation.txHash, solana, hyperliquid) && observation.intentHash === authorization.intentHash && String(observation.chainId) === String(authorization.intent.chainId) && (!solana || observation.chainRef === SOLANA_MAINNET_CAIP2) && (!hyperliquid || observation.chainRef === HYPERLIQUID_MAINNET_CHAIN_REF) && sameAddress(observation.sender, authorization.delegate.executor, solana) && String(observation.nonce ?? "") === String(authorization.intent.nonce) && (authorization.intent.executionProfile !== "priorseal.execution-profile.erc4337-user-operation.v1" || same(observation.userOperationHash, authorization.intent.userOperationHash) && same(observation.entryPoint, authorization.intent.entryPoint) && same(observation.entryPointVersion, authorization.intent.entryPointVersion) && same(observation.entryPointCodeHash, authorization.intent.entryPointCodeHash) && (authorization.intent.accountCallProfile == null || same(observation.accountCallProfile, authorization.intent.accountCallProfile) && same(observation.accountCallTarget, authorization.intent.accountCallTarget) && same(observation.accountCallValue, authorization.intent.accountCallValue) && same(observation.accountCallDataHash, authorization.intent.accountCallDataHash)) && matchesEip7702(authorization.intent.eip7702, observation.eip7702Delegation));
  if (!correlated) return "UNRELATED";
  if (["CONFIRMED", "REVERTED"].includes(observation.status ?? "") && ["CONFIRMED", "FINALIZED"].includes(observation.finalityState ?? "")) return "FINAL";
  if (["CONFIRMED", "REVERTED"].includes(observation.status ?? "")) return "CANDIDATE";
  if (observation.status === "PENDING") return "CANDIDATE";
  return "UNRELATED";
}
function classifyExecutionCorrelation(authorization, observation) {
  if (!authorization || !observation || observation.executionDataAvailable === false) return "INDETERMINATE";
  const intent = authorization.intent;
  const exactCall = intent.executionProfile === "priorseal.execution-profile.exact-call.v1";
  const erc4337 = intent.executionProfile === "priorseal.execution-profile.erc4337-user-operation.v1";
  const solana = intent.executionProfile === SOLANA_TRANSACTION_PROFILE;
  const hyperliquid = intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE;
  const matches = validTransactionSignature(observation.txHash, solana, hyperliquid) && observation.intentHash === authorization.intentHash && String(observation.chainId) === String(intent.chainId) && (!solana || observation.chainRef === SOLANA_MAINNET_CAIP2) && (!hyperliquid || observation.chainRef === HYPERLIQUID_MAINNET_CHAIN_REF) && sameAddress(observation.sender, authorization.delegate.executor, solana) && same(observation.action, intent.action) && String(observation.nonce ?? "") === String(intent.nonce) && (solana ? Boolean(observation.solanaTransaction && intent.solanaTransaction && canonicalize(observation.solanaTransaction) === canonicalize(intent.solanaTransaction)) : hyperliquid ? Boolean(observation.hyperliquidOrder && intent.hyperliquidOrder && canonicalize({ assetId: observation.hyperliquidOrder.assetId, isBuy: observation.hyperliquidOrder.isBuy, limitPrice: observation.hyperliquidOrder.limitPrice, size: observation.hyperliquidOrder.size, timeInForce: observation.hyperliquidOrder.timeInForce, clientOrderId: observation.hyperliquidOrder.clientOrderId, expiresAfter: observation.hyperliquidOrder.expiresAfter }) === canonicalize(intent.hyperliquidOrder)) : exactCall ? same(observation.target, intent.callTarget) && same(observation.calldataHash, intent.calldataHash) && String(observation.nativeValue ?? "") === String(intent.transactionValue) : same(observation.recipient, intent.recipient) && same(observation.asset, intent.asset) && String(observation.amount ?? "") === String(intent.amount)) && (!erc4337 || same(observation.userOperationHash, intent.userOperationHash) && same(observation.entryPoint, intent.entryPoint) && same(observation.entryPointVersion, intent.entryPointVersion) && same(observation.entryPointCodeHash, intent.entryPointCodeHash) && (intent.accountCallProfile == null || same(observation.accountCallProfile, intent.accountCallProfile) && same(observation.accountCallTarget, intent.accountCallTarget) && same(observation.accountCallValue, intent.accountCallValue) && same(observation.accountCallDataHash, intent.accountCallDataHash)) && matchesEip7702(intent.eip7702, observation.eip7702Delegation));
  return matches ? "MATCH" : "MISMATCH";
}
function same(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}
function sameAddress(left, right, caseSensitive) {
  return caseSensitive ? String(left ?? "") === String(right ?? "") : same(left, right);
}
function validTransactionSignature(value, solana, hyperliquid = false) {
  if (hyperliquid) return isHyperliquidCloid(value);
  if (!solana) return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
  try {
    return typeof value === "string" && decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}
function normalizeSolanaSignature(value) {
  if (typeof value !== "string" || !validTransactionSignature(value, true)) throw new PriorSealError("INVALID_TX_HASH", "Solana transaction signature must be a 64-byte base58 value");
  return value;
}
function normalizeHyperliquidCloid(value) {
  if (!isHyperliquidCloid(value)) throw new PriorSealError("INVALID_HYPERLIQUID_CLOID", "Hyperliquid observations use the authorized 16-byte client order id as txHash");
  return value.toLowerCase();
}
function matchesEip7702(expected, evidence) {
  if (expected == null) return true;
  if (!evidence || !same(evidence.delegateAddress, expected.delegateAddress) || !same(evidence.delegateCodeHash, expected.delegateCodeHash) || !same(evidence.authorizationTupleHash, expected.authorizationTupleHash) || evidence.authorizationIncluded !== (expected.authorizationTupleHash != null) || evidence.operationIncluded !== true) return false;
  if (evidence.outerTransactionStatus === "REVERTED" && evidence.operationSuccess === null) {
    return evidence.stateAtTransactionEnd === "ACTIVE" && same(evidence.delegateAfter, expected.delegateAddress);
  }
  return evidence.outerTransactionStatus === "SUCCESS";
}
export {
  canClaimAuthorization,
  classifyAuthorizationAssociation,
  classifyExecutionCorrelation,
  observeExecution
};
