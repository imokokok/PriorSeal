import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore } from '../../src/index.mjs';
import { testPostgresPool, type TestClient } from '../support/postgres.mjs';
import { pglitePool } from '../support/postgres.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const hasCode = (error: unknown, code: string) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('Postgres store rejects a receipt ID collision but permits an identical replay', async () => {
  const original = { receiptId: 'psr_same', intentHash: 'intent', execution: { txHash: '0x1' }, schema: 'v1', issuer: 'test', keyId: 'k1', outcome: 'COMPLETED', signature: 'original' };
  const pool = testPostgresPool({ query: async (sql) => { if (sql.startsWith('INSERT INTO receipts')) return { rows: [] }; if (sql.startsWith('SELECT receipt_json FROM receipts')) return { rows: [{ receipt_json: original }] }; throw new Error(`Unexpected query: ${sql}`); } });
  const store = createPostgresStore(pool);
  await assert.rejects(() => store.saveReceipt({ receiptId: 'psr_same', intentHash: 'intent', execution: { txHash: '0x1' }, schema: 'v1', issuer: 'test', keyId: 'k1', outcome: 'COMPLETED', signature: 'new' }), (error) => hasCode(error, 'RECEIPT_ID_CONFLICT'));
  assert.equal(await store.saveReceipt(original), original);
});

test('Postgres idempotency rows can be read and expired rows can be replaced', async () => {
  const expiresAt = new Date(2_000);
  const calls: string[] = [];
  const pool = testPostgresPool({ query: async (sql) => { calls.push(sql); if (sql.startsWith('SELECT request_hash')) return { rows: [{ request_hash: 'hash', response_json: { ok: true }, expires_at: expiresAt }] }; if (sql.startsWith('INSERT INTO idempotency_records')) return { rows: [{ response_json: { ok: false } }] }; throw new Error(`Unexpected query: ${sql}`); } });
  const store = createPostgresStore(pool);
  assert.deepEqual(await store.getIdempotency('scope', 'key'), { requestHash: 'hash', response: { ok: true }, expiresAt: 2_000 });
  assert.deepEqual(await store.reserveIdempotency({ scope: 'scope', key: 'key', requestHash: 'new', response: { ok: false }, expiresAt: 3_000 }), { replay: false, response: { ok: false } });
  assert.match(calls[1], /expires_at <= now\(\)/);
});

test('Postgres observation persistence rolls back the authorization claim with evidence', async () => {
  const calls: string[] = []; let released = false;
  const client: TestClient = { async query(sql) { calls.push(sql); if (sql.startsWith('UPDATE authorizations')) return { rows: [{}] }; if (sql.startsWith('INSERT INTO receipts')) throw new Error('receipt insert failed'); return { rows: [] }; }, release() { released = true; } };
  const pool = testPostgresPool({ query: async () => ({ rows: [] }), connect: async () => client });
  const store = createPostgresStore(pool);
  await assert.rejects(() => store.saveObservationReceipt({ authorizationId: 'auth_1', claimAuthorization: true, observation: { intentHash: 'intent', chainId: 8453, txHash: '0x1', status: 'CONFIRMED', blockNumber: 1, observedAt: 1, finalityState: 'CONFIRMED' }, receipt: { receiptId: 'psr_1', intentHash: 'intent', execution: { txHash: '0x1' }, schema: 'v2', issuer: 'test', keyId: 'k1', outcome: 'COMPLETED', signature: 'sig' } }), /receipt insert failed/);
  assert.ok(calls.includes('BEGIN'));
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(released, true);
});

test('Postgres observation claims recover expired leases and reject a stale owner update', async () => {
  const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
  const claimedRow = { job_id: 'job-1', idempotency_key: 'same', input_json: { chainId: 8453, txHash: '0x1' }, state: 'RUNNING', attempts: 2, next_attempt_at: new Date(1_000), observation_json: null, result_json: null, error_json: null, created_at: new Date(0), lease_token: 'lease-token', lease_expires_at: new Date(901_000) };
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      calls.push({ sql, parameters });
      if (sql.startsWith('WITH due AS')) return { rows: [claimedRow] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = testPostgresPool({
    connect: async () => client,
    async query(sql: string, parameters?: unknown[]) {
      calls.push({ sql, parameters });
      if (sql.startsWith('UPDATE observation_jobs')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  });
  const store = createPostgresStore(pool);
  const [claim] = await store.claimDueJobs(1_000, 10, 900_000);
  assert.ok(claim);
  assert.equal(claim.leaseToken, 'lease-token');
  const claimCall = calls.find((call) => call.sql.startsWith('WITH due AS'));
  assert.ok(claimCall);
  assert.match(claimCall.sql, /state='RUNNING' AND lease_expires_at <=/);
  assert.equal(await store.saveJob({ ...claim, state: 'COMPLETED' }), undefined);
  const save = calls.find((call) => call.sql.startsWith('UPDATE observation_jobs'));
  assert.ok(save?.parameters);
  assert.match(save.sql, /lease_token=\$8/);
  assert.equal(save.parameters[7], 'lease-token');
});

test('Postgres targeted claims respect backoff, lease ownership and terminal state', async () => {
  const database = new PGlite();
  try {
    for (const migration of ['001_init.sql', '002_runtime_state.sql', '007_observation_job_results.sql', '008_observation_job_leases.sql']) {
      await database.exec(await readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
    }
    const store = createPostgresStore(pglitePool(database));
    const job = { jobId: 'targeted', idempotencyKey: 'targeted-key', input: { chainId: 8453, txHash: '0x1' }, state: 'QUEUED', attempts: 0, nextAttemptAt: 1000, createdAt: 0, observation: null, result: null, error: null };
    await store.enqueueJob(job);
    await store.enqueueJob({ ...job, jobId: 'other', idempotencyKey: 'other-key' });
    assert.equal(await store.claimJob(job.jobId, 999, 100), undefined);
    const first = await store.claimJob(job.jobId, 1000, 100);
    assert.ok(first);
    assert.equal(first.attempts, 1);
    assert.equal(await store.claimJob(job.jobId, 1099, 100), undefined);
    assert.equal((await store.getJob('other'))?.state, 'QUEUED');
    const recovered = await store.claimJob(job.jobId, 1100, 100);
    assert.ok(recovered);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.leaseToken, first.leaseToken);
    assert.equal(await store.saveJob({ ...first, state: 'COMPLETED' }), undefined);
    await store.saveJob({ ...recovered, state: 'RETRY_WAIT', nextAttemptAt: 2000 });
    assert.equal(await store.claimJob(job.jobId, 1999), undefined);
    const retry = await store.claimJob(job.jobId, 2000);
    assert.ok(retry);
    await store.saveJob({ ...retry, state: 'COMPLETED' });
    assert.equal(await store.claimJob(job.jobId, 3000), undefined);
  } finally { await database.close(); }
});
