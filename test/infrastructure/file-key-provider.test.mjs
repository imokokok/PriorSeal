import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFileKeyProvider } from '../../src/infrastructure/keys/file-key-provider.mjs';

test('normalizes literal newline escapes in secret-store PEM files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'priorseal-key-provider-'));
  const privatePath = join(directory, 'private.pem');
  const publicPath = join(directory, 'public.pem');
  try {
    writeFileSync(privatePath, '-----BEGIN PRIVATE KEY-----\\nprivate\\n-----END PRIVATE KEY-----\\n');
    writeFileSync(publicPath, '-----BEGIN PUBLIC KEY-----\\npublic\\n-----END PUBLIC KEY-----\\n');
    const provider = createFileKeyProvider({ privateKeyFile: privatePath, publicKeyFile: publicPath });
    assert.equal(provider.getPrivateKey(), '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\n');
    assert.equal(provider.getPublicKey(), '-----BEGIN PUBLIC KEY-----\npublic\n-----END PUBLIC KEY-----\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
