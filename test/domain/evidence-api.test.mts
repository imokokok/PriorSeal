import test from 'node:test';
import assert from 'node:assert/strict';
import { hashJson } from '../../src/domain/hashing.mjs';
import { buildEvidenceEnvelope, evidenceProfilesForChains } from '../../src/domain/evidence-api.mjs';

function bundleFor(receipt: Record<string, unknown>) {
  const unsigned = {
    schema: 'priorseal.verification-bundle.v1',
    receipt,
    keyRegistry: { schema: 'priorseal.keys.v1', issuer: 'issuer.example', keys: [] },
    assembledAt: 1_234,
    trust: { model: 'PIN_ISSUER_KEY_OUT_OF_BAND', notice: 'Bundled keys are discovery metadata, not an independent trust anchor.' },
  };
  return { ...unsigned, bundleHash: hashJson(unsigned) };
}

test('Evidence API envelope presents authorized EVM receipt claims without pretending to verify the signature', () => {
  const receipt = {
    schema: 'priorseal.execution-receipt.v3', receiptId: 'psr_evidence_fixture', authorizationHash: 'a'.repeat(64), executionHash: 'b'.repeat(64), issuer: 'issuer.example', keyId: 'key-1', signature: 'signature-bytes',
    authorizationEvidence: { authorization: { authorizationId: 'auth_evidence_fixture' } },
    execution: { chainId: 143, txHash: `0x${'1'.repeat(64)}`, status: 'CONFIRMED', finalityState: 'CONFIRMED', confirmations: 3, observationSource: 'evm-json-rpc:eip155:143:configured-1' },
  };
  const evidence = buildEvidenceEnvelope(bundleFor(receipt));
  assert.equal(evidence.schema, 'priorseal.evidence.v1');
  assert.match(evidence.evidenceId, /^pse_[0-9a-f]{32}$/);
  assert.equal(evidence.profile.id, 'priorseal.evidence-profile.evm.v1');
  assert.equal(evidence.profile.network, 'eip155:143');
  assert.equal(evidence.subject.authorizationId, 'auth_evidence_fixture');
  assert.equal(evidence.claims.authorizationBinding.status, 'ASSERTED_BY_RECEIPT');
  assert.equal(evidence.claims.receiptSignature.status, 'PRESENT_NOT_VERIFIED');
  assert.equal(evidence.verification.required, 'VERIFY_LOCALLY_WITH_INDEPENDENT_ISSUER_KEY_TRUST');
  const { evidenceHash, ...unsigned } = evidence;
  assert.equal(evidenceHash, hashJson(unsigned));
});

test('Evidence API profiles distinguish the supported Solana transaction profile and preserve deployment scope', () => {
  const profiles = evidenceProfilesForChains([8453, 143, 0, 143]);
  assert.deepEqual(profiles.map(profile => [profile.family, profile.network]), [
    ['svm', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['evm', 'eip155:143'],
    ['evm', 'eip155:8453'],
  ]);
  assert.equal(profiles[0].id, 'priorseal.evidence-profile.solana-transaction.v1');
  assert.ok(profiles[1].limitations.some(limitation => limitation.includes('does not submit transactions')));
});

test('Evidence API refuses malformed bundle inputs and marks legacy receipt authorization as unavailable', () => {
  assert.throws(() => buildEvidenceEnvelope({}), /PriorSeal verification bundle/);
  const evidence = buildEvidenceEnvelope(bundleFor({ receiptId: 'psr_legacy', execution: { chainId: 8453, status: 'PENDING' } }));
  assert.equal(evidence.kind, 'EXECUTION');
  assert.equal(evidence.claims.authorizationBinding.status, 'NOT_INCLUDED_IN_RECEIPT');
  assert.equal(evidence.claims.receiptSignature.status, 'MISSING');
});
