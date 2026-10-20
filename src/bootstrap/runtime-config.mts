import { createArchiveAccess } from '../application/archive/evidence-archive.mjs';
import type { GuardedJupiterDeploymentPolicy } from '../application/jupiter/guarded-swap-service.mjs';
import { MAX_JUPITER_PLATFORM_FEE_BPS, SOLANA_USDC_MINT } from 'priorseal-sdk';
import { isSolanaPublicKey } from '../domain/solana.mjs';
import type { GuardedZeroExDeploymentPolicy } from '../application/zeroex/guarded-swap-service.mjs';
import { parseGuardedZeroExTenantPolicySet, type GuardedZeroExTenantPolicySet } from '../application/zeroex/tenant-policy.mjs';
import { parseZeroExResponseSignatureConfiguration, type ZeroExResponseSignatureConfiguration } from 'priorseal-sdk';
import { parseX402Config } from '../infrastructure/payments/x402-exact-evm.mjs';
import { parseAgentMeterConfig } from '../application/commerce/agent-meter.mjs';
import { SELFSEEK_BASE_MAINNET_CHAIN_ID, SELFSEEK_BASE_MAINNET_USDC, type SelfserveClaimConfig } from '../application/commerce/selfserve-claim.mjs';
import { createHash } from 'node:crypto';

type RuntimeEnvironmentInput = Partial<Record<
  'DATABASE_URL' |
  'DATABASE_URL_UNPOOLED' |
  'PRIORSEAL_DATABASE_BACKEND' |
  'PORT' |
  'PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS' |
  'PRIORSEAL_AGENT_METER_JSON' |
  'PRIORSEAL_ANCHOR_CONFIRMATIONS' |
  'PRIORSEAL_ARCHIVE_CREDENTIALS_JSON' |
  'PRIORSEAL_AUTHORIZATION_AUDIENCE' |
  'PRIORSEAL_BUILD_VERSION' |
  'PRIORSEAL_CORS_ORIGINS' |
  'PRIORSEAL_ENVIRONMENT' |
  'PRIORSEAL_ERC4337_ENTRY_POINTS_JSON' |
  'PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON' |
  'PRIORSEAL_SAFE_4337_TRUST_JSON' |
  'PRIORSEAL_ISSUER' |
  'JUPITER_API_KEY' |
  'INSIGHT_API_KEY' |
  'ZEROEX_API_KEY' |
  'PRIORSEAL_JUPITER_INSIGHT_BASE_URL' |
  'PRIORSEAL_JUPITER_PLATFORM_FEE_BPS' |
  'PRIORSEAL_JUPITER_FEE_ACCOUNT' |
  'PRIORSEAL_JUPITER_POLICY_JSON' |
  'PRIORSEAL_JUPITER_ROUTER_BASE_URL' |
  'PRIORSEAL_JUPITER_RPC_URL' |
  'PRIORSEAL_ZEROEX_INSIGHT_BASE_URL' |
  'PRIORSEAL_ZEROEX_POLICY_JSON' |
  'PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON' |
  'PRIORSEAL_ZEROEX_TENANTS_JSON' |
  'PRIORSEAL_ZEROEX_ROUTER_BASE_URL' |
  'PRIORSEAL_ZEROEX_RPC_URL' |
  'PRIORSEAL_KEY_ID' |
  'PRIORSEAL_KEY_REGISTRY_FILE' |
  'PRIORSEAL_KEY_REGISTRY_JSON' |
  'PRIORSEAL_POLICY_FILE' |
  'PRIORSEAL_POLICY_JSON' |
  'PRIORSEAL_PREEXECUTION_PROOF_MODE' |
  'PRIORSEAL_PRIVATE_KEY_FILE' |
  'PRIORSEAL_PRIVATE_KEY_PEM' |
  'PRIORSEAL_PUBLIC_KEY_FILE' |
  'PRIORSEAL_PUBLIC_KEY_PEM' |
  'PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR' |
  'PRIORSEAL_RPC_BASE' |
  'PRIORSEAL_RUNTIME' |
  'PRIORSEAL_TRANSPARENCY_ANCHOR_FILE' |
  'PRIORSEAL_TRANSPARENCY_ANCHOR_JSON' |
  'PRIORSEAL_TRUST_PROXY' |
  'PRIORSEAL_X402_FACILITATOR_HEADERS_JSON' |
  'PRIORSEAL_X402_FACILITATOR_AUTH_MODE' |
  'PRIORSEAL_X402_CDP_API_KEY_ID' |
  'PRIORSEAL_X402_CDP_API_KEY_SECRET' |
  'PRIORSEAL_X402_FACILITATOR_URL' |
  'PRIORSEAL_X402_ENABLE_TESTNETS' |
  'PRIORSEAL_X402_PAY_TO' |
  'PRIORSEAL_X402_SOLANA_PAY_TO' |
  'PRIORSEAL_X402_NETWORKS' |
  'PRIORSEAL_X402_RESOURCE_ORIGIN' |
  'PRIORSEAL_X402_ROUTES_JSON' |
  'PRIORSEAL_X402_TIMEOUT_MS' |
  'PRIORSEAL_WITNESS_ENDPOINTS_FILE' |
  'PRIORSEAL_WITNESS_ENDPOINTS_JSON',
  string
>>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Converts environment input into a validated runtime configuration.
 * Keep environment parsing at the composition root; domain and interface modules
 * receive explicit values rather than reading process.env themselves.
 */
export function loadRuntimeConfig(environment: RuntimeEnvironmentInput = process.env) {
  const runtimeEnvironment = environmentValue(environment.PRIORSEAL_ENVIRONMENT);
  const runtime = runtimeValue(environment.PRIORSEAL_RUNTIME);
  const privateKeyFile = optionalValue(environment.PRIORSEAL_PRIVATE_KEY_FILE);
  const publicKeyFile = optionalValue(environment.PRIORSEAL_PUBLIC_KEY_FILE);
  const privateKeyPem = optionalPem(environment.PRIORSEAL_PRIVATE_KEY_PEM);
  const publicKeyPem = optionalPem(environment.PRIORSEAL_PUBLIC_KEY_PEM);
  const keyRegistryFile = optionalValue(environment.PRIORSEAL_KEY_REGISTRY_FILE);
  const keyRegistryJson = optionalJson(environment.PRIORSEAL_KEY_REGISTRY_JSON, 'PRIORSEAL_KEY_REGISTRY_JSON');
  const policyFile = optionalValue(environment.PRIORSEAL_POLICY_FILE);
  const policyJson = optionalJson(environment.PRIORSEAL_POLICY_JSON, 'PRIORSEAL_POLICY_JSON');
  const transparencyAnchorFile = optionalValue(environment.PRIORSEAL_TRANSPARENCY_ANCHOR_FILE);
  const transparencyAnchorJson = optionalJson(environment.PRIORSEAL_TRANSPARENCY_ANCHOR_JSON, 'PRIORSEAL_TRANSPARENCY_ANCHOR_JSON');
  const witnessEndpointsFile = optionalValue(environment.PRIORSEAL_WITNESS_ENDPOINTS_FILE);
  const witnessEndpointsJson = optionalJson(environment.PRIORSEAL_WITNESS_ENDPOINTS_JSON, 'PRIORSEAL_WITNESS_ENDPOINTS_JSON');
  const archiveCredentials = optionalJson(environment.PRIORSEAL_ARCHIVE_CREDENTIALS_JSON, 'PRIORSEAL_ARCHIVE_CREDENTIALS_JSON');
  const agentMeter = parseAgentMeterConfig(optionalJson(environment.PRIORSEAL_AGENT_METER_JSON, 'PRIORSEAL_AGENT_METER_JSON'));
  const erc4337EntryPoints = parseErc4337EntryPoints(optionalJson(environment.PRIORSEAL_ERC4337_ENTRY_POINTS_JSON, 'PRIORSEAL_ERC4337_ENTRY_POINTS_JSON'));
  const eip7702Delegates = parseEip7702DelegateTrust(optionalJson(environment.PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON, 'PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON'));
  const safe4337Trust = parseSafe4337Trust(optionalJson(environment.PRIORSEAL_SAFE_4337_TRUST_JSON, 'PRIORSEAL_SAFE_4337_TRUST_JSON'));
  const x402 = parseX402Config(environment);
  const selfserveClaim = selfserveClaimConfig(environment, agentMeter, privateKeyPem);
  const guardedJupiter = guardedJupiterConfig(environment);
  const guardedZeroEx = guardedZeroExConfig(environment);
  for (const profile of safe4337Trust) {
    if (!erc4337EntryPoints.some(entry => entry.chainId === profile.chainId && entry.version === profile.version && entry.address === profile.entryPointAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${profile.chainId}:${profile.version} requires a matching configured EntryPoint address`);
  }
  createArchiveAccess(archiveCredentials); // Readiness and startup share strict credential validation.
  const anchorConfirmations = confirmationValue(environment.PRIORSEAL_ANCHOR_CONFIRMATIONS);
  if (Boolean(privateKeyFile) !== Boolean(publicKeyFile)) {
    throw new TypeError('PRIORSEAL_PRIVATE_KEY_FILE and PRIORSEAL_PUBLIC_KEY_FILE must be configured together');
  }
  if (Boolean(privateKeyPem) !== Boolean(publicKeyPem)) {
    throw new TypeError('PRIORSEAL_PRIVATE_KEY_PEM and PRIORSEAL_PUBLIC_KEY_PEM must be configured together');
  }
  if (privateKeyFile && privateKeyPem) throw new TypeError('Configure issuer keys as files or inline PEM secrets, not both');
  if (keyRegistryFile && keyRegistryJson) throw new TypeError('Configure the key registry as a file or inline JSON, not both');
  if (policyFile && policyJson) throw new TypeError('Configure the authorization policy as a file or inline JSON, not both');
  if (transparencyAnchorFile && transparencyAnchorJson) throw new TypeError('Configure the transparency anchor as a file or inline JSON, not both');
  if (witnessEndpointsFile && witnessEndpointsJson) throw new TypeError('Configure witness endpoints as a file or inline JSON, not both');

  const preExecutionProofMode = proofModeValue(environment.PRIORSEAL_PREEXECUTION_PROOF_MODE, environment.PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR, runtimeEnvironment);
  const allowSelfAssertedPrincipals = booleanValue(environment.PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS, 'PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS', false);
  const config = {
    environment: runtimeEnvironment,
    ...(archiveCredentials ? { archiveCredentials } : {}),
    ...(agentMeter ? { agentMeter } : {}),
    erc4337EntryPoints,
    eip7702Delegates,
    safe4337Trust,
    ...(runtime !== 'node' ? { runtime } : {}),
    port: portValue(environment.PORT),
    issuer: identifierValue(environment.PRIORSEAL_ISSUER, 'PRIORSEAL_ISSUER', 'priorseal-local'),
    keyId: identifierValue(environment.PRIORSEAL_KEY_ID, 'PRIORSEAL_KEY_ID', 'default'),
    buildVersion: identifierValue(environment.PRIORSEAL_BUILD_VERSION, 'PRIORSEAL_BUILD_VERSION', 'dev'),
    authorizationAudience: identifierValue(environment.PRIORSEAL_AUTHORIZATION_AUDIENCE, 'PRIORSEAL_AUTHORIZATION_AUDIENCE', 'priorseal'),
    privateKeyFile,
    publicKeyFile,
    ...(privateKeyPem ? { privateKeyPem, publicKeyPem } : {}),
    keyRegistryFile,
    ...(keyRegistryJson ? { keyRegistryJson } : {}),
    policyFile,
    ...(policyJson ? { policyJson } : {}),
    transparencyAnchorFile,
    ...(transparencyAnchorJson ? { transparencyAnchorJson } : {}),
    witnessEndpointsFile,
    ...(witnessEndpointsJson ? { witnessEndpointsJson } : {}),
    preExecutionProofMode,
    allowSelfAssertedPrincipals,
    requireExternalAnchor: preExecutionProofMode === 'evm-anchor',
    anchorConfirmations,
    databaseUrl: databaseUrl(environment.DATABASE_URL, 'DATABASE_URL'),
    databaseDirectUrl: databaseUrl(environment.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED'),
    databaseBackend: databaseBackendValue(environment.PRIORSEAL_DATABASE_BACKEND),
    corsOrigins: corsOrigins(environment.PRIORSEAL_CORS_ORIGINS),
    trustProxy: booleanValue(environment.PRIORSEAL_TRUST_PROXY, 'PRIORSEAL_TRUST_PROXY', false),
    x402,
    ...(selfserveClaim ? { selfserveClaim } : {}),
    ...(guardedJupiter ? { guardedJupiter } : {}),
    ...(guardedZeroEx ? { guardedZeroEx } : {}),
  };
  if (runtimeEnvironment === 'production' || runtimeEnvironment === 'staging') {
    validateDeploymentConfig(config, runtimeEnvironment);
  }
  return config;
}

function guardedZeroExConfig(environment: RuntimeEnvironmentInput): { zeroExApiKey: string; insightApiKey: string; rpcUrl: string; policy: GuardedZeroExDeploymentPolicy; responseSignature: ZeroExResponseSignatureConfiguration; tenantPolicies?: GuardedZeroExTenantPolicySet; zeroExBaseUrl?: string; insightBaseUrl?: string } | undefined {
  const zeroExApiKey = optionalValue(environment.ZEROEX_API_KEY);
  const insightApiKey = optionalValue(environment.INSIGHT_API_KEY);
  const rpcUrl = optionalValue(environment.PRIORSEAL_ZEROEX_RPC_URL);
  const policy = optionalJson(environment.PRIORSEAL_ZEROEX_POLICY_JSON, 'PRIORSEAL_ZEROEX_POLICY_JSON');
  const responseSignatureConfig = optionalJson(environment.PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON, 'PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON');
  const tenantPolicyConfig = optionalJson(environment.PRIORSEAL_ZEROEX_TENANTS_JSON, 'PRIORSEAL_ZEROEX_TENANTS_JSON');
  if (!zeroExApiKey && !rpcUrl && !policy && !responseSignatureConfig && !tenantPolicyConfig) return undefined; // INSIGHT_API_KEY may belong to Jupiter alone.
  if (!zeroExApiKey || !insightApiKey || !rpcUrl || !policy || !responseSignatureConfig) throw new TypeError('Guarded 0x swaps require ZEROEX_API_KEY, INSIGHT_API_KEY, PRIORSEAL_ZEROEX_RPC_URL, PRIORSEAL_ZEROEX_POLICY_JSON, and PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON together');
  if (!rpcUrl || new URL(rpcUrl).protocol !== 'https:') throw new TypeError('PRIORSEAL_ZEROEX_RPC_URL must use HTTPS');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('PRIORSEAL_ZEROEX_POLICY_JSON must be an object');
  const responseSignature = parseZeroExResponseSignatureConfiguration(responseSignatureConfig);
  const tenantPolicies = parseGuardedZeroExTenantPolicySet(tenantPolicyConfig, policy as GuardedZeroExDeploymentPolicy);
  return {
    zeroExApiKey: zeroExApiKey!, insightApiKey: insightApiKey!, rpcUrl,
    policy: policy as GuardedZeroExDeploymentPolicy, responseSignature,
    ...(tenantPolicies ? { tenantPolicies } : {}),
    ...(optionalValue(environment.PRIORSEAL_ZEROEX_ROUTER_BASE_URL) ? { zeroExBaseUrl: optionalValue(environment.PRIORSEAL_ZEROEX_ROUTER_BASE_URL) } : {}),
    ...(optionalValue(environment.PRIORSEAL_ZEROEX_INSIGHT_BASE_URL) ? { insightBaseUrl: optionalValue(environment.PRIORSEAL_ZEROEX_INSIGHT_BASE_URL) } : {}),
  };
}

/**
 * Self-serve funding claims piggyback on the agent meter and x402 payTo:
 * they activate only when metered credits, an EVM payTo, Base mainnet RPC,
 * and an issuer key (for the credential derivation secret) are all present.
 */
function selfserveClaimConfig(environment: RuntimeEnvironmentInput, agentMeter: ReturnType<typeof parseAgentMeterConfig>, privateKeyPem: string | undefined): SelfserveClaimConfig | undefined {
  if (!agentMeter || !privateKeyPem) return undefined;
  const payTo = addressValue(environment.PRIORSEAL_X402_PAY_TO);
  const rpcBase = optionalValue(environment.PRIORSEAL_RPC_BASE);
  if (!payTo || !rpcBase) return undefined;
  const fraction = agentMeter.creditUnitUsd.split('.')[1] ?? '';
  if (fraction.length > 6) throw new TypeError('PRIORSEAL_AGENT_METER_JSON creditUnitUsd precision exceeds USDC raw units');
  return {
    schema: 'priorseal.selfserve-claim.v1',
    chainId: SELFSEEK_BASE_MAINNET_CHAIN_ID,
    payTo: payTo.toLowerCase(),
    usdcAddress: SELFSEEK_BASE_MAINNET_USDC,
    minRawUnits: 1_000_000n,
    rawUnitsPerCredit: 10n ** BigInt(6 - fraction.length),
    credentialKeyHex: createHash('sha256').update(`priorseal-selfserve-credential-v1:${privateKeyPem}`, 'utf8').digest('hex'),
  };
}

function addressValue(value: unknown) {
  const address = optionalValue(value);
  if (!address) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) throw new TypeError('PRIORSEAL_X402_PAY_TO must be a non-zero address');
  return address;
}

function guardedJupiterConfig(environment: RuntimeEnvironmentInput): { jupiterApiKey: string; insightApiKey: string; rpcUrl: string; policy: GuardedJupiterDeploymentPolicy; jupiterBaseUrl?: string; insightBaseUrl?: string } | undefined {
  const jupiterApiKey = optionalValue(environment.JUPITER_API_KEY);
  const insightApiKey = optionalValue(environment.INSIGHT_API_KEY);
  const rpcUrl = optionalValue(environment.PRIORSEAL_JUPITER_RPC_URL);
  const policy = optionalJson(environment.PRIORSEAL_JUPITER_POLICY_JSON, 'PRIORSEAL_JUPITER_POLICY_JSON');
  const platformFeeBps = optionalValue(environment.PRIORSEAL_JUPITER_PLATFORM_FEE_BPS);
  const feeAccount = optionalValue(environment.PRIORSEAL_JUPITER_FEE_ACCOUNT);
  const jupiterConfigured = [jupiterApiKey, rpcUrl, policy].filter(Boolean).length;
  if (Boolean(platformFeeBps) !== Boolean(feeAccount)) throw new TypeError('PRIORSEAL_JUPITER_PLATFORM_FEE_BPS and PRIORSEAL_JUPITER_FEE_ACCOUNT must be configured together');
  if ((platformFeeBps || feeAccount) && jupiterConfigured === 0) throw new TypeError('Jupiter platform fees require the complete guarded Jupiter configuration');
  if (jupiterConfigured === 0) return undefined; // INSIGHT_API_KEY may belong to 0x alone.
  if (!jupiterApiKey || !insightApiKey || !rpcUrl || !policy) throw new TypeError('Guarded Jupiter swaps require JUPITER_API_KEY, INSIGHT_API_KEY, PRIORSEAL_JUPITER_RPC_URL, and PRIORSEAL_JUPITER_POLICY_JSON together');
  if (!rpcUrl || new URL(rpcUrl).protocol !== 'https:') throw new TypeError('PRIORSEAL_JUPITER_RPC_URL must use HTTPS');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('PRIORSEAL_JUPITER_POLICY_JSON must be an object');
  if ('platformFee' in policy) throw new TypeError('Configure the guarded Jupiter platform fee with PRIORSEAL_JUPITER_PLATFORM_FEE_BPS and PRIORSEAL_JUPITER_FEE_ACCOUNT, not PRIORSEAL_JUPITER_POLICY_JSON');
  let platformFee: GuardedJupiterDeploymentPolicy['platformFee'];
  if (platformFeeBps && feeAccount) {
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(platformFeeBps)) throw new TypeError(`PRIORSEAL_JUPITER_PLATFORM_FEE_BPS must be an integer from 1 through ${MAX_JUPITER_PLATFORM_FEE_BPS}`);
    if (!isSolanaPublicKey(feeAccount)) throw new TypeError('PRIORSEAL_JUPITER_FEE_ACCOUNT must be a Solana public key');
    const merchant = optionalValue(environment.PRIORSEAL_X402_SOLANA_PAY_TO);
    if (!isSolanaPublicKey(merchant)) throw new TypeError('PRIORSEAL_X402_SOLANA_PAY_TO must be a Solana public key when a Jupiter platform fee is enabled');
    platformFee = { feeBps: Number(platformFeeBps), feeAccount, feeMint: SOLANA_USDC_MINT, merchant };
  }
  return {
    jupiterApiKey: jupiterApiKey!, insightApiKey: insightApiKey!, rpcUrl,
    policy: { ...(policy as GuardedJupiterDeploymentPolicy), ...(platformFee ? { platformFee } : {}) },
    ...(optionalValue(environment.PRIORSEAL_JUPITER_ROUTER_BASE_URL) ? { jupiterBaseUrl: optionalValue(environment.PRIORSEAL_JUPITER_ROUTER_BASE_URL) } : {}),
    ...(optionalValue(environment.PRIORSEAL_JUPITER_INSIGHT_BASE_URL) ? { insightBaseUrl: optionalValue(environment.PRIORSEAL_JUPITER_INSIGHT_BASE_URL) } : {}),
  };
}

function parseSafe4337Trust(value: unknown): { chainId: number; version: '0.6' | '0.7' | '0.8' | '0.9'; entryPointAddress: string; moduleAddress: string; moduleCodeHash: string; safeProxyCodeHash: string; safeSingletonCodeHash: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('PRIORSEAL_SAFE_4337_TRUST_JSON must be an array with at most 64 entries');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'chainId,entryPointAddress,moduleAddress,moduleCodeHash,safeProxyCodeHash,safeSingletonCodeHash,version') throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid shape`);
    const candidate = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid chainId`);
    if (!['0.6', '0.7', '0.8', '0.9'].includes(String(candidate.version))) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an unsupported version`);
    if (typeof candidate.moduleAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(candidate.moduleAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid moduleAddress`);
    if (typeof candidate.entryPointAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(candidate.entryPointAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid entryPointAddress`);
    for (const field of ['moduleCodeHash', 'safeProxyCodeHash', 'safeSingletonCodeHash']) if (typeof candidate[field] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(candidate[field] as string)) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid ${field}`);
    const normalized = { chainId: Number(candidate.chainId), version: candidate.version as '0.6' | '0.7' | '0.8' | '0.9', entryPointAddress: candidate.entryPointAddress.toLowerCase(), moduleAddress: candidate.moduleAddress.toLowerCase(), moduleCodeHash: (candidate.moduleCodeHash as string).toLowerCase(), safeProxyCodeHash: (candidate.safeProxyCodeHash as string).toLowerCase(), safeSingletonCodeHash: (candidate.safeSingletonCodeHash as string).toLowerCase() };
    const key = `${normalized.chainId}:${normalized.version}`;
    if (seen.has(key)) throw new TypeError(`Safe ERC-4337 trust entry ${index} duplicates a previous chain/version`);
    seen.add(key);
    return normalized;
  });
}

function parseErc4337EntryPoints(value: unknown): { chainId: number; version: '0.6' | '0.7' | '0.8' | '0.9'; address: string; codeHash: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('PRIORSEAL_ERC4337_ENTRY_POINTS_JSON must be an array with at most 64 entries');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'address,chainId,codeHash,version') throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid shape`);
    const candidate = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid chainId`);
    if (!['0.6', '0.7', '0.8', '0.9'].includes(String(candidate.version))) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an unsupported version`);
    if (typeof candidate.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(candidate.address)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid address`);
    if (typeof candidate.codeHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(candidate.codeHash)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid codeHash`);
    const normalized = { chainId: Number(candidate.chainId), version: candidate.version as '0.6' | '0.7' | '0.8' | '0.9', address: candidate.address.toLowerCase(), codeHash: candidate.codeHash.toLowerCase() };
    const key = `${normalized.chainId}:${normalized.version}:${normalized.address}`;
    if (seen.has(key)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} duplicates a previous entry`);
    seen.add(key);
    return normalized;
  });
}

function parseEip7702DelegateTrust(value: unknown): { chainId: number; address: string; codeHash: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON must be an array with at most 64 entries');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'address,chainId,codeHash') throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid shape`);
    const candidate = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid chainId`);
    if (typeof candidate.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(candidate.address) || /^0x0{40}$/i.test(candidate.address)) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid address`);
    if (typeof candidate.codeHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(candidate.codeHash)) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid codeHash`);
    const normalized = { chainId: Number(candidate.chainId), address: candidate.address.toLowerCase(), codeHash: candidate.codeHash.toLowerCase() };
    const key = `${normalized.chainId}:${normalized.address}`;
    if (seen.has(key)) throw new TypeError(`EIP-7702 delegate trust entry ${index} duplicates a previous chain/address`);
    seen.add(key);
    return normalized;
  });
}

function databaseBackendValue(value: unknown): 'postgresql' | 'd1' {
  const backend = optionalValue(value) ?? 'postgresql';
  if (backend !== 'postgresql' && backend !== 'd1') throw new TypeError('PRIORSEAL_DATABASE_BACKEND must be postgresql or d1');
  return backend;
}

function databaseUrl(value: unknown, name: string) {
  const url = optionalValue(value);
  if (!url) return undefined;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${name} must be a PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new TypeError(`${name} must be a PostgreSQL connection URL`);
  }
  if (['prefer', 'require', 'verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')) parsed.searchParams.set('sslmode', 'verify-full');
  return parsed.toString();
}

function optionalValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPem(value: unknown) {
  const pem = optionalValue(value);
  if (!pem) return undefined;
  return pem.includes('\\n') && !pem.includes('\n') ? pem.replaceAll('\\n', '\n') : pem;
}

function optionalJson(value: unknown, name: string): unknown {
  const json = optionalValue(value);
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { throw new TypeError(`${name} must be valid JSON`); }
}

function runtimeValue(value: unknown) {
  const runtime = optionalValue(value) ?? 'node';
  if (!['node', 'cloudflare-workers'].includes(runtime)) throw new TypeError('PRIORSEAL_RUNTIME must be node or cloudflare-workers');
  return runtime;
}

function environmentValue(value: unknown) {
  const environment = optionalValue(value) ?? 'development';
  if (!['development', 'test', 'production', 'staging'].includes(environment)) throw new TypeError('PRIORSEAL_ENVIRONMENT must be development, test, or production (or staging)');
  return environment;
}

type ProductionConfig = {
  databaseUrl?: string; databaseDirectUrl?: string; databaseBackend?: string; runtime?: string;
  privateKeyFile?: string; publicKeyFile?: string; privateKeyPem?: string; publicKeyPem?: string;
  keyId: string; buildVersion: string; policyFile?: string; policyJson?: unknown;
  issuer: string; authorizationAudience: string; preExecutionProofMode: string;
  witnessEndpointsFile?: string; witnessEndpointsJson?: unknown;
  transparencyAnchorFile?: string; transparencyAnchorJson?: unknown; corsOrigins: string[];
  x402?: { networksExplicitlyConfigured: boolean; testnetNetworksEnabled: boolean };
};
function validateDeploymentConfig(config: ProductionConfig, environment: 'production' | 'staging') {
  const label = environment === 'production' ? 'Production' : 'Staging';
  if (config.databaseBackend !== 'd1' && !config.databaseUrl) throw new TypeError(`${label} requires a database connection`);
  if ((config.runtime ?? 'node') === 'node' && !config.databaseDirectUrl) throw new TypeError(`${label} Node runtime requires DATABASE_URL_UNPOOLED`);
  if (!(config.privateKeyFile && config.publicKeyFile) && !(config.privateKeyPem && config.publicKeyPem)) throw new TypeError(`${label} requires issuer signing keys`);
  if (config.keyId === 'default') throw new TypeError(`${label} requires a deployment-specific PRIORSEAL_KEY_ID`);
  if (config.buildVersion === 'dev') throw new TypeError(`${label} requires PRIORSEAL_BUILD_VERSION`);
  if (!config.policyFile && !config.policyJson) throw new TypeError(`${label} requires an authorization policy`);
  if (config.issuer === 'priorseal-local' || config.authorizationAudience === 'priorseal') throw new TypeError(`${label} requires deployment-specific issuer and authorization audience values`);
  if (config.preExecutionProofMode === 'issuer') throw new TypeError(`${label} requires rfc3161, witness-quorum, or evm-anchor pre-execution proof`);
  if (config.preExecutionProofMode === 'witness-quorum' && !config.witnessEndpointsFile && !config.witnessEndpointsJson) throw new TypeError(`${label} witness-quorum mode requires witness endpoints`);
  if (config.preExecutionProofMode === 'evm-anchor' && !config.transparencyAnchorFile && !config.transparencyAnchorJson) throw new TypeError(`${label} evm-anchor mode requires a transparency anchor`);
  if (environment === 'production' && !config.corsOrigins.length) throw new TypeError('Production requires at least one non-localhost CORS origin');
  if (config.corsOrigins.some((origin: string) => new URL(origin).hostname === 'localhost')) throw new TypeError(`${label} requires non-localhost CORS origins`);
  if (config.x402 && !config.x402.networksExplicitlyConfigured) throw new TypeError(`${label} requires an explicit PRIORSEAL_X402_NETWORKS allowlist when x402 is enabled`);
  if (environment === 'production' && config.x402?.testnetNetworksEnabled) throw new TypeError('Production cannot enable x402 testnet payment rails');
}

function proofModeValue(value: unknown, legacyAnchor: unknown, environment: string) {
  const explicit = optionalValue(value);
  if (explicit && !['issuer', 'rfc3161', 'witness-quorum', 'evm-anchor'].includes(explicit)) throw new TypeError('PRIORSEAL_PREEXECUTION_PROOF_MODE must be issuer, rfc3161, witness-quorum, or evm-anchor');
  if (explicit) return explicit;
  if (booleanValue(legacyAnchor, 'PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR', false)) return 'evm-anchor';
  if (environment === 'production' || environment === 'staging') {
    const label = environment === 'production' ? 'Production' : 'Staging';
    throw new TypeError(`${label} requires explicit PRIORSEAL_PREEXECUTION_PROOF_MODE`);
  }
  return 'issuer';
}

function portValue(value: unknown) {
  const port = Number(optionalValue(value) ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function confirmationValue(value: unknown) {
  const confirmations = Number(optionalValue(value) ?? 12);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 10_000) throw new TypeError('PRIORSEAL_ANCHOR_CONFIRMATIONS must be an integer between 1 and 10000');
  return confirmations;
}

function identifierValue(value: unknown, name: string, fallback: string) {
  const identifier = optionalValue(value) ?? fallback;
  if (!IDENTIFIER.test(identifier)) throw new TypeError(`${name} must be a 1-128 character protocol identifier`);
  return identifier;
}

function booleanValue(value: unknown, name: string, fallback: boolean) {
  const normalized = optionalValue(value);
  if (normalized === undefined) return fallback;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new TypeError(`${name} must be true or false`);
}

function corsOrigins(value: unknown) {
  const origins = (optionalValue(value) ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...new Set(origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError(`PRIORSEAL_CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new TypeError(`PRIORSEAL_CORS_ORIGINS must contain origins without paths: ${origin}`);
    }
    return parsed.origin;
  }))];
}
