import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildIntent, buildReceipt, buildVerificationBundle, hashJson } from '../../src/index.mjs';
import { signReceipt } from '../../src/domain/receipt.mjs';
import { buildReviewManifest, parseTrustProfile, verifyReviewManifestLocally } from '../../sdk/dist/verifier.js';

function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const key = { issuer: 'test', keyId: 'key-1', algorithm: 'Ed25519', publicKey, status: 'active', validFrom: null, validUntil: null };
  const intent = buildIntent({ intentId: 'review-test', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender: `0x${'a'.repeat(40)}`, recipient: `0x${'b'.repeat(40)}`, validUntil: 2000, nonce: '1' });
  const execution = { chainId: 8453, txHash: `0x${'1'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', executedAt: 1100, observedAt: 1101, sender: intent.sender, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: '1', finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildReceipt({ intent, execution, issuer: 'test', keyId: 'key-1', issuedAt: 1101 }), privateKey);
  return { key, bundle: buildVerificationBundle({ receipt, keyRegistry: { schema: 'priorseal.keys.v1', issuer: 'test', keys: [key] }, assembledAt: 1101 }) };
}

test('review manifest preserves original artifacts and requires caller trust rather than bundle keys', async () => {
  const { key, bundle } = fixture();
  const manifest = await buildReviewManifest({ bundle, assembledAt: 1102 });
  assert.equal((await verifyReviewManifestLocally(manifest, { now: 1200 })).valid, false);
  const result = await verifyReviewManifestLocally(manifest, { trustedKeys: key, now: 1200 });
  assert.equal(result.valid, true);
  assert.equal(result.verificationOrigin, 'local');
  const changed = structuredClone(manifest);
  changed.bundle.receipt.execution.txHash = `0x${'2'.repeat(64)}`;
  assert.equal((await verifyReviewManifestLocally(changed, { trustedKeys: key, now: 1200 })).code, 'MANIFEST_HASH_MISMATCH');
  const mismatch = await buildReviewManifest({ bundle, expectedTxHash: `0x${'2'.repeat(64)}` });
  assert.equal((await verifyReviewManifestLocally(mismatch, { trustedKeys: key, now: 1200 })).code, 'EVIDENCE_RELATION_MISMATCH');
});

test('unknown external proof, missing Insight evidence and changed raw bytes cannot become complete verification', async () => {
  const { key, bundle } = fixture();
  const rawJson = '{ "signed": "exact bytes" }';
  const manifest = await buildReviewManifest({ bundle, attachments: [{ id: 'external', role: 'external', profile: 'unknown.v1', rawJson }] });
  assert.equal(manifest.attachments[0].rawJson, rawJson);
  const partial = await verifyReviewManifestLocally(manifest, { trustedKeys: key, now: 1200 });
  assert.equal(partial.valid, false);
  assert.deepEqual(partial.unverified, ['external']);
  const tampered = structuredClone(manifest);
  tampered.attachments[0].rawJson = '{"signed":"exact bytes"}';
  const { manifestHash: _hash, ...content } = tampered;
  tampered.manifestHash = hashJson(content);
  assert.equal((await verifyReviewManifestLocally(tampered, { trustedKeys: key, now: 1200 })).artifacts[0].code, 'ARTIFACT_HASH_MISMATCH');
  await assert.rejects(buildReviewManifest({ bundle, attachments: [{ id: 'one', role: 'insight.source', profile: 'insight.pretrade.v3', rawJson: '{}' }, { id: 'two', role: 'insight.source', profile: 'insight.pretrade.v3', rawJson: '{}' }] }), /Ambiguous/);
});

test('trust profile rejects ambiguous key identity and invalid windows while preserving custom audience', () => {
  const { key } = fixture();
  const profile = { schema: 'priorseal.trust-profile.v1', issuer: 'test', audience: 'custom-audience', source: 'independent test channel', confirmedAt: 1100, keys: [key] };
  assert.equal(parseTrustProfile(profile).audience, 'custom-audience');
  assert.throws(() => parseTrustProfile({ ...profile, keys: [key, key] }), /ambiguous/);
  assert.throws(() => parseTrustProfile({ ...profile, keys: [{ ...key, validFrom: 2000, validUntil: 1000 }] }), /window/);
});

test('Insight trust follows the published default attester role and rejects ambiguous registries', () => {
  const { key } = fixture();
  const insightKey = { key_id: 'insight-one', public_key: `0x${'a'.repeat(40)}`, role: 'attester', revoked: false, validFrom: '1970-01-01T00:00:00Z', validUntil: null };
  const profile = { schema: 'priorseal.trust-profile.v1', issuer: 'test', audience: 'test', source: 'independent provisioning', confirmedAt: 0, keys: [key], insightKeyRegistry: { keys: [insightKey] } };
  assert.equal(parseTrustProfile(profile).insightKeyRegistry.keys[0].role, 'attester');
  assert.equal(parseTrustProfile({ ...profile, insightKeyRegistry: { keys: [{ ...insightKey, role: undefined }] } }).insightKeyRegistry.keys[0].role, undefined);
  for (const registry of [
    { keys: [{ ...insightKey, role: 'unknown-role' }] },
    { keys: [insightKey, { ...insightKey, public_key: `0x${'b'.repeat(40)}` }] },
    { keys: [insightKey, { ...insightKey, key_id: 'another-id' }] },
    { keys: [insightKey], public_keys: [insightKey] },
    { keys: [{ ...insightKey, validFrom: 'not-a-date' }] },
    { keys: [insightKey], revoked: [], revoked_keys: [] },
  ]) assert.throws(() => parseTrustProfile({ ...profile, insightKeyRegistry: registry }), /Insight/);
});
