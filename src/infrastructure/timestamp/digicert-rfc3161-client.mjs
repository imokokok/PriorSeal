import { canonicalize, hashJson } from '../../domain/hashing.mjs';
import { RunProofError } from '../../domain/errors.mjs';
import { DIGICERT_RFC3161_URL, buildTimestampEvidence, createTimestampRequest, verifyTimestampEvidence } from '../../domain/rfc3161.mjs';

export function createDigiCertTimestampProvider({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('RFC 3161 timestamp provider requires fetch');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('RFC 3161 timeout must be between 1 and 60000 ms');
  return async ({ authorization, acceptance, policy }) => {
    const data = new TextEncoder().encode(canonicalize(authorization));
    const request = await createTimestampRequest(data);
    let response;
    try {
      response = await fetchImpl(DIGICERT_RFC3161_URL, {
        method: 'POST',
        headers: { accept: 'application/timestamp-reply', 'content-type': 'application/timestamp-query' },
        body: request.body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new RunProofError('TIMESTAMP_SERVICE_UNAVAILABLE', `DigiCert timestamp request failed: ${safeReason(error)}`);
    }
    if (!response.ok) throw new RunProofError('TIMESTAMP_SERVICE_UNAVAILABLE', `DigiCert timestamp service returned HTTP ${response.status}`);
    const contentType = response.headers?.get?.('content-type')?.split(';')[0]?.trim()?.toLowerCase();
    if (contentType && contentType !== 'application/timestamp-reply') throw new RunProofError('INVALID_TIMESTAMP_RESPONSE', 'DigiCert returned an unexpected content type');
    const body = new Uint8Array(await response.arrayBuffer());
    if (!body.length || body.length > 128 * 1024) throw new RunProofError('INVALID_TIMESTAMP_RESPONSE', 'DigiCert returned an invalid timestamp response size');
    const authorizationHash = hashJson(authorization);
    const evidence = await buildTimestampEvidence({ response: body, authorizationHash, requestedAt: acceptance.acceptedAt, nonce: request.nonce });
    const verified = await verifyTimestampEvidence(evidence, data, policy, { authorizationHash, requestedAt: acceptance.acceptedAt });
    if (!verified.valid) throw new RunProofError(verified.code, 'DigiCert timestamp response could not be verified');
    return evidence;
  };
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.replace(/[\r\n]/g, ' ').slice(0, 160);
}
