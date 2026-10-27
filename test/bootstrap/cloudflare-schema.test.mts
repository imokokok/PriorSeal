import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaGuard } from '../../src/bootstrap/cloudflare-schema.mjs';
import { loadRuntimeConfig } from '../../src/bootstrap/runtime-config.mjs';
import { testD1 } from '../support/d1.mjs';

test('schema readiness skips repeated cache I/O and expires with the edge entry', async () => {
  const fixture = testD1();
  let now = 1_000_000;
  let matches = 0;
  let puts = 0;
  const entries = new Map<string, Response>();
  const cache = {
    async match(key: Request) {
      matches += 1;
      const entry = entries.get(key.url);
      const checkedAt = Number(entry?.headers.get('x-schema-checked-at'));
      return entry && now < checkedAt + 300_000 ? entry : undefined;
    },
    async put(key: Request, response: Response) { puts += 1; entries.set(key.url, response); },
  } as unknown as Cache;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  const config = loadRuntimeConfig();
  try {
    const firstIsolate = createSchemaGuard(() => now);
    await firstIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 1);
    assert.equal(puts, 1);
    assert.equal(fixture.calls.length, 3);

    await firstIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 1);
    assert.equal(fixture.calls.length, 3);

    const secondIsolate = createSchemaGuard(() => now);
    await secondIsolate(fixture.database, config, context, cache);
    await secondIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 2);
    assert.equal(fixture.calls.length, 3);

    now += 300_000;
    await firstIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 3);
    assert.equal(puts, 2);
    assert.equal(fixture.calls.length, 6);
  } finally { fixture.sqlite.close(); }
});
test('missing schema never enters the in-isolate or edge cache', async () => {
  const guard = createSchemaGuard();
  let matches = 0;
  let puts = 0;
  const cache = { async match() { matches += 1; return undefined; }, async put() { puts += 1; } } as unknown as Cache;
  const database = { prepare() { return { bind() { return { async all() { return { results: [] }; } }; } }; } } as unknown as D1Database;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  const config = loadRuntimeConfig();
  await assert.rejects(() => guard(database, config, context, cache), /Required D1 production tables are missing/);
  await assert.rejects(() => guard(database, config, context, cache), /Required D1 production tables are missing/);
  assert.equal(matches, 2);
  assert.equal(puts, 0);
});

test('missing observation coalescing column never enters the cache', async () => {
  const guard = createSchemaGuard();
  let puts = 0;
  const cache = { async match() { return undefined; }, async put() { puts += 1; } } as unknown as Cache;
  const requiredTables = ['authorization_log', 'authorization_log_merkle_nodes', 'authorizations', 'observation_jobs', 'receipts'];
  const database = {
    prepare(sql: string) {
      const all = async () => ({ results: sql.startsWith('PRAGMA') ? [] : requiredTables.map((name) => ({ name })) });
      return { bind() { return { all }; }, all };
    },
  } as unknown as D1Database;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  await assert.rejects(() => guard(database, loadRuntimeConfig(), context, cache), /coalescing column/);
  assert.equal(puts, 0);
});

test('x402 schema readiness requires the durable payment ledger', async () => {
  const fixture = testD1();
  const guard = createSchemaGuard();
  const cache = { async match() { return undefined; }, async put() {} } as unknown as Cache;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  const config = loadRuntimeConfig({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://x402.org/facilitator',
    PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://priorseal.xyz',
    PRIORSEAL_X402_PAY_TO: `0x${'a'.repeat(40)}`,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453',
    PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/receipts/:receiptId/bundle","description":"Export a portable PriorSeal receipt bundle","price":"$0.02"}]',
  });
  try {
    await guard(fixture.database, config, context, cache);
    fixture.sqlite.exec('DROP TABLE x402_payment_ledger_events');
    const freshGuard = createSchemaGuard();
    await assert.rejects(() => freshGuard(fixture.database, config, context, cache), /Required D1 production tables are missing/);
  } finally { fixture.sqlite.close(); }
});

test('x402 Credit-pack readiness requires the durable purchase table', async () => {
  const fixture = testD1();
  const guard = createSchemaGuard();
  const cache = { async match() { return undefined; }, async put() {} } as unknown as Cache;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  const config = loadRuntimeConfig({
    PRIORSEAL_X402_FACILITATOR_URL: 'https://x402.org/facilitator', PRIORSEAL_X402_RESOURCE_ORIGIN: 'https://priorseal.xyz', PRIORSEAL_X402_PAY_TO: `0x${'a'.repeat(40)}`,
    PRIORSEAL_X402_NETWORKS: 'eip155:8453', PRIORSEAL_X402_ROUTES_JSON: '[{"method":"GET","path":"/v1/agent-credit-packs/standard-100/checkout","description":"Buy 100 Agent credits","price":"$1.00"}]',
    PRIORSEAL_AGENT_METER_JSON: JSON.stringify({ schema: 'priorseal.agent-meter.v1', creditUnitUsd: '0.01', operatorCredentialHash: 'a'.repeat(64), accounts: [], routes: [] }),
    PRIORSEAL_X402_CREDIT_PACKS_JSON: JSON.stringify({ schema: 'priorseal.x402-credit-packs.v1', packs: [{ packId: 'standard-100', credits: '100', priceUsd: '1.00' }] }),
  });
  try {
    await guard(fixture.database, config, context, cache);
    fixture.sqlite.exec('DROP TABLE x402_credit_purchases');
    await assert.rejects(() => createSchemaGuard()(fixture.database, config, context, cache), /Required D1 production tables are missing/);
  } finally { fixture.sqlite.close(); }
});
