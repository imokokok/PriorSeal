import { readFileSync } from 'node:fs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';
import { evmAddress, protocolId } from '../../domain/values.mjs';
import { buildWitnessPolicy } from '../../domain/witness.mjs';
import { buildTimestampPolicy } from '../../domain/rfc3161.mjs';

export function readPolicyFile(file) {
  if (!file) return null;
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  assertSafeJson(policy);
  assertOnlyFields(policy, ['policyId', 'principals', 'allowedChainIds', 'allowedActions', 'allowedAssets', 'allowedSenders', 'allowedRecipients', 'maxAmount', 'maxValiditySeconds', 'witnessQuorum', 'timestampPolicy'], 'policy');
  const witnessQuorum = policy.witnessQuorum ? buildWitnessPolicy(policy.witnessQuorum) : undefined;
  const timestampPolicy = policy.timestampPolicy ? buildTimestampPolicy(policy.timestampPolicy) : undefined;
  if (policy.principals === undefined) return { ...policy, ...(witnessQuorum ? { witnessQuorum } : {}), ...(timestampPolicy ? { timestampPolicy } : {}) };
  if (!Array.isArray(policy.principals)) throw new TypeError('policy.principals must be an array');
  const principals = policy.principals.map((principal, index) => {
    assertOnlyFields(principal, ['id', 'type', 'account', 'authorizerType'], `policy.principals[${index}]`);
    if (!['user', 'organization'].includes(principal.type) || !['eip712', 'eip1271'].includes(principal.authorizerType)) throw new TypeError(`policy.principals[${index}] has an invalid type`);
    return { id: protocolId(principal.id, `policy.principals[${index}].id`), type: principal.type, account: evmAddress(principal.account, `policy.principals[${index}].account`), authorizerType: principal.authorizerType };
  });
  if (new Set(principals.map((principal) => principal.id)).size !== principals.length) throw new TypeError('policy.principals contains duplicate ids');
  return { ...policy, principals, ...(witnessQuorum ? { witnessQuorum } : {}), ...(timestampPolicy ? { timestampPolicy } : {}) };
}
