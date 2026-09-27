import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { pglitePool, testPostgresPool } from '../support/postgres.mjs';
import { createPostgresStore, createPostgresRwaAttemptStore, executeRwaAuthorized, reconcileRwaAttempt } from '../../src/index.mjs';
import * as sdk from '../../sdk/dist/index.js';
import { inspectRwaReceiptBundle as browserInspect } from '../../sdk/dist/verifier.js';
import { workflowFixture } from '../../examples/rwa-v2/workflow-fixture.mjs';

async function database(t: TestContext) {
  const names = (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort();
  const migration = (await Promise.all(names.map(async name => readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8')))).join('\n');
  if (process.env.RWA_TEST_DATABASE_URL) {
    const root = new pg.Pool({ connectionString: process.env.RWA_TEST_DATABASE_URL });
    const schema = 'rwa_test_' + randomUUID().replaceAll('-', '');
    await root.query('CREATE SCHEMA ' + schema);
    const pool = new pg.Pool({ connectionString: process.env.RWA_TEST_DATABASE_URL, options: '-c search_path=' + schema, max: 12 });
    t.after(async () => { await pool.end(); await root.query('DROP SCHEMA ' + schema + ' CASCADE'); await root.end(); });
    await pool.query(migration);
    return pool;
  }
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(migration);
  return pglitePool(db);
}
async function setup(t: TestContext) {
  const pool = await database(t), attempts = createPostgresRwaAttemptStore(pool);
  const x = await workflowFixture(sdk);
  const authorizationStore = createPostgresStore(pool);
  await authorizationStore.saveIntent(x.authorization.intent);
  const accepted = await x.store.getAuthorization(x.input.authorizationId);
  assert.ok(accepted);
  await authorizationStore.saveAuthorization(accepted);
  let calls = 0;
  const deps: Parameters<typeof executeRwaAuthorized>[1] = { authorizationStore, attempts, clock: () => x.f.now, submit: async tx => { assert.deepEqual(tx, x.f.transaction); calls++; return x.txHash; } };
  const input = x.input as unknown as Parameters<typeof executeRwaAuthorized>[0];
  const reserve = { authorizationId: input.authorizationId, transaction: x.f.transaction, executionDigest: input.execution.proof.digest, now: x.f.now };
  return { ...x, input, pool, attempts, deps, reserve, calls: () => calls };
}
test('shared database: twelve independent handles atomically claim one authorization and nonce', async t => {
  const x = await setup(t);
  const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => createPostgresRwaAttemptStore(x.pool).reserve({ ...x.reserve, authorizationId: 'auth_' + i.toString(16).padStart(32, '0') })));
  assert.equal(claims.filter(c => c.claimed).length, 1);
  assert.equal(claims.filter(c => c.code === 'RWA_NONCE_ALREADY_RESERVED').length, 11);
});
test('shared database: concurrent actual executor entries broadcast exactly once and verify the receipt in both runtimes', async t => {
  const x = await setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => executeRwaAuthorized(x.input, { ...x.deps, attempts: createPostgresRwaAttemptStore(x.pool) })));
  assert.equal(x.calls(), 1); assert.equal(results.filter(r => !r.replay).length, 1);
  assert.equal((await createPostgresStore(x.pool).getAuthorization(x.input.authorizationId))?.boundTxHash, x.txHash);
  for (const inspect of [sdk.inspectRwaReceiptBundle, browserInspect]) {
    const result = await inspect({ receipt: x.receipt() as unknown as sdk.Receipt, authority: x.input.authority.proof, execution: x.input.execution.proof }, x.input.authority.trust, x.options);
    assert.equal(result.admissible, true, JSON.stringify(result)); assert.equal(result.execution, 'SATISFIED');
  }
});
test('shared database: lost broadcast response survives a new handle and reconciliation never resends', async t => {
  const x = await setup(t); let calls = 0;
  await assert.rejects(executeRwaAuthorized(x.input, { ...x.deps, submit: async () => { calls++; throw new Error('lost RPC response'); } }), /lost RPC response/);
  const attempts = createPostgresRwaAttemptStore(x.pool);
  assert.equal((await attempts.get(x.input.authorizationId))?.status, 'UNCERTAIN');
  assert.equal((await executeRwaAuthorized(x.input, { ...x.deps, attempts })).replay, true);
  assert.equal(x.calls(), 0); assert.equal(calls, 1);
  const reconciled = await reconcileRwaAttempt(x.input.authorizationId, { ...x.deps, attempts, observe: async () => ({ transaction: x.f.transaction, txHash: x.txHash, status: 'CONFIRMED', finalized: true }) });
  assert.equal(reconciled.status, 'CONFIRMED'); assert.equal(x.calls(), 0);
  const conflict = await attempts.reserve({ ...x.reserve, authorizationId: 'auth_' + 'ff'.repeat(16) });
  assert.equal(conflict.code, 'RWA_NONCE_ALREADY_RESERVED');
});
test('shared database: compare-and-set permits only one competing same-second state transition', async t => {
  const x = await setup(t); await x.attempts.reserve(x.reserve);
  const results = await Promise.allSettled([
    x.attempts.transition(x.input.authorizationId, ['RESERVED'], { status: 'SUBMITTING', updatedAt: x.f.now }),
    createPostgresRwaAttemptStore(x.pool).transition(x.input.authorizationId, ['RESERVED'], { status: 'REJECTED', updatedAt: x.f.now }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('shared database: committed claim with a lost DB response cannot become a new broadcast', async t => {
  const x = await setup(t);
  const uncertain = createPostgresRwaAttemptStore(testPostgresPool({ query: async (sql, values) => { const r = await x.pool.query(sql, values); if (sql.startsWith('INSERT')) throw new Error('DB response lost'); return { rows: r.rows }; } }));
  await assert.rejects(executeRwaAuthorized(x.input, { ...x.deps, attempts: uncertain }), /DB response lost/);
  assert.equal((await executeRwaAuthorized(x.input, x.deps)).replay, true); assert.equal(x.calls(), 0);
});
test('shared database: corrupted persisted identities, clocks, transitions and terminal nonce reuse fail closed', async t => {
  const x = await setup(t); await x.attempts.reserve(x.reserve);
  await assert.rejects(x.attempts.transition(x.input.authorizationId, ['RESERVED'], { status: 'SUBMITTING', updatedAt: x.f.now - 1 }), /TIME_INVALID/);
  await assert.rejects(x.attempts.transition(x.input.authorizationId, ['RESERVED'], { status: 'CONFIRMED', txHash: x.txHash, updatedAt: x.f.now }), /TRANSITION_INVALID/);
  await x.attempts.transition(x.input.authorizationId, ['RESERVED'], { status: 'REJECTED', updatedAt: x.f.now });
  assert.equal((await x.attempts.reserve({ ...x.reserve, authorizationId: 'auth_' + 'ff'.repeat(16) })).claimed, false);
  await x.pool.query(`UPDATE rwa_execution_attempts SET record_json=jsonb_set(record_json,'{transaction,nonce}','"9"'::jsonb)`);
  await assert.rejects(x.attempts.get(x.input.authorizationId), /JOURNAL_INVALID/);
  await assert.rejects(executeRwaAuthorized(x.input, x.deps)); assert.equal(x.calls(), 0);
});
test('shared database: invalid untrusted reservations are rejected before a database query', async () => {
  let queries = 0;
  const store = createPostgresRwaAttemptStore(testPostgresPool({ query: async () => { queries++; throw new Error('unexpected query'); } }));
  await assert.rejects(store.reserve({ authorizationId: 'auth_invalid', transaction: {}, executionDigest: 'bad', now: NaN }), /RESERVATION_INVALID/);
  assert.equal(queries, 0);
});
test('shared database: a persisted transaction hash cannot be cleared by a null recovery patch', async t => {
  const x = await setup(t); await executeRwaAuthorized(x.input, x.deps);
  await assert.rejects(x.attempts.transition(x.input.authorizationId, ['SUBMITTED'], { status: 'CONFIRMED', txHash: null, updatedAt: x.f.now }), /TX_HASH_CONFLICT/);
  assert.equal((await x.attempts.get(x.input.authorizationId))?.txHash, x.txHash);
});
test('shared database: principal revocation during gas preparation stops the actual pre-broadcast gate', async t => {
  const x = await setup(t); let broadcasts = 0;
  await assert.rejects(executeRwaAuthorized(x.input, { ...x.deps, submit: async (_tx, guard) => {
    await x.pool.query("UPDATE authorizations SET status='REVOKED' WHERE authorization_id=$1", [x.input.authorizationId]);
    await guard(); broadcasts++; return x.txHash;
  } }), /AUTHORIZATION_ALREADY_USED/);
  assert.equal(broadcasts, 0); assert.equal((await x.attempts.get(x.input.authorizationId))?.status, 'UNCERTAIN');
});
