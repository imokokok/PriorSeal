import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, toBytes } from 'viem'
import { buildExactCallIntent, parseExactCallTransaction } from './exact-call.js'
import type { ContextCommitment, ExactCallIntentInput, Intent } from './types.js'

/** Original Uniswap V3 SwapRouter exactInputSingle, with a deadline in the tuple.
 * SwapRouter02, Universal Router, multicall, native swaps and arbitrary selectors
 * require separate reviewed adapters; they are deliberately rejected here.
 */
export const V3_SINGLE_SWAP_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
])
export const SWAP_APPROVAL_NAMESPACE = 'priorseal.swap-approval.v1'

export type V3SwapApproval = {
  schema: 'priorseal.swap-approval.v1'
  chainId: number
  sender: string
  router: string
  routerCodeHash: string
  inputToken: string
  outputToken: string
  maxInputAmount: string
  minOutputAmount: string
  recipient: string
  fee: number
  deadline: number
}

export type V3SwapSemantics = {
  chainId: number
  sender: string
  router: string
  inputToken: string
  outputToken: string
  inputAmount: string
  minimumOutput: string
  recipient: string
  fee: number
  deadline: number
}

type Transaction = ExactCallIntentInput['transaction']
const addressPattern = /^0x[0-9a-fA-F]{40}$/
const hashPattern = /^0x[0-9a-fA-F]{64}$/
const uintPattern = /^(0|[1-9][0-9]*)$/
const zeroAddress = `0x${'0'.repeat(40)}`

function requireValid(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TypeError(code)
}

function address(value: unknown, field: string): string {
  requireValid(typeof value === 'string' && addressPattern.test(value) && value.toLowerCase() !== zeroAddress, `${field} must be a nonzero EVM address`)
  return value.toLowerCase()
}

function amount(value: unknown, field: string): string {
  requireValid(typeof value === 'string' && uintPattern.test(value) && BigInt(value) > 0n && BigInt(value) < 2n ** 256n, `${field} must be a positive uint256 decimal string`)
  return value
}

function transaction(value: unknown): Transaction {
  return parseExactCallTransaction(value)
}

/** Strictly decode one canonical ERC-20 exact-input call. This does not validate
 * the target deployment, so use assertV3SwapRouterCode before authorization and
 * at the enforced signing/submission boundary.
 */
export function decodeV3SingleSwap(value: unknown): V3SwapSemantics {
  const tx = transaction(value)
  requireValid(tx.value === undefined || BigInt(tx.value) === 0n, 'SWAP_NATIVE_VALUE_UNSUPPORTED')
  requireValid(tx.data.length > 10, 'SWAP_CALL_UNSUPPORTED')
  let decoded: ReturnType<typeof decodeFunctionData<typeof V3_SINGLE_SWAP_ABI>>
  try { decoded = decodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, data: tx.data }) }
  catch { throw new TypeError('SWAP_CALL_UNSUPPORTED') }
  requireValid(decoded.functionName === 'exactInputSingle', 'SWAP_CALL_UNSUPPORTED')
  requireValid(encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: decoded.args }).toLowerCase() === tx.data.toLowerCase(), 'SWAP_CALL_NON_CANONICAL')
  const p = decoded.args[0]
  requireValid(p.deadline <= BigInt(Number.MAX_SAFE_INTEGER) && p.deadline > 0n, 'SWAP_DEADLINE_INVALID')
  requireValid(p.fee > 0 && p.fee < 1_000_000 && p.sqrtPriceLimitX96 === 0n, 'SWAP_POOL_OR_PARTIAL_FILL_UNSUPPORTED')
  requireValid(p.amountIn > 0n && p.amountOutMinimum > 0n, 'SWAP_AMOUNT_INVALID')
  const inputToken = address(p.tokenIn, 'tokenIn')
  const outputToken = address(p.tokenOut, 'tokenOut')
  requireValid(inputToken !== outputToken, 'SWAP_TOKEN_PAIR_INVALID')
  return {
    chainId: tx.chainId,
    sender: address(tx.from, 'transaction.from'),
    router: address(tx.to, 'transaction.to'),
    inputToken,
    outputToken,
    inputAmount: p.amountIn.toString(),
    minimumOutput: p.amountOutMinimum.toString(),
    recipient: address(p.recipient, 'recipient'),
    fee: p.fee,
    deadline: Number(p.deadline),
  }
}

/** Create the user-visible approval from an existing transaction. The code hash
 * must come from a separately reviewed deployment configuration, not from the
 * transaction proposer or a discovery response alone.
 */
export function createV3SwapApproval(value: unknown, routerCodeHash: string): V3SwapApproval {
  const swap = decodeV3SingleSwap(value)
  return parseV3SwapApproval({
    schema: 'priorseal.swap-approval.v1', chainId: swap.chainId, sender: swap.sender,
    router: swap.router, routerCodeHash, inputToken: swap.inputToken,
    outputToken: swap.outputToken, maxInputAmount: swap.inputAmount,
    minOutputAmount: swap.minimumOutput, recipient: swap.recipient,
    fee: swap.fee, deadline: swap.deadline,
  })
}

/** Validate imported approval JSON before treating it as a business constraint. */
export function parseV3SwapApproval(value: unknown): V3SwapApproval {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'SWAP_APPROVAL_INVALID')
  const candidate = value as Record<string, unknown>
  const keys = ['schema', 'chainId', 'sender', 'router', 'routerCodeHash', 'inputToken', 'outputToken', 'maxInputAmount', 'minOutputAmount', 'recipient', 'fee', 'deadline']
  requireValid(Object.keys(candidate).sort().join(',') === [...keys].sort().join(','), 'SWAP_APPROVAL_SHAPE')
  requireValid(candidate.schema === 'priorseal.swap-approval.v1', 'SWAP_APPROVAL_SCHEMA')
  requireValid(typeof candidate.chainId === 'number' && Number.isSafeInteger(candidate.chainId) && candidate.chainId > 0, 'SWAP_CHAIN_INVALID')
  requireValid(typeof candidate.fee === 'number' && Number.isSafeInteger(candidate.fee) && candidate.fee > 0 && candidate.fee < 1_000_000, 'SWAP_FEE_INVALID')
  requireValid(typeof candidate.deadline === 'number' && Number.isSafeInteger(candidate.deadline) && candidate.deadline > 0, 'SWAP_DEADLINE_INVALID')
  requireValid(typeof candidate.routerCodeHash === 'string' && hashPattern.test(candidate.routerCodeHash), 'SWAP_ROUTER_CODE_HASH_INVALID')
  const inputToken = address(candidate.inputToken, 'inputToken')
  const outputToken = address(candidate.outputToken, 'outputToken')
  requireValid(inputToken !== outputToken, 'SWAP_TOKEN_PAIR_INVALID')
  return {
    schema: 'priorseal.swap-approval.v1', chainId: candidate.chainId,
    sender: address(candidate.sender, 'sender'), router: address(candidate.router, 'router'),
    routerCodeHash: candidate.routerCodeHash.toLowerCase(), inputToken, outputToken,
    maxInputAmount: amount(candidate.maxInputAmount, 'maxInputAmount'),
    minOutputAmount: amount(candidate.minOutputAmount, 'minOutputAmount'),
    recipient: address(candidate.recipient, 'recipient'), fee: candidate.fee,
    deadline: candidate.deadline,
  }
}

export function assertV3SwapRouterCode(value: unknown, bytecode: unknown): void {
  const approval = parseV3SwapApproval(value)
  requireValid(typeof bytecode === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode), 'SWAP_ROUTER_CODE_UNAVAILABLE')
  requireValid(keccak256(bytecode as `0x${string}`).toLowerCase() === approval.routerCodeHash, 'SWAP_ROUTER_CODE_MISMATCH')
}

export function swapApprovalCommitment(value: unknown): ContextCommitment {
  const approval = parseV3SwapApproval(value)
  return { namespace: SWAP_APPROVAL_NAMESPACE, algorithm: 'keccak256', digest: keccak256(toBytes(JSON.stringify(approval))) }
}

export function assertV3SwapTransaction(value: unknown, transactionValue: unknown, now = Math.floor(Date.now() / 1000)): V3SwapSemantics {
  const approval = parseV3SwapApproval(value)
  const swap = decodeV3SingleSwap(transactionValue)
  requireValid(Number.isSafeInteger(now) && now > 0 && now <= swap.deadline, 'SWAP_DEADLINE_EXPIRED')
  requireValid(swap.chainId === approval.chainId && swap.sender === approval.sender && swap.router === approval.router, 'SWAP_EXECUTION_SCOPE_MISMATCH')
  requireValid(swap.inputToken === approval.inputToken && swap.outputToken === approval.outputToken && swap.recipient === approval.recipient, 'SWAP_ASSET_OR_RECIPIENT_MISMATCH')
  requireValid(swap.fee === approval.fee && swap.deadline <= approval.deadline, 'SWAP_ROUTE_OR_DEADLINE_MISMATCH')
  requireValid(BigInt(swap.inputAmount) <= BigInt(approval.maxInputAmount) && BigInt(swap.minimumOutput) >= BigInt(approval.minOutputAmount), 'SWAP_AMOUNT_LIMIT_MISMATCH')
  return swap
}

export function buildV3SwapIntent(input: { approval: unknown; transaction: unknown; intentId: string; validUntil: number; constraints?: Intent['constraints']; contextCommitments?: ContextCommitment[]; now?: number }): Intent {
  const approval = parseV3SwapApproval(input.approval)
  const swap = assertV3SwapTransaction(approval, input.transaction, input.now)
  requireValid(Number.isSafeInteger(input.validUntil) && input.validUntil > (input.now ?? Math.floor(Date.now() / 1000)) && input.validUntil <= swap.deadline, 'SWAP_AUTHORIZATION_WINDOW_INVALID')
  requireValid(!input.contextCommitments?.some((entry) => entry.namespace === SWAP_APPROVAL_NAMESPACE), 'SWAP_APPROVAL_COMMITMENT_DUPLICATE')
  return buildExactCallIntent({
    transaction: transaction(input.transaction), intentId: input.intentId,
    asset: `eip155:${swap.chainId}/erc20:${swap.inputToken}`, amount: swap.inputAmount,
    validUntil: input.validUntil, constraints: input.constraints,
    contextCommitments: [...(input.contextCommitments ?? []), swapApprovalCommitment(approval)],
  })
}

/** Recheck immediately before the external wallet's signing/submission call.
 * The caller must separately verify the principal signature and accepted
 * authorization, and route every signing path through this check.
 */
export function assertV3SwapAuthorization(input: { approval: unknown; transaction: unknown; intent: Intent; routerBytecode: unknown; now?: number }): V3SwapSemantics {
  const approval = parseV3SwapApproval(input.approval)
  assertV3SwapRouterCode(approval, input.routerBytecode)
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const swap = assertV3SwapTransaction(approval, input.transaction, now)
  requireValid(input.intent?.schema === 'priorseal.intent.v2' && input.intent.executionProfile === 'priorseal.execution-profile.exact-call.v1' && input.intent.action === 'CONTRACT_CALL', 'SWAP_INTENT_PROFILE_MISMATCH')
  requireValid(Number.isSafeInteger(input.intent.validUntil) && now <= input.intent.validUntil && input.intent.validUntil <= swap.deadline, 'SWAP_AUTHORIZATION_WINDOW_INVALID')
  const matching = input.intent.contextCommitments?.filter((entry) => entry.namespace === SWAP_APPROVAL_NAMESPACE) ?? []
  const commitment = swapApprovalCommitment(approval)
  requireValid(matching.length === 1 && matching[0].algorithm === commitment.algorithm && matching[0].digest === commitment.digest, 'SWAP_APPROVAL_COMMITMENT_MISMATCH')
  const expected = buildExactCallIntent({ transaction: transaction(input.transaction), intentId: input.intent.intentId, asset: `eip155:${swap.chainId}/erc20:${swap.inputToken}`, amount: swap.inputAmount, validUntil: input.intent.validUntil, constraints: input.intent.constraints, contextCommitments: input.intent.contextCommitments })
  for (const key of ['schema', 'executionProfile', 'intentId', 'chainId', 'action', 'asset', 'amount', 'sender', 'recipient', 'validUntil', 'nonce', 'callTarget', 'calldataHash', 'transactionValue'] as const) {
    requireValid(input.intent[key] === expected[key], `SWAP_INTENT_${key.toUpperCase()}_MISMATCH`)
  }
  return swap
}
