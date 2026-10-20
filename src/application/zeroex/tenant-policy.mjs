// Generated from tenant-policy.mts by npm run core:build. Do not edit directly.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const BASE58_PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function hasGuardedZeroExCommercialFees(policies) {
  return Boolean(policies?.tenants.some((tenant) => tenant.commercialFee));
}
function parseGuardedZeroExTenantPolicySet(value, deploymentPolicy) {
  if (value === void 0 || value === null || value === "") return void 0;
  const root = record(value, "PRIORSEAL_ZEROEX_TENANTS_JSON");
  exactKeys(root, ["defaultTenantId", "schema", "tenants"], "PRIORSEAL_ZEROEX_TENANTS_JSON");
  if (root.schema !== "priorseal.zeroex-tenant-policy-set.v1" || typeof root.defaultTenantId !== "string" || !IDENTIFIER.test(root.defaultTenantId) || !Array.isArray(root.tenants) || root.tenants.length < 1 || root.tenants.length > 128) {
    throw new TypeError("PRIORSEAL_ZEROEX_TENANTS_JSON has an invalid schema, defaultTenantId, or tenants list");
  }
  const tenants = root.tenants.map((entry, index) => parseTenant(entry, index, deploymentPolicy));
  if (new Set(tenants.map((tenant) => tenant.tenantId)).size !== tenants.length) throw new TypeError("PRIORSEAL_ZEROEX_TENANTS_JSON tenantId values must be unique");
  if (!tenants.some((tenant) => tenant.tenantId === root.defaultTenantId)) throw new TypeError("PRIORSEAL_ZEROEX_TENANTS_JSON defaultTenantId must name a configured tenant");
  const defaultTenant = tenants.find((tenant) => tenant.tenantId === root.defaultTenantId);
  if (defaultTenant.agentAccountId) throw new TypeError("PRIORSEAL_ZEROEX_TENANTS_JSON default tenant must not require an agent account");
  const accountIds = tenants.flatMap((tenant) => tenant.agentAccountId ? [tenant.agentAccountId] : []);
  if (new Set(accountIds).size !== accountIds.length) throw new TypeError("PRIORSEAL_ZEROEX_TENANTS_JSON agentAccountId values must be unique");
  return { schema: "priorseal.zeroex-tenant-policy-set.v1", defaultTenantId: root.defaultTenantId, tenants };
}
function resolveGuardedZeroExTenantPolicy(deploymentPolicy, policies, agentAccountId) {
  if (!policies) return { tenantId: "public", policy: structuredClone(deploymentPolicy) };
  const tenant = agentAccountId ? policies.tenants.find((candidate) => candidate.agentAccountId === agentAccountId) : policies.tenants.find((candidate) => candidate.tenantId === policies.defaultTenantId);
  if (!tenant) throw commercialError("ZEROEX_TENANT_UNAUTHORIZED", "This authenticated Agent account has no guarded 0x tenant policy");
  const policy = {
    ...structuredClone(deploymentPolicy),
    ...tenant.allowedInputMints ? { allowedInputMints: [...tenant.allowedInputMints] } : {},
    ...tenant.allowedOutputMints ? { allowedOutputMints: [...tenant.allowedOutputMints] } : {},
    ...tenant.maxInputAmountAtomic ? { maxInputAmountAtomic: tenant.maxInputAmountAtomic } : {},
    ...tenant.maxSlippageBps !== void 0 ? { maxSlippageBps: tenant.maxSlippageBps } : {},
    ...tenant.commercialFee ? { commercialFee: { ...tenant.commercialFee, tenantId: tenant.tenantId } } : {}
  };
  return { tenantId: tenant.tenantId, policy };
}
function parseTenant(value, index, deploymentPolicy) {
  const tenant = record(value, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}]`);
  const allowed = ["agentAccountId", "allowedInputMints", "allowedOutputMints", "commercialFee", "maxInputAmountAtomic", "maxSlippageBps", "tenantId"];
  if (Object.keys(tenant).some((key) => !allowed.includes(key)) || typeof tenant.tenantId !== "string" || !IDENTIFIER.test(tenant.tenantId)) throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}] has an invalid tenantId or unknown field`);
  const agentAccountId = tenant.agentAccountId === void 0 ? void 0 : identifier(tenant.agentAccountId, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].agentAccountId`);
  const allowedInputMints = optionalPublicKeys(tenant.allowedInputMints, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].allowedInputMints`);
  const allowedOutputMints = optionalPublicKeys(tenant.allowedOutputMints, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].allowedOutputMints`);
  ensureSubset(allowedInputMints, deploymentPolicy.allowedInputMints, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].allowedInputMints`);
  ensureSubset(allowedOutputMints, deploymentPolicy.allowedOutputMints, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].allowedOutputMints`);
  const maxInputAmountAtomic = tenant.maxInputAmountAtomic === void 0 ? void 0 : atomic(tenant.maxInputAmountAtomic, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].maxInputAmountAtomic`);
  if (maxInputAmountAtomic && BigInt(maxInputAmountAtomic) > BigInt(deploymentPolicy.maxInputAmountAtomic)) throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].maxInputAmountAtomic may not exceed deployment policy`);
  const maxSlippageBps = tenant.maxSlippageBps === void 0 ? void 0 : positiveInteger(tenant.maxSlippageBps, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].maxSlippageBps`);
  if (maxSlippageBps !== void 0 && maxSlippageBps > deploymentPolicy.maxSlippageBps) throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].maxSlippageBps may not exceed deployment policy`);
  const commercialFee = tenant.commercialFee === void 0 ? void 0 : parseCommercialFee(tenant.commercialFee, index);
  if (commercialFee && allowedInputMints && !allowedInputMints.includes(commercialFee.inputMint)) throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].commercialFee inputMint must be admitted by the tenant`);
  if (commercialFee && deploymentPolicy.allowedInputMints && !deploymentPolicy.allowedInputMints.includes(commercialFee.inputMint)) throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].commercialFee inputMint must be admitted by deployment policy`);
  return { tenantId: tenant.tenantId, ...agentAccountId ? { agentAccountId } : {}, ...allowedInputMints ? { allowedInputMints } : {}, ...allowedOutputMints ? { allowedOutputMints } : {}, ...maxInputAmountAtomic ? { maxInputAmountAtomic } : {}, ...maxSlippageBps !== void 0 ? { maxSlippageBps } : {}, ...commercialFee ? { commercialFee } : {} };
}
function parseCommercialFee(value, index) {
  const fee = record(value, `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].commercialFee`);
  exactKeys(fee, ["feePpm", "inputMint", "profileId", "recipientTokenAccount", "side"], `PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].commercialFee`);
  if (fee.side !== "sell" || typeof fee.profileId !== "string" || !IDENTIFIER.test(fee.profileId) || typeof fee.inputMint !== "string" || !BASE58_PUBLIC_KEY.test(fee.inputMint) || typeof fee.recipientTokenAccount !== "string" || !BASE58_PUBLIC_KEY.test(fee.recipientTokenAccount) || typeof fee.feePpm !== "number" || !Number.isSafeInteger(fee.feePpm) || fee.feePpm < 1 || fee.feePpm > 1e5) {
    throw new TypeError(`PRIORSEAL_ZEROEX_TENANTS_JSON.tenants[${index}].commercialFee is invalid`);
  }
  return { profileId: fee.profileId, inputMint: fee.inputMint, feePpm: fee.feePpm, recipientTokenAccount: fee.recipientTokenAccount, side: "sell" };
}
function optionalPublicKeys(value, label) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || value.some((item) => typeof item !== "string" || !BASE58_PUBLIC_KEY.test(item)) || new Set(value).size !== value.length) throw new TypeError(`${label} must be a distinct non-empty public-key list`);
  return [...value];
}
function ensureSubset(candidate, parent, label) {
  if (candidate && parent && candidate.some((item) => !parent.includes(item))) throw new TypeError(`${label} must be a subset of the deployment policy`);
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return Number(value);
}
function atomic(value, label) {
  if (typeof value !== "string" || !ATOMIC.test(value) || value === "0") throw new TypeError(`${label} must be a positive atomic integer string`);
  return value;
}
function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new TypeError(`${label} has unknown or missing fields`);
}
function commercialError(code, message) {
  return Object.assign(new Error(message), { code });
}
export {
  hasGuardedZeroExCommercialFees,
  parseGuardedZeroExTenantPolicySet,
  resolveGuardedZeroExTenantPolicy
};
