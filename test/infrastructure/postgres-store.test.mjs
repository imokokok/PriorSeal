import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore } from '../../src/index.mjs';

test('Postgres store preserves an existing immutable receipt', async () => {
  const original = { receiptId: 'psr_same', marker: 'original' };
  const pool = { async query(sql) { if (sql.startsWith('INSERT INTO receipts')) return { rows: [] }; if (sql.startsWith('SELECT receipt_json FROM receipts')) return { rows: [{ receipt_json: original }] }; throw new Error(`Unexpected query: ${sql}`); } };
  const store = createPostgresStore(pool);
  const result = await store.saveReceipt({ receiptId: 'psr_same', intentHash: 'intent', execution: { txHash: '0x1' }, schema: 'v1', issuer: 'test', keyId: 'k1', outcome: 'COMPLETED', signature: 'new' });
  assert.equal(result, original);
});

test('Postgres idempotency rows can be read and expired rows can be replaced', async () => {
  const expiresAt = new Date(2_000);
  const calls = [];
  const pool = { async query(sql) { calls.push(sql); if (sql.startsWith('SELECT request_hash')) return { rows: [{ request_hash: 'hash', response_json: { ok: true }, expires_at: expiresAt }] }; if (sql.startsWith('INSERT INTO idempotency_records')) return { rows: [{ response_json: { ok: false } }] }; throw new Error(`Unexpected query: ${sql}`); } };
  const store = createPostgresStore(pool);
  assert.deepEqual(await store.getIdempotency('scope', 'key'), { requestHash: 'hash', response: { ok: true }, expiresAt: 2_000 });
  assert.deepEqual(await store.reserveIdempotency({ scope: 'scope', key: 'key', requestHash: 'new', response: { ok: false }, expiresAt: 3_000 }), { replay: false, response: { ok: false } });
  assert.match(calls[1], /expires_at <= now\(\)/);
});
