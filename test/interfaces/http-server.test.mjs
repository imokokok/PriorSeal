import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { brotliDecompressSync } from 'node:zlib';
import { createHttpServer } from '../../src/index.mjs';
import { authorizationTypedData, buildAuthorization } from '../../src/index.mjs';
import { privateKeyToAccount } from 'viem/accounts';

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
  const done = new Promise((resolve) => res.once('finish', resolve)); server.emit('request', req, res); await done; return { status: res.status, headers: res.headers, buffer: () => Buffer.from(res.body ?? ''), json: () => JSON.parse(res.body), text: () => Buffer.from(res.body ?? '').toString('utf8') };
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
test('observation writes honor Idempotency-Key and return a signed linked receipt', async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  let calls = 0;
  const txHash = `0x${'1'.repeat(64)}`;
  const server = createHttpServer({ privateKeyPem, publicKeyPem, observer: async () => { calls += 1; return { chainId: 8453, txHash, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 1_000, observedAt: 1_001, sender, recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, confirmations: 12, gasUsed: '21000', transfers: [], blockHash: `0x${'c'.repeat(64)}`, finalityState: 'CONFIRMED', observationSource: 'evm-json-rpc:eip155:8453:configured-1' }; } });
  t.after(() => server.close());
  await request(server, '/v1/intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(intent) });
  const options = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'observe-1' }, body: JSON.stringify({ intentId: intent.intentId, chainId: 8453, txHash, confirmations: 12 }) };
  const first = await request(server, '/v1/executions/observe', options);
  const replay = await request(server, '/v1/executions/observe', options);
  assert.equal(first.status, 200);
  const issued = first.json().receipt;
  assert.equal(issued.binding.bound, true);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.equal(calls, 1);
  const fetched = await request(server, `/v1/receipts/${issued.receiptId}`);
  assert.deepEqual(fetched.json(), issued);
  assert.ok(fetched.headers['x-request-id']);
  const verified = await request(server, '/v1/receipts/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt: fetched.json() }) });
  assert.equal(verified.json().result.valid, true);
});
test('signed authorization is accepted before execution and produces a v2 receipt', async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const executionIntent = { ...intent, intentId: 'intent-authorized-api', sender: account.address.toLowerCase(), validUntil: 2_000 };
  const draft = buildAuthorization({ intent: executionIntent, principal: { type: 'organization', id: 'org-test', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-test', executor: account.address }, issuedAt: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'2'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const txHash = `0x${'5'.repeat(64)}`;
  const server = createHttpServer({ privateKeyPem, publicKeyPem, now: () => 1_001_000, observer: async () => ({ chainId: 8453, txHash, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 1_100, observedAt: 1_101, sender: account.address.toLowerCase(), recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, confirmations: 12, gasUsed: '21000', transfers: [], blockHash: `0x${'c'.repeat(64)}`, finalityState: 'CONFIRMED', observationSource: 'test' }) });
  t.after(() => server.close());
  const accepted = await request(server, '/v1/authorizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorization) });
  assert.equal(accepted.status, 201);
  const authorizationId = accepted.json().authorization.authorizationId;
  const observed = await request(server, '/v1/executions/observe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorizationId, chainId: 8453, txHash, confirmations: 12 }) });
  assert.equal(observed.status, 200);
  assert.equal(observed.json().receipt.schema, 'priorseal.execution-receipt.v2');
  assert.equal(observed.json().receipt.binding.bound, true);
  assert.equal(observed.json().verification.valid, true);
  const verified = await request(server, '/v1/receipts/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipt: observed.json().receipt }) });
  assert.equal(verified.json().result.valid, true);
});
test('serves the production console and preserves API 404 responses', async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), 'priorseal-static-'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>PriorSeal console</title>');
  await writeFile(join(staticDir, 'app.js'), `globalThis.example = '${'evidence-'.repeat(600)}';`);
  await writeFile(join(staticDir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const server = createHttpServer({ staticDir }); t.after(() => server.close());
  const root = await request(server, '/'); const route = await request(server, '/app/receipts'); const missingApi = await request(server, '/v1/missing');
  assert.equal(root.status, 200); assert.match(root.headers['content-type'], /^text\/html/); assert.match(root.text(), /PriorSeal console/);
  assert.equal(route.status, 200); assert.equal(route.text(), root.text());
  const compressed = await request(server, '/app.js', { headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(compressed.headers['content-encoding'], 'br'); assert.match(brotliDecompressSync(compressed.buffer()).toString(), /globalThis\.example/);
  const image = await request(server, '/photo.jpg'); assert.equal(image.headers['content-type'], 'image/jpeg'); assert.ok(image.headers.etag);
  const notModified = await request(server, '/photo.jpg', { headers: { 'if-none-match': image.headers.etag } }); assert.equal(notModified.status, 304);
  assert.equal(missingApi.status, 404); assert.equal(missingApi.json().error.code, 'NOT_FOUND');
});
