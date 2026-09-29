import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { buildCoverageReport, evaluateCoverage, coveragePolicyId, coverageReportDigest, coverageSigningData } from '../../sdk/dist/insight-coverage.js';
import { buildCoverageBoundIntent, withCoverageBoundIntent } from '../../sdk/dist/index.js';
import type { CoverageObservation, CoveragePolicy } from '../../sdk/dist/insight-coverage.js';
import type { CoverageRequirement, ExactCallIntentInput } from '../../sdk/dist/index.js';

const key = privateKeyToAccount(`0x${'12'.repeat(32)}`), now = 1800000000;
// A local test policy keeps the signing fixture explicit. Consumers must pin
// their own policy; this test does not claim to publish Insight's strict policy.
const policy: CoveragePolicy = {
  schema: 'insight.coverage-policy.v1', name: 'priorseal-coverage-test.v1',
  minProviders: 3, minIndependentGroups: 2, maxSourceAgeSeconds: 300,
  maxSpreadBps: 100, reportTtlSeconds: 60,
  sources: {
    chainlink: { group: 'chainlink', derived: false },
    api3: { group: 'api3', derived: false },
    twap: { group: 'twap', derived: true },
    band: { group: 'band', derived: false },
  },
};
const input: ExactCallIntentInput = { transaction: { chainId: 8453, from: key.address, to: `0x${'22'.repeat(20)}`, data: '0x1234', nonce: 1, value: '0' }, intentId: 'coverage-test', asset: 'USDC', amount: '1', validUntil: now + 100 };
async function requirements(): Promise<CoverageRequirement[]> {
  const report = buildCoverageReport({ asset: 'USDC', evidenceChainId: 1, evaluatedAt: now,
    observations: ['chainlink', 'api3', 'twap'].map(provider => ({ provider, evidenceChainId: 1, price: 1, status: 'success', observedAt: now - 10, retrievedAt: now, timestampProvenance: 'provider_timestamp', excluded: false })) }, policy);
  return [{ side: 'source', proof: { report, digest: coverageReportDigest(report), signer: key.address, signature: await key.signTypedData(coverageSigningData(report)) }, trust: { policy, policyId: coveragePolicyId(policy), asset: 'USDC', evidenceChainId: 1, keys: [{ address: key.address, validFrom: now - 100, validUntil: now + 100, revoked: false }] } }];
}
test('binds independently verified coverage, caps intent lifetime, preserves evidence/settlement distinction', async () => {
  const req = await requirements(), intent = await buildCoverageBoundIntent(input, req, now);
  const commitment = intent.contextCommitments?.[0];
  const requirement = req[0];
  assert.ok(commitment && requirement);
  assert.equal(intent.validUntil, now + 60);
  assert.equal(intent.chainId, 8453);
  assert.equal(commitment.digest, requirement.proof.digest);
  let called = 0;
  await withCoverageBoundIntent(intent, req, async () => ++called, () => now);
  assert.equal(called, 1);
});
for (const mode of ['missing', 'duplicate', 'wrong-digest', 'expired', 'revoked', 'extended-lifetime', 'unsigned']) test(`does not enter provider: ${mode}`, async () => {
  const req = await requirements(), intent = await buildCoverageBoundIntent(input, req, now);
  const commitments = intent.contextCommitments;
  const requirement = req[0];
  assert.ok(commitments && commitments[0] && requirement?.trust.keys[0]);
  if (mode === 'missing') intent.contextCommitments = [];
  if (mode === 'duplicate') commitments.push({ ...commitments[0] });
  if (mode === 'wrong-digest') commitments[0].digest = `0x${'00'.repeat(32)}`;
  if (mode === 'extended-lifetime') intent.validUntil++;
  if (mode === 'revoked') requirement.trust.keys[0].revoked = true;
  if (mode === 'unsigned') requirement.proof.signature = null;
  let called = false;
  await assert.rejects(withCoverageBoundIntent(intent, req, async () => { called = true }, () => mode === 'expired' ? now + 60 : now));
  assert.equal(called, false);
});
test('does not permit empty or same-side requirements', async () => {
  await assert.rejects(buildCoverageBoundIntent(input, [], now));
  const req = await requirements();
  await assert.rejects(buildCoverageBoundIntent(input, [...req, ...req], now));
});

test('recognizes Band as independent but keeps the strict 300-second freshness gate', () => {
  assert.deepEqual(policy.sources.band, { group: 'band', derived: false });
  const observation = (age: number): CoverageObservation => ({ provider: 'band', evidenceChainId: 1, price: 1, status: 'success', observedAt: now - age, retrievedAt: now, timestampProvenance: 'provider_timestamp', excluded: false });
  assert.deepEqual(evaluateCoverage([observation(300)], { ...policy, minProviders: 3 }, 1, now).providers[0].reasons, []);
  assert.deepEqual(evaluateCoverage([observation(301)], { ...policy, minProviders: 3 }, 1, now).providers[0].reasons, ['SOURCE_TOO_OLD']);
});
test('coverage policy ID binds its name and source classification', () => {
  const expected = coveragePolicyId(policy);
  assert.equal(expected, '0x92b24fc19b35a625049f9b78b9d0343188f10ab0bae75b80fdf72173ccc5246b');
  assert.notEqual(coveragePolicyId({ ...policy, name: 'strict-300s.v3' }), expected);
  assert.notEqual(coveragePolicyId({ ...policy, sources: { ...policy.sources, band: { group: 'band', derived: true } } }), expected);
});
