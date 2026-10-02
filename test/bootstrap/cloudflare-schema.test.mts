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
