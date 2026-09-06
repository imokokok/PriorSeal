import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { RunProofError } from './errors.mjs';
import { canonicalize, hashJson } from './hashing.mjs';
import { protocolId, unixSeconds } from './values.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';

export const WITNESS_POLICY_SCHEMA = 'runproof.witness-policy.v1';
export const WITNESS_REQUEST_SCHEMA = 'runproof.witness-request.v1';
export const WITNESS_ATTESTATION_SCHEMA = 'runproof.witness-attestation.v1';
export const WITNESS_EVIDENCE_SCHEMA = 'runproof.witness-evidence.v1';

const HASH = /^[0-9a-f]{64}$/;

export function buildWitnessPolicy(input) {
  assertSafeJson(input);
  assertOnlyFields(input, ['schema', 'threshold', 'maxClockSkewSeconds', 'witnesses'], 'witness policy');
  if (input?.schema !== WITNESS_POLICY_SCHEMA) throw new RunProofError('INVALID_WITNESS_POLICY', `witness policy schema must be ${WITNESS_POLICY_SCHEMA}`);
  if (!Array.isArray(input.witnesses) || input.witnesses.length < 2) throw new RunProofError('INVALID_WITNESS_POLICY', 'witness policy requires at least two witnesses');
  const keyFingerprints = [];
  const witnesses = input.witnesses.map((entry, index) => {
    assertOnlyFields(entry, ['witnessId', 'keyId', 'algorithm', 'publicKey'], `witness policy witness ${index}`);
    if (entry.algorithm !== 'Ed25519' || typeof entry.publicKey !== 'string' || !entry.publicKey.trim()) throw new RunProofError('INVALID_WITNESS_POLICY', 'every witness requires an Ed25519 public key');
    try {
      const key = createPublicKey(entry.publicKey.trim());
      if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('not Ed25519');
      keyFingerprints.push(key.export({ type: 'spki', format: 'der' }).toString('base64'));
    } catch { throw new RunProofError('INVALID_WITNESS_POLICY', `witness ${index} public key is not Ed25519`); }
    return { witnessId: protocolId(entry.witnessId, 'witnessId'), keyId: protocolId(entry.keyId, 'keyId'), algorithm: 'Ed25519', publicKey: entry.publicKey.trim() };
  });
  if (new Set(witnesses.map((entry) => entry.witnessId)).size !== witnesses.length) throw new RunProofError('INVALID_WITNESS_POLICY', 'witnessId values must be unique');
  if (new Set(keyFingerprints).size !== keyFingerprints.length) throw new RunProofError('INVALID_WITNESS_POLICY', 'each witness must use a distinct public key');
  const threshold = Number(input.threshold);
  if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > witnesses.length) throw new RunProofError('INVALID_WITNESS_POLICY', 'threshold must be between 2 and the witness count');
  const maxClockSkewSeconds = Number(input.maxClockSkewSeconds ?? 60);
  if (!Number.isSafeInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 0 || maxClockSkewSeconds > 3600) throw new RunProofError('INVALID_WITNESS_POLICY', 'maxClockSkewSeconds must be between 0 and 3600');
  return { schema: WITNESS_POLICY_SCHEMA, threshold, maxClockSkewSeconds, witnesses };
}

export function buildWitnessRequest(input) {
  assertSafeJson(input);
  assertOnlyFields(input, ['schema', 'domain', 'authorizationId', 'authorizationHash', 'intentHash', 'requester', 'requestedAt', 'expiresAt'], 'witness request');
  const request = {
    schema: WITNESS_REQUEST_SCHEMA,
    domain: 'runproof/witness-request/v1',
    authorizationId: protocolId(input.authorizationId, 'authorizationId'),
    authorizationHash: hashValue(input.authorizationHash, 'authorizationHash'),
    intentHash: hashValue(input.intentHash, 'intentHash'),
    requester: protocolId(input.requester, 'requester'),
    requestedAt: unixSeconds(input.requestedAt, 'requestedAt'),
    expiresAt: unixSeconds(input.expiresAt, 'expiresAt'),
  };
  if (request.requestedAt > request.expiresAt) throw new RunProofError('INVALID_WITNESS_REQUEST', 'witness request is already expired');
  if (input.schema && input.schema !== request.schema) throw new RunProofError('INVALID_WITNESS_REQUEST', 'unsupported witness request schema');
  if (input.domain && input.domain !== request.domain) throw new RunProofError('INVALID_WITNESS_REQUEST', 'invalid witness request domain');
  return request;
}

export function witnessRequestForAuthorization(authorization, { requester, requestedAt }) {
  return buildWitnessRequest({
    authorizationId: authorization.authorizationId,
    authorizationHash: hashJson(authorization),
    intentHash: authorization.intentHash,
    requester,
    requestedAt,
    expiresAt: authorization.expiresAt,
  });
}

export function buildWitnessAttestation({ request, witnessId, keyId, observedAt }) {
  const normalized = buildWitnessRequest(request);
  const timestamp = unixSeconds(observedAt, 'observedAt');
  if (timestamp > normalized.expiresAt) throw new RunProofError('WITNESS_REQUEST_EXPIRED', 'authorization expired before it could be witnessed');
  return {
    schema: WITNESS_ATTESTATION_SCHEMA,
    domain: 'runproof/witness-attestation/v1',
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

export function signWitnessAttestation(attestation, privateKeyPem) {
  if (!privateKeyPem) throw new RunProofError('WITNESS_NOT_CONFIGURED', 'witness signing key is required');
  return { ...attestation, signature: sign(null, Buffer.from(canonicalize(attestation)), createPrivateKey(privateKeyPem)).toString('base64url') };
}

export function verifyWitnessAttestation(attestation, request, witness) {
  try {
    assertSafeJson(attestation);
    assertOnlyFields(attestation, ['schema', 'domain', 'witnessId', 'keyId', 'algorithm', 'requestHash', 'authorizationId', 'authorizationHash', 'intentHash', 'observedAt', 'expiresAt', 'signature'], 'witness attestation');
  } catch { return false; }
  if (!attestation?.signature || attestation.schema !== WITNESS_ATTESTATION_SCHEMA || attestation.domain !== 'runproof/witness-attestation/v1') return false;
  if (attestation.witnessId !== witness.witnessId || attestation.keyId !== witness.keyId || attestation.algorithm !== witness.algorithm) return false;
  if (attestation.requestHash !== hashJson(request) || attestation.authorizationId !== request.authorizationId || attestation.authorizationHash !== request.authorizationHash || attestation.intentHash !== request.intentHash || attestation.expiresAt !== request.expiresAt) return false;
  if (!Number.isSafeInteger(attestation.observedAt) || attestation.observedAt < 0 || attestation.observedAt > request.expiresAt) return false;
  const { signature, ...unsigned } = attestation;
  try { return verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(witness.publicKey), Buffer.from(signature, 'base64url')); } catch { return false; }
}

export function buildWitnessEvidence({ request, attestations, policy }) {
  const normalizedPolicy = buildWitnessPolicy(policy);
  const normalizedRequest = buildWitnessRequest(request);
  const evidence = { schema: WITNESS_EVIDENCE_SCHEMA, domain: 'runproof/witness-evidence/v1', policyHash: hashJson(normalizedPolicy), request: normalizedRequest, attestations: [...attestations] };
  const result = verifyWitnessEvidence(evidence, null, normalizedPolicy);
  if (!result.valid) throw new RunProofError(result.code, 'Witness quorum could not be verified', result);
  return evidence;
}

export function verifyWitnessEvidence(evidence, authorization, policy, { expectedRequestedAt, before } = {}) {
  let normalizedPolicy;
  let request;
  try {
    normalizedPolicy = buildWitnessPolicy(policy);
    request = buildWitnessRequest(evidence?.request);
  } catch (error) { return invalid(error.code ?? 'INVALID_WITNESS_EVIDENCE'); }
  if (evidence?.schema !== WITNESS_EVIDENCE_SCHEMA || evidence.domain !== 'runproof/witness-evidence/v1') return invalid('INVALID_WITNESS_EVIDENCE');
  if (evidence.policyHash !== hashJson(normalizedPolicy) || !Array.isArray(evidence.attestations)) return invalid('WITNESS_POLICY_MISMATCH');
  if (authorization) {
    if (request.authorizationId !== authorization.authorizationId || request.authorizationHash !== hashJson(authorization) || request.intentHash !== authorization.intentHash || request.expiresAt !== authorization.expiresAt) return invalid('WITNESS_AUTHORIZATION_MISMATCH');
    if (request.requestedAt < authorization.issuedAt || request.requestedAt > authorization.expiresAt) return invalid('INVALID_WITNESS_REQUEST');
  }
  if (expectedRequestedAt !== undefined && request.requestedAt !== expectedRequestedAt) return invalid('WITNESS_ACCEPTANCE_MISMATCH');
  const validWitnessIds = [];
  for (const attestation of evidence.attestations) {
    const witness = normalizedPolicy.witnesses.find((entry) => entry.witnessId === attestation?.witnessId);
    if (!witness || validWitnessIds.includes(witness.witnessId)) continue;
    if (attestation.observedAt < request.requestedAt - normalizedPolicy.maxClockSkewSeconds) continue;
    if (before !== undefined && attestation.observedAt > before) continue;
    if (verifyWitnessAttestation(attestation, request, witness)) validWitnessIds.push(witness.witnessId);
  }
  if (validWitnessIds.length < normalizedPolicy.threshold) return { ...invalid('WITNESS_QUORUM_NOT_MET'), threshold: normalizedPolicy.threshold, validWitnessIds };
  return { valid: true, code: 'OK', threshold: normalizedPolicy.threshold, validWitnessIds };
}

function hashValue(value, name) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HASH.test(normalized)) throw new RunProofError('INVALID_WITNESS_REQUEST', `${name} must be a lowercase SHA-256 hex digest`);
  return normalized;
}

function invalid(code) { return { valid: false, code }; }
