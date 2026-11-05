/**
 * Optional, caller-supplied independent chain re-read for Insight Base Agent
 * Swap Guard settlements.
 *
 * `verifyInsightBaseAgentSwapGuardSettlement` re-checks signatures, the uid,
 * the reason-code hash and the decision<->settlement binding locally, but it
 * inherits Insight's RPC reconciliation claims for the factual layer
 * (swapTxHash, onChainSwapCalldataHash, fillStatus, amounts, blockNumber,
 * executedPrice). This module closes that gap *when the caller supplies its own
 * RPC*: it re-reads the swap transaction and receipt from that RPC and
 * independently recomputes
 *
 *   1. keccak256 of the transaction calldata, compared against
 *      `onChainSwapCalldataHash`;
 *   2. the ERC-20 `Transfer` amounts and recipient decoded from the receipt
 *      logs, compared against `sourceAmountRaw`, `destinationAmountRaw`,
 *      `recipient` and `fillStatus`;
 *   3. the pinned chain id and block number, so a missing receipt or a reorged
 *      / mismatched block can never be reported as a match.
 *
 * No RPC endpoint is baked in: the caller passes `rpcUrl`, a viem `provider`,
 * or a narrow `reader`. Results and logs never contain the full URL (which may
 * carry an API key) — only its origin is recorded.
 *
 * Fail-closed: any mismatch, undecodable log, missing receipt, chain/block
 * mismatch, RPC error or timeout yields `verdict !== 'VERIFIED'` and
 * `verified: false`. `verified` means only "the independently re-read chain
 * facts agree with the settlement's claims"; it does NOT replace signature,
 * uid, reason-code or trust verification, which remain the caller's
 * responsibility via the existing verifiers (or the composition helper below).
 */

import {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  toEventSelector,
  type Hex,
  type PublicClient,
} from 'viem'

import {
  INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_ATTESTER_LABEL,
  INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE,
  INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_SCHEMA,
  SETTLEMENT_CHAIN_IDS,
  verifyInsightBaseAgentSwapGuardSettlement,
  type InsightBaseAgentSwapGuardSettlementData,
  type InsightBaseAgentSwapGuardSettlementOptions,
  type InsightBaseAgentSwapGuardSettlementVerification,
} from './insight-base-agent-swap-guard-settlement.js'

const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)')
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/
const UINT = /^(?:0|[1-9][0-9]*)$/
/** Raw amounts are exact decimal strings; '' means Insight could not attribute them. */
const RAW_AMOUNT = /^(?:0|[1-9][0-9]*)?$/
const DEFAULT_TIMEOUT_MS = 10_000

/** Minimal transaction shape needed for an independent re-read. */
export type SettlementRereadTransaction = {
  hash: Hex
  from: Hex | null
  input: Hex
  blockNumber: bigint | null
}

/** Minimal receipt shape needed for an independent re-read. */
export type SettlementRereadReceipt = {
  blockNumber: bigint
  status: 'success' | 'reverted' | string
  logs: ReadonlyArray<{ address: Hex; topics: readonly Hex[]; data: Hex }>
}

/**
 * Narrow, read-only, caller-supplied RPC surface. Injecting a `reader` is the
 * easiest way to use an RPC fully independent of Insight's/PriorSeal's own and
 * to mock the chain in tests.
 */
export type SettlementRereadReader = {
  getChainId(): Promise<number>
  getTransaction(input: { hash: Hex }): Promise<SettlementRereadTransaction | null>
  getTransactionReceipt(input: { hash: Hex }): Promise<SettlementRereadReceipt | null>
}

/** One decoded ERC-20 `Transfer` log, lowercased, amounts as decimal strings. */
export type ObservedErc20Transfer = {
  token: string
  from: string
  to: string
  valueRaw: string
}

export type IndependentRereadOptions = {
  /** Caller's own RPC URL. Only its origin is ever recorded in results/logs. */
  rpcUrl?: string
  /** A caller-constructed viem public client (adapted to the narrow reader). */
  provider?: Pick<PublicClient, 'getChainId' | 'getTransaction' | 'getTransactionReceipt'>
  /** A pre-built narrow reader; takes precedence over provider/rpcUrl. */
  reader?: SettlementRereadReader
  /** Chain id to pin the RPC against; defaults to settlement.data.chainId. */
  chainId?: number
  /** Optional ERC-20 contract addresses to disambiguate Transfer logs. */
  sourceToken?: Hex
  destinationToken?: Hex
  /** Per-RPC-call timeout in milliseconds (default 10000). */
  timeoutMs?: number
}

export type IndependentRereadVerdict = 'VERIFIED' | 'MISMATCH' | 'UNKNOWN'

export type IndependentRereadCheck = {
  name: string
  expected: string
  observed: string
  pass: boolean
  status: 'PASS' | 'FAIL' | 'UNKNOWN'
  /** Machine-readable reason code for this check. */
  code: string
}

export type IndependentRereadMismatch = {
  name: string
  expected: string
  observed: string
  status: 'FAIL' | 'UNKNOWN'
  code: string
}

export type IndependentRereadResult = {
  /** true ONLY when every check passed (verdict === 'VERIFIED'). */
  verified: boolean
  verdict: IndependentRereadVerdict
  /** Machine-readable conclusion, e.g. 'OK' or the first failing/unknown code. */
  reason: string
  checks: IndependentRereadCheck[]
  mismatches: IndependentRereadMismatch[]
  rereadAt: string
  /** URL origin (scheme+host+port) only; never a URL containing credentials. */
  rpcOrigin: string | null
  /** Declared identifiers from the settlement, not chain-observed values. */
  chainId: number | null
  swapTxHash: string | null
  blockNumber: string | null
  /** All decoded ERC-20 Transfer logs, exposed for caller inspection. */
  observedTransfers: ObservedErc20Transfer[]
}

export type SettlementVerificationWithIndependentReread =
  InsightBaseAgentSwapGuardSettlementVerification & { independentReread: IndependentRereadResult }

/** Adapts a viem public client (or a compatible mock) to the narrow reader. */
export function createSettlementRereadReader(
  client: Pick<PublicClient, 'getChainId' | 'getTransaction' | 'getTransactionReceipt'>,
): SettlementRereadReader {
  return {
    getChainId: () => client.getChainId(),
    getTransaction: async ({ hash }) => {
      const tx = await client.getTransaction({ hash })
      if (!tx) return null
      return { hash: tx.hash, from: tx.from, input: tx.input, blockNumber: tx.blockNumber }
    },
    getTransactionReceipt: async ({ hash }) => {
      const receipt = await client.getTransactionReceipt({ hash })
      if (!receipt) return null
      return {
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: [...log.topics] as Hex[],
          data: log.data,
        })),
      }
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/** Shape-check the settlement; cryptographic verification stays with the caller. */
function parseSettlement(value: unknown): InsightBaseAgentSwapGuardSettlementData | null {
  if (!isRecord(value)) return null
  if (value.type !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_PRIMARY_TYPE ||
    value.schema !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_SCHEMA ||
    value.schemaVersion !== 1 ||
    value.attesterLabel !== INSIGHT_BASE_AGENT_SWAP_GUARD_SETTLEMENT_ATTESTER_LABEL ||
    !isRecord(value.data)) return null
  const d = value.data
  if (typeof d.swapTxHash !== 'string' || !HEX32.test(d.swapTxHash) ||
    typeof d.onChainSwapCalldataHash !== 'string' || !HEX32.test(d.onChainSwapCalldataHash) ||
    typeof d.recipient !== 'string' || !ADDRESS.test(d.recipient) ||
    typeof d.chainId !== 'number' || !SETTLEMENT_CHAIN_IDS.has(d.chainId) ||
    (d.fillStatus !== 'FULL' && d.fillStatus !== 'REVERTED') ||
    typeof d.sourceAmountRaw !== 'string' || !RAW_AMOUNT.test(d.sourceAmountRaw) ||
    typeof d.destinationAmountRaw !== 'string' || !RAW_AMOUNT.test(d.destinationAmountRaw) ||
    typeof d.blockNumber !== 'string' || !UINT.test(d.blockNumber) || d.blockNumber.length > 78) return null
  return d as unknown as InsightBaseAgentSwapGuardSettlementData
}

/** Only scheme + host + port; query strings / paths / API keys never survive. */
function originOf(rpcUrl: string): string | null {
  try {
    const url = new URL(rpcUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function lowerEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function check(name: string, expected: string, observed: string, status: IndependentRereadCheck['status'], code: string): IndependentRereadCheck {
  return { name, expected, observed, pass: status === 'PASS', status, code }
}

class RpcTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcTimeoutError('RPC_TIMEOUT')), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function resolveReader(options: IndependentRereadOptions): SettlementRereadReader | null {
  try {
    if (options.reader) return options.reader
    if (options.provider) return createSettlementRereadReader(options.provider)
    if (typeof options.rpcUrl === 'string' && options.rpcUrl.trim()) {
      return createSettlementRereadReader(createPublicClient({ transport: http(options.rpcUrl) }))
    }
  } catch {
    return null
  }
  return null
}

type RereadMeta = {
  rpcOrigin: string | null
  chainId: number | null
  swapTxHash: string | null
  blockNumber: string | null
  observedTransfers: ObservedErc20Transfer[]
}

function buildResult(checks: IndependentRereadCheck[], meta: RereadMeta): IndependentRereadResult {
  const firstBad = checks.find((entry) => entry.status === 'FAIL') ?? checks.find((entry) => entry.status === 'UNKNOWN')
  const verdict: IndependentRereadVerdict = firstBad
    ? (firstBad.status === 'FAIL' ? 'MISMATCH' : 'UNKNOWN')
    : (checks.length === 0 ? 'UNKNOWN' : 'VERIFIED')
  const mismatches: IndependentRereadMismatch[] = checks
    .filter((entry) => entry.status !== 'PASS')
    .map((entry) => ({
      name: entry.name,
      expected: entry.expected,
      observed: entry.observed,
      status: entry.status as 'FAIL' | 'UNKNOWN',
      code: entry.code,
    }))
  return {
    verified: verdict === 'VERIFIED',
    verdict,
    reason: verdict === 'VERIFIED' ? 'OK' : (firstBad?.code ?? 'UNKNOWN'),
    checks,
    mismatches,
    rereadAt: new Date().toISOString(),
    rpcOrigin: meta.rpcOrigin,
    chainId: meta.chainId,
    swapTxHash: meta.swapTxHash,
    blockNumber: meta.blockNumber,
    observedTransfers: meta.observedTransfers,
  }
}

function unavailableResult(code: string, rpcOrigin: string | null): IndependentRereadResult {
  return buildResult(
    [check('LOCAL_VERIFICATION', 'valid', 'invalid', 'UNKNOWN', code)],
    { rpcOrigin, chainId: null, swapTxHash: null, blockNumber: null, observedTransfers: [] },
  )
}

function amountCheck(name: string, declared: string, candidates: readonly ObservedErc20Transfer[]): IndependentRereadCheck {
  if (declared === '') return check(name, declared, 'UNKNOWN', 'UNKNOWN', `${name}_NOT_DECLARED`)
  if (candidates.length !== 1) {
    return check(name, declared, candidates.map((entry) => entry.valueRaw).join(',') || 'UNKNOWN', 'UNKNOWN', `${name}_UNATTRIBUTABLE`)
  }
  const observed = candidates[0].valueRaw
  return observed === declared
    ? check(name, declared, observed, 'PASS', 'OK')
    : check(name, declared, observed, 'FAIL', `${name}_MISMATCH`)
}

/**
 * Independently re-read the swap transaction from a caller-supplied RPC and
 * compare the recomputed chain facts against the settlement's claims.
 *
 * With no `options` (or no RPC source) this returns an `UNKNOWN` result — the
 * re-read is opt-in and never changes the behaviour of the existing settlement
 * verifiers. Any inconsistency, RPC failure or timeout is fail-closed.
 */
export async function independentlyVerifySettlement(
  settlement: unknown,
  options: IndependentRereadOptions = {},
): Promise<IndependentRereadResult> {
  const meta: RereadMeta = {
    rpcOrigin: typeof options.rpcUrl === 'string' ? originOf(options.rpcUrl) : null,
    chainId: null,
    swapTxHash: null,
    blockNumber: null,
    observedTransfers: [],
  }
  const checks: IndependentRereadCheck[] = []
  const finish = (): IndependentRereadResult => buildResult(checks, meta)

  const data = parseSettlement(settlement)
  if (!data) {
    checks.push(check('SETTLEMENT_SHAPE', 'valid settlement', 'malformed', 'UNKNOWN', 'MALFORMED_SETTLEMENT'))
    return finish()
  }
  meta.chainId = data.chainId
  meta.swapTxHash = data.swapTxHash.toLowerCase()
  meta.blockNumber = data.blockNumber

  const expectedChainId = options.chainId ?? data.chainId
  if (options.chainId !== undefined && options.chainId !== data.chainId) {
    checks.push(check('CHAIN_ID_DECLARATION', String(data.chainId), String(options.chainId), 'FAIL', 'CHAIN_ID_DECLARATION_CONFLICT'))
    return finish()
  }

  const reader = resolveReader(options)
  if (!reader) {
    checks.push(check('RPC_SOURCE', 'caller-supplied RPC', 'none', 'UNKNOWN', 'RPC_NOT_CONFIGURED'))
    return finish()
  }

  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS
  const call = <T>(fn: () => Promise<T>): Promise<T> => withTimeout(Promise.resolve().then(fn), timeoutMs)
  const hash = data.swapTxHash as Hex

  try {
    const rawChainId = await call(() => reader.getChainId())
    const chainId = Number(rawChainId)
    checks.push(Number.isSafeInteger(chainId) && chainId === expectedChainId
      ? check('CHAIN_ID', String(expectedChainId), String(rawChainId), 'PASS', 'OK')
      : check('CHAIN_ID', String(expectedChainId), String(rawChainId), 'FAIL', 'RPC_CHAIN_MISMATCH'))

    const tx = await call(() => reader.getTransaction({ hash }))
    if (!tx) {
      checks.push(check('TRANSACTION_PRESENT', 'present', 'missing', 'UNKNOWN', 'TX_NOT_FOUND'))
      return finish()
    }
    checks.push(check('TRANSACTION_PRESENT', 'present', 'present', 'PASS', 'OK'))
    checks.push(typeof tx.hash === 'string' && lowerEqual(tx.hash, hash)
      ? check('SWAP_TX_HASH', hash, tx.hash, 'PASS', 'OK')
      : check('SWAP_TX_HASH', hash, String(tx.hash), 'FAIL', 'TX_HASH_MISMATCH'))

    if (typeof tx.input !== 'string' || !HEX_BYTES.test(tx.input)) {
      checks.push(check('CALLDATA_HASH', data.onChainSwapCalldataHash, 'unreadable', 'UNKNOWN', 'CALLDATA_UNREADABLE'))
    } else {
      const observedHash = keccak256(tx.input)
      checks.push(lowerEqual(observedHash, data.onChainSwapCalldataHash)
        ? check('CALLDATA_HASH', data.onChainSwapCalldataHash, observedHash, 'PASS', 'OK')
        : check('CALLDATA_HASH', data.onChainSwapCalldataHash, observedHash, 'FAIL', 'CALLDATA_HASH_MISMATCH'))
    }

    const receipt = await call(() => reader.getTransactionReceipt({ hash }))
    if (!receipt) {
      checks.push(check('RECEIPT_PRESENT', 'present', 'missing', 'UNKNOWN', 'RECEIPT_NOT_FOUND'))
      return finish()
    }
    checks.push(check('RECEIPT_PRESENT', 'present', 'present', 'PASS', 'OK'))

    if (typeof receipt.blockNumber !== 'bigint') {
      checks.push(check('BLOCK_NUMBER', data.blockNumber, 'unreadable', 'UNKNOWN', 'BLOCK_NUMBER_UNREADABLE'))
    } else {
      const expectedBlock = BigInt(data.blockNumber)
      const txBlock = tx.blockNumber
      const blockOk = receipt.blockNumber === expectedBlock && (txBlock === null || txBlock === receipt.blockNumber)
      checks.push(blockOk
        ? check('BLOCK_NUMBER', data.blockNumber, receipt.blockNumber.toString(), 'PASS', 'OK')
        : check('BLOCK_NUMBER', data.blockNumber, receipt.blockNumber.toString(), 'FAIL', 'BLOCK_NUMBER_MISMATCH'))
    }

    const observedStatus = receipt.status === 'success' ? 'FULL' : receipt.status === 'reverted' ? 'REVERTED' : 'UNKNOWN'
    checks.push(observedStatus === data.fillStatus
      ? check('FILL_STATUS', data.fillStatus, observedStatus, 'PASS', 'OK')
      : observedStatus === 'UNKNOWN'
        ? check('FILL_STATUS', data.fillStatus, observedStatus, 'UNKNOWN', 'RECEIPT_STATUS_UNREADABLE')
        : check('FILL_STATUS', data.fillStatus, observedStatus, 'FAIL', 'FILL_STATUS_MISMATCH'))

    const logs = Array.isArray(receipt.logs) ? receipt.logs : []
    const transfers: ObservedErc20Transfer[] = []
    let decodeFailure: string | null = null
    for (const log of logs) {
      const topics = Array.isArray(log.topics) ? log.topics : []
      if (topics.length === 0 || !lowerEqual(String(topics[0]), TRANSFER_TOPIC)) continue
      try {
        const decoded = decodeEventLog({
          abi: TRANSFER_ABI,
          data: log.data,
          topics: topics as [Hex, ...Hex[]],
          strict: true,
        })
        if (decoded.eventName !== 'Transfer' || !decoded.args) throw new TypeError('not a Transfer event')
        const args = decoded.args as { from: Hex; to: Hex; value: bigint }
        transfers.push({
          token: String(log.address).toLowerCase(),
          from: String(args.from).toLowerCase(),
          to: String(args.to).toLowerCase(),
          valueRaw: args.value.toString(),
        })
      } catch {
        decodeFailure = 'TRANSFER_LOG_UNDECODABLE'
        break
      }
    }
    meta.observedTransfers = transfers
    checks.push(decodeFailure
      ? check('TRANSFER_LOGS', 'decodable', 'undecodable', 'UNKNOWN', decodeFailure)
      : transfers.length > 0
        ? check('TRANSFER_LOGS', '>=1', String(transfers.length), 'PASS', 'OK')
        : check('TRANSFER_LOGS', '>=1', '0', 'UNKNOWN', 'NO_TRANSFER_LOGS'))

    const recipient = data.recipient.toLowerCase()
    const payer = typeof tx.from === 'string' ? tx.from.toLowerCase() : null
    const sourceToken = typeof options.sourceToken === 'string' ? options.sourceToken.toLowerCase() : null
    const destinationToken = typeof options.destinationToken === 'string' ? options.destinationToken.toLowerCase() : null

    // Output: ERC-20 Transfer(s) whose `to` is the declared recipient.
    const destinationCandidates = transfers.filter((entry) =>
      entry.to === recipient && (destinationToken === null || entry.token === destinationToken))
    // Input: ERC-20 Transfer(s) paid by the transaction sender to someone else.
    const sourceCandidates = transfers.filter((entry) =>
      entry.to !== recipient && (payer === null || entry.from === payer) &&
      (sourceToken === null || entry.token === sourceToken))

    checks.push(amountCheck('DESTINATION_AMOUNT', data.destinationAmountRaw, destinationCandidates))
    checks.push(amountCheck('SOURCE_AMOUNT', data.sourceAmountRaw, sourceCandidates))
    checks.push(destinationCandidates.length === 1 && destinationCandidates[0].to === recipient
      ? check('RECIPIENT', data.recipient, destinationCandidates[0].to, 'PASS', 'OK')
      : check('RECIPIENT', data.recipient,
        destinationCandidates.length === 1 ? destinationCandidates[0].to : 'UNKNOWN',
        'UNKNOWN', destinationCandidates.length === 0 ? 'NO_TRANSFER_TO_RECIPIENT' : 'AMBIGUOUS_RECIPIENT_TRANSFERS'))

    return finish()
  } catch (error) {
    const timedOut = error instanceof RpcTimeoutError
    checks.push(check('RPC', 'responsive', timedOut ? 'timeout' : 'error', 'UNKNOWN', timedOut ? 'RPC_TIMEOUT' : 'RPC_UNAVAILABLE'))
    return finish()
  }
}

/**
 * Opt-in composition: run the SDK's existing offline verification first, then
 * additionally the caller-supplied independent chain re-read, returning both.
 * The existing verifiers are untouched; this is an additive helper following
 * the same pattern as `verifyReviewManifestWithChain`. A caller should require
 * `verification.valid && independentReread.verified` before trusting the
 * settlement's factual layer.
 */
export async function verifySettlementWithIndependentReread(
  value: unknown,
  options: InsightBaseAgentSwapGuardSettlementOptions & { independentReread: IndependentRereadOptions },
): Promise<SettlementVerificationWithIndependentReread> {
  const verification = await verifyInsightBaseAgentSwapGuardSettlement(value, options)
  const rpcOrigin = typeof options.independentReread.rpcUrl === 'string'
    ? originOf(options.independentReread.rpcUrl)
    : null
  const independentReread = verification.valid
    ? await independentlyVerifySettlement(value, options.independentReread)
    : unavailableResult('LOCAL_VERIFICATION_FAILED', rpcOrigin)
  return { ...verification, independentReread }
}
