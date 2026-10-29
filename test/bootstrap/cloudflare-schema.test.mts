import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaCapabilityGuard, REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY } from '../../src/bootstrap/cloudflare-schema.mjs';
import { testD1 } from '../support/d1.mjs';

test('schema readiness is one primary-key capability lookup', async () => {
  const fixture = testD1();
  try {
    const guard = createSchemaCapabilityGuard();
    await Promise.all([guard(fixture.database), guard(fixture.database)]);
    await guard(fixture.database);
    assert.deepEqual(fixture.calls, [{
      sql: 'SELECT version FROM priorseal_schema_capabilities WHERE capability=?',
      values: ['cloudflare-runtime'],
    }]);
    assert.equal(REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY, 11);
  } finally { fixture.sqlite.close(); }
});

test('a missing schema capability fails closed and is never treated as ready', async () => {
  const fixture = testD1();
  try {
    fixture.sqlite.exec("DELETE FROM priorseal_schema_capabilities WHERE capability='cloudflare-runtime'");
    const guard = createSchemaCapabilityGuard();
    await assert.rejects(() => guard(fixture.database), /schema capability 11 is required/);
    await assert.rejects(() => guard(fixture.database), /schema capability 11 is required/);
    assert.equal(fixture.calls.length, 2);
  } finally { fixture.sqlite.close(); }
});

test('a stale schema capability fails closed', async () => {
  const fixture = testD1();
  try {
    fixture.sqlite.exec("UPDATE priorseal_schema_capabilities SET version=10 WHERE capability='cloudflare-runtime'");
    await assert.rejects(() => createSchemaCapabilityGuard()(fixture.database), /schema capability 11 is required/);
  } finally { fixture.sqlite.close(); }
});
