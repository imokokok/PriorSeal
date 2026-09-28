import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, keccak256 } from 'viem'
import {
  V3_SINGLE_SWAP_ABI, assertV3SwapAuthorization, assertV3SwapRouterCode,
  assertV3SwapTransaction, buildV3SwapIntent, createV3SwapApproval,
  decodeV3SingleSwap, parseV3SwapApproval, swapApprovalCommitment,
} from '../../sdk/dist/index.js'

const sender = `0x${'1'.repeat(40)}` as const
const router = `0x${'2'.repeat(40)}` as const
const inputToken = `0x${'3'.repeat(40)}` as const
const outputToken = `0x${'4'.repeat(40)}` as const
const recipient = `0x${'5'.repeat(40)}` as const
const code = '0x60006000' as const
const now = 1_800_000_000

function fixture(overrides: Record<string, unknown> = {}) {
  const params = {
    tokenIn: inputToken, tokenOut: outputToken, fee: 3000, recipient,
    deadline: 1_800_000_120n, amountIn: 1_000_000n,
    amountOutMinimum: 900_000n, sqrtPriceLimitX96: 0n,
    ...overrides,
  }
  const transaction = {
    chainId: 8453, from: sender, to: router, nonce: '7', value: '0',
    data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [params] }),
  }
  const approval = createV3SwapApproval(transaction, keccak256(code))
  const intent = buildV3SwapIntent({ approval, transaction, intentId: 'swap-1', validUntil: now + 90, now })
  return { transaction, approval, intent }
}

test('one canonical ERC-20 swap is decoded, signed as an exact call and rechecked before signing', () => {
  const { transaction, approval, intent } = fixture()
  assert.equal(decodeV3SingleSwap(transaction).recipient, recipient)
  assert.equal(intent.asset, `eip155:8453/erc20:${inputToken}`)
  assert.equal(intent.amount, '1000000')
  assert.equal(intent.calldataHash, keccak256(transaction.data))
  assert.deepEqual(intent.contextCommitments, [swapApprovalCommitment(approval)])
  assertV3SwapRouterCode(approval, code)
  assert.equal(assertV3SwapAuthorization({ approval, transaction, intent, routerBytecode: code, now }).minimumOutput, '900000')
})

test('a changed spend, minimum output, recipient, token, pool fee or deadline is denied', () => {
  const baseline = fixture()
  const mutations = [
    { amountIn: 1_000_001n }, { amountOutMinimum: 899_999n },
    { recipient: sender }, { tokenOut: sender }, { fee: 500 },
    { deadline: 1_800_000_121n },
  ]
  for (const mutation of mutations) {
    const changed = fixture(mutation)
    assert.throws(() => assertV3SwapTransaction(baseline.approval, changed.transaction, now), `Accepted ${JSON.stringify(mutation, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`)
    assert.throws(() => assertV3SwapAuthorization({ approval: baseline.approval, transaction: changed.transaction, intent: baseline.intent, routerBytecode: code, now }))
  }
  assert.throws(() => assertV3SwapTransaction(baseline.approval, { ...baseline.transaction, to: recipient }, now))
  assert.throws(() => assertV3SwapTransaction(baseline.approval, { ...baseline.transaction, value: '1' }, now))
  assert.throws(() => assertV3SwapTransaction(baseline.approval, baseline.transaction, now + 121), /SWAP_DEADLINE_EXPIRED/)
})

test('the signer check rejects changed code, signed approval, intent or exact calldata', () => {
  const { transaction, approval, intent } = fixture()
  const call = { approval, transaction, intent, routerBytecode: code, now }
  assert.throws(() => assertV3SwapAuthorization({ ...call, routerBytecode: '0x6001' }), /SWAP_ROUTER_CODE_MISMATCH/)
  assert.throws(() => assertV3SwapAuthorization({ ...call, intent: { ...intent, calldataHash: `0x${'0'.repeat(64)}` } }), /SWAP_INTENT_CALLDATAHASH_MISMATCH/)
  assert.throws(() => assertV3SwapAuthorization({ ...call, intent: { ...intent, contextCommitments: [] } }), /SWAP_APPROVAL_COMMITMENT_MISMATCH/)
  assert.throws(() => assertV3SwapAuthorization({ ...call, intent: { ...intent, contextCommitments: [swapApprovalCommitment(approval), swapApprovalCommitment(approval)] } }), /SWAP_APPROVAL_COMMITMENT_MISMATCH/)
  assert.throws(() => assertV3SwapAuthorization({ ...call, approval: { ...approval, minOutputAmount: '900001' } }))
  assert.throws(() => assertV3SwapAuthorization({ ...call, transaction: { ...transaction, nonce: '8' } }), /SWAP_INTENT_NONCE_MISMATCH/)
})

test('strict approval and call parser reject unknown fields, unsafe calls and unsupported router variants', () => {
  const { transaction, approval } = fixture()
  assert.throws(() => parseV3SwapApproval({ ...approval, hidden: true }), /SWAP_APPROVAL_SHAPE/)
  assert.throws(() => parseV3SwapApproval({ ...approval, maxInputAmount: '-1' }))
  assert.throws(() => decodeV3SingleSwap({ ...transaction, data: '0x12345678' }), /SWAP_CALL_UNSUPPORTED/)
  assert.throws(() => decodeV3SingleSwap({ ...transaction, data: `${transaction.data}00` }), /SWAP_CALL_NON_CANONICAL/)
  assert.throws(() => decodeV3SingleSwap(fixture({ sqrtPriceLimitX96: 1n }).transaction), /SWAP_POOL_OR_PARTIAL_FILL_UNSUPPORTED/)
  assert.throws(() => buildV3SwapIntent({ approval, transaction, intentId: 'swap-1', validUntil: now + 121, now }), /SWAP_AUTHORIZATION_WINDOW_INVALID/)
})
