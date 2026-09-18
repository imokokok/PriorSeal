import { readFileSync } from 'node:fs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';
import { chainId, evmAddress, protocolId, uintString } from '../../domain/values.mjs';
import { buildWitnessPolicy } from '../../domain/witness.mjs';
import { buildTimestampPolicy } from '../../domain/rfc3161.mjs';

export function readPolicyFile(file) {
  if (!file) return null;
  return parsePolicyDocument(JSON.parse(readFileSync(file, 'utf8')));
}

export function parsePolicyDocument(policy) {
  if (policy == null) return null;
  assertSafeJson(policy);
  assertOnlyFields(policy, ['policyId', 'principals', 'allowedChainIds', 'allowedActions', 'allowedAssets', 'allowedSenders', 'allowedRecipients', 'maxAmount', 'maxValiditySeconds', 'minConfirmations', 'requireDistinctAuthorizerAndExecutor', 'witnessQuorum', 'timestampPolicy'], 'policy');
  const policyId = policy.policyId == null ? undefined : protocolId(policy.policyId, 'policy.policyId');
  const allowedChainIds = normalizeList(policy.allowedChainIds, 'policy.allowedChainIds', chainId);
  const allowedActions = normalizeList(policy.allowedActions, 'policy.allowedActions', (value) => protocolId(value, 'policy.allowedActions entry'));
  const allowedAssets = normalizeList(policy.allowedAssets, 'policy.allowedAssets', assetId);
  const allowedSenders = normalizeList(policy.allowedSenders, 'policy.allowedSenders', (value) => evmAddress(value, 'policy.allowedSenders entry'));
  const allowedRecipients = normalizeList(policy.allowedRecipients, 'policy.allowedRecipients', (value) => evmAddress(value, 'policy.allowedRecipients entry'));
  const maxAmount = policy.maxAmount == null ? undefined : uintString(policy.maxAmount, 'policy.maxAmount');
  if (policy.maxValiditySeconds != null && (!Number.isSafeInteger(policy.maxValiditySeconds) || policy.maxValiditySeconds < 0)) throw new TypeError('policy.maxValiditySeconds must be a non-negative safe integer');
  if (policy.minConfirmations != null && (!Number.isSafeInteger(policy.minConfirmations) || policy.minConfirmations < 1 || policy.minConfirmations > 10_000)) throw new TypeError('policy.minConfirmations must be an integer between 1 and 10000');
  if (policy.requireDistinctAuthorizerAndExecutor != null && typeof policy.requireDistinctAuthorizerAndExecutor !== 'boolean') throw new TypeError('policy.requireDistinctAuthorizerAndExecutor must be a boolean');
  const witnessQuorum = policy.witnessQuorum ? buildWitnessPolicy(policy.witnessQuorum) : undefined;
  const timestampPolicy = policy.timestampPolicy ? buildTimestampPolicy(policy.timestampPolicy) : undefined;
  let principals;
  if (policy.principals !== undefined) {
    if (!Array.isArray(policy.principals)) throw new TypeError('policy.principals must be an array');
    principals = policy.principals.map((principal, index) => {
      assertOnlyFields(principal, ['id', 'type', 'account', 'authorizerType'], `policy.principals[${index}]`);
      if (!['user', 'organization'].includes(principal.type) || !['eip712', 'eip1271'].includes(principal.authorizerType)) throw new TypeError(`policy.principals[${index}] has an invalid type`);
      return { id: protocolId(principal.id, `policy.principals[${index}].id`), type: principal.type, account: evmAddress(principal.account, `policy.principals[${index}].account`), authorizerType: principal.authorizerType };
    });
    if (new Set(principals.map((principal) => principal.id)).size !== principals.length) throw new TypeError('policy.principals contains duplicate ids');
  }
  return {
    ...(policyId ? { policyId } : {}),
    ...(principals ? { principals } : {}),
    ...(allowedChainIds ? { allowedChainIds } : {}),
    ...(allowedActions ? { allowedActions } : {}),
    ...(allowedAssets ? { allowedAssets } : {}),
    ...(allowedSenders ? { allowedSenders } : {}),
    ...(allowedRecipients ? { allowedRecipients } : {}),
    ...(maxAmount != null ? { maxAmount } : {}),
    ...(policy.maxValiditySeconds != null ? { maxValiditySeconds: policy.maxValiditySeconds } : {}),
    ...(policy.minConfirmations != null ? { minConfirmations: policy.minConfirmations } : {}),
    ...(policy.requireDistinctAuthorizerAndExecutor != null ? { requireDistinctAuthorizerAndExecutor: policy.requireDistinctAuthorizerAndExecutor } : {}),
    ...(witnessQuorum ? { witnessQuorum } : {}),
    ...(timestampPolicy ? { timestampPolicy } : {}),
  };
}

function normalizeList(value, field, normalize) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const normalized = value.map(normalize);
  const identities = normalized.map((entry) => String(entry).toLowerCase());
  if (new Set(identities).size !== identities.length) throw new TypeError(`${field} contains duplicate entries`);
  return normalized;
}

function assetId(value) {
  if (typeof value !== 'string' || !/^eip155:[1-9][0-9]*\/(native|erc20:0x[0-9a-fA-F]{40})$/.test(value)) throw new TypeError('policy.allowedAssets entries must be canonical EIP-155 asset identifiers');
  return value.toLowerCase();
}
