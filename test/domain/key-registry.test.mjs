import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyRegistry } from '../../src/index.mjs';
test('key registry exposes public metadata only and supports rotation', () => {
  const registry = createKeyRegistry([{ issuer: 'test', keyId: 'old', algorithm: 'Ed25519', publicKey: 'PUBLIC', privateKeyPem: 'SECRET', status: 'retired' }]);
  registry.add({ issuer: 'test', keyId: 'new', algorithm: 'Ed25519', publicKey: 'PUBLIC2', status: 'active' });
  assert.equal(registry.get('new').publicKey, 'PUBLIC2');
  assert.equal(JSON.stringify(registry.list()).includes('SECRET'), false);
  assert.deepEqual(registry.list().map((key) => key.keyId), ['old', 'new']);
});

test('migrated key registry preserves validation and validity defaults', () => {
  const entry = { issuer: 'test', keyId: 'new', algorithm: 'Ed25519', publicKey: 'PUBLIC' };
  const registry = createKeyRegistry([entry]);
  assert.deepEqual(registry.list()[0], { ...entry, status: 'active', validFrom: null, validUntil: null });
  assert.throws(() => registry.add({ ...entry, status: 'unknown' }), /Key status/);
  assert.throws(() => registry.add({ ...entry, validFrom: 20, validUntil: 10 }), /validFrom/);
  assert.throws(() => registry.add({ ...entry, validFrom: 0 }), /positive Unix timestamp/);
});
