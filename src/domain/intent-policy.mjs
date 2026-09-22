// Generated from intent-policy.mts by npm run core:build. Do not edit directly.
const POLICY_CODES = Object.freeze({
  CHAIN_NOT_ALLOWED: "POLICY_CHAIN_NOT_ALLOWED",
  ACTION_NOT_ALLOWED: "POLICY_ACTION_NOT_ALLOWED",
  ASSET_NOT_ALLOWED: "POLICY_ASSET_NOT_ALLOWED",
  SENDER_NOT_ALLOWED: "POLICY_SENDER_NOT_ALLOWED",
  RECIPIENT_NOT_ALLOWED: "POLICY_RECIPIENT_NOT_ALLOWED",
  AMOUNT_EXCEEDED: "POLICY_AMOUNT_EXCEEDED",
  EXPIRY_TOO_FAR: "POLICY_EXPIRY_TOO_FAR",
  PRINCIPAL_NOT_ALLOWED: "POLICY_PRINCIPAL_NOT_ALLOWED",
  AUTHORIZER_EXECUTOR_NOT_DISTINCT: "POLICY_AUTHORIZER_EXECUTOR_NOT_DISTINCT",
  MIN_CONFIRMATIONS_REQUIRED: "POLICY_MIN_CONFIRMATIONS_REQUIRED",
  INVALID_POLICY: "POLICY_INVALID",
  EXACT_CALL_SEMANTICS_UNSUPPORTED: "POLICY_EXACT_CALL_SEMANTICS_UNSUPPORTED"
});
const listHas = (list, value) => Array.isArray(list) && !list.map(String).map((x) => x.toLowerCase()).includes(String(value).toLowerCase());
function evaluateIntentPolicy(intent, policy = {}, now = Math.floor(Date.now() / 1e3)) {
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
function evaluateAuthorizationPolicy(authorization, policy = {}, now = Math.floor(Date.now() / 1e3)) {
  const intentResult = evaluateIntentPolicy(authorization.intent, policy, now);
  const reasonCodes = [...intentResult.reasonCodes];
  if (policy.principals !== void 0 && !Array.isArray(policy.principals)) reasonCodes.push(POLICY_CODES.INVALID_POLICY);
  if (Array.isArray(policy.principals)) {
    const matched = policy.principals.some((entry) => {
      const principal = entry;
      return principal.id === authorization.principal.id && principal.type === authorization.principal.type && principal.account.toLowerCase() === authorization.principal.account && principal.authorizerType === authorization.authorizer.type;
    });
    if (!matched) reasonCodes.push(POLICY_CODES.PRINCIPAL_NOT_ALLOWED);
  }
  if (policy.requireDistinctAuthorizerAndExecutor === true && String(authorization.authorizer?.address ?? "").toLowerCase() === String(authorization.delegate?.executor ?? "").toLowerCase()) {
    reasonCodes.push(POLICY_CODES.AUTHORIZER_EXECUTOR_NOT_DISTINCT);
  }
  return { ...intentResult, allowed: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}
function evaluateNewIntentPolicyCompatibility(intent, policy = {}) {
  const exactCall = intent?.executionProfile === "priorseal.execution-profile.exact-call.v1";
  const semanticRestrictionsConfigured = policy.allowedAssets !== void 0 || policy.allowedRecipients !== void 0 || policy.maxAmount !== void 0;
  return exactCall && semanticRestrictionsConfigured ? { allowed: false, reasonCodes: [POLICY_CODES.EXACT_CALL_SEMANTICS_UNSUPPORTED] } : { allowed: true, reasonCodes: [] };
}
function validRuntimePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  const fields = policy;
  const listFields = ["allowedChainIds", "allowedActions", "allowedAssets", "allowedSenders", "allowedRecipients"];
  if (listFields.some((field) => fields[field] !== void 0 && !Array.isArray(fields[field]))) return false;
  if (fields.maxAmount != null && !/^(0|[1-9][0-9]*)$/.test(String(fields.maxAmount))) return false;
  if (fields.maxValiditySeconds != null && (!Number.isSafeInteger(fields.maxValiditySeconds) || fields.maxValiditySeconds < 0)) return false;
  if (fields.minConfirmations != null && (!Number.isSafeInteger(fields.minConfirmations) || fields.minConfirmations < 1 || fields.minConfirmations > 1e4)) return false;
  if (fields.requireDistinctAuthorizerAndExecutor != null && typeof fields.requireDistinctAuthorizerAndExecutor !== "boolean") return false;
  return true;
}
export {
  POLICY_CODES,
  evaluateAuthorizationPolicy,
  evaluateIntentPolicy,
  evaluateNewIntentPolicyCompatibility
};
