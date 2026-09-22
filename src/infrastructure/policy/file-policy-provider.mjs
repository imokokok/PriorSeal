// Generated from file-policy-provider.mts by npm run core:build. Do not edit directly.
import { readFileSync } from "node:fs";
import { assertOnlyFields, assertSafeJson } from "../../shared/safe-json.mjs";
import { chainId, evmAddress, protocolId, uintString } from "../../domain/values.mjs";
import { buildWitnessPolicy } from "../../domain/witness.mjs";
import { buildTimestampPolicy } from "../../domain/rfc3161.mjs";
function readPolicyFile(file) {
  if (!file) return null;
  return parsePolicyDocument(JSON.parse(readFileSync(file, "utf8")));
}
function parsePolicyDocument(policy) {
  if (policy == null) return null;
  assertSafeJson(policy);
  policy = assertOnlyFields(policy, ["policyId", "principals", "allowedChainIds", "allowedActions", "allowedAssets", "allowedSenders", "allowedRecipients", "maxAmount", "maxValiditySeconds", "minConfirmations", "requireDistinctAuthorizerAndExecutor", "witnessQuorum", "timestampPolicy"], "policy");
  const document = policy;
  const policyId = document.policyId == null ? void 0 : protocolId(document.policyId, "policy.policyId");
  const allowedChainIds = normalizeList(document.allowedChainIds, "policy.allowedChainIds", chainId);
  const allowedActions = normalizeList(document.allowedActions, "policy.allowedActions", (value) => protocolId(value, "policy.allowedActions entry"));
  const allowedAssets = normalizeList(document.allowedAssets, "policy.allowedAssets", assetId);
  const allowedSenders = normalizeList(document.allowedSenders, "policy.allowedSenders", (value) => evmAddress(value, "policy.allowedSenders entry"));
  const allowedRecipients = normalizeList(document.allowedRecipients, "policy.allowedRecipients", (value) => evmAddress(value, "policy.allowedRecipients entry"));
  const maxAmount = document.maxAmount == null ? void 0 : uintString(document.maxAmount, "policy.maxAmount");
  if (document.maxValiditySeconds != null && (typeof document.maxValiditySeconds !== "number" || !Number.isSafeInteger(document.maxValiditySeconds) || document.maxValiditySeconds < 0)) throw new TypeError("policy.maxValiditySeconds must be a non-negative safe integer");
  if (document.minConfirmations != null && (typeof document.minConfirmations !== "number" || !Number.isSafeInteger(document.minConfirmations) || document.minConfirmations < 1 || document.minConfirmations > 1e4)) throw new TypeError("policy.minConfirmations must be an integer between 1 and 10000");
  if (document.requireDistinctAuthorizerAndExecutor != null && typeof document.requireDistinctAuthorizerAndExecutor !== "boolean") throw new TypeError("policy.requireDistinctAuthorizerAndExecutor must be a boolean");
  const witnessQuorum = document.witnessQuorum ? buildWitnessPolicy(document.witnessQuorum) : void 0;
  const timestampPolicy = document.timestampPolicy ? buildTimestampPolicy(document.timestampPolicy) : void 0;
  let principals;
  if (document.principals !== void 0) {
    if (!Array.isArray(document.principals)) throw new TypeError("policy.principals must be an array");
    principals = document.principals.map((entry, index) => {
      const principal = assertOnlyFields(entry, ["id", "type", "account", "authorizerType"], `policy.principals[${index}]`);
      if (!["user", "organization"].includes(String(principal.type)) || !["eip712", "eip1271"].includes(String(principal.authorizerType))) throw new TypeError(`policy.principals[${index}] has an invalid type`);
      return { id: protocolId(principal.id, `policy.principals[${index}].id`), type: principal.type, account: evmAddress(principal.account, `policy.principals[${index}].account`), authorizerType: principal.authorizerType };
    });
    if (new Set(principals.map((principal) => principal.id)).size !== principals.length) throw new TypeError("policy.principals contains duplicate ids");
  }
  return {
    ...policyId ? { policyId } : {},
    ...principals ? { principals } : {},
    ...allowedChainIds ? { allowedChainIds } : {},
    ...allowedActions ? { allowedActions } : {},
    ...allowedAssets ? { allowedAssets } : {},
    ...allowedSenders ? { allowedSenders } : {},
    ...allowedRecipients ? { allowedRecipients } : {},
    ...maxAmount != null ? { maxAmount } : {},
    ...document.maxValiditySeconds != null ? { maxValiditySeconds: document.maxValiditySeconds } : {},
    ...document.minConfirmations != null ? { minConfirmations: document.minConfirmations } : {},
    ...document.requireDistinctAuthorizerAndExecutor != null ? { requireDistinctAuthorizerAndExecutor: document.requireDistinctAuthorizerAndExecutor } : {},
    ...witnessQuorum ? { witnessQuorum } : {},
    ...timestampPolicy ? { timestampPolicy } : {}
  };
}
function normalizeList(value, field, normalize) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const normalized = value.map(normalize);
  const identities = normalized.map((entry) => String(entry).toLowerCase());
  if (new Set(identities).size !== identities.length) throw new TypeError(`${field} contains duplicate entries`);
  return normalized;
}
function assetId(value) {
  if (typeof value !== "string" || !/^eip155:[1-9][0-9]*\/(native|erc20:0x[0-9a-fA-F]{40})$/.test(value)) throw new TypeError("policy.allowedAssets entries must be canonical EIP-155 asset identifiers");
  return value.toLowerCase();
}
export {
  parsePolicyDocument,
  readPolicyFile
};
