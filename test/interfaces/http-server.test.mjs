import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHttpServer } from '../../src/index.mjs';

const sender = `0x${'a'.repeat(40)}`;
const recipient = `0x${'b'.repeat(40)}`;
const intent = { intentId: 'intent-api-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1000000', sender, recipient, validUntil: 2_000_000_000, nonce: '0' };

async function serverFor(testContext) {
  const server = createHttpServer({ observer: async () => ({ chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'PENDING', sender, recipient, finalityState: 'PENDING' }) });
  testContext.after(() => server.close()); return server;
}
async function request(server, path, { method = 'GET', headers = {}, body } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []); Object.assign(req, { method, url: path, headers, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter(); res.writableEnded = false; res.destroyed = false; res.writeHead = (status, responseHeaders) => { res.status = status; res.headers = responseHeaders; return res; }; res.end = (value) => { res.writableEnded = true; res.body = value; res.emit('finish'); res.emit('close'); };
  const done = new Promise((resolve) => res.once('finish', resolve)); server.emit('request', req, res); await done; return { status: res.status, headers: res.headers, json: () => JSON.parse(res.body) };
}
test('API matches pathnames with query strings and uses idempotency safely', async (t) => {
  const server = await serverFor(t); const options = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'intent-1' }, body: JSON.stringify(intent) };
  const first = await request(server, '/v1/intents?source=test', options); assert.equal(first.status, 201); assert.equal(first.headers['x-content-type-options'], 'nosniff');
  const replay = await request(server, '/v1/intents', options); assert.equal(replay.status, 200); assert.equal(replay.headers['idempotency-replayed'], 'true');
  const conflict = await request(server, '/v1/intents', { ...options, body: JSON.stringify({ ...intent, amount: '2' }) }); assert.equal(conflict.status, 409); assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
});
test('API rejects unknown fields and unsafe JSON keys without exposing internals', async (t) => {
  const server = await serverFor(t); const unknown = await request(server, '/v1/intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...intent, unexpected: true }) }); assert.equal(unknown.status, 400); assert.equal(unknown.json().error.code, 'UNKNOWN_FIELD');
  const badType = await request(server, '/v1/intents', { method: 'POST', body: JSON.stringify(intent) }); assert.equal(badType.status, 415);
  const health = await request(server, '/health/live'); assert.equal(health.json().status, 'ok');
});
