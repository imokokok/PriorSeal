export type DemoTransactionState = 'PENDING' | 'NOT_FOUND' | 'CONFIRMED' | 'FAILED' | 'REORGED' | 'INCONSISTENT'

export type DemoTransactionStatus = {
  schema: 'priorseal.transaction-recovery-demo-status.v1'
  state: DemoTransactionState
  chainId: 84532
  transactionHash: string
  checkedAt: string
  source: 'base-sepolia-json-rpc' | 'base-sepolia-blockscout-index'
  blockNumber?: string
  blockHash?: string
  confirmations?: number
  latestBlock?: string
  canonical?: boolean
  receiptStatus?: '0x0' | '0x1'
  tokenAddress?: string
  recipientAddress?: string
  amountBaseUnits?: string
  transferMatched?: boolean
}

const endpoint = '/demo-api/base-sepolia/transaction'
const HASH = /^0x[0-9a-f]{64}$/i
const ADDRESS = /^0x[0-9a-f]{40}$/i
const STATES = new Set<DemoTransactionState>(['PENDING', 'NOT_FOUND', 'CONFIRMED', 'FAILED', 'REORGED', 'INCONSISTENT'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseStatus(value: unknown): DemoTransactionStatus {
  if (!isRecord(value)
    || value.schema !== 'priorseal.transaction-recovery-demo-status.v1'
    || !STATES.has(value.state as DemoTransactionState)
    || value.chainId !== 84532
    || typeof value.transactionHash !== 'string' || !HASH.test(value.transactionHash)
    || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))
    || !['base-sepolia-json-rpc', 'base-sepolia-blockscout-index'].includes(String(value.source))) throw new TypeError('The status service returned an invalid response.')
  if (value.blockNumber !== undefined && (typeof value.blockNumber !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.blockNumber))) throw new TypeError('The status service returned an invalid block number.')
  if (value.blockHash !== undefined && (typeof value.blockHash !== 'string' || !HASH.test(value.blockHash))) throw new TypeError('The status service returned an invalid block hash.')
  if (value.confirmations !== undefined && (!Number.isSafeInteger(value.confirmations) || Number(value.confirmations) < 0)) throw new TypeError('The status service returned an invalid confirmation count.')
  if (value.tokenAddress !== undefined && (typeof value.tokenAddress !== 'string' || !ADDRESS.test(value.tokenAddress))) throw new TypeError('The status service returned an invalid token address.')
  if (value.recipientAddress !== undefined && (typeof value.recipientAddress !== 'string' || !ADDRESS.test(value.recipientAddress))) throw new TypeError('The status service returned an invalid recipient address.')
  if (value.amountBaseUnits !== undefined && (typeof value.amountBaseUnits !== 'string' || !/^[0-9]+$/.test(value.amountBaseUnits))) throw new TypeError('The status service returned an invalid transfer amount.')
  return value as unknown as DemoTransactionStatus
}

export async function fetchDemoTransactionStatus(): Promise<DemoTransactionStatus> {
  const response = await fetch(endpoint, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string' ? body.error.code : 'STATUS_UNAVAILABLE'
    throw new Error(code)
  }
  return parseStatus(body)
}
