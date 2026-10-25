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
