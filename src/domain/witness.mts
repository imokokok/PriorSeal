import { createPublicKey } from 'node:crypto';
import { PriorSealError } from './errors.mjs';
import { hashJson } from './hashing.mjs';
import { protocolId, unixSeconds } from './values.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';
import { signEd25519Statement, verifyEd25519Statement } from './ed25519.mjs';

export const WITNESS_POLICY_SCHEMA = 'priorseal.witness-policy.v1';
export const WITNESS_REQUEST_SCHEMA = 'priorseal.witness-request.v1';
export const WITNESS_ATTESTATION_SCHEMA = 'priorseal.witness-attestation.v1';
export const WITNESS_EVIDENCE_SCHEMA = 'priorseal.witness-evidence.v1';

const HASH = /^[0-9a-f]{64}$/;

type Witness = { witnessId: string; keyId: string; algorithm: string; publicKey: string };
type WitnessAuthorization = { authorizationId: string; intentHash: string; expiresAt: number; issuedAt: number };
type WitnessOptions = { expectedRequestedAt?: number; before?: number };

export function buildWitnessPolicy(inputValue: unknown) {
  assertSafeJson(inputValue);
  const input = assertOnlyFields(inputValue, ['schema', 'threshold', 'maxClockSkewSeconds', 'witnesses'], 'witness policy');
  if (input.schema !== WITNESS_POLICY_SCHEMA) throw new PriorSealError('INVALID_WITNESS_POLICY', `witness policy schema must be ${WITNESS_POLICY_SCHEMA}`);
  if (!Array.isArray(input.witnesses) || input.witnesses.length < 2) throw new PriorSealError('INVALID_WITNESS_POLICY', 'witness policy requires at least two witnesses');
  const keyFingerprints: string[] = [];
  const witnesses = input.witnesses.map((entry, index) => {
    const witness = assertOnlyFields(entry, ['witnessId', 'keyId', 'algorithm', 'publicKey'], `witness policy witness ${index}`);
    if (witness.algorithm !== 'Ed25519' || typeof witness.publicKey !== 'string' || !witness.publicKey.trim()) throw new PriorSealError('INVALID_WITNESS_POLICY', 'every witness requires an Ed25519 public key');
    try {
      const key = createPublicKey(witness.publicKey.trim());
      if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('not Ed25519');
      keyFingerprints.push(key.export({ type: 'spki', format: 'der' }).toString('base64'));
    } catch { throw new PriorSealError('INVALID_WITNESS_POLICY', `witness ${index} public key is not Ed25519`); }
    return { witnessId: protocolId(witness.witnessId, 'witnessId'), keyId: protocolId(witness.keyId, 'keyId'), algorithm: 'Ed25519', publicKey: witness.publicKey.trim() };
  });
  if (new Set(witnesses.map((entry) => entry.witnessId)).size !== witnesses.length) throw new PriorSealError('INVALID_WITNESS_POLICY', 'witnessId values must be unique');
  if (new Set(keyFingerprints).size !== keyFingerprints.length) throw new PriorSealError('INVALID_WITNESS_POLICY', 'each witness must use a distinct public key');
  const threshold = Number(input.threshold);
  if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > witnesses.length) throw new PriorSealError('INVALID_WITNESS_POLICY', 'threshold must be between 2 and the witness count');
  const maxClockSkewSeconds = Number(input.maxClockSkewSeconds ?? 60);
  if (!Number.isSafeInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 0 || maxClockSkewSeconds > 3600) throw new PriorSealError('INVALID_WITNESS_POLICY', 'maxClockSkewSeconds must be between 0 and 3600');
  return { schema: WITNESS_POLICY_SCHEMA, threshold, maxClockSkewSeconds, witnesses };
}

export function buildWitnessRequest(inputValue: unknown) {
  assertSafeJson(inputValue);
  const input = assertOnlyFields(inputValue, ['schema', 'domain', 'authorizationId', 'authorizationHash', 'intentHash', 'requester', 'requestedAt', 'expiresAt'], 'witness request');
  const request = {
    schema: WITNESS_REQUEST_SCHEMA,
    domain: 'priorseal/witness-request/v1',
    authorizationId: protocolId(input.authorizationId, 'authorizationId'),
    authorizationHash: hashValue(input.authorizationHash, 'authorizationHash'),
    intentHash: hashValue(input.intentHash, 'intentHash'),
    requester: protocolId(input.requester, 'requester'),
    requestedAt: unixSeconds(input.requestedAt, 'requestedAt'),
    expiresAt: unixSeconds(input.expiresAt, 'expiresAt'),
  };
  if (request.requestedAt > request.expiresAt) throw new PriorSealError('INVALID_WITNESS_REQUEST', 'witness request is already expired');
  if (input.schema && input.schema !== request.schema) throw new PriorSealError('INVALID_WITNESS_REQUEST', 'unsupported witness request schema');
  if (input.domain && input.domain !== request.domain) throw new PriorSealError('INVALID_WITNESS_REQUEST', 'invalid witness request domain');
  return request;
}

export function witnessRequestForAuthorization(authorization: { authorizationId: unknown; intentHash: unknown; expiresAt: unknown }, { requester, requestedAt }: { requester: unknown; requestedAt: unknown }) {
  return buildWitnessRequest({
    authorizationId: authorization.authorizationId,
    authorizationHash: hashJson(authorization),
    intentHash: authorization.intentHash,
    requester,
    requestedAt,
    expiresAt: authorization.expiresAt,
  });
}

export function buildWitnessAttestation({ request, witnessId, keyId, observedAt }: { request: unknown; witnessId: unknown; keyId: unknown; observedAt: unknown }) {
  const normalized = buildWitnessRequest(request);
  const timestamp = unixSeconds(observedAt, 'observedAt');
  if (timestamp > normalized.expiresAt) throw new PriorSealError('WITNESS_REQUEST_EXPIRED', 'authorization expired before it could be witnessed');
  return {
    schema: WITNESS_ATTESTATION_SCHEMA,
    domain: 'priorseal/witness-attestation/v1',
    witnessId: protocolId(witnessId, 'witnessId'),
    keyId: protocolId(keyId, 'keyId'),
    algorithm: 'Ed25519',
    requestHash: hashJson(normalized),
    authorizationId: normalized.authorizationId,
    authorizationHash: normalized.authorizationHash,
    intentHash: normalized.intentHash,
    observedAt: timestamp,
    expiresAt: normalized.expiresAt,
  };
}

export function signWitnessAttestation<T extends Record<string, unknown>>(attestation: T, privateKeyPem: string | undefined) {
  if (!privateKeyPem) throw new PriorSealError('WITNESS_NOT_CONFIGURED', 'witness signing key is required');
  return signEd25519Statement(attestation, privateKeyPem);
}

export function verifyWitnessAttestation(attestation: unknown, request: ReturnType<typeof buildWitnessRequest>, witness: Witness): boolean {
  let checked: Record<string, unknown>;
  try {
    assertSafeJson(attestation);
    checked = assertOnlyFields(attestation, ['schema', 'domain', 'witnessId', 'keyId', 'algorithm', 'requestHash', 'authorizationId', 'authorizationHash', 'intentHash', 'observedAt', 'expiresAt', 'signature'], 'witness attestation');
  } catch { return false; }
  if (!checked.signature || checked.schema !== WITNESS_ATTESTATION_SCHEMA || checked.domain !== 'priorseal/witness-attestation/v1') return false;
  if (checked.witnessId !== witness.witnessId || checked.keyId !== witness.keyId || checked.algorithm !== witness.algorithm) return false;
  if (checked.requestHash !== hashJson(request) || checked.authorizationId !== request.authorizationId || checked.authorizationHash !== request.authorizationHash || checked.intentHash !== request.intentHash || checked.expiresAt !== request.expiresAt) return false;
  if (!Number.isSafeInteger(checked.observedAt) || (checked.observedAt as number) < 0 || (checked.observedAt as number) > request.expiresAt) return false;
  return verifyEd25519Statement(checked, witness.publicKey);
}

export function buildWitnessEvidence({ request, attestations, policy }: { request: unknown; attestations: unknown[]; policy: unknown }) {
  const normalizedPolicy = buildWitnessPolicy(policy);
  const normalizedRequest = buildWitnessRequest(request);
  const evidence = { schema: WITNESS_EVIDENCE_SCHEMA, domain: 'priorseal/witness-evidence/v1', policyHash: hashJson(normalizedPolicy), request: normalizedRequest, attestations: [...attestations] };
  const result = verifyWitnessEvidence(evidence, null, normalizedPolicy);
  if (!result.valid) throw new PriorSealError(result.code, 'Witness quorum could not be verified', result);
  return evidence;
}

export function verifyWitnessEvidence(evidence: unknown, authorization: WitnessAuthorization | null | undefined, policy: unknown, { expectedRequestedAt, before }: WitnessOptions = {}) {
  const candidate = evidence as Record<string, unknown> | null | undefined;
  let normalizedPolicy: ReturnType<typeof buildWitnessPolicy>;
  let request: ReturnType<typeof buildWitnessRequest>;
  try {
    normalizedPolicy = buildWitnessPolicy(policy);
    request = buildWitnessRequest(candidate?.request);
  } catch (error) { return invalid((error as { code?: string })?.code ?? 'INVALID_WITNESS_EVIDENCE'); }
  if (candidate?.schema !== WITNESS_EVIDENCE_SCHEMA || candidate.domain !== 'priorseal/witness-evidence/v1') return invalid('INVALID_WITNESS_EVIDENCE');
  if (candidate.policyHash !== hashJson(normalizedPolicy) || !Array.isArray(candidate.attestations)) return invalid('WITNESS_POLICY_MISMATCH');
  if (authorization) {
    if (request.authorizationId !== authorization.authorizationId || request.authorizationHash !== hashJson(authorization) || request.intentHash !== authorization.intentHash || request.expiresAt !== authorization.expiresAt) return invalid('WITNESS_AUTHORIZATION_MISMATCH');
    if (request.requestedAt < authorization.issuedAt || request.requestedAt > authorization.expiresAt) return invalid('INVALID_WITNESS_REQUEST');
  }
  if (expectedRequestedAt !== undefined && request.requestedAt !== expectedRequestedAt) return invalid('WITNESS_ACCEPTANCE_MISMATCH');
  const validWitnessIds: string[] = [];
  for (const attestation of candidate.attestations) {
    const witness = normalizedPolicy.witnesses.find((entry) => entry.witnessId === attestation?.witnessId);
    if (!witness || validWitnessIds.includes(witness.witnessId)) continue;
    if (attestation.observedAt < request.requestedAt - normalizedPolicy.maxClockSkewSeconds) continue;
    if (before !== undefined && attestation.observedAt > before) continue;
    if (verifyWitnessAttestation(attestation, request, witness)) validWitnessIds.push(witness.witnessId);
  }
  if (validWitnessIds.length < normalizedPolicy.threshold) return { ...invalid('WITNESS_QUORUM_NOT_MET'), threshold: normalizedPolicy.threshold, validWitnessIds };
  return { valid: true, code: 'OK', threshold: normalizedPolicy.threshold, validWitnessIds };
}

function hashValue(value: unknown, name: string): string {
  const normalized = String(value ?? '').toLowerCase();
  if (!HASH.test(normalized)) throw new PriorSealError('INVALID_WITNESS_REQUEST', `${name} must be a lowercase SHA-256 hex digest`);
  return normalized;
}

function invalid(code: string) { return { valid: false, code }; }
