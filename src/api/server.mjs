import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildIntent } from '../core/intent.mjs';
import { buildReceipt, signReceipt } from '../core/receipt.mjs';
import { verifyReceipt } from '../core/verifier.mjs';
import { observeEvm } from '../adapters/evm/observer.mjs';
import { createMemoryStore } from '../storage/memory.mjs';
import { createKeyRegistry } from '../core/keys.mjs';
import { evaluateIntentPolicy } from '../policy/engine.mjs';
const json = (res, status, body, requestId) => { res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId }); res.end(JSON.stringify(body)); };
export function createApiServer({ store = createMemoryStore(), issuer = 'runproof-demo', privateKeyPem, publicKeyPem, keyId = 'default', keyRegistry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null }] : []), policy = null, maxBodyBytes = 1024 * 64, rateLimit = 60, requestTimeoutMs = 15000, observer = observeEvm } = {}) {
  const requests = new Map();
  return createServer(async (req, res) => { const requestId = req.headers['x-request-id'] || randomUUID(); const timeout = setTimeout(() => { if (!res.writableEnded) json(res, 504, { error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out' } }, requestId); }, requestTimeoutMs); res.on('close', () => clearTimeout(timeout)); try {
    const now = Date.now(); const bucket = Math.floor(now / 60000); const key = `${req.socket.remoteAddress}:${bucket}`; const count = (requests.get(key) || 0) + 1; requests.set(key, count); if (count > rateLimit) return json(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, requestId);
    let body = {}; if (req.method !== 'GET') { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) return json(res, 413, { error: { code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds limit' } }, requestId); chunks.push(chunk); } try { body = JSON.parse(Buffer.concat(chunks)); } catch { return json(res, 400, { error: { code: 'INVALID_JSON', message: 'Malformed JSON' } }, requestId); } }
    if (req.method === 'POST' && req.url === '/v1/intents') { const intent = buildIntent(body); const policyResult = policy ? evaluateIntentPolicy(intent, policy) : { allowed: true, reasonCodes: [], policyId: null }; if (!policyResult.allowed) return json(res, 403, { error: { code: 'POLICY_REJECTED', message: 'Intent rejected by policy', details: policyResult } }, requestId); await store.saveIntent(intent); return json(res, 201, { intent, intentHash: intent.intentHash, policy: policyResult }, requestId); }
    if (req.method === 'POST' && req.url === '/v1/executions/observe') { const intent = body.intent || await store.getIntent(body.intentId); if (!intent) return json(res, 404, { error: { code: 'INTENT_NOT_FOUND', message: 'Intent not found' } }, requestId); const execution = await observer({ chainId: body.chainId, txHash: body.txHash, confirmations: body.confirmations, signal: req.signal }); await store.saveObservation(execution); const receipt = privateKeyPem ? signReceipt(buildReceipt({ intent, execution, issuer, keyId }), privateKeyPem) : null; if (receipt) await store.saveReceipt(receipt); return json(res, 200, { observation: execution, receipt, ...(receipt ? { verification: verifyReceipt(receipt, publicKeyPem, { keyId }) } : {}) }, requestId); }
    const receiptMatch = req.method === 'GET' && req.url.match(/^\/v1\/receipts\/([^/]+)$/); if (receiptMatch) { const receipt = await store.getReceipt(receiptMatch[1]); return receipt ? json(res, 200, receipt, requestId) : json(res, 404, { error: { code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found' } }, requestId); }
    if (req.method === 'POST' && req.url === '/v1/receipts/verify') { const entry = keyRegistry.get(body.receipt?.keyId); return json(res, 200, { convenienceEndpoint: true, independentVerification: 'Use the local verifier; do not trust this API response alone.', result: entry ? verifyReceipt(body.receipt, entry.publicKey, { keyId: entry.keyId }) : { valid: false, code: 'UNKNOWN_KEY' } }, requestId); }
    if (req.method === 'GET' && req.url === '/.well-known/runproof-keys.json') return json(res, 200, { schema: 'runproof.keys.v1', issuer, keys: keyRegistry.list(), verifierVersion: '1.0.0', schemaVersions: ['runproof.execution-receipt.v1'] }, requestId);
    return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } }, requestId);
  } catch (error) { return json(res, error.code === 'INVALID_INTENT' ? 400 : 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message, details: error.details || {} } }, requestId); }
  });
}
