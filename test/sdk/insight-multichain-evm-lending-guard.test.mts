import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  buildMultichainEvmLendingGuardBoundIntent,
  multichainEvmLendingGuardIntentAsset,
  verifyInsightMultichainEvmLendingGuardDecision,
} from '../../sdk/dist/index.js'

const signer = privateKeyToAccount(`0x${'22'.repeat(32)}` as `0x${string}`)
const now = 1_792_252_800
const sender = '0x1111111111111111111111111111111111111111' as const
const moolah = '0x8f73b65b4caaf64fba2af91cc5d4a2a1318e5d8c' as const
const marketId = `0x${'33'.repeat(32)}` as const
const domain = { name: 'Insight Multichain EVM Lending Guard', version: '1', chainId: 1 } as const
const types = { MultichainEvmLendingGuardDecision: [
  { name: 'decisionHash', type: 'bytes32' }, { name: 'calldataHash', type: 'bytes32' },
  { name: 'account', type: 'address' }, { name: 'chainId', type: 'uint256' },
  { name: 'verdict', type: 'uint8' }, { name: 'issuedAt', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
] } as const
const transaction = { chainId: 56 as const, from: sender, to: moolah, data: '0x' as const, nonce: '9', value: '0' }
const keyRegistry = { keys: [{ key_id: 'insight-test', public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' as const }] }

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`).join(',')}}`
}
async function listaDecision() {
  const action = {
    protocolId: 'lista-moolah-bnb' as const, action: 'supply' as const, target: moolah,
    calldataHash: keccak256(transaction.data), amount: '1000000', account: sender,
    receiver: null, asset: '0x3333333333333333333333333333333333333333', marketId,
  }
  const guard = {
    schema: 'insight.multichain-evm-lending-guard.v1' as const, verdict: 'ALLOW' as const,
    chainId: 56 as const, protocolId: 'lista-moolah-bnb' as const, action: 'supply' as const,
    scope: { chainId: 56 as const, transactionAuthority: 'none', valuation: 'caller_declared_post_action_usd' },
    market: { marketId, collateralSymbol: 'WBNB', loanSymbol: 'USDC', maxLtv: 0.86, liquidationLtv: 0.86, parameterSource: 'lista-moolah-market', oracleAddress: '0x4444444444444444444444444444444444444444' },
  }
  const decisionHash = keccak256(toBytes(canonical({ schema: 'insight.multichain-evm-lending-guard-decision.v1', guard, transaction, action })))
  const data = { decisionHash, calldataHash: action.calldataHash, account: sender, chainId: 56 as const, verdict: 0 as const, issuedAt: now, validUntil: now + 300, schemaVersion: 1 as const }
  const typedData = { domain, types, primaryType: 'MultichainEvmLendingGuardDecision' as const, message: { ...data, chainId: 56n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n } }
  return {
    schema: 'insight.multichain-evm-lending-guard-decision.v1' as const, guard, transaction, action, decisionHash,
    attestation: {
      type: 'MultichainEvmLendingGuardDecision' as const, schemaVersion: 1 as const, uid: hashTypedData(typedData),
      attester: signer.address, attesterLabel: 'Insight Multichain EVM Lending Guard attester' as const,
      signedAt: new Date(now * 1000).toISOString(), validForSeconds: 300 as const,
      signature: await signer.signTypedData(typedData), verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/multichain-evm-lending-guard/verify',
      data, eip712: { domain, types, primaryType: 'MultichainEvmLendingGuardDecision' },
    },
  }
}

async function eulerBorrowDecision() {
  const evc = '0x5301c7dd20bd945d2013b48ed0dee3a284ca8989' as const
  const borrowVault = '0x5555555555555555555555555555555555555555' as const
  const collateralVault = '0x6666666666666666666666666666666666666666' as const
  const eulerTransaction = { chainId: 8453 as const, from: sender, to: evc as `0x${string}`, data: '0x1234' as const, nonce: '10', value: '0' }
  const action = {
    protocolId: 'euler-v2-base' as const, action: 'borrow' as const, target: evc as `0x${string}`,
    calldataHash: keccak256(eulerTransaction.data), amount: '1000000', account: sender,
    receiver: sender, asset: '0x3333333333333333333333333333333333333333', marketId: null,
  }
  const guard = {
    schema: 'insight.multichain-evm-lending-guard.v1' as const, verdict: 'ALLOW' as const,
    chainId: 8453 as const, protocolId: 'euler-v2-base' as const, action: 'borrow' as const,
    scope: { chainId: 8453 as const, transactionAuthority: 'none', valuation: 'caller_declared_post_action_usd' },
    market: { marketAddress: borrowVault, collateralVaultAddress: collateralVault, collateralSymbol: 'WETH', loanSymbol: 'USDC', maxLtv: 0.8, liquidationLtv: 0.85, parameterSource: 'euler-evault' },
  }
  const decisionHash = keccak256(toBytes(canonical({ schema: 'insight.multichain-evm-lending-guard-decision.v1', guard, transaction: eulerTransaction, action })))
  const data = { decisionHash, calldataHash: action.calldataHash, account: sender, chainId: 8453 as const, verdict: 0 as const, issuedAt: now, validUntil: now + 300, schemaVersion: 1 as const }
  const typedData = { domain, types, primaryType: 'MultichainEvmLendingGuardDecision' as const, message: { ...data, chainId: 8453n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n } }
  return {
    schema: 'insight.multichain-evm-lending-guard-decision.v1' as const, guard, transaction: eulerTransaction, action, decisionHash,
    attestation: {
      type: 'MultichainEvmLendingGuardDecision' as const, schemaVersion: 1 as const, uid: hashTypedData(typedData),
      attester: signer.address, attesterLabel: 'Insight Multichain EVM Lending Guard attester' as const,
      signedAt: new Date(now * 1000).toISOString(), validForSeconds: 300 as const,
      signature: await signer.signTypedData(typedData), verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/multichain-evm-lending-guard/verify',
      data, eip712: { domain, types, primaryType: 'MultichainEvmLendingGuardDecision' },
    },
  }
}

test('binds a Lista Moolah isolated-market ALLOW to exactly one BNB chain call', async () => {
  const proof = await listaDecision()
  assert.equal((await verifyInsightMultichainEvmLendingGuardDecision(proof, { keyRegistry, now })).valid, true)
  const intent = await buildMultichainEvmLendingGuardBoundIntent({
    transaction, intentId: 'lista-moolah-test', asset: multichainEvmLendingGuardIntentAsset(56, 'lista-moolah-bnb'), amount: proof.action.amount, validUntil: now + 500,
  }, proof, { keyRegistry, now })
  assert.equal(intent.validUntil, now + 300)
  assert.equal(intent.asset, 'eip155:56/lending:lista-moolah-bnb')
})

test('binds an Euler EVC borrow batch only to the canonical Base EVC', async () => {
  const proof = await eulerBorrowDecision()
  assert.equal((await verifyInsightMultichainEvmLendingGuardDecision(proof, { keyRegistry, now })).valid, true)
  const intent = await buildMultichainEvmLendingGuardBoundIntent({
    transaction: proof.transaction, intentId: 'euler-borrow-test', asset: multichainEvmLendingGuardIntentAsset(8453, 'euler-v2-base'), amount: proof.action.amount, validUntil: now + 500,
  }, proof, { keyRegistry, now })
  assert.equal(intent.asset, 'eip155:8453/lending:euler-v2-base')
  const tampered = structuredClone(proof)
  tampered.transaction.to = '0x5555555555555555555555555555555555555555'
  tampered.action.target = tampered.transaction.to
  tampered.action.calldataHash = keccak256(tampered.transaction.data)
  tampered.decisionHash = keccak256(toBytes(canonical({ schema: tampered.schema, guard: tampered.guard, transaction: tampered.transaction, action: tampered.action })))
  tampered.attestation!.data.decisionHash = tampered.decisionHash
  tampered.attestation!.data.calldataHash = tampered.action.calldataHash
  const message = { ...tampered.attestation!.data, chainId: 8453n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n }
  const typedData = { domain, types, primaryType: 'MultichainEvmLendingGuardDecision' as const, message }
  tampered.attestation!.uid = hashTypedData(typedData)
  tampered.attestation!.signature = await signer.signTypedData(typedData)
  assert.equal((await verifyInsightMultichainEvmLendingGuardDecision(tampered, { keyRegistry, now })).reason, 'MALFORMED')
})
