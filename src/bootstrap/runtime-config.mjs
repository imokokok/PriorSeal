const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Converts environment input into a validated runtime configuration.
 * Keep environment parsing at the composition root; domain and interface modules
 * receive explicit values rather than reading process.env themselves.
 */
export function loadRuntimeConfig(environment = process.env) {
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
  if (Boolean(privateKeyFile) !== Boolean(publicKeyFile)) {
    throw new TypeError('PRIORSEAL_PRIVATE_KEY_FILE and PRIORSEAL_PUBLIC_KEY_FILE must be configured together');
  }
  if (Boolean(privateKeyPem) !== Boolean(publicKeyPem)) {
    throw new TypeError('PRIORSEAL_PRIVATE_KEY_PEM and PRIORSEAL_PUBLIC_KEY_PEM must be configured together');
  }
  if (privateKeyFile && privateKeyPem) throw new TypeError('Configure issuer keys as files or inline PEM secrets, not both');

  const preExecutionProofMode = proofModeValue(environment.PRIORSEAL_PREEXECUTION_PROOF_MODE, environment.PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR, runtimeEnvironment);
  const allowSelfAssertedPrincipals = booleanValue(environment.PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS, 'PRIORSEAL_ALLOW_SELF_ASSERTED_PRINCIPALS', false);
  const config = {
    environment: runtimeEnvironment,
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
    databaseUrl: databaseUrl(environment.DATABASE_URL, 'DATABASE_URL'),
    databaseDirectUrl: databaseUrl(environment.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED'),
    corsOrigins: corsOrigins(environment.PRIORSEAL_CORS_ORIGINS),
    trustProxy: booleanValue(environment.PRIORSEAL_TRUST_PROXY, 'PRIORSEAL_TRUST_PROXY', false),
  };
  if (runtimeEnvironment === 'production') validateProductionConfig(config);
  return config;
}

function databaseUrl(value, name) {
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
  if (['prefer', 'require', 'verify-ca'].includes(parsed.searchParams.get('sslmode'))) parsed.searchParams.set('sslmode', 'verify-full');
  return parsed.toString();
}

function optionalValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPem(value) {
  const pem = optionalValue(value);
  if (!pem) return undefined;
  return pem.includes('\\n') && !pem.includes('\n') ? pem.replaceAll('\\n', '\n') : pem;
}

function optionalJson(value, name) {
  const json = optionalValue(value);
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { throw new TypeError(`${name} must be valid JSON`); }
}

function runtimeValue(value) {
  const runtime = optionalValue(value) ?? 'node';
  if (!['node', 'cloudflare-workers'].includes(runtime)) throw new TypeError('PRIORSEAL_RUNTIME must be node or cloudflare-workers');
  return runtime;
}

function environmentValue(value) {
  const environment = optionalValue(value) ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) throw new TypeError('PRIORSEAL_ENVIRONMENT must be development, test, or production');
  return environment;
}

function validateProductionConfig(config) {
  if (!config.databaseUrl) throw new TypeError('Production requires a database connection');
  if ((config.runtime ?? 'node') === 'node' && !config.databaseDirectUrl) throw new TypeError('Production Node runtime requires DATABASE_URL_UNPOOLED');
  if (!(config.privateKeyFile && config.publicKeyFile) && !(config.privateKeyPem && config.publicKeyPem)) throw new TypeError('Production requires issuer signing keys');
  if (config.keyId === 'default') throw new TypeError('Production requires a deployment-specific PRIORSEAL_KEY_ID');
  if (config.buildVersion === 'dev') throw new TypeError('Production requires PRIORSEAL_BUILD_VERSION');
  if (!config.policyFile && !config.policyJson) throw new TypeError('Production requires an authorization policy');
  if (config.issuer === 'priorseal-local' || config.authorizationAudience === 'priorseal') throw new TypeError('Production requires deployment-specific issuer and authorization audience values');
  if (config.preExecutionProofMode === 'issuer') throw new TypeError('Production requires rfc3161, witness-quorum, or evm-anchor pre-execution proof');
  if (config.preExecutionProofMode === 'witness-quorum' && !config.witnessEndpointsFile && !config.witnessEndpointsJson) throw new TypeError('Production witness-quorum mode requires witness endpoints');
  if (!config.corsOrigins.length || config.corsOrigins.some((origin) => new URL(origin).hostname === 'localhost')) throw new TypeError('Production requires at least one non-localhost CORS origin');
}

function proofModeValue(value, legacyAnchor, environment) {
  const explicit = optionalValue(value);
  if (explicit && !['issuer', 'rfc3161', 'witness-quorum', 'evm-anchor'].includes(explicit)) throw new TypeError('PRIORSEAL_PREEXECUTION_PROOF_MODE must be issuer, rfc3161, witness-quorum, or evm-anchor');
  if (explicit) return explicit;
  if (booleanValue(legacyAnchor, 'PRIORSEAL_REQUIRE_EXTERNAL_ANCHOR', false)) return 'evm-anchor';
  if (environment === 'production') throw new TypeError('Production requires explicit PRIORSEAL_PREEXECUTION_PROOF_MODE');
  return 'issuer';
}

function portValue(value) {
  const port = Number(optionalValue(value) ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function identifierValue(value, name, fallback) {
  const identifier = optionalValue(value) ?? fallback;
  if (!IDENTIFIER.test(identifier)) throw new TypeError(`${name} must be a 1-128 character protocol identifier`);
  return identifier;
}

function booleanValue(value, name, fallback) {
  const normalized = optionalValue(value);
  if (normalized === undefined) return fallback;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new TypeError(`${name} must be true or false`);
}

function corsOrigins(value) {
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
