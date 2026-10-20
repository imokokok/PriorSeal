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
    assert.equal(fixture.calls.length, 1);

    await firstIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 1);
    assert.equal(fixture.calls.length, 1);

    const secondIsolate = createSchemaGuard(() => now);
    await secondIsolate(fixture.database, config, context, cache);
    await secondIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 2);
    assert.equal(fixture.calls.length, 1);

    now += 300_000;
    await firstIsolate(fixture.database, config, context, cache);
    assert.equal(matches, 3);
    assert.equal(puts, 2);
    assert.equal(fixture.calls.length, 2);
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

test('fee-bearing 0x schema readiness requires the durable commercial ledger', async () => {
  const fixture = testD1();
  const guard = createSchemaGuard();
  const cache = { async match() { return undefined; }, async put() {} } as unknown as Cache;
  const context = { waitUntil(promise: Promise<unknown>) { void promise; } } as ExecutionContext;
  const config = loadRuntimeConfig({
    PRIORSEAL_ZEROEX_ENABLED: 'true', ZEROEX_API_KEY: '0x-secret', INSIGHT_API_KEY: 'insight-secret', PRIORSEAL_ZEROEX_RPC_URL: 'https://rpc.example',
    PRIORSEAL_ZEROEX_POLICY_JSON: JSON.stringify({ maxInputAmountAtomic: '1000000', maxSlippageBps: 50, allowedInputMints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'], allowedProgramIds: ['ComputeBudget111111111111111111111111111111'], computeUnitLimit: 200000, computeUnitPriceMicroLamports: '100', maxComputeUnitLimit: 200000, maxComputeUnitPriceMicroLamports: '100', maxPriorityFeeLamports: '20', authorizationTtlSeconds: 60 }),
    PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON: JSON.stringify({ trustedKeys: [{ kty: 'OKP', crv: 'Ed25519', kid: '0x-signing-key-prod-24092026', x: '19P3C981JsyQsqwVho8Tlabx51rslvdruSH59mGuWn0' }] }),
    PRIORSEAL_ZEROEX_TENANTS_JSON: JSON.stringify({ schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public', tenants: [{ tenantId: 'public' }, { tenantId: 'partner-a', agentAccountId: 'agent-partner-a', commercialFee: { profileId: 'partner-a-usdc-10bps', inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', feePpm: 1000, recipientTokenAccount: 'FYj2K9vJqCgGq5FHWg3HQTdTSXtripR1k6ZsWfSCNqrq', side: 'sell' } }] }),
    PRIORSEAL_AGENT_METER_JSON: JSON.stringify({ schema: 'priorseal.agent-meter.v1', creditUnitUsd: '0.01', operatorCredentialHash: 'a'.repeat(64), accounts: [{ accountId: 'agent-partner-a', credentialHash: 'b'.repeat(64), provisionedCredits: '10', status: 'active' }], routes: [{ routeId: 'zeroex-prepare', method: 'POST', path: '/v1/0x/guarded-swaps/prepare', credits: '1' }] }),
  });
  try {
    await guard(fixture.database, config, context, cache);
    fixture.sqlite.exec('DROP TABLE zeroex_commercial_ledger_events');
    await assert.rejects(() => createSchemaGuard()(fixture.database, config, context, cache), /Required D1 production tables are missing/);
  } finally { fixture.sqlite.close(); }
});
