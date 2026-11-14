import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentCapabilities } from '../../src/application/capabilities.mjs';

const base = {
  issuer: 'test', audience: 'test', keyConfigured: true, proofMode: 'issuer', timestampConfigured: false,
  witnessConfigured: false, anchorConfigured: false, rpcChainIds: [], store: {}, archiveEnabled: false, now: 1_700_000_000_000,
};

test('Hyperliquid capability is explicit, policy-gated, and does not pretend to be an EIP-155 chain', async () => {
  const capabilities = await deploymentCapabilities({
    ...base,
    hyperliquidSpotIocConfigured: true,
    policy: { allowedChainIds: ['hyperliquid:mainnet'], allowedActions: ['HYPERLIQUID_SPOT_IOC_ORDER'], minConfirmations: 1, maxToleratedReorgDepth: 0 },
  });
  assert.deepEqual(capabilities.chains, []);
  assert.deepEqual(capabilities.networks, ['hyperliquid:mainnet']);
  assert.ok(capabilities.executionProfiles.includes('priorseal.execution-profile.hyperliquid-spot-ioc.v1'));
  assert.equal(capabilities.workflowReady, true);
  assert.equal(capabilities.evidenceApi.profiles[0]?.id, 'priorseal.evidence-profile.hyperliquid-spot-ioc.v1');
});

test('Hyperliquid capability stays hidden without an explicit network policy entry', async () => {
  const capabilities = await deploymentCapabilities({
    ...base,
    hyperliquidSpotIocConfigured: true,
    policy: { allowedChainIds: [0], allowedActions: ['HYPERLIQUID_SPOT_IOC_ORDER'] },
  });
  assert.equal(capabilities.executionProfiles.includes('priorseal.execution-profile.hyperliquid-spot-ioc.v1'), false);
});

test('five-chain capability discovery reports Seal, Witness, Match, and Review separately', async () => {
  const capabilities = await deploymentCapabilities({
    ...base,
    proofMode: 'rfc3161',
    timestampConfigured: true,
    rpcChainIds: [56, 999, 8453, 0],
    hyperliquidSpotIocConfigured: true,
    policy: {
      allowedChainIds: [56, 8453, 999, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'hyperliquid:mainnet'],
      allowedActions: ['TRANSFER', 'CONTRACT_CALL', 'SOLANA_TRANSACTION', 'HYPERLIQUID_SPOT_IOC_ORDER'],
      minConfirmations: 1,
      maxToleratedReorgDepth: 0,
    },
  });
  assert.deepEqual(capabilities.fourProductCoverage.map(coverage => coverage.network), [
    'eip155:56',
    'eip155:999',
    'eip155:8453',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'hyperliquid:mainnet',
  ]);
  for (const coverage of capabilities.fourProductCoverage) {
    assert.equal(coverage.seal.status, 'configured');
    assert.equal(coverage.witness.status, 'configured');
    assert.equal(coverage.match.status, 'configured');
    assert.equal(coverage.review.status, 'configured');
  }
  const hypercore = capabilities.fourProductCoverage.find(coverage => coverage.network === 'hyperliquid:mainnet');
  assert.deepEqual(hypercore?.match, { status: 'configured', profile: 'hyperliquid_spot_ioc' });
  assert.deepEqual(hypercore?.review, { status: 'configured', profile: 'priorseal.evidence-profile.hyperliquid-spot-ioc.v1' });
});

test('four-product coverage does not advertise Seal or Witness without an issuer key', async () => {
  const capabilities = await deploymentCapabilities({
    ...base,
    keyConfigured: false,
    proofMode: 'rfc3161',
    timestampConfigured: true,
    rpcChainIds: [8453],
    policy: { allowedChainIds: [8453], allowedActions: ['CONTRACT_CALL'] },
  });
  assert.deepEqual(capabilities.fourProductCoverage[0]?.seal, { status: 'unavailable', authorizers: ['eip712'] });
  assert.deepEqual(capabilities.fourProductCoverage[0]?.witness, { status: 'unavailable', mode: 'rfc3161' });
  assert.equal(capabilities.fourProductCoverage[0]?.match.status, 'configured');
  assert.equal(capabilities.fourProductCoverage[0]?.review.status, 'unavailable');
});
