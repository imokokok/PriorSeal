import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  runFixtureChecks,
  verifyThoughtProofExport,
} from '../../examples/thoughtproof-sentinel-paired-v1/verify.mjs';

const fixtureUrl = new URL('../../examples/thoughtproof-sentinel-paired-v1/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, fixtureUrl), 'utf8'));

test('ThoughtProof Sentinel M1 paired vectors preserve issuer and subject-binding boundaries', async () => {
  const results = await runFixtureChecks({ log: () => {} });
  assert.equal(results.length, 13);
  assert.deepEqual(
    results.filter((result) => result.code === 'DECISION_COMMITMENT_VERIFIED').map((result) => result.name),
    ['production matching pair', 'vector matching pair'],
  );
});

test('ThoughtProof vector pin cannot be promoted to production by changing discovery status', () => {
  const artifact = readJson('export-valid.json');
  const keyDocument = readJson('thoughtproof-keys.json');
  const expected = readJson('expected.json');
  keyDocument.keys.find((entry) => entry.kid === artifact.keyId).status = 'active';
  assert.equal(
    verifyThoughtProofExport(artifact, keyDocument, expected, { allowVectorOnly: true }).code,
    'DECISION_SIGNER_UNTRUSTED',
  );
});

test('retired production kid remains verifiable for an artifact signed in its window', () => {
  const artifact = readJson('export-prod-live.json');
  const keyDocument = readJson('thoughtproof-keys.json');
  const expected = readJson('expected.json');
  const key = keyDocument.keys.find((entry) => entry.kid === artifact.keyId);
  key.status = 'retired';
  key.notAfter = new Date((artifact.signedAt + 1) * 1000).toISOString();
  assert.equal(verifyThoughtProofExport(artifact, keyDocument, expected).code, 'OK');
});
