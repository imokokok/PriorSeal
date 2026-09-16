import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runFinalPairChecks } from '../../examples/thoughtproof-sentinel-paired-v2-final/verify.mjs';

const fixtureUrl = new URL('../../examples/thoughtproof-sentinel-paired-v2-final/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, fixtureUrl), 'utf8'));

test('M2 final pairs use the ThoughtProof-issued matching and missing-subject artifacts', async () => {
  const results = await runFinalPairChecks({ log: () => {} });
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.slice(2).map((result) => result.code),
    [
      'DECISION_COMMITMENT_VERIFIED',
      'DECISION_SUBJECT_MISSING',
      'DECISION_SIGNER_UNTRUSTED',
    ],
  );
  assert.equal(results[2].subjectBindingCode, 'DECISION_SUBJECT_VERIFIED');
});

test('M2 final receipts commit to the exact two transported ThoughtProof artifacts', () => {
  const expected = readJson('expected.json');
  const matchingExport = readJson('export-m2-match.json');
  const missingExport = readJson('export-m2-missing-subject.json');
  const matchingReceipt = readJson('priorseal-receipt-matching.json');
  const missingReceipt = readJson('priorseal-receipt-missing-subject.json');
  const matchingCommitment = matchingReceipt.authorizationEvidence.authorization.intent.contextCommitments;
  const missingCommitment = missingReceipt.authorizationEvidence.authorization.intent.contextCommitments;

  assert.equal(expected.status, 'FINAL_PAIR_CANDIDATE');
  assert.deepEqual(matchingCommitment, [
    {
      namespace: 'thoughtproof.sentinel-decision.v1',
      algorithm: 'sha256',
      digest: matchingExport.digest,
    },
  ]);
  assert.deepEqual(missingCommitment, [
    {
      namespace: 'thoughtproof.sentinel-decision.v1',
      algorithm: 'sha256',
      digest: missingExport.digest,
    },
  ]);
});
