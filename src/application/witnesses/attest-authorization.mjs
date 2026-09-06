import { buildWitnessAttestation, buildWitnessRequest, signWitnessAttestation } from '../../domain/witness.mjs';
import { hashJson } from '../../domain/hashing.mjs';
import { RunProofError } from '../../domain/errors.mjs';

export async function attestAuthorization({ input, witnessId, keyId, privateKeyPem, store, now = () => Date.now(), maxRequestAgeSeconds = 300 }) {
  const request = buildWitnessRequest(input);
  const observedAt = Math.floor(now() / 1000);
  if (request.requestedAt > observedAt + 60) throw new RunProofError('WITNESS_REQUEST_IN_FUTURE', 'witness request timestamp is too far in the future');
  if (observedAt - request.requestedAt > maxRequestAgeSeconds) throw new RunProofError('WITNESS_REQUEST_TOO_OLD', 'witness request is too old');
  if (observedAt > request.expiresAt) throw new RunProofError('WITNESS_REQUEST_EXPIRED', 'authorization expired before it could be witnessed');
  const requestHash = hashJson(request);
  const existing = await store.get(requestHash, witnessId);
  if (existing) return { replay: true, attestation: existing };
  const attestation = signWitnessAttestation(buildWitnessAttestation({ request, witnessId, keyId, observedAt }), privateKeyPem);
  return { replay: false, attestation: await store.save(requestHash, witnessId, attestation) };
}
