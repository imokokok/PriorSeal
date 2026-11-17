import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeFunctionData, hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  HYPERLEND_CORE_POOL,
  buildHyperEvmLendingGuardBoundIntent,
  hyperEvmLendingGuardIntentAsset,
  verifyInsightHyperEvmLendingGuardDecision,
} from '../../sdk/dist/index.js'

const signer = privateKeyToAccount(`0x${'44'.repeat(32)}` as `0x${string}`)
const now = 1_792_339_200
const sender = '0x1111111111111111111111111111111111111111' as const
const usdc = '0xb88339CB7199b77E23DB6E890353E22632Ba630f' as const
const domain = { name: 'Insight HyperEVM Lending Guard', version: '1', chainId: 999 } as const
const types = { HyperEvmLendingGuardDecision: [
  { name: 'decisionHash', type: 'bytes32' }, { name: 'calldataHash', type: 'bytes32' },
  { name: 'account', type: 'address' }, { name: 'chainId', type: 'uint256' },
  { name: 'verdict', type: 'uint8' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
] } as const
const keyRegistry = { keys: [{ key_id: 'insight-test', public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' as const }] }

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`).join(',')}}`
}

async function hyperLendBorrowDecision() {
  const transaction = {
    chainId: 999 as const, from: sender, to: HYPERLEND_CORE_POOL, nonce: '7', value: '0',
    data: encodeFunctionData({
      abi: [{ type: 'function', name: 'borrow', stateMutability: 'nonpayable', inputs: [
        { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'interestRateMode', type: 'uint256' }, { name: 'referralCode', type: 'uint16' }, { name: 'onBehalfOf', type: 'address' },
      ], outputs: [] }] as const,
      functionName: 'borrow', args: [usdc, 1_000_000n, 2n, 0, sender],
    }),
  }
  const action = {
    protocolId: 'hyperlend-core-hyperevm' as const, action: 'borrow' as const, target: HYPERLEND_CORE_POOL,
    calldataHash: keccak256(transaction.data), amount: '1000000', account: sender, receiver: sender, asset: usdc,
  }
  const guard = {
    schema: 'insight.hyperevm-lending-guard.v1' as const, verdict: 'ALLOW' as const, protocolId: 'hyperlend-core-hyperevm' as const,
    action: 'borrow' as const, scope: { chainId: 999 as const, transactionAuthority: 'none' },
    market: { collateralSymbol: 'WHYPE', loanSymbol: 'USDC', maxLtv: 0.8, liquidationLtv: 0.85 },
  }
  const decisionHash = keccak256(toBytes(canonical({ schema: 'insight.hyperevm-lending-guard-decision.v1', guard, transaction, action })))
  const data = { decisionHash, calldataHash: action.calldataHash, account: sender, chainId: 999 as const, verdict: 0 as const, issuedAt: now, validUntil: now + 300, schemaVersion: 1 as const }
  const typedData = { domain, types, primaryType: 'HyperEvmLendingGuardDecision' as const, message: { ...data, chainId: 999n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n } }
  return {
    schema: 'insight.hyperevm-lending-guard-decision.v1' as const, guard, transaction, action, decisionHash,
    attestation: {
      type: 'HyperEvmLendingGuardDecision' as const, schemaVersion: 1 as const, uid: hashTypedData(typedData), attester: signer.address,
      attesterLabel: 'Insight HyperEVM Lending Guard attester' as const, signedAt: new Date(now * 1000).toISOString(), validForSeconds: 300 as const,
      signature: await signer.signTypedData(typedData), verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/hyperevm-lending-guard/verify', data,
      eip712: { domain, types, primaryType: 'HyperEvmLendingGuardDecision' },
    },
  }
}

test('binds a HyperLend Core variable-rate borrow to the canonical HyperEVM pool', async () => {
  const proof = await hyperLendBorrowDecision()
  assert.equal((await verifyInsightHyperEvmLendingGuardDecision(proof, { keyRegistry, now })).valid, true)
  const intent = await buildHyperEvmLendingGuardBoundIntent({
    transaction: proof.transaction, intentId: 'hyperlend-borrow-test', asset: hyperEvmLendingGuardIntentAsset(), amount: proof.action.amount, validUntil: now + 500,
  }, proof, { keyRegistry, now })
  assert.equal(intent.asset, 'eip155:999/lending:hyperlend-core-hyperevm')
  assert.equal(intent.validUntil, now + 300)
})

test('rejects tampered HyperLend calldata before authorization preparation', async () => {
  const proof = await hyperLendBorrowDecision()
  proof.transaction.data = encodeFunctionData({
    abi: [{ type: 'function', name: 'borrow', stateMutability: 'nonpayable', inputs: [
      { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'interestRateMode', type: 'uint256' }, { name: 'referralCode', type: 'uint16' }, { name: 'onBehalfOf', type: 'address' },
    ], outputs: [] }] as const,
    functionName: 'borrow', args: [usdc, 1_000_000n, 1n, 0, sender],
  })
  assert.equal((await verifyInsightHyperEvmLendingGuardDecision(proof, { keyRegistry, now })).valid, false)
})
