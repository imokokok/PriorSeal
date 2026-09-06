import { readFileSync } from 'node:fs';
import { RunProofError } from '../../domain/errors.mjs';
import { buildWitnessEvidence, buildWitnessPolicy, verifyWitnessAttestation, witnessRequestForAuthorization } from '../../domain/witness.mjs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';

export function readWitnessEndpoints(file, { requireHttps = false } = {}) {
  if (!file) return null;
  let input;
  try { input = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new TypeError(`Unable to read witness endpoints: ${error.message}`); }
  assertSafeJson(input);
  assertOnlyFields(input, ['schema', 'endpoints'], 'witness endpoints');
  if (input.schema !== 'runproof.witness-endpoints.v1' || !Array.isArray(input.endpoints)) throw new TypeError('Witness endpoint file must use runproof.witness-endpoints.v1');
  const endpoints = input.endpoints.map((entry, index) => {
    assertOnlyFields(entry, ['witnessId', 'url', 'bearerToken'], `witness endpoint ${index}`);
    let url;
    try { url = new URL(entry.url); } catch { throw new TypeError(`Witness endpoint ${index} has an invalid URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError(`Witness endpoint ${index} must be an HTTP(S) URL without credentials, query, or fragment`);
    if (requireHttps && url.protocol !== 'https:') throw new TypeError(`Production witness endpoint ${entry.witnessId} must use HTTPS`);
    return { witnessId: String(entry.witnessId), url: url.toString().replace(/\/$/, ''), ...(entry.bearerToken ? { bearerToken: String(entry.bearerToken) } : {}) };
  });
  if (new Set(endpoints.map((entry) => entry.witnessId)).size !== endpoints.length) throw new TypeError('Witness endpoint IDs must be unique');
  return endpoints;
}

export function createHttpWitnessProvider({ policy, endpoints, requester, fetchImpl = globalThis.fetch, timeoutMs = 5_000 }) {
  const normalizedPolicy = buildWitnessPolicy(policy);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new TypeError('Witness timeout must be between 100 and 60000 milliseconds');
  const configured = new Map((endpoints ?? []).map((entry) => [entry.witnessId, entry]));
  for (const witness of normalizedPolicy.witnesses) if (!configured.has(witness.witnessId)) throw new TypeError(`Missing endpoint for witness ${witness.witnessId}`);

  return async ({ authorization, acceptance }) => {
    const request = witnessRequestForAuthorization(authorization, { requester, requestedAt: acceptance.acceptedAt });
    const results = await Promise.allSettled(normalizedPolicy.witnesses.map(async (witness) => {
      const endpoint = configured.get(witness.witnessId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${endpoint.url}/v1/witness/attest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(endpoint.bearerToken ? { authorization: `Bearer ${endpoint.bearerToken}` } : {}) },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (Buffer.byteLength(text) > 64 * 1024) throw new Error('response too large');
        const attestation = JSON.parse(text).attestation;
        if (!verifyWitnessAttestation(attestation, request, witness)) throw new Error('invalid witness signature');
        return attestation;
      } finally { clearTimeout(timeout); }
    }));
    const attestations = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
    if (attestations.length < normalizedPolicy.threshold) {
      const failures = results.map((result, index) => result.status === 'rejected' ? { witnessId: normalizedPolicy.witnesses[index].witnessId, reason: safeReason(result.reason) } : null).filter(Boolean);
      throw new RunProofError('WITNESS_QUORUM_UNAVAILABLE', `Only ${attestations.length} of ${normalizedPolicy.threshold} required witness signatures were collected`, { threshold: normalizedPolicy.threshold, collected: attestations.length, failures });
    }
    return buildWitnessEvidence({ request, attestations, policy: normalizedPolicy });
  };
}

function safeReason(error) {
  if (error?.name === 'AbortError') return 'timeout';
  return String(error?.message ?? 'request failed').slice(0, 160);
}
