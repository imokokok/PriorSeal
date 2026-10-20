import assert from 'node:assert/strict'
import test from 'node:test'

import { SOLANA_COMPUTE_BUDGET_PROGRAM } from '../../sdk/dist/index.js'
import { parseGuardedZeroExTenantPolicySet, resolveGuardedZeroExTenantPolicy } from '../../src/application/zeroex/tenant-policy.mjs'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
const TREASURY_USDC_ATA = 'FYj2K9vJqCgGq5FHWg3HQTdTSXtripR1k6ZsWfSCNqrq'

function deploymentPolicy() {
  return {
    maxInputAmountAtomic: '2000000', maxSlippageBps: 50,
    allowedInputMints: [USDC], allowedOutputMints: [WRAPPED_SOL],
    allowedProgramIds: [SOLANA_COMPUTE_BUDGET_PROGRAM],
    computeUnitLimit: 200_000, computeUnitPriceMicroLamports: '100',
    maxComputeUnitLimit: 200_000, maxComputeUnitPriceMicroLamports: '100', maxPriorityFeeLamports: '20', authorizationTtlSeconds: 60,
  }
}

test('0x tenant policies only narrow deployment controls and bind fees to authenticated Agent accounts', () => {
  const policySet = parseGuardedZeroExTenantPolicySet({
    schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public',
    tenants: [
      { tenantId: 'public', allowedInputMints: [USDC], maxInputAmountAtomic: '1000000', maxSlippageBps: 25 },
      { tenantId: 'partner-a', agentAccountId: 'agent-partner-a', allowedInputMints: [USDC], allowedOutputMints: [WRAPPED_SOL], maxInputAmountAtomic: '500000', maxSlippageBps: 10, commercialFee: { profileId: 'partner-a-usdc-5bps', inputMint: USDC, feePpm: 500, recipientTokenAccount: TREASURY_USDC_ATA, side: 'sell' } },
    ],
  }, deploymentPolicy())!
  const publicTenant = resolveGuardedZeroExTenantPolicy(deploymentPolicy(), policySet, undefined)
  assert.equal(publicTenant.tenantId, 'public')
  assert.equal(publicTenant.policy.maxInputAmountAtomic, '1000000')
  assert.equal(publicTenant.policy.commercialFee, undefined)

  const partner = resolveGuardedZeroExTenantPolicy(deploymentPolicy(), policySet, 'agent-partner-a')
  assert.equal(partner.tenantId, 'partner-a')
  assert.deepEqual(partner.policy.commercialFee, { profileId: 'partner-a-usdc-5bps', tenantId: 'partner-a', inputMint: USDC, feePpm: 500, recipientTokenAccount: TREASURY_USDC_ATA, side: 'sell' })
  assert.throws(() => resolveGuardedZeroExTenantPolicy(deploymentPolicy(), policySet, 'unmapped-agent'), (error: unknown) => (error as { code?: string }).code === 'ZEROEX_TENANT_UNAUTHORIZED')
})

test('0x tenant policies reject expanded limits, duplicate accounts, and a metered default tenant', () => {
  assert.throws(() => parseGuardedZeroExTenantPolicySet({ schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public', tenants: [{ tenantId: 'public', maxInputAmountAtomic: '2000001' }] }, deploymentPolicy()), /may not exceed deployment policy/)
  assert.throws(() => parseGuardedZeroExTenantPolicySet({ schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public', tenants: [{ tenantId: 'public', agentAccountId: 'agent-public' }] }, deploymentPolicy()), /default tenant must not require an agent account/)
  assert.throws(() => parseGuardedZeroExTenantPolicySet({ schema: 'priorseal.zeroex-tenant-policy-set.v1', defaultTenantId: 'public', tenants: [{ tenantId: 'public' }, { tenantId: 'partner-a', agentAccountId: 'same-account' }, { tenantId: 'partner-b', agentAccountId: 'same-account' }] }, deploymentPolicy()), /agentAccountId values must be unique/)
})
