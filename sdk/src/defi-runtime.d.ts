import type { WalletClient } from 'viem'
import type { PriorSealClient } from './client.js'
import type {
  Authorization,
  ContextCommitment,
  Intent,
  KeyEntry,
} from './types.js'

export type DefiTransaction = {
  chainId: number
  from: string
  to: string
  data: `0x${string}`
  nonce: string
  value: string
}

export type DefiAttemptStatus =
  | 'RESERVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'UNCERTAIN'
  | 'REJECTED'
  | 'CONFIRMED'
  | 'REVERTED'

export type DefiAttempt = {
  authorizationId: string
  executionDigest: string
  nonceKey: string
  status: DefiAttemptStatus
  transaction: DefiTransaction
  txHash: string | null
  updatedAt: number
}

export type DefiAttemptStore = {
  get(authorizationId: string): Promise<DefiAttempt | null>
  reserve(input: { authorizationId: string; transaction: unknown; executionDigest: string; now: number }): Promise<{ claimed: boolean; attempt: DefiAttempt; code?: string }>
  transition(authorizationId: string, expected: DefiAttemptStatus[], patch: { status: DefiAttemptStatus; txHash?: string | null; updatedAt: number }): Promise<DefiAttempt>
}

export type DefiAuthorizationRecord = {
  /** Persistence is an untrusted boundary; the gateway validates these bytes. */
  authorization: unknown
  acceptance: unknown
  policyEvidence?: { document?: Record<string, unknown> | null }
  boundTxHash: string | null
  uses: number
  status: string
}

export type DefiAuthorizationStore = {
  getAuthorization(authorizationId: string): Promise<DefiAuthorizationRecord | null | undefined>
  bindAuthorization(authorizationId: string, txHash: string): Promise<{ ok: boolean; code?: string }>
}

export type DefiChainReader = {
  getChainId(): Promise<number>
  getBytecode(input: { address: `0x${string}` }): Promise<`0x${string}` | undefined>
}

export type DefiExecutionDependencies = {
  authorizationStore: DefiAuthorizationStore
  attempts: DefiAttemptStore
  chainReader: DefiChainReader
  submit: (transaction: DefiTransaction, assertBeforeBroadcast: () => Promise<void>) => Promise<string>
  clock?: () => number
  verifyContractSignature?: (input: { authorization: Authorization; digest: `0x${string}`; signature: string }) => Promise<boolean> | boolean
}

export type DefiExecutionInput = {
  audience: string
  authorizationId: string
  intent: Intent
  transaction: DefiTransaction
  acceptanceKey: KeyEntry
  adapter: { kind: 'uniswap-v3-single'; approval: unknown }
}

export type DefiRecoveryObservation = {
  transaction: DefiTransaction
  txHash: string
  status: 'CONFIRMED' | 'REVERTED'
  finalized: boolean
}

export type DefiPrepareInput = {
  approval: unknown
  transaction: DefiTransaction
  intentId: string
  validUntil: number
  constraints?: Intent['constraints']
  contextCommitments?: ContextCommitment[]
  authorization: Omit<Parameters<PriorSealClient['prepareAuthorization']>[0], 'intent'>
}

export function createDefiExecutionGateway(
  client: Pick<PriorSealClient, 'prepareAuthorization' | 'acceptAuthorization'>,
  deps: DefiExecutionDependencies,
): {
  prepare(input: DefiPrepareInput): ReturnType<PriorSealClient['prepareAuthorization']>
  authorize(signed: Parameters<PriorSealClient['acceptAuthorization']>[0]): ReturnType<PriorSealClient['acceptAuthorization']>
  execute(input: DefiExecutionInput): Promise<{ replay: boolean; attempt: DefiAttempt }>
  status(authorizationId: string): Promise<DefiAttempt | null>
  recover(authorizationId: string, observe: (attempt: DefiAttempt) => Promise<DefiRecoveryObservation | null>): Promise<DefiAttempt>
}

export function executeDefiAuthorized(input: DefiExecutionInput, deps: DefiExecutionDependencies): Promise<{ replay: boolean; attempt: DefiAttempt }>
export function getDefiAttempt(authorizationId: string, attempts: DefiAttemptStore): Promise<DefiAttempt | null>
export function reconcileDefiAttempt(authorizationId: string, deps: { attempts: DefiAttemptStore; authorizationStore: DefiAuthorizationStore; observe: (attempt: DefiAttempt) => Promise<DefiRecoveryObservation | null>; clock?: () => number }): Promise<DefiAttempt>
export function createDefiViemSubmitter(client: WalletClient): DefiExecutionDependencies['submit']
export function createDefiAttemptStore(input: { directory: string }): DefiAttemptStore
export function createPostgresDefiAttemptStore(pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): DefiAttemptStore
