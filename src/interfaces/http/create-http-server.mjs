import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyReceipt } from '../../domain/receipt-verifier.mjs';
import { observeEvm } from '../../infrastructure/blockchain/evm/observer.mjs';
import { createMemoryStore } from '../../infrastructure/persistence/memory-store.mjs';
import { createKeyRegistry } from '../../domain/key-registry.mjs';
import { PriorSealError } from '../../domain/errors.mjs';
import { assertOnlyFields } from '../../shared/safe-json.mjs';
import { createIntent } from '../../application/intents/create-intent.mjs';
import { authorizeIntent } from '../../application/authorizations/authorize-intent.mjs';
import { AUTHORIZATION_SCHEMA, authorizationTypedData, buildAuthorization, verifyAuthorizedReceipt } from '../../domain/authorization.mjs';
import { observeExecution } from '../../application/observations/observe-execution.mjs';
import { createMemoryRateLimiter } from './rate-limiter.mjs';
import { readJsonBody, requestPath } from './request-parser.mjs';
import { errorBody, sendJson } from './response-writer.mjs';
import { hashJson } from '../../domain/hashing.mjs';
import { createStaticAssetHandler } from './static-assets.mjs';
import { buildVerificationBundle } from '../../domain/verification-bundle.mjs';

const ERROR_STATUS = Object.freeze({ INVALID_JSON: 400, INVALID_REQUEST: 400, UNKNOWN_FIELD: 400, DANGEROUS_JSON_KEY: 400, JSON_TOO_DEEP: 400, INVALID_INTENT: 400, INVALID_AUTHORIZATION: 400, MISSING_AUTHORIZATION_SIGNATURE: 400, INVALID_AUTHORIZATION_SIGNATURE: 400, AUTHORIZATION_AUDIENCE_MISMATCH: 400, AUTHORIZATION_NOT_YET_VALID: 400, AUTHORIZATION_ISSUED_IN_FUTURE: 400, AUTHORIZATION_POLICY_MISMATCH: 409, AUTHORIZATION_EXPIRED: 410, AUTHORIZATION_ALREADY_USED: 409, AUTHORIZATION_NONCE_REUSED: 409, INVALID_TIMESTAMP_EVIDENCE: 400, INVALID_TIMESTAMP_PROFILE: 400, TIMESTAMP_POLICY_MISMATCH: 409, TIMESTAMP_AUTHORIZATION_MISMATCH: 409, TIMESTAMP_RESPONSE_HASH_MISMATCH: 409, TIMESTAMP_METADATA_MISMATCH: 409, INVALID_TIMESTAMP_POLICY: 400, TIMESTAMP_CLOCK_SKEW: 409, TIMESTAMP_AFTER_EXECUTION: 409, INVALID_TIMESTAMP_SIGNATURE: 409, INVALID_TIMESTAMP_CERTIFICATE_USAGE: 409, UNTRUSTED_TIMESTAMP_ROOT: 409, TIMESTAMP_SERVICE_UNAVAILABLE: 503, TIMESTAMP_NOT_CONFIGURED: 503, INVALID_TIMESTAMP_RESPONSE: 502, INVALID_WITNESS_POLICY: 400, INVALID_WITNESS_EVIDENCE: 400, WITNESS_POLICY_MISMATCH: 409, WITNESS_AUTHORIZATION_MISMATCH: 409, WITNESS_ACCEPTANCE_MISMATCH: 409, WITNESS_QUORUM_NOT_MET: 409, WITNESS_QUORUM_UNAVAILABLE: 503, WITNESS_NOT_CONFIGURED: 503, TRANSPARENCY_ANCHOR_REQUIRED: 409, INVALID_CHAIN_ID: 400, INVALID_TX_HASH: 400, INVALID_ADDRESS: 400, INVALID_ASSET: 400, INVALID_UINT: 400, INVALID_TIME: 400, INVALID_IDENTIFIER: 400, INVALID_CONSTRAINT: 400, INVALID_IDEMPOTENCY_KEY: 400, UNSUPPORTED_MEDIA_TYPE: 415, REQUEST_TOO_LARGE: 413, IDEMPOTENCY_CONFLICT: 409, POLICY_REJECTED: 403, INTENT_NOT_FOUND: 404, AUTHORIZATION_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 404, NOT_FOUND: 404, REQUEST_TIMEOUT: 504, ISSUER_NOT_CONFIGURED: 503, AUTHORIZATION_VERIFIER_UNAVAILABLE: 503, RPC_NOT_CONFIGURED: 503, RPC_TIMEOUT: 503, RPC_FAILURE: 503 });

function requester(req, trustProxy) { return trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown' : req.socket.remoteAddress || 'unknown'; }

export function createHttpServer({ store = createMemoryStore(), issuer = 'priorseal-local', privateKeyPem, publicKeyPem, keyId = 'default', keyRegistry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null }] : []), policy = null, authorizationAudience = 'priorseal', verifyContractSignature, timestampProvider = null, requireTimestamp = false, witnessProvider = null, requireWitnessQuorum = false, transparencyProvider = null, observationWorker = null, maxBodyBytes = 64 * 1024, rateLimit = 60, rateLimiter = createMemoryRateLimiter({ limit: rateLimit }), requestTimeoutMs = 15_000, observer = observeEvm, corsOrigins = [], trustProxy = false, version = process.env.PRIORSEAL_BUILD_VERSION ?? 'dev', staticDir, logger = null, now = () => Date.now() } = {}) {
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
      if (req.method === 'GET' && path === '/health/live') return respond(200, { status: 'ok', requestId });
      if (req.method === 'GET' && path === '/health/ready') return respond(200, { status: 'ready', storage: store.health ? await store.health() : 'unknown', requestId });
      if (req.method === 'GET' && serveStaticAsset && await serveStaticAsset({ pathname: path, req, res })) return;
      if (!rateLimiter.allow(requester(req, trustProxy), now())) return respond(429, errorBody('RATE_LIMITED', 'Too many requests', requestId), { 'retry-after': '60' });
      const body = req.method === 'POST' ? await readJsonBody(req, maxBodyBytes, controller.signal) : {};
      if (controller.signal.aborted) throw new PriorSealError('REQUEST_TIMEOUT', 'Request timed out');
      if (req.method === 'GET' && path === '/v1/version') return respond(200, { service: 'priorseal', version, protocol: ['priorseal.intent.v1', 'priorseal.intent.v2', 'priorseal.execution-profile.exact-call.v1', 'priorseal.context-commitment.v1', 'priorseal.authorization.v1', 'priorseal.authorization.v2', 'priorseal.rfc3161-evidence.v1', 'priorseal.witness-attestation.v1', 'priorseal.execution-receipt.v1', 'priorseal.execution-receipt.v2', 'priorseal.execution-receipt.v3', 'priorseal.compliance-assessment.v1', 'priorseal.verification-bundle.v1'], requestId });
      if (req.method === 'GET' && path === '/openapi/v1.json') return respond(200, OPENAPI, { 'cache-control': 'public, max-age=300' });
      if (req.method === 'POST' && path === '/v1/intents') {
        const result = await createIntent({ input: body, idempotencyKey: req.headers['idempotency-key'], store, policy, now });
        return respond(result.replay ? 200 : 201, { ...result.response, requestId }, result.replay ? { 'idempotency-replayed': 'true' } : {});
      }
      if (req.method === 'POST' && path === '/v1/authorizations/prepare') {
        const authorization = buildAuthorization({ ...body, audience: authorizationAudience, policyHash: policy ? `0x${hashJson(policy)}` : `0x${'0'.repeat(64)}` });
        if (authorization.schema !== AUTHORIZATION_SCHEMA) throw new PriorSealError('INVALID_AUTHORIZATION', 'Legacy authorization schemas are verification-only');
        const typedData = jsonSafe(authorizationTypedData(authorization));
        return respond(200, { authorization, typedData, requestId });
      }
      if (req.method === 'POST' && path === '/v1/authorizations') {
        const result = await authorizeIntent({ input: body, idempotencyKey: req.headers['idempotency-key'], store, privateKeyPem, issuer, keyId, policy, audience: authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp, witnessProvider, requireWitnessQuorum, now });
        return respond(result.replay ? 200 : 201, { ...result.response, requestId }, result.replay ? { 'idempotency-replayed': 'true' } : {});
      }
      const authorizationMatch = req.method === 'GET' && path.match(/^\/v1\/authorizations\/([^/]+)$/);
      if (authorizationMatch) { const record = await store.getAuthorization?.(decodeURIComponent(authorizationMatch[1])); if (!record) throw new PriorSealError('AUTHORIZATION_NOT_FOUND', 'Authorization not found'); return respond(200, record); }
      if (req.method === 'POST' && path === '/v1/executions/observe') {
        const result = await observeExecution({ input: body, store, observer, signal: controller.signal, privateKeyPem, issuer, keyId, publicKeyPem, idempotencyKey: req.headers['idempotency-key'], transparencyProvider, authorizationAudience, verifyContractSignature, now });
        const observationJob = observationWorker && ['PENDING', 'NOT_FOUND', 'RPC_ERROR', 'RPC_TIMEOUT'].includes(result.response.observation.status) ? await observationWorker.enqueuePersistent({ ...body, idempotencyKey: `${body.authorizationId ?? body.intentId}:${body.chainId}:${body.txHash}:${body.confirmations ?? 0}` }) : null;
        return respond(200, { ...result.response, ...(observationJob ? { observationJob } : {}), requestId }, result.replay ? { 'idempotency-replayed': 'true' } : {});
      }
      const transparencyMatch = req.method === 'GET' && path.match(/^\/v1\/authorizations\/([^/]+)\/transparency$/);
      if (transparencyMatch) { const record = await store.getAuthorization?.(decodeURIComponent(transparencyMatch[1])); if (!record) throw new PriorSealError('AUTHORIZATION_NOT_FOUND', 'Authorization not found'); if (!transparencyProvider) throw new PriorSealError('ISSUER_NOT_CONFIGURED', 'Transparency checkpoint signing is unavailable'); return respond(200, await transparencyProvider(record.acceptance)); }
      const jobMatch = req.method === 'GET' && path.match(/^\/v1\/observation-jobs\/([^/]+)$/);
      if (jobMatch && observationWorker) { const job = await observationWorker.get(decodeURIComponent(jobMatch[1])); if (!job) throw new PriorSealError('NOT_FOUND', 'Observation job not found'); return respond(200, job); }
      const bundleMatch = req.method === 'GET' && path.match(/^\/v1\/receipts\/([^/]+)\/bundle$/);
      if (bundleMatch) { const receipt = await store.getReceipt(decodeURIComponent(bundleMatch[1])); if (!receipt) throw new PriorSealError('RECEIPT_NOT_FOUND', 'Receipt not found'); return respond(200, buildVerificationBundle({ receipt, keyRegistry: keyRegistryDocument(issuer, keyRegistry), assembledAt: Math.floor(now() / 1000) })); }
      const match = req.method === 'GET' && path.match(/^\/v1\/receipts\/([^/]+)$/);
      if (match) { const receipt = await store.getReceipt(decodeURIComponent(match[1])); if (!receipt) throw new PriorSealError('RECEIPT_NOT_FOUND', 'Receipt not found'); return respond(200, receipt); }
      if (req.method === 'POST' && path === '/v1/receipts/verify') { assertOnlyFields(body, ['receipt'], 'verification request'); const entry = keyRegistry.get(body.receipt?.keyId); const result = !entry ? { valid: false, code: 'UNKNOWN_KEY' } : ['priorseal.execution-receipt.v2', 'priorseal.execution-receipt.v3'].includes(body.receipt?.schema) ? await verifyAuthorizedReceipt(body.receipt, entry.publicKey, { audience: authorizationAudience, verifyContractSignature, key: entry, now: Math.floor(now() / 1000) }) : verifyReceipt(body.receipt, entry.publicKey, { keyId: entry.keyId, now: Math.floor(now() / 1000), key: entry }); return respond(200, { convenienceEndpoint: true, independentVerification: 'Use the local verifier; do not trust this API response alone.', result, requestId }); }
      if (req.method === 'GET' && path === '/.well-known/priorseal-keys.json') return respond(200, { ...keyRegistryDocument(issuer, keyRegistry), requestId }, { 'cache-control': 'public, max-age=300' });
      throw new PriorSealError('NOT_FOUND', 'Route not found');
    } catch (error) {
      const code = controller.signal.aborted ? 'REQUEST_TIMEOUT' : error instanceof PriorSealError ? error.code : error?.code || 'INTERNAL_ERROR'; const status = ERROR_STATUS[code] ?? 500;
      logger?.error?.({ event: 'http.request_failed', requestId, method: req.method, path, code, status });
      return respond(status, errorBody(code, status === 500 ? 'Internal server error' : error.message, requestId, status < 500 ? error.details : undefined));
    } finally { cleanup(); }
  });
}

function jsonSafe(value) { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)); }

function keyRegistryDocument(issuer, keyRegistry) { return { schema: 'priorseal.keys.v1', issuer, keys: keyRegistry.list(), verifierVersion: '3.0.0', schemaVersions: ['priorseal.intent.v1', 'priorseal.intent.v2', 'priorseal.execution-profile.exact-call.v1', 'priorseal.context-commitment.v1', 'priorseal.authorization.v1', 'priorseal.authorization.v2', 'priorseal.rfc3161-evidence.v1', 'priorseal.execution-receipt.v1', 'priorseal.execution-receipt.v2', 'priorseal.execution-receipt.v3', 'priorseal.compliance-assessment.v1', 'priorseal.verification-bundle.v1'] }; }

const OPENAPI = { openapi: '3.1.0', info: { title: 'PriorSeal API', version: '2.0.0', description: 'Signed authorization and independently verifiable execution evidence.' }, paths: { '/v1/intents': { post: { summary: 'Create a legacy unsigned intent draft', deprecated: true, responses: { '201': { description: 'Created' } } } }, '/v1/authorizations/prepare': { post: { summary: 'Canonicalize an authorization and return EIP-712 typed data' } }, '/v1/authorizations': { post: { summary: 'Verify and accept a signed authorization' } }, '/v1/authorizations/{authorizationId}': { get: { summary: 'Read authorization state' } }, '/v1/authorizations/{authorizationId}/transparency': { get: { summary: 'Read signed transparency evidence and any verified external anchor' } }, '/v1/executions/observe': { post: { summary: 'Observe EVM execution against an authorization' } }, '/v1/observation-jobs/{jobId}': { get: { summary: 'Read automatic finality observation job' } }, '/v1/receipts/{receiptId}': { get: { summary: 'Read receipt' } }, '/v1/receipts/{receiptId}/bundle': { get: { summary: 'Export portable receipt evidence and key-discovery metadata' } }, '/v1/receipts/verify': { post: { summary: 'Convenience verification, not authority' } }, '/.well-known/priorseal-keys.json': { get: { summary: 'Read the issuer public-key registry' } }, '/v1/version': { get: { summary: 'Read service and protocol versions' } }, '/health/live': { get: { summary: 'Liveness' } }, '/health/ready': { get: { summary: 'Readiness' } } } };
