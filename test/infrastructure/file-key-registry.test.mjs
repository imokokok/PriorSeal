import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileKeyRegistry } from '../../src/infrastructure/keys/file-key-registry.mjs';

test('public key registry files retain historical keys and reject private material', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'priorseal-key-registry-'));
  const valid = join(directory, 'keys.json');
  await writeFile(valid, JSON.stringify({ schema: 'priorseal.keys.v1', keys: [{ issuer: 'test', keyId: 'old', algorithm: 'Ed25519', publicKey: 'PUBLIC', status: 'retired', validFrom: 100, validUntil: 200 }] }));
  assert.equal(readFileKeyRegistry(valid)[0].keyId, 'old');
  const unsafe = join(directory, 'unsafe.json');
  await writeFile(unsafe, JSON.stringify({ schema: 'priorseal.keys.v1', keys: [{ issuer: 'test', keyId: 'bad', algorithm: 'Ed25519', publicKey: 'PUBLIC', privateKeyPem: 'SECRET' }] }));
  assert.throws(() => readFileKeyRegistry(unsafe), /unsupported field/);
});
