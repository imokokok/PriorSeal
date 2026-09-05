const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Converts environment input into a validated runtime configuration.
 * Keep environment parsing at the composition root; domain and interface modules
 * receive explicit values rather than reading process.env themselves.
 */
export function loadRuntimeConfig(environment = process.env) {
  const privateKeyFile = optionalValue(environment.RUNPROOF_PRIVATE_KEY_FILE);
  const publicKeyFile = optionalValue(environment.RUNPROOF_PUBLIC_KEY_FILE);
  if (Boolean(privateKeyFile) !== Boolean(publicKeyFile)) {
    throw new TypeError('RUNPROOF_PRIVATE_KEY_FILE and RUNPROOF_PUBLIC_KEY_FILE must be configured together');
  }

  return {
    port: portValue(environment.PORT),
    issuer: identifierValue(environment.RUNPROOF_ISSUER, 'RUNPROOF_ISSUER', 'runproof-local'),
    keyId: identifierValue(environment.RUNPROOF_KEY_ID, 'RUNPROOF_KEY_ID', 'default'),
    privateKeyFile,
    publicKeyFile,
    databaseUrl: databaseUrl(environment.DATABASE_URL, 'DATABASE_URL'),
    databaseDirectUrl: databaseUrl(environment.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED'),
    corsOrigins: corsOrigins(environment.RUNPROOF_CORS_ORIGINS),
    trustProxy: booleanValue(environment.RUNPROOF_TRUST_PROXY, 'RUNPROOF_TRUST_PROXY', false),
  };
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
  return url;
}

function optionalValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
      throw new TypeError(`RUNPROOF_CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new TypeError(`RUNPROOF_CORS_ORIGINS must contain origins without paths: ${origin}`);
    }
    return parsed.origin;
  }))];
}
