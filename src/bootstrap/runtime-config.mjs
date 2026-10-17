// Generated from runtime-config.mts by npm run core:build. Do not edit directly.
import { createArchiveAccess } from "../application/archive/evidence-archive.mjs";
import { parseX402Config } from "../infrastructure/payments/x402-exact-evm.mjs";
import { parseAgentMeterConfig } from "../application/commerce/agent-meter.mjs";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function loadRuntimeConfig(environment = process.env) {
  const runtimeEnvironment = environmentValue(environment.PRIORSEAL_ENVIRONMENT);
  const runtime = runtimeValue(environment.PRIORSEAL_RUNTIME);
  const privateKeyFile = optionalValue(environment.PRIORSEAL_PRIVATE_KEY_FILE);
  const publicKeyFile = optionalValue(environment.PRIORSEAL_PUBLIC_KEY_FILE);
  const privateKeyPem = optionalPem(environment.PRIORSEAL_PRIVATE_KEY_PEM);
  const publicKeyPem = optionalPem(environment.PRIORSEAL_PUBLIC_KEY_PEM);
  const keyRegistryFile = optionalValue(environment.PRIORSEAL_KEY_REGISTRY_FILE);
  const keyRegistryJson = optionalJson(environment.PRIORSEAL_KEY_REGISTRY_JSON, "PRIORSEAL_KEY_REGISTRY_JSON");
  const policyFile = optionalValue(environment.PRIORSEAL_POLICY_FILE);
  const policyJson = optionalJson(environment.PRIORSEAL_POLICY_JSON, "PRIORSEAL_POLICY_JSON");
  const transparencyAnchorFile = optionalValue(environment.PRIORSEAL_TRANSPARENCY_ANCHOR_FILE);
  const transparencyAnchorJson = optionalJson(environment.PRIORSEAL_TRANSPARENCY_ANCHOR_JSON, "PRIORSEAL_TRANSPARENCY_ANCHOR_JSON");
  const witnessEndpointsFile = optionalValue(environment.PRIORSEAL_WITNESS_ENDPOINTS_FILE);
  const witnessEndpointsJson = optionalJson(environment.PRIORSEAL_WITNESS_ENDPOINTS_JSON, "PRIORSEAL_WITNESS_ENDPOINTS_JSON");
  const archiveCredentials = optionalJson(environment.PRIORSEAL_ARCHIVE_CREDENTIALS_JSON, "PRIORSEAL_ARCHIVE_CREDENTIALS_JSON");
  const agentMeter = parseAgentMeterConfig(optionalJson(environment.PRIORSEAL_AGENT_METER_JSON, "PRIORSEAL_AGENT_METER_JSON"));
  const erc4337EntryPoints = parseErc4337EntryPoints(optionalJson(environment.PRIORSEAL_ERC4337_ENTRY_POINTS_JSON, "PRIORSEAL_ERC4337_ENTRY_POINTS_JSON"));
  const eip7702Delegates = parseEip7702DelegateTrust(optionalJson(environment.PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON, "PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON"));
  const safe4337Trust = parseSafe4337Trust(optionalJson(environment.PRIORSEAL_SAFE_4337_TRUST_JSON, "PRIORSEAL_SAFE_4337_TRUST_JSON"));
  const x402 = parseX402Config(environment);
  for (const profile of safe4337Trust) {
    if (!erc4337EntryPoints.some((entry) => entry.chainId === profile.chainId && entry.version === profile.version && entry.address === profile.entryPointAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${profile.chainId}:${profile.version} requires a matching configured EntryPoint address`);
  }
  createArchiveAccess(archiveCredentials);
  const anchorConfirmations = confirmationValue(environment.PRIORSEAL_ANCHOR_CONFIRMATIONS);
  if (Boolean(privateKeyFile) !== Boolean(publicKeyFile)) {
    throw new TypeError("PRIORSEAL_PRIVATE_KEY_FILE and PRIORSEAL_PUBLIC_KEY_FILE must be configured together");
  }
  if (Boolean(privateKeyPem) !== Boolean(publicKeyPem)) {
    throw new TypeError("PRIORSEAL_PRIVATE_KEY_PEM and PRIORSEAL_PUBLIC_KEY_PEM must be configured together");
  }
  if (privateKeyFile && privateKeyPem) throw new TypeError("Configure issuer keys as files or inline PEM secrets, not both");
  if (keyRegistryFile && keyRegistryJson) throw new TypeError("Configure the key registry as a file or inline JSON, not both");
  if (policyFile && policyJson) throw new TypeError("Configure the authorization policy as a file or inline JSON, not both");
  if (transparencyAnchorFile && transparencyAnchorJson) throw new TypeError("Configure the transparency anchor as a file or inline JSON, not both");
  if (witnessEndpointsFile && witnessEndpointsJson) throw new TypeError("Configure witness endpoints as a file or inline JSON, not both");
  const preExecutionProofMode = proofModeValue(environment.PRIORSEAL_PREEXECUTION_PROOF_MODE, environment.PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR, runtimeEnvironment);
  const allowSelfAssertedPrincipals = booleanValue(environment.PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS, "PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS", false);
  const config = {
    environment: runtimeEnvironment,
    ...archiveCredentials ? { archiveCredentials } : {},
    ...agentMeter ? { agentMeter } : {},
    erc4337EntryPoints,
    eip7702Delegates,
    safe4337Trust,
    ...runtime !== "node" ? { runtime } : {},
    port: portValue(environment.PORT),
    issuer: identifierValue(environment.PRIORSEAL_ISSUER, "PRIORSEAL_ISSUER", "priorseal-local"),
    keyId: identifierValue(environment.PRIORSEAL_KEY_ID, "PRIORSEAL_KEY_ID", "default"),
    buildVersion: identifierValue(environment.PRIORSEAL_BUILD_VERSION, "PRIORSEAL_BUILD_VERSION", "dev"),
    authorizationAudience: identifierValue(environment.PRIORSEAL_AUTHORIZATION_AUDIENCE, "PRIORSEAL_AUTHORIZATION_AUDIENCE", "priorseal"),
    privateKeyFile,
    publicKeyFile,
    ...privateKeyPem ? { privateKeyPem, publicKeyPem } : {},
    keyRegistryFile,
    ...keyRegistryJson ? { keyRegistryJson } : {},
    policyFile,
    ...policyJson ? { policyJson } : {},
    transparencyAnchorFile,
    ...transparencyAnchorJson ? { transparencyAnchorJson } : {},
    witnessEndpointsFile,
    ...witnessEndpointsJson ? { witnessEndpointsJson } : {},
    preExecutionProofMode,
    allowSelfAssertedPrincipals,
    requireExternalAnchor: preExecutionProofMode === "evm-anchor",
    anchorConfirmations,
    databaseUrl: databaseUrl(environment.DATABASE_URL, "DATABASE_URL"),
    databaseDirectUrl: databaseUrl(environment.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED"),
    databaseBackend: databaseBackendValue(environment.PRIORSEAL_DATABASE_BACKEND),
    corsOrigins: corsOrigins(environment.PRIORSEAL_CORS_ORIGINS),
    trustProxy: booleanValue(environment.PRIORSEAL_TRUST_PROXY, "PRIORSEAL_TRUST_PROXY", false),
    x402
  };
  if (runtimeEnvironment === "production" || runtimeEnvironment === "staging") {
    validateDeploymentConfig(config, runtimeEnvironment);
  }
  return config;
}
function parseSafe4337Trust(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("PRIORSEAL_SAFE_4337_TRUST_JSON must be an array with at most 64 entries");
  const seen = /* @__PURE__ */ new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "chainId,entryPointAddress,moduleAddress,moduleCodeHash,safeProxyCodeHash,safeSingletonCodeHash,version") throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid shape`);
    const candidate = entry;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid chainId`);
    if (!["0.6", "0.7", "0.8", "0.9"].includes(String(candidate.version))) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an unsupported version`);
    if (typeof candidate.moduleAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(candidate.moduleAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid moduleAddress`);
    if (typeof candidate.entryPointAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(candidate.entryPointAddress)) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid entryPointAddress`);
    for (const field of ["moduleCodeHash", "safeProxyCodeHash", "safeSingletonCodeHash"]) if (typeof candidate[field] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate[field])) throw new TypeError(`Safe ERC-4337 trust entry ${index} has an invalid ${field}`);
    const normalized = { chainId: Number(candidate.chainId), version: candidate.version, entryPointAddress: candidate.entryPointAddress.toLowerCase(), moduleAddress: candidate.moduleAddress.toLowerCase(), moduleCodeHash: candidate.moduleCodeHash.toLowerCase(), safeProxyCodeHash: candidate.safeProxyCodeHash.toLowerCase(), safeSingletonCodeHash: candidate.safeSingletonCodeHash.toLowerCase() };
    const key = `${normalized.chainId}:${normalized.version}`;
    if (seen.has(key)) throw new TypeError(`Safe ERC-4337 trust entry ${index} duplicates a previous chain/version`);
    seen.add(key);
    return normalized;
  });
}
function parseErc4337EntryPoints(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("PRIORSEAL_ERC4337_ENTRY_POINTS_JSON must be an array with at most 64 entries");
  const seen = /* @__PURE__ */ new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "address,chainId,codeHash,version") throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid shape`);
    const candidate = entry;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid chainId`);
    if (!["0.6", "0.7", "0.8", "0.9"].includes(String(candidate.version))) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an unsupported version`);
    if (typeof candidate.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(candidate.address)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid address`);
    if (typeof candidate.codeHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.codeHash)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} has an invalid codeHash`);
    const normalized = { chainId: Number(candidate.chainId), version: candidate.version, address: candidate.address.toLowerCase(), codeHash: candidate.codeHash.toLowerCase() };
    const key = `${normalized.chainId}:${normalized.version}:${normalized.address}`;
    if (seen.has(key)) throw new TypeError(`ERC-4337 EntryPoint entry ${index} duplicates a previous entry`);
    seen.add(key);
    return normalized;
  });
}
function parseEip7702DelegateTrust(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON must be an array with at most 64 entries");
  const seen = /* @__PURE__ */ new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "address,chainId,codeHash") throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid shape`);
    const candidate = entry;
    if (!Number.isSafeInteger(candidate.chainId) || Number(candidate.chainId) < 1) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid chainId`);
    if (typeof candidate.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(candidate.address) || /^0x0{40}$/i.test(candidate.address)) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid address`);
    if (typeof candidate.codeHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.codeHash)) throw new TypeError(`EIP-7702 delegate trust entry ${index} has an invalid codeHash`);
    const normalized = { chainId: Number(candidate.chainId), address: candidate.address.toLowerCase(), codeHash: candidate.codeHash.toLowerCase() };
    const key = `${normalized.chainId}:${normalized.address}`;
    if (seen.has(key)) throw new TypeError(`EIP-7702 delegate trust entry ${index} duplicates a previous chain/address`);
    seen.add(key);
    return normalized;
  });
}
function databaseBackendValue(value) {
  const backend = optionalValue(value) ?? "postgresql";
  if (backend !== "postgresql" && backend !== "d1") throw new TypeError("PRIORSEAL_DATABASE_BACKEND must be postgresql or d1");
  return backend;
}
function databaseUrl(value, name) {
  const url = optionalValue(value);
  if (!url) return void 0;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${name} must be a PostgreSQL connection URL`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new TypeError(`${name} must be a PostgreSQL connection URL`);
  }
  if (["prefer", "require", "verify-ca"].includes(parsed.searchParams.get("sslmode") ?? "")) parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
function optionalValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function optionalPem(value) {
  const pem = optionalValue(value);
  if (!pem) return void 0;
  return pem.includes("\\n") && !pem.includes("\n") ? pem.replaceAll("\\n", "\n") : pem;
}
function optionalJson(value, name) {
  const json = optionalValue(value);
  if (!json) return void 0;
  try {
    return JSON.parse(json);
  } catch {
    throw new TypeError(`${name} must be valid JSON`);
  }
}
function runtimeValue(value) {
  const runtime = optionalValue(value) ?? "node";
  if (!["node", "cloudflare-workers"].includes(runtime)) throw new TypeError("PRIORSEAL_RUNTIME must be node or cloudflare-workers");
  return runtime;
}
function environmentValue(value) {
  const environment = optionalValue(value) ?? "development";
  if (!["development", "test", "production", "staging"].includes(environment)) throw new TypeError("PRIORSEAL_ENVIRONMENT must be development, test, or production (or staging)");
  return environment;
}
function validateDeploymentConfig(config, environment) {
  const label = environment === "production" ? "Production" : "Staging";
  if (config.databaseBackend !== "d1" && !config.databaseUrl) throw new TypeError(`${label} requires a database connection`);
  if ((config.runtime ?? "node") === "node" && !config.databaseDirectUrl) throw new TypeError(`${label} Node runtime requires DATABASE_URL_UNPOOLED`);
  if (!(config.privateKeyFile && config.publicKeyFile) && !(config.privateKeyPem && config.publicKeyPem)) throw new TypeError(`${label} requires issuer signing keys`);
  if (config.keyId === "default") throw new TypeError(`${label} requires a deployment-specific PRIORSEAL_KEY_ID`);
  if (config.buildVersion === "dev") throw new TypeError(`${label} requires PRIORSEAL_BUILD_VERSION`);
  if (!config.policyFile && !config.policyJson) throw new TypeError(`${label} requires an authorization policy`);
  if (config.issuer === "priorseal-local" || config.authorizationAudience === "priorseal") throw new TypeError(`${label} requires deployment-specific issuer and authorization audience values`);
  if (config.preExecutionProofMode === "issuer") throw new TypeError(`${label} requires rfc3161, witness-quorum, or evm-anchor pre-execution proof`);
  if (config.preExecutionProofMode === "witness-quorum" && !config.witnessEndpointsFile && !config.witnessEndpointsJson) throw new TypeError(`${label} witness-quorum mode requires witness endpoints`);
  if (config.preExecutionProofMode === "evm-anchor" && !config.transparencyAnchorFile && !config.transparencyAnchorJson) throw new TypeError(`${label} evm-anchor mode requires a transparency anchor`);
  if (environment === "production" && !config.corsOrigins.length) throw new TypeError("Production requires at least one non-localhost CORS origin");
  if (config.corsOrigins.some((origin) => new URL(origin).hostname === "localhost")) throw new TypeError(`${label} requires non-localhost CORS origins`);
  if (config.x402 && !config.x402.networksExplicitlyConfigured) throw new TypeError(`${label} requires an explicit PRIORSEAL_X402_NETWORKS allowlist when x402 is enabled`);
  if (environment === "production" && config.x402?.testnetNetworksEnabled) throw new TypeError("Production cannot enable x402 testnet payment rails");
}
function proofModeValue(value, legacyAnchor, environment) {
  const explicit = optionalValue(value);
  if (explicit && !["issuer", "rfc3161", "witness-quorum", "evm-anchor"].includes(explicit)) throw new TypeError("PRIORSEAL_PREEXECUTION_PROOF_MODE must be issuer, rfc3161, witness-quorum, or evm-anchor");
  if (explicit) return explicit;
  if (booleanValue(legacyAnchor, "PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR", false)) return "evm-anchor";
  if (environment === "production" || environment === "staging") {
    const label = environment === "production" ? "Production" : "Staging";
    throw new TypeError(`${label} requires explicit PRIORSEAL_PREEXECUTION_PROOF_MODE`);
  }
  return "issuer";
}
function portValue(value) {
  const port = Number(optionalValue(value) ?? 3e3);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("PORT must be an integer between 1 and 65535");
  }
  return port;
}
function confirmationValue(value) {
  const confirmations = Number(optionalValue(value) ?? 12);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1e4) throw new TypeError("PRIORSEAL_ANCHOR_CONFIRMATIONS must be an integer between 1 and 10000");
  return confirmations;
}
function identifierValue(value, name, fallback) {
  const identifier = optionalValue(value) ?? fallback;
  if (!IDENTIFIER.test(identifier)) throw new TypeError(`${name} must be a 1-128 character protocol identifier`);
  return identifier;
}
function booleanValue(value, name, fallback) {
  const normalized = optionalValue(value);
  if (normalized === void 0) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new TypeError(`${name} must be true or false`);
}
function corsOrigins(value) {
  const origins = (optionalValue(value) ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return [...new Set(origins.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError(`PRIORSEAL_CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new TypeError(`PRIORSEAL_CORS_ORIGINS must contain origins without paths: ${origin}`);
    }
    return parsed.origin;
  }))];
}
export {
  loadRuntimeConfig
};
