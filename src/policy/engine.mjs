export const POLICY_CODES = Object.freeze({
  CHAIN_NOT_ALLOWED: 'POLICY_CHAIN_NOT_ALLOWED',
  ACTION_NOT_ALLOWED: 'POLICY_ACTION_NOT_ALLOWED',
  ASSET_NOT_ALLOWED: 'POLICY_ASSET_NOT_ALLOWED',
  SENDER_NOT_ALLOWED: 'POLICY_SENDER_NOT_ALLOWED',
  RECIPIENT_NOT_ALLOWED: 'POLICY_RECIPIENT_NOT_ALLOWED',
  AMOUNT_EXCEEDED: 'POLICY_AMOUNT_EXCEEDED',
  EXPIRY_TOO_FAR: 'POLICY_EXPIRY_TOO_FAR',
});
const listHas = (list, value) => Array.isArray(list) && !list.map(String).map((x) => x.toLowerCase()).includes(String(value).toLowerCase());
export function evaluateIntentPolicy(intent, policy = {}, now = Math.floor(Date.now() / 1000)) {
  const reasonCodes = [];
  if (listHas(policy.allowedChainIds, intent.chainId)) reasonCodes.push(POLICY_CODES.CHAIN_NOT_ALLOWED);
  if (listHas(policy.allowedActions, intent.action)) reasonCodes.push(POLICY_CODES.ACTION_NOT_ALLOWED);
  if (listHas(policy.allowedAssets, intent.asset)) reasonCodes.push(POLICY_CODES.ASSET_NOT_ALLOWED);
  if (listHas(policy.allowedSenders, intent.sender)) reasonCodes.push(POLICY_CODES.SENDER_NOT_ALLOWED);
  if (listHas(policy.allowedRecipients, intent.recipient)) reasonCodes.push(POLICY_CODES.RECIPIENT_NOT_ALLOWED);
  if (policy.maxAmount != null && BigInt(intent.amount) > BigInt(policy.maxAmount)) reasonCodes.push(POLICY_CODES.AMOUNT_EXCEEDED);
  if (policy.maxValiditySeconds != null && Number(intent.validUntil) > now + Number(policy.maxValiditySeconds)) reasonCodes.push(POLICY_CODES.EXPIRY_TOO_FAR);
  return { allowed: reasonCodes.length === 0, reasonCodes, policyId: policy.policyId ?? null, evaluatedAt: now };
}
