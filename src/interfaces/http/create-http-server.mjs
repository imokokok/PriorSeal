import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { observeEvm } from '../../infrastructure/blockchain/evm/observer.mjs';
import { createMemoryStore } from '../../infrastructure/persistence/memory-store.mjs';
import { createKeyRegistry } from '../../domain/key-registry.mjs';
import { RunProofError } from '../../domain/errors.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';
import { createIntent } from '../../application/intents/create-intent.mjs';
import { observeExecution } from '../../application/observations/observe-execution.mjs';
import { createMemoryRateLimiter } from './rate-limiter.mjs';
import { readJsonBody, requestPath } from './request-parser.mjs';
import { errorBody, sendJson } from './response-writer.mjs';
import { createStaticAssetHandler } from './static-assets.mjs';

const ERROR_STATUS = Object.freeze({ INVALID_JSON: 400, INVALID_REQUEST: 400, UNKNOWN_FIELD: 400, DANGEROUS_JSON_KEY: 400, JSON_TOO_DEEP: 400, INVALID_INTENT: 400, INVALID_CHAIN_ID: 400, INVALID_TX_HASH: 400, INVALID_ADDRESS: 400, INVALID_ASSET: 400, INVALID_UINT: 400, INVALID_TIME: 400, INVALID_IDENTIFIER: 400, INVALID_CONSTRAINT: 400, INVALID_IDEMPOTENCY_KEY: 400, UNSUPPORTED_MEDIA_TYPE: 415, REQUEST_TOO_LARGE: 413, IDEMPOTENCY_CONFLICT: 409, POLICY_REJECTED: 403, INTENT_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 404, NOT_FOUND: 404, REQUEST_TIMEOUT: 504, RPC_NOT_CONFIGURED: 503, RPC_TIMEOUT: 503, RPC_FAILURE: 503 });

function requester(req, trustProxy) { return trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown' : req.socket.remoteAddress || 'unknown'; }

export function createHttpServer({ store = createMemoryStore(), issuer = 'runproof-local', privateKeyPem, publicKeyPem, keyId = 'default', keyRegistry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null }] : []), policy = null, maxBodyBytes = 64 * 1024, rateLimit = 60, rateLimiter = createMemoryRateLimiter({ limit: rateLimit }), requestTimeoutMs = 15_000, observer = observeEvm, corsOrigins = [], trustProxy = false, version = process.env.RUNPROOF_BUILD_VERSION ?? 'dev', staticDir, logger = null, now = () => Date.now() } = {}) {
  const serveStaticAsset = staticDir ? createStaticAssetHandler(staticDir) : null;
  return createServer(async (req, res) => {
    const requestId = typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : randomUUID();
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), requestTimeoutMs); const cleanup = () => clearTimeout(timeout);
    req.once('aborted', () => controller.abort()); res.once('close', cleanup); res.once('finish', cleanup);
    const path = requestPath(req); const origin = req.headers.origin; const cors = origin && corsOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type,idempotency-key,x-request-id', 'access-control-allow-methods': 'GET,POST,OPTIONS' } : {};
    const respond = (status, body, headers = {}) => sendJson(res, status, body, requestId, { ...cors, ...headers });
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
      if (!['GET', 'POST'].includes(req.method ?? '')) return respond(405, errorBody('METHOD_NOT_ALLOWED', 'Method not allowed', requestId), { allow: 'GET, POST, OPTIONS' });
      if (!rateLimiter.allow(requester(req, trustProxy), now())) return respond(429, errorBody('RATE_LIMITED', 'Too many requests', requestId), { 'retry-after': '60' });
      const body = req.method === 'POST' ? await readJsonBody(req, maxBodyBytes, controller.signal) : {};
      if (controller.signal.aborted) throw new RunProofError('REQUEST_TIMEOUT', 'Request timed out');
      if (req.method === 'GET' && path === '/health/live') return respond(200, { status: 'ok', requestId });
      if (req.method === 'GET' && path === '/health/ready') return respond(200, { status: 'ready', storage: store.health ? await store.health() : 'unknown', requestId });
      if (req.method === 'GET' && path === '/v1/version') return respond(200, { service: 'runproof', version, protocol: ['runproof.intent.v1', 'runproof.execution-receipt.v1'], requestId });
      if (req.method === 'GET' && path === '/openapi/v1.json') return respond(200, OPENAPI, { 'cache-control': 'public, max-age=300' });
      if (req.method === 'POST' && path === '/v1/intents') {
        const result = await createIntent({ input: body, idempotencyKey: req.headers['idempotency-key'], store, policy, now });
        return respond(result.replay ? 200 : 201, { ...result.response, requestId }, result.replay ? { 'idempotency-replayed': 'true' } : {});
      }
      if (req.method === 'POST' && path === '/v1/executions/observe') {
        const result = await observeExecution({ input: body, store, observer, signal: controller.signal, privateKeyPem, issuer, keyId, publicKeyPem });
        return respond(200, result);
      }
      const match = req.method === 'GET' && path.match(/^\/v1\/receipts\/([^/]+)$/);
      if (match) { const receipt = await store.getReceipt(decodeURIComponent(match[1])); if (!receipt) throw new RunProofError('RECEIPT_NOT_FOUND', 'Receipt not found'); return respond(200, { ...receipt, requestId }); }
      if (req.method === 'POST' && path === '/v1/receipts/verify') { assertOnlyFields(body, ['receipt'], 'verification request'); const entry = keyRegistry.get(body.receipt?.keyId); return respond(200, { convenienceEndpoint: true, independentVerification: 'Use the local verifier; do not trust this API response alone.', result: entry ? verifyReceipt(body.receipt, entry.publicKey, { keyId: entry.keyId, now: Math.floor(now() / 1000), key: entry }) : { valid: false, code: 'UNKNOWN_KEY' }, requestId }); }
      if (req.method === 'GET' && path === '/.well-known/runproof-keys.json') return respond(200, { schema: 'runproof.keys.v1', issuer, keys: keyRegistry.list(), verifierVersion: '1.0.0', schemaVersions: ['runproof.execution-receipt.v1'], requestId }, { 'cache-control': 'public, max-age=300' });
      if (req.method === 'GET' && serveStaticAsset && await serveStaticAsset({ pathname: path, res })) return;
      throw new RunProofError('NOT_FOUND', 'Route not found');
    } catch (error) {
      const code = controller.signal.aborted ? 'REQUEST_TIMEOUT' : error instanceof RunProofError ? error.code : error?.code || 'INTERNAL_ERROR'; const status = ERROR_STATUS[code] ?? 500;
      logger?.error?.({ event: 'http.request_failed', requestId, method: req.method, path, code, status });
      return respond(status, errorBody(code, status === 500 ? 'Internal server error' : error.message, requestId, status < 500 ? error.details : undefined));
    } finally { cleanup(); }
  });
}

const OPENAPI = { openapi: '3.1.0', info: { title: 'RunProof API', version: '1.0.0', description: 'HTTP verification is a convenience only. Offline verification of signed receipts is authoritative.' }, paths: { '/v1/intents': { post: { summary: 'Create pre-authorized intent', responses: { '201': { description: 'Created' }, '409': { description: 'Idempotency conflict' } } } }, '/v1/executions/observe': { post: { summary: 'Observe EVM execution', responses: { '200': { description: 'Observation' }, '503': { description: 'RPC unavailable, not a chain failure' } } } }, '/v1/receipts/{receiptId}': { get: { summary: 'Read receipt' } }, '/v1/receipts/verify': { post: { summary: 'Convenience verification, not authority' } }, '/health/live': { get: { summary: 'Liveness' } }, '/health/ready': { get: { summary: 'Readiness' } } } };
