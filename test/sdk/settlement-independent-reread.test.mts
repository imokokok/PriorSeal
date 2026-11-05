import assert from 'node:assert/strict'
import test from 'node:test'

import {
  encodeEventTopics,
  hashTypedData,
  keccak256,
  pad,
  parseAbi,
  toBytes,
  toEventSelector,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  createSettlementRereadReader,
  independentlyVerifySettlement,
  verifyInsightBaseAgentSwapGuardSettlement,
  verifySettlementWithIndependentReread,
} from '../../sdk/dist/index.js'
import type { SettlementRereadReader } from '../../sdk/dist/index.js'

// Deterministic public TEST signing material — never fund it.
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`)
const now = 1_792_252_800

const recipient = '0x1111111111111111111111111111111111111111' as const
const payer = '0x2222222222222222222222222222222222222222' as const
const tokenIn = '0x4200000000000000000000000000000000000006' as const
const tokenOut = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const router = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5' as const
const swapData = '0x414bf389' as const
const swapTxHash = `0x${'ab'.repeat(32)}` as const
const decisionHash = `0x${'aa'.repeat(32)}` as const
const calldataHash = keccak256(swapData)
const blockNumber = 27_134_567n
const sourceAmountRaw = '1000000000000000000'
const destinationAmountRaw = '3200000000'

const keyRegistry = {
  keys: [{
    key_id: 'insight-test',
    public_key: signer.address,
    validFrom: new Date(0).toISOString(),
    validUntil: null,
    revoked: false,
    role: 'attester' as const,
  }],
}
const verificationOptions = { keyRegistry, now }

const settlementDomain = { name: 'Insight Base Agent Swap Guard Settlement', version: '1', chainId: 1 } as const
const settlementTypes = {
  BaseAgentSwapGuardSettlement: [
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'swapTxHash', type: 'bytes32' },
    { name: 'approvalTxHash', type: 'bytes32' },
    { name: 'onChainSwapCalldataHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'fillStatus', type: 'string' },
    { name: 'sourceAmountRaw', type: 'string' },
    { name: 'destinationAmountRaw', type: 'string' },
    { name: 'executedPrice', type: 'string' },
    { name: 'realizedSlippageBps', type: 'string' },
    { name: 'blockNumber', type: 'string' },
    { name: 'executedAt', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

/** A genuinely signed settlement so the offline verifier accepts it. */
async function makeSettlement() {
  const reasonCodes: string[] = ['APPROVAL_TX_NOT_PRESENTED']
  const data = {
    decisionHash,
    swapTxHash,
    approvalTxHash: `0x${'0'.repeat(64)}` as const,
    onChainSwapCalldataHash: calldataHash,
    recipient,
    chainId: 8453 as const,
    fillStatus: 'FULL' as const,
    sourceAmountRaw,
    destinationAmountRaw,
    executedPrice: '3200',
    realizedSlippageBps: '12.5',
    blockNumber: blockNumber.toString(),
    executedAt: now + 12,
    checkedAt: now + 40,
    reasonCodesHash: keccak256(toBytes(canonical(reasonCodes))),
    schemaVersion: 1 as const,
  }
  const typedData = {
    domain: settlementDomain,
    types: settlementTypes,
    primaryType: 'BaseAgentSwapGuardSettlement' as const,
    message: { ...data, chainId: 8453n, executedAt: BigInt(data.executedAt), checkedAt: BigInt(data.checkedAt), schemaVersion: 1n },
  }
  return {
    type: 'BaseAgentSwapGuardSettlement' as const,
    schemaVersion: 1 as const,
    schema: 'insight.base-agent-swap-guard-settlement.v1' as const,
    uid: hashTypedData(typedData),
    attester: signer.address,
    attesterLabel: 'Insight Base Agent Swap Guard settlement attester' as const,
    signedAt: new Date(data.checkedAt * 1000).toISOString(),
    signature: await signer.signTypedData(typedData),
    verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/settlement',
    decisionHash,
    reasonCodes,
    data,
    eip712: { domain: settlementDomain, types: settlementTypes, primaryType: 'BaseAgentSwapGuardSettlement' },
  }
}

const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const transferTopic = toEventSelector('Transfer(address,address,uint256)')

type RereadLog = { address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}` }

function transferLog(token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint): RereadLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from, to } }) as unknown as readonly `0x${string}`[],
    data: pad(toHex(value)),
  }
}

// One input transfer (payer -> router), one output transfer (router -> recipient),
// plus an unrelated log that must be ignored by the decoder.
const happyLogs = [
  transferLog(tokenIn, payer, router, 1_000_000_000_000_000_000n),
  transferLog(tokenOut, router, recipient, 3_200_000_000n),
  { address: router, topics: [keccak256(toBytes('Swap(address,address,int256,int256)'))], data: '0x' as const },
]

const happyTransaction = { hash: swapTxHash, from: payer, input: swapData, blockNumber }
const happyReceipt = { blockNumber, status: 'success' as const, logs: happyLogs }

/** Fully in-memory reader; no network access of any kind. */
function happyReader(): SettlementRereadReader {
  return {
    getChainId: async (): Promise<number> => 8453,
    getTransaction: async () => happyTransaction,
    getTransactionReceipt: async () => happyReceipt,
  }
}

function checkByName(result: { checks: Array<{ name: string; status: string; observed: string }> }, name: string) {
  const entry = result.checks.find((item) => item.name === name)
  assert.ok(entry, `missing check ${name}`)
  return entry
}

test('all independently re-read chain facts agree -> VERIFIED', async () => {
  const settlement = await makeSettlement()
  const result = await independentlyVerifySettlement(settlement, { reader: happyReader() })
  assert.equal(result.verified, true)
  assert.equal(result.verdict, 'VERIFIED')
  assert.equal(result.reason, 'OK')
  assert.equal(result.mismatches.length, 0)
  assert.equal(result.checks.every((entry) => entry.pass && entry.status === 'PASS'), true)
  assert.equal(checkByName(result, 'CALLDATA_HASH').observed.toLowerCase(), calldataHash.toLowerCase())
  assert.equal(checkByName(result, 'SOURCE_AMOUNT').observed, sourceAmountRaw)
  assert.equal(checkByName(result, 'DESTINATION_AMOUNT').observed, destinationAmountRaw)
  assert.equal(checkByName(result, 'RECIPIENT').observed, recipient)
  assert.equal(result.observedTransfers.length, 2)
  assert.equal(result.chainId, 8453)
  assert.equal(result.swapTxHash, swapTxHash)
  assert.equal(result.blockNumber, blockNumber.toString())
  assert.equal(result.rpcOrigin, null)
  assert.ok(Number.isFinite(Date.parse(result.rereadAt)))
})

test('calldata hash mismatch -> MISMATCH, never verified', async () => {
  const settlement = await makeSettlement()
  const reader = {
    ...happyReader(),
    getTransaction: async () => ({ ...happyTransaction, input: '0xdeadbeef' as const }),
  }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'MISMATCH')
  assert.equal(result.reason, 'CALLDATA_HASH_MISMATCH')
  assert.equal(checkByName(result, 'CALLDATA_HASH').status, 'FAIL')
  assert.ok(result.mismatches.some((entry) => entry.name === 'CALLDATA_HASH'))
})

test('ERC-20 Transfer amount mismatch -> MISMATCH, never verified', async () => {
  const settlement = await makeSettlement()
  const reader = {
    ...happyReader(),
    getTransactionReceipt: async () => ({
      ...happyReceipt,
      logs: [
        happyLogs[0],
        transferLog(tokenOut, router, recipient, 9_999_999_999n),
        happyLogs[2],
      ],
    }),
  }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'MISMATCH')
  assert.equal(result.reason, 'DESTINATION_AMOUNT_MISMATCH')
  assert.equal(checkByName(result, 'DESTINATION_AMOUNT').observed, '9999999999')
  assert.equal(checkByName(result, 'DESTINATION_AMOUNT').status, 'FAIL')
})

test('missing receipt -> fail-closed UNKNOWN', async () => {
  const settlement = await makeSettlement()
  const reader = { ...happyReader(), getTransactionReceipt: async () => null }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.reason, 'RECEIPT_NOT_FOUND')
  assert.equal(checkByName(result, 'RECEIPT_PRESENT').status, 'UNKNOWN')
})

test('missing transaction -> fail-closed UNKNOWN', async () => {
  const settlement = await makeSettlement()
  const reader = { ...happyReader(), getTransaction: async () => null }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.reason, 'TX_NOT_FOUND')
})

test('RPC throwing -> fail-closed UNKNOWN, error text never leaks', async () => {
  const settlement = await makeSettlement()
  const reader = {
    ...happyReader(),
    getTransactionReceipt: async () => { throw new Error('secret-rpc-internal-detail') },
  }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.reason, 'RPC_UNAVAILABLE')
  assert.equal(JSON.stringify(result).includes('secret-rpc-internal-detail'), false)
})

test('RPC timeout -> fail-closed UNKNOWN', async () => {
  const settlement = await makeSettlement()
  const reader = {
    ...happyReader(),
    getTransactionReceipt: () => new Promise<never>(() => {}),
  }
  const result = await independentlyVerifySettlement(settlement, { reader, timeoutMs: 30 })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(result.reason, 'RPC_TIMEOUT')
})

test('block number / chain id mismatch (reorg or wrong RPC) -> fail-closed', async () => {
  const settlement = await makeSettlement()
  const reorged = {
    ...happyReader(),
    getTransactionReceipt: async () => ({ ...happyReceipt, blockNumber: blockNumber + 1n }),
  }
  const reorgResult = await independentlyVerifySettlement(settlement, { reader: reorged })
  assert.equal(reorgResult.verified, false)
  assert.equal(reorgResult.verdict, 'MISMATCH')
  assert.equal(checkByName(reorgResult, 'BLOCK_NUMBER').status, 'FAIL')

  const wrongChain = { ...happyReader(), getChainId: async (): Promise<number> => 56 }
  const chainResult = await independentlyVerifySettlement(settlement, { reader: wrongChain })
  assert.equal(chainResult.verified, false)
  assert.equal(checkByName(chainResult, 'CHAIN_ID').status, 'FAIL')
})

test('no opts: re-read is UNKNOWN and the existing settlement verification output is unchanged', async () => {
  const settlement = await makeSettlement()

  const reread = await independentlyVerifySettlement(settlement)
  assert.equal(reread.verified, false)
  assert.equal(reread.verdict, 'UNKNOWN')
  assert.equal(reread.reason, 'RPC_NOT_CONFIGURED')

  // Backwards-compatibility regression: the existing verifier's shape and
  // verdict are byte-for-byte identical, with no extra field.
  const verification = await verifyInsightBaseAgentSwapGuardSettlement(settlement, verificationOptions)
  assert.deepEqual(verification, {
    valid: true,
    decisionHash: decisionHash.toLowerCase(),
    swapTxHash: swapTxHash.toLowerCase(),
    attester: signer.address.toLowerCase(),
    reason: 'OK',
  })
  assert.equal('independentReread' in verification, false)
})

test('only the rpcUrl origin is recorded; credentials/path/query never appear', async () => {
  const settlement = await makeSettlement()
  const result = await independentlyVerifySettlement(settlement, {
    reader: happyReader(), // reader wins, so no network request is made
    rpcUrl: 'https://user:pass@rpc.example.com/v1/SUPERSECRET?apikey=XYZ',
  })
  assert.equal(result.verified, true)
  assert.equal(result.rpcOrigin, 'https://rpc.example.com')
  const serialized = JSON.stringify(result)
  for (const secret of ['SUPERSECRET', 'apikey', 'user:pass', 'XYZ']) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`)
  }
})

test('createSettlementRereadReader adapts a viem-like client', async () => {
  const settlement = await makeSettlement()
  const client = {
    getChainId: async () => 8453,
    getTransaction: async () => happyTransaction,
    getTransactionReceipt: async () => ({
      blockNumber,
      status: 'success' as const,
      logs: happyLogs.map((log) => ({ address: log.address, topics: [...log.topics] as `0x${string}`[], data: log.data })),
    }),
  }
  const reader = createSettlementRereadReader(client as unknown as Parameters<typeof createSettlementRereadReader>[0])
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, true)
  assert.equal(result.verdict, 'VERIFIED')
})

test('verifySettlementWithIndependentReread composes local + chain results', async () => {
  const settlement = await makeSettlement()
  const result = await verifySettlementWithIndependentReread(settlement, {
    ...verificationOptions,
    independentReread: { reader: happyReader() },
  })
  assert.equal(result.valid, true)
  assert.equal(result.reason, 'OK')
  assert.equal(result.independentReread.verified, true)
})

test('composition does not read the chain when local verification already failed', async () => {
  const settlement = await makeSettlement()
  const tampered = { ...settlement, reasonCodes: ['TAMPERED_AFTER_SIGNING'] }
  let rpcCalled = false
  const reader = {
    ...happyReader(),
    getChainId: async (): Promise<number> => { rpcCalled = true; return 8453 },
  }
  const result = await verifySettlementWithIndependentReread(tampered, {
    ...verificationOptions,
    independentReread: { reader, rpcUrl: 'https://rpc.example.com/v1/KEY' },
  })
  assert.equal(result.valid, false)
  assert.equal(result.independentReread.verified, false)
  assert.equal(result.independentReread.verdict, 'UNKNOWN')
  assert.equal(result.independentReread.reason, 'LOCAL_VERIFICATION_FAILED')
  assert.equal(result.independentReread.rpcOrigin, 'https://rpc.example.com')
  assert.equal(rpcCalled, false)
})

test('undecodable Transfer log -> fail-closed UNKNOWN', async () => {
  const settlement = await makeSettlement()
  const reader = {
    ...happyReader(),
    getTransactionReceipt: async () => ({
      ...happyReceipt,
      logs: [
        { address: tokenIn, topics: [transferTopic, `0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`] as `0x${string}`[], data: '0x1234' as const },
      ],
    }),
  }
  const result = await independentlyVerifySettlement(settlement, { reader })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, 'UNKNOWN')
  assert.equal(checkByName(result, 'TRANSFER_LOGS').status, 'UNKNOWN')
})
