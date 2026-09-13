export const POLICY_CODES = Object.freeze({
  CHAIN_NOT_ALLOWED: 'POLICY_CHAIN_NOT_ALLOWED',
  ACTION_NOT_ALLOWED: 'POLICY_ACTION_NOT_ALLOWED',
  ASSET_NOT_ALLOWED: 'POLICY_ASSET_NOT_ALLOWED',
  SENDER_NOT_ALLOWED: 'POLICY_SENDER_NOT_ALLOWED',
  RECIPIENT_NOT_ALLOWED: 'POLICY_RECIPIENT_NOT_ALLOWED',
  AMOUNT_EXCEEDED: 'POLICY_AMOUNT_EXCEEDED',
  EXPIRY_TOO_FAR: 'POLICY_EXPIRY_TOO_FAR',
  PRINCIPAL_NOT_ALLOWED: 'POLICY_PRINCIPAL_NOT_ALLOWED',
  MIN_CONFIRMATIONS_REQUIRED: 'POLICY_MIN_CONFIRMATIONS_REQUIRED',
  INVALID_POLICY: 'POLICY_INVALID',
  EXACT_CALL_SEMANTICS_UNSUPPORTED: 'POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED',
});
const listHas = (list, value) => Array.isArray(list) && !list.map(String).map((x) => x.toLowerCase()).includes(String(value).toLowerCase());
export function evaluateIntentPolicy(intent, policy = {}, now = Math.floor(Date.now() / 1000)) {
  const reasonCodes = [];
  if (!validRuntimePolicy(policy)) reasonCodes.push(POLICY_CODES.INVALID_POLICY);
  if (listHas(policy.allowedChainIds, intent.chainId)) reasonCodes.push(POLICY_CODES.CHAIN_NOT_ALLOWED);
  if (listHas(policy.allowedActions, intent.action)) reasonCodes.push(POLICY_CODES.ACTION_NOT_ALLOWED);
  if (listHas(policy.allowedAssets, intent.asset)) reasonCodes.push(POLICY_CODES.ASSET_NOT_ALLOWED);
  if (listHas(policy.allowedSenders, intent.sender)) reasonCodes.push(POLICY_CODES.SENDER_NOT_ALLOWED);
  if (listHas(policy.allowedRecipients, intent.recipient)) reasonCodes.push(POLICY_CODES.RECIPIENT_NOT_ALLOWED);
  try {
    if (policy.maxAmount != null && BigInt(intent.amount) > BigInt(policy.maxAmount)) reasonCodes.push(POLICY_CODES.AMOUNT_EXCEEDED);
    if (policy.maxValiditySeconds != null && Number(intent.validUntil) > now + Number(policy.maxValiditySeconds)) reasonCodes.push(POLICY_CODES.EXPIRY_TOO_FAR);
    if (policy.minConfirmations != null && Number(intent.constraints?.minConfirmations ?? 0) < Number(policy.minConfirmations)) reasonCodes.push(POLICY_CODES.MIN_CONFIRMATIONS_REQUIRED);
  } catch {
    reasonCodes.push(POLICY_CODES.INVALID_POLICY);
  }
  return { allowed: reasonCodes.length === 0, reasonCodes, policyId: policy.policyId ?? null, evaluatedAt: now };
}

export function evaluateAuthorizationPolicy(authorization, policy = {}, now = Math.floor(Date.now() / 1000)) {
  const intentResult = evaluateIntentPolicy(authorization.intent, policy, now);
  const reasonCodes = [...intentResult.reasonCodes];
  if (policy.principals !== undefined && !Array.isArray(policy.principals)) reasonCodes.push(POLICY_CODES.INVALID_POLICY);
  if (Array.isArray(policy.principals)) {
    const matched = policy.principals.some((principal) => principal.id === authorization.principal.id
      && principal.type === authorization.principal.type
      && principal.account.toLowerCase() === authorization.principal.account
      && principal.authorizerType === authorization.authorizer.type);
    if (!matched) reasonCodes.push(POLICY_CODES.PRINCIPAL_NOT_ALLOWED);
  }
  return { ...intentResult, allowed: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

/**
 * Exact-call receipts deliberately bind transaction bytes without interpreting
 * token/recipient/amount business semantics. Reject new authorizations whose
 * policy would otherwise appear to enforce those descriptive fields.
 */
export function evaluateNewIntentPolicyCompatibility(intent, policy = {}) {
  const exactCall = intent?.executionProfile === 'priorseal.execution-profile.exact-call.v1';
  const semanticRestrictionsConfigured = policy.allowedAssets !== undefined || policy.allowedRecipients !== undefined || policy.maxAmount !== undefined;
  return exactCall && semanticRestrictionsConfigured
    ? { allowed: false, reasonCodes: [POLICY_CODES.EXACT_CALL_SEMANTICS_UNSUPPORTED] }
    : { allowed: true, reasonCodes: [] };
}

function validRuntimePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const listFields = ['allowedChainIds', 'allowedActions', 'allowedAssets', 'allowedSenders', 'allowedRecipients'];
  if (listFields.some((field) => policy[field] !== undefined && !Array.isArray(policy[field]))) return false;
  if (policy.maxAmount != null && !/^(0|[1-9][0-9]*)$/.test(String(policy.maxAmount))) return false;
  if (policy.maxValiditySeconds != null && (!Number.isSafeInteger(policy.maxValiditySeconds) || policy.maxValiditySeconds < 0)) return false;
  if (policy.minConfirmations != null && (!Number.isSafeInteger(policy.minConfirmations) || policy.minConfirmations < 1 || policy.minConfirmations > 10_000)) return false;
  return true;
}
