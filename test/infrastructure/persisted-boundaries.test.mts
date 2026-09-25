import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Store } from '../../src/infrastructure/persistence/d1-store.mjs';
import { createPostgresStore } from '../../src/infrastructure/persistence/postgres-store.mjs';
import { testPostgresPool } from '../support/postgres.mjs';

test('D1 rejects malformed persisted intents before returning them as typed records', async () => {
  const database = { prepare: () => ({ bind() { return this; }, async first() { return { intent_json: JSON.stringify({ intentId: 'i', schema: 'priorseal.intent.v1' }) }; } }), batch: async () => [] } as unknown as D1Database;
  await assert.rejects(createD1Store(database).getIntent('i'), /Invalid persisted intent.intentHash/);
});

test('Postgres rejects malformed persisted receipts before returning them as typed records', async () => {
  const pool = testPostgresPool({ query: async () => ({ rows: [{ receipt_json: { receiptId: 'r', intentHash: 'h', schema: 'v1', issuer: 'issuer', keyId: 'key', outcome: 'COMPLETED', execution: null } }] }) });
  await assert.rejects(createPostgresStore(pool).getReceipt('r'), /Invalid persisted receipt.execution/);
});
