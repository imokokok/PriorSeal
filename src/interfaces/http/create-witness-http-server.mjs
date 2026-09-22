import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { attestAuthorization } from '../../application/witnesses/attest-authorization.mjs';
import { PriorSealError } from '../../domain/errors.mjs';
import { createMemoryWitnessStore } from '../../infrastructure/witness/memory-witness-store.mjs';
import { createMemoryRateLimiter } from './rate-limiter.mjs';
import { readJsonBody, requestPath } from './request-parser.mjs';
import { errorBody, sendJson } from './response-writer.mjs';
import { assertEd25519KeyPair } from '../../domain/ed25519.mjs';
import { createRequestDeadline } from './request-deadline.mjs';

const ERROR_STATUS = Object.freeze({ INVALID_JSON: 400, INVALID_WITNESS_REQUEST: 400, WITNESS_REQUEST_IN_FUTURE: 400, WITNESS_REQUEST_TOO_OLD: 410, WITNESS_REQUEST_EXPIRED: 410, UNSUPPORTED_MEDIA_TYPE: 415, REQUEST_TOO_LARGE: 413, RATE_LIMITED: 429, UNAUTHORIZED: 401, REQUEST_TIMEOUT: 504, WITNESS_NOT_CONFIGURED: 503, NOT_FOUND: 404 });

export function createWitnessHttpServer({ witnessId, keyId = 'default', privateKeyPem, publicKeyPem, store = createMemoryWitnessStore(), bearerToken, maxBodyBytes = 16 * 1024, rateLimit = 120, rateLimiter = createMemoryRateLimiter({ limit: rateLimit }), requestTimeoutMs = 10_000, maxRequestAgeSeconds = 300, now = () => Date.now(), logger = null } = {}) {
  if (!witnessId || !privateKeyPem || !publicKeyPem) throw new TypeError('Witness ID and Ed25519 key pair are required');
  assertEd25519KeyPair(privateKeyPem, publicKeyPem);
  return createServer({ requestTimeout: requestTimeoutMs }, async (req, res) => {
    const requestId = randomUUID();
    const deadline = createRequestDeadline(req, requestTimeoutMs);
    const respond = (status, body, headers = {}) => sendJson(res, status, body, requestId, headers);
    const dispatch = async () => {
      const path = requestPath(req);
      if (req.method === 'GET' && path === '/health/live') return respond(200, { status: 'ok', requestId });
      if (req.method === 'GET' && path === '/health/ready') return respond(200, { status: 'ready', storage: await store.health(), requestId });
      if (req.method === 'GET' && path === '/.well-known/priorseal-witness-key.json') return respond(200, { schema: 'priorseal.witness-key.v1', witnessId, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, requestId }, { 'cache-control': 'public, max-age=300' });
      if (req.method !== 'POST' || path !== '/v1/witness/attest') throw new PriorSealError('NOT_FOUND', 'Route not found');
      if (!authorized(req.headers.authorization, bearerToken)) throw new PriorSealError('UNAUTHORIZED', 'Witness credentials are invalid');
      if (!rateLimiter.allow(req.socket.remoteAddress ?? 'unknown', now())) throw new PriorSealError('RATE_LIMITED', 'Too many requests');
      const body = await readJsonBody(req, maxBodyBytes, deadline.signal);
      const result = await attestAuthorization({ input: body, witnessId, keyId, privateKeyPem, store, now, maxRequestAgeSeconds });
      return respond(result.replay ? 200 : 201, { attestation: result.attestation, requestId }, result.replay ? { 'idempotency-replayed': 'true' } : {});
    };
    try {
      return await deadline.run(dispatch);
    } catch (error) {
      const code = error instanceof PriorSealError ? error.code : error?.code ?? 'INTERNAL_ERROR';
      const status = ERROR_STATUS[code] ?? 500;
      if (code === 'REQUEST_TIMEOUT') deadline.closeAfterResponse(res);
      logger?.error?.({ event: 'witness.request_failed', requestId, code, status });
      return respond(status, errorBody(code, status === 500 ? 'Internal server error' : error.message, requestId));
    } finally { deadline.cleanup(); }
  });
}

function authorized(header, expected) {
  if (!expected) return true;
  const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(provided); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
