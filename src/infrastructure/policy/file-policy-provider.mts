import { readFileSync } from 'node:fs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';
import { chainId, evmAddress, protocolId, uintString } from '../../domain/values.mjs';
import { buildWitnessPolicy } from '../../domain/witness.mjs';
import { buildTimestampPolicy } from '../../domain/rfc3161.mjs';

export function readPolicyFile(file: string | null | undefined) {
  if (!file) return null;
  return parsePolicyDocument(JSON.parse(readFileSync(file, 'utf8')));
}

export function parsePolicyDocument(policy: unknown) {
  if (policy == null) return null;
  assertSafeJson(policy);
  policy = assertOnlyFields(policy, ['policyId', 'principals', 'allowedChainIds', 'allowedActions', 'allowedAssets', 'allowedSenders', 'allowedRecipients', 'maxAmount', 'maxValiditySeconds', 'minConfirmations', 'requireDistinctAuthorizerAndExecutor', 'witnessQuorum', 'timestampPolicy'], 'policy');
  const document = policy as Record<string, unknown>;
  const policyId = document.policyId == null ? undefined : protocolId(document.policyId, 'policy.policyId');
  const allowedChainIds = normalizeList(document.allowedChainIds, 'policy.allowedChainIds', chainId);
  const allowedActions = normalizeList(document.allowedActions, 'policy.allowedActions', (value) => protocolId(value, 'policy.allowedActions entry'));
  const allowedAssets = normalizeList(document.allowedAssets, 'policy.allowedAssets', assetId);
  const allowedSenders = normalizeList(document.allowedSenders, 'policy.allowedSenders', (value) => evmAddress(value, 'policy.allowedSenders entry'));
  const allowedRecipients = normalizeList(document.allowedRecipients, 'policy.allowedRecipients', (value) => evmAddress(value, 'policy.allowedRecipients entry'));
  const maxAmount = document.maxAmount == null ? undefined : uintString(document.maxAmount, 'policy.maxAmount');
  if (document.maxValiditySeconds != null && (typeof document.maxValiditySeconds !== 'number' || !Number.isSafeInteger(document.maxValiditySeconds) || document.maxValiditySeconds < 0)) throw new TypeError('policy.maxValiditySeconds must be a non-negative safe integer');
  if (document.minConfirmations != null && (typeof document.minConfirmations !== 'number' || !Number.isSafeInteger(document.minConfirmations) || document.minConfirmations < 1 || document.minConfirmations > 10_000)) throw new TypeError('policy.minConfirmations must be an integer between 1 and 10000');
  if (document.requireDistinctAuthorizerAndExecutor != null && typeof document.requireDistinctAuthorizerAndExecutor !== 'boolean') throw new TypeError('policy.requireDistinctAuthorizerAndExecutor must be a boolean');
  const witnessQuorum = document.witnessQuorum ? buildWitnessPolicy(document.witnessQuorum) : undefined;
  const timestampPolicy = document.timestampPolicy ? buildTimestampPolicy(document.timestampPolicy) : undefined;
  let principals;
  if (document.principals !== undefined) {
    if (!Array.isArray(document.principals)) throw new TypeError('policy.principals must be an array');
    principals = document.principals.map((entry: unknown, index: number) => {
      const principal = assertOnlyFields(entry, ['id', 'type', 'account', 'authorizerType'], `policy.principals[${index}]`);
      if (!['user', 'organization'].includes(String(principal.type)) || !['eip712', 'eip1271'].includes(String(principal.authorizerType))) throw new TypeError(`policy.principals[${index}] has an invalid type`);
      return { id: protocolId(principal.id, `policy.principals[${index}].id`), type: principal.type as 'user' | 'organization', account: evmAddress(principal.account, `policy.principals[${index}].account`), authorizerType: principal.authorizerType as 'eip712' | 'eip1271' };
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
    ...(document.maxValiditySeconds != null ? { maxValiditySeconds: document.maxValiditySeconds as number } : {}),
    ...(document.minConfirmations != null ? { minConfirmations: document.minConfirmations as number } : {}),
    ...(document.requireDistinctAuthorizerAndExecutor != null ? { requireDistinctAuthorizerAndExecutor: document.requireDistinctAuthorizerAndExecutor as boolean } : {}),
    ...(witnessQuorum ? { witnessQuorum } : {}),
    ...(timestampPolicy ? { timestampPolicy } : {}),
  };
}

function normalizeList<T>(value: unknown, field: string, normalize: (entry: unknown) => T): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const normalized = value.map(normalize);
  const identities = normalized.map((entry) => String(entry).toLowerCase());
  if (new Set(identities).size !== identities.length) throw new TypeError(`${field} contains duplicate entries`);
  return normalized;
}

function assetId(value: unknown) {
  if (typeof value !== 'string' || !/^eip155:[1-9][0-9]*\/(native|erc20:0x[0-9a-fA-F]{40})$/.test(value)) throw new TypeError('policy.allowedAssets entries must be canonical EIP-155 asset identifiers');
  return value.toLowerCase();
}
