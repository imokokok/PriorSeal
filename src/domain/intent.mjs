// Generated from intent.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
import { PriorSealError } from "./errors.mjs";
import { assertOnlyFields, assertSafeJson } from "../shared/safe-json.mjs";
import { chainId, evmAddress, protocolId, uintString, unixSeconds } from "./values.mjs";
const INTENT_SCHEMA = "priorseal.intent.v1";
const EXACT_CALL_INTENT_SCHEMA = "priorseal.intent.v2";
const EXACT_CALL_PROFILE = "priorseal.execution-profile.exact-call.v1";
const ERC4337_USER_OPERATION_PROFILE = "priorseal.execution-profile.erc4337-user-operation.v1";
const required = ["intentId", "chainId", "action", "asset", "amount", "sender", "recipient", "validUntil"];
function assertIssuableIntentInput(input) {
  const candidate = input;
  if (candidate?.chainIds !== void 0) throw new PriorSealError("INVALID_INTENT", "chainIds is not supported for new intents; use chainId");
  if (candidate?.nonce == null) throw new PriorSealError("INVALID_INTENT", "nonce is required for new intents");
  if (candidate?.constraints?.minConfirmations != null && typeof candidate.constraints.minConfirmations !== "number") throw new PriorSealError("INVALID_CONSTRAINT", "minConfirmations must be a JSON number");
  if (candidate?.constraints?.maxToleratedReorgDepth != null && typeof candidate.constraints.maxToleratedReorgDepth !== "number") throw new PriorSealError("INVALID_CONSTRAINT", "maxToleratedReorgDepth must be a JSON number");
  return input;
}
function buildIntent(inputValue) {
  assertSafeJson(inputValue);
  const input = assertOnlyFields(inputValue, ["schema", "executionProfile", "intentId", "chainId", "chainIds", "action", "asset", "amount", "sender", "recipient", "validUntil", "nonce", "callTarget", "calldataHash", "transactionValue", "entryPoint", "entryPointCodeHash", "entryPointVersion", "userOperationHash", "accountCallProfile", "accountCallTarget", "accountCallValue", "accountCallDataHash", "contextCommitments", "constraints"], "intent");
  if (required.some((key) => input[key] === void 0 || input[key] === null)) throw new PriorSealError("INVALID_INTENT", `Missing intent field: ${required.find((key) => input[key] == null)}`);
  const schema = input.schema ?? (input.executionProfile ? EXACT_CALL_INTENT_SCHEMA : INTENT_SCHEMA);
  if (schema !== INTENT_SCHEMA && schema !== EXACT_CALL_INTENT_SCHEMA) throw new PriorSealError("INVALID_INTENT", "intent schema is not supported");
  const exactCall = schema === EXACT_CALL_INTENT_SCHEMA;
  const executionProfile = input.executionProfile;
  const erc4337 = executionProfile === ERC4337_USER_OPERATION_PROFILE;
  if (exactCall && ![EXACT_CALL_PROFILE, ERC4337_USER_OPERATION_PROFILE].includes(String(executionProfile))) throw new PriorSealError("INVALID_INTENT", "intent v2 requires a supported executionProfile");
  if (!exactCall && executionProfile != null) throw new PriorSealError("INVALID_INTENT", "executionProfile requires priorseal.intent.v2");
  if (executionProfile === EXACT_CALL_PROFILE && input.action !== "CONTRACT_CALL") throw new PriorSealError("INVALID_INTENT", "exact-call intents require action CONTRACT_CALL");
  if (erc4337 && input.action !== "ERC4337_USER_OPERATION") throw new PriorSealError("INVALID_INTENT", "ERC-4337 intents require action ERC4337_USER_OPERATION");
  if (exactCall && (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId < 1)) throw new PriorSealError("INVALID_CHAIN_ID", "exact-call intent chainId must be a positive JSON integer");
  if (erc4337 && (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId < 1)) throw new PriorSealError("INVALID_CHAIN_ID", "ERC-4337 intent chainId must be a positive JSON integer");
  if (executionProfile === EXACT_CALL_PROFILE && input.nonce == null) throw new PriorSealError("INVALID_INTENT", "exact-call intents require an explicit transaction nonce");
  if (executionProfile === EXACT_CALL_PROFILE && (input.callTarget == null || input.calldataHash == null || input.transactionValue == null)) throw new PriorSealError("INVALID_INTENT", "exact-call intents require callTarget, calldataHash, and transactionValue");
  if (erc4337 && (input.nonce == null || input.entryPoint == null || input.entryPointCodeHash == null || input.entryPointVersion == null || input.userOperationHash == null)) throw new PriorSealError("INVALID_INTENT", "ERC-4337 intents require nonce, entryPoint, entryPointCodeHash, entryPointVersion, and userOperationHash");
  if (erc4337 && !["0.6", "0.7", "0.8", "0.9"].includes(String(input.entryPointVersion))) throw new PriorSealError("INVALID_INTENT", "ERC-4337 entryPointVersion is not supported");
  if (erc4337 && (typeof input.userOperationHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.userOperationHash))) throw new PriorSealError("INVALID_INTENT", "ERC-4337 userOperationHash must be a 32-byte hash");
  if (erc4337 && (typeof input.entryPointCodeHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.entryPointCodeHash))) throw new PriorSealError("INVALID_INTENT", "ERC-4337 entryPointCodeHash must be a 32-byte hash");
  const safe4337Call = input.accountCallProfile === "safe-4337.v1";
  if (input.accountCallProfile != null && !safe4337Call) throw new PriorSealError("INVALID_INTENT", "accountCallProfile is not supported");
  if (!safe4337Call && ["accountCallTarget", "accountCallValue", "accountCallDataHash"].some((field) => input[field] != null)) throw new PriorSealError("INVALID_INTENT", "Safe account call fields require accountCallProfile safe-4337.v1");
  if (safe4337Call && (!erc4337 || input.accountCallTarget == null || input.accountCallValue == null || input.accountCallDataHash == null)) throw new PriorSealError("INVALID_INTENT", "Safe ERC-4337 profile requires accountCallTarget, accountCallValue and accountCallDataHash");
  if (safe4337Call && (typeof input.accountCallDataHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.accountCallDataHash))) throw new PriorSealError("INVALID_INTENT", "accountCallDataHash must be a 32-byte hash");
  const chainIds = input.chainIds;
  if (chainIds != null && !Array.isArray(chainIds)) throw new PriorSealError("INVALID_INTENT", "chainIds must be an array when provided");
  const contextCommitments = normalizeContextCommitments(input.contextCommitments, exactCall);
  const constraints = input.constraints == null ? void 0 : assertOnlyFields(input.constraints, ["minConfirmations", "maxGasUsed", "maxToleratedReorgDepth", "finalityRequirement"], "intent.constraints");
  if (constraints !== void 0) {
    if (constraints.minConfirmations != null && (!Number.isSafeInteger(Number(constraints.minConfirmations)) || Number(constraints.minConfirmations) < 0 || Number(constraints.minConfirmations) > 1e4)) throw new PriorSealError("INVALID_CONSTRAINT", "minConfirmations must be an integer between 0 and 10000");
    if (constraints.maxToleratedReorgDepth != null && (typeof constraints.maxToleratedReorgDepth !== "number" || !Number.isSafeInteger(constraints.maxToleratedReorgDepth) || constraints.maxToleratedReorgDepth < 0 || constraints.maxToleratedReorgDepth > 9999)) throw new PriorSealError("INVALID_CONSTRAINT", "maxToleratedReorgDepth must be an integer between 0 and 9999");
    if (constraints.finalityRequirement != null && !["CONFIRMATIONS", "RPC_FINALIZED"].includes(String(constraints.finalityRequirement))) throw new PriorSealError("INVALID_CONSTRAINT", "finalityRequirement must be CONFIRMATIONS or RPC_FINALIZED");
    if (constraints.maxGasUsed != null) uintString(constraints.maxGasUsed, "maxGasUsed");
  }
  const normalizedConstraints = constraints === void 0 ? void 0 : {
    ...constraints.minConfirmations != null ? { minConfirmations: constraints.minConfirmations } : {},
    ...constraints.maxGasUsed != null ? { maxGasUsed: String(constraints.maxGasUsed) } : {},
    ...constraints.maxToleratedReorgDepth != null ? { maxToleratedReorgDepth: constraints.maxToleratedReorgDepth } : {},
    ...constraints.finalityRequirement != null ? { finalityRequirement: constraints.finalityRequirement } : {}
  };
  if (input.calldataHash != null && !/^0x[0-9a-fA-F]{64}$/.test(input.calldataHash)) throw new PriorSealError("INVALID_INTENT", "calldataHash must be a 32-byte hex value");
  const intent = { schema, ...exactCall ? { executionProfile: String(executionProfile) } : {}, intentId: protocolId(input.intentId, "intentId"), chainId: chainId(input.chainId), ...chainIds ? { chainIds: chainIds.map(chainId) } : {}, action: protocolId(input.action, "action"), asset: String(input.asset), amount: uintString(input.amount, "amount"), sender: evmAddress(input.sender, "sender"), recipient: evmAddress(input.recipient, "recipient"), validUntil: unixSeconds(input.validUntil, "validUntil"), nonce: uintString(input.nonce ?? "0", "nonce"), ...input.callTarget != null ? { callTarget: evmAddress(input.callTarget, "callTarget") } : {}, ...input.calldataHash != null ? { calldataHash: input.calldataHash.toLowerCase() } : {}, ...input.transactionValue != null ? { transactionValue: uintString(input.transactionValue, "transactionValue") } : {}, ...erc4337 ? { entryPoint: evmAddress(String(input.entryPoint), "entryPoint"), entryPointCodeHash: String(input.entryPointCodeHash).toLowerCase(), entryPointVersion: String(input.entryPointVersion), userOperationHash: String(input.userOperationHash).toLowerCase(), ...safe4337Call ? { accountCallProfile: "safe-4337.v1", accountCallTarget: evmAddress(String(input.accountCallTarget), "accountCallTarget"), accountCallValue: uintString(input.accountCallValue, "accountCallValue"), accountCallDataHash: String(input.accountCallDataHash).toLowerCase() } : {} } : {}, ...contextCommitments ? { contextCommitments } : {}, ...normalizedConstraints ? { constraints: normalizedConstraints } : {} };
  const assetMatch = /^eip155:([1-9][0-9]*)\/(native|erc20:0x[0-9a-fA-F]{40})$/.exec(intent.asset);
  if (!assetMatch) throw new PriorSealError("INVALID_ASSET", "asset must be eip155:<chain>/native or eip155:<chain>/erc20:<address>");
  if (Number(assetMatch[1]) !== intent.chainId) throw new PriorSealError("INVALID_ASSET", "asset chain must match intent.chainId");
  return { ...intent, intentHash: hashJson(intent) };
}
function normalizeContextCommitments(value, exactCall) {
  if (value == null) return void 0;
  if (!exactCall) throw new PriorSealError("INVALID_INTENT", "contextCommitments require priorseal.intent.v2");
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new PriorSealError("INVALID_INTENT", "contextCommitments must contain between 1 and 16 entries");
  const normalized = value.map((entry, index) => {
    const item = assertOnlyFields(entry, ["namespace", "algorithm", "digest"], `intent.contextCommitments[${index}]`);
    const namespace = protocolId(item.namespace, `contextCommitments[${index}].namespace`);
    const algorithm = String(item.algorithm ?? "").toLowerCase();
    if (!["keccak256", "sha256"].includes(algorithm)) throw new PriorSealError("INVALID_INTENT", `contextCommitments[${index}].algorithm must be keccak256 or sha256`);
    const digest = String(item.digest ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new PriorSealError("INVALID_INTENT", `contextCommitments[${index}].digest must be a 32-byte hex value`);
    return { namespace, algorithm, digest };
  }).sort((left, right) => compareCommitmentKeys(left, right));
  if (new Set(normalized.map((entry) => `${entry.namespace}:${entry.algorithm}:${entry.digest}`)).size !== normalized.length) throw new PriorSealError("INVALID_INTENT", "contextCommitments must not contain duplicates");
  return normalized;
}
function compareCommitmentKeys(left, right) {
  const leftKey = `${left.namespace}:${left.algorithm}:${left.digest}`;
  const rightKey = `${right.namespace}:${right.algorithm}:${right.digest}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
export {
  ERC4337_USER_OPERATION_PROFILE,
  EXACT_CALL_INTENT_SCHEMA,
  EXACT_CALL_PROFILE,
  INTENT_SCHEMA,
  assertIssuableIntentInput,
  buildIntent
};
