import { getAddress } from 'viem';
import { signEd25519Statement, verifyEd25519Statement } from './ed25519.mjs';
import { hashJson } from './hashing.mjs';

/** A short-lived, issuer-signed, read-only assessment for an EVM integration target. */
export const INTEGRATION_READINESS_SCHEMA = 'priorseal.integration-readiness.v1';
export const INTEGRATION_READINESS_DOMAIN = 'priorseal/integration-readiness/v1';

export type IntegrationReadinessInspection = {
  chain: {
    support: 'SUPPORTED' | 'UNSUPPORTED';
    rpc: 'AVAILABLE' | 'NOT_CONFIGURED' | 'CHAIN_ID_MISMATCH' | 'UNAVAILABLE';
    observedChainId: number | null;
    source: 'evm-json-rpc' | null;
  };
  subject: {
    kind: 'EOA' | 'CONTRACT' | 'NOT_OBSERVED';
    codeHash: string | null;
    codeBytes: number | null;
  };
};

type KeyRegistryDigest = { schema: string; hash: string; url: string };

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`Integration readiness ${field} must be a positive integer`);
  return Number(value);
}

function boundedString(value: unknown, field: string, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`Integration readiness ${field} is invalid`);
  return value;
}

function evmAddress(value: unknown) {
  if (typeof value !== 'string') throw new TypeError('Integration readiness subjectAddress must be an EVM address');
  try { return getAddress(value).toLowerCase(); } catch { throw new TypeError('Integration readiness subjectAddress must be an EVM address'); }
}

function inspection(value: IntegrationReadinessInspection): IntegrationReadinessInspection {
  const observedChainId = value?.chain?.observedChainId;
  if (!['SUPPORTED', 'UNSUPPORTED'].includes(value?.chain?.support)
    || !['AVAILABLE', 'NOT_CONFIGURED', 'CHAIN_ID_MISMATCH', 'UNAVAILABLE'].includes(value?.chain?.rpc)
    || (observedChainId !== null && !Number.isSafeInteger(observedChainId))
    || ![null, 'evm-json-rpc'].includes(value?.chain?.source)
    || !['EOA', 'CONTRACT', 'NOT_OBSERVED'].includes(value?.subject?.kind)
    || (value.subject.codeHash !== null && !/^0x[0-9a-f]{64}$/.test(value.subject.codeHash))
    || (value.subject.codeBytes !== null && (!Number.isSafeInteger(value.subject.codeBytes) || value.subject.codeBytes < 0))) {
    throw new TypeError('Integration readiness inspection is invalid');
  }
  if (value.subject.kind === 'NOT_OBSERVED' && (value.subject.codeHash !== null || value.subject.codeBytes !== null)) throw new TypeError('Unobserved integration readiness subjects cannot contain code facts');
  if (value.subject.kind !== 'NOT_OBSERVED' && (value.subject.codeHash === null || value.subject.codeBytes === null)) throw new TypeError('Observed integration readiness subjects must contain code facts');
  return value;
}

/**
 * This statement describes a single, public EVM target at a bounded point in
 * time. It never proves address ownership, contract safety, authorization, or
 * a right to transact. Those claims deliberately remain outside this product.
 */
export function buildIntegrationReadiness({
  chainId,
  subjectAddress,
  inspection: result,
  issuer,
  keyId = 'default',
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt = issuedAt + 300,
  keyRegistry,
  payment,
}: {
  chainId: number;
  subjectAddress: string;
  inspection: IntegrationReadinessInspection;
  issuer: string;
  keyId?: string;
  issuedAt?: number;
  expiresAt?: number;
  keyRegistry: KeyRegistryDigest;
  payment: { protocol: 'x402'; method: 'GET'; path: '/v1/integration-readiness'; price: string };
}) {
  const normalizedChainId = positiveInteger(chainId, 'chainId');
  const normalizedAddress = evmAddress(subjectAddress);
  const normalizedIssuer = boundedString(issuer, 'issuer', 256);
  const normalizedKeyId = boundedString(keyId, 'keyId', 128);
  const normalizedIssuedAt = positiveInteger(issuedAt, 'issuedAt');
  const normalizedExpiresAt = positiveInteger(expiresAt, 'expiresAt');
  if (normalizedExpiresAt <= normalizedIssuedAt || normalizedExpiresAt - normalizedIssuedAt > 3_600) throw new TypeError('Integration readiness expiresAt must be after issuedAt and within one hour');
  if (!keyRegistry || keyRegistry.schema !== 'priorseal.keys.v1' || !/^[0-9a-f]{64}$/.test(keyRegistry.hash) || typeof keyRegistry.url !== 'string' || !/^https:\/\//.test(keyRegistry.url)) throw new TypeError('Integration readiness key registry digest is invalid');
  if (!payment || payment.protocol !== 'x402' || payment.method !== 'GET' || payment.path !== '/v1/integration-readiness' || typeof payment.price !== 'string' || !/^\$(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(payment.price)) throw new TypeError('Integration readiness payment descriptor is invalid');
  const checked = inspection(result);
  const input = { chainId: normalizedChainId, subjectAddress: normalizedAddress };
  const inputHash = hashJson(input);
  const readinessId = `pir_${hashJson({ inputHash, inspection: checked, issuer: normalizedIssuer, keyId: normalizedKeyId, issuedAt: normalizedIssuedAt, expiresAt: normalizedExpiresAt }).slice(0, 32)}`;
  return {
    schema: INTEGRATION_READINESS_SCHEMA,
    domain: INTEGRATION_READINESS_DOMAIN,
    readinessId,
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
    input: { ...input, inputHash },
    inspection: checked,
    issuer: normalizedIssuer,
    keyId: normalizedKeyId,
    algorithm: 'Ed25519',
    keyRegistry,
    payment,
    limitations: [
      'This is a read-only point-in-time check of public chain configuration and bytecode presence; it does not submit transactions or custody keys.',
      'EOA or CONTRACT describes only whether eth_getCode returned empty bytecode at the checked state. It does not prove address control, contract safety, ownership, authorization, or business suitability.',
      'Verify this signature with the issuer key from the published key registry and apply independent RPC and security review before relying on the result.',
    ],
  };
}

export function signIntegrationReadiness<T extends Record<string, unknown>>(report: T, privateKeyPem: string) {
  return signEd25519Statement(report, privateKeyPem);
}

export function verifyIntegrationReadiness(value: Record<string, unknown> | null | undefined, publicKeyPem: string) {
  if (!value || value.schema !== INTEGRATION_READINESS_SCHEMA || value.domain !== INTEGRATION_READINESS_DOMAIN || value.algorithm !== 'Ed25519') return false;
  return verifyEd25519Statement(value, publicKeyPem);
}
