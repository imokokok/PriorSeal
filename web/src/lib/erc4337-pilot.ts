import { bindERC4337UserOperation, decodeSafe4337CallData, type DeploymentCapabilities, type ObservationResult } from 'priorseal-sdk'
import { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_SAFE } from './erc4337-profile'

export { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_MODULE, PILOT_OWNER, PILOT_SAFE, PILOT_USER_OPERATION_EVENT_TOPIC } from './erc4337-profile'

const recoveryStorageKey = 'priorseal.erc4337-pilot-recovery.v1'
const maxRecoveryBytes = 64_000
const hashPattern = /^0x[0-9a-fA-F]{64}$/
const entryPointCodeHashPattern = /^0x[0-9a-fA-F]{64}$/
export const PILOT_MIN_CONFIRMATIONS = 2
const pilotMinReorgDepth = 1

export type PilotRecoveryRecord = {
  schema: 'priorseal.erc4337-pilot-recovery.v1'
  chainId: typeof PILOT_CHAIN_ID
  entryPoint: typeof PILOT_ENTRY_POINT
  entryPointCodeHash: typeof PILOT_ENTRY_POINT_CODE_HASH
  entryPointVersion: '0.7'
  accountCallProfile: 'safe-4337.v1'
  userOperation: Record<string, unknown>
  userOperationHash: `0x${string}`
  authorizationId: string
  stage: 'AUTHORIZED' | 'SUBMITTING' | 'SUBMITTED'
  submissionAttempts: number
  transactionHash?: `0x${string}`
}

export type PilotRecoveryRead = { record: PilotRecoveryRecord | null; error: string | null }

export type PilotRecoveryLookupAssessment =
  | { kind: 'INCLUDED'; transactionHash: `0x${string}`; source: 'bundler-receipt' | 'entrypoint-event' | 'bundler-operation' }
  | { kind: 'PENDING' }
  | { kind: 'ABSENT' }
  | { kind: 'INDETERMINATE' }

export type PilotObservationAssessment =
  | { kind: 'FINAL'; status: 'CONFIRMED' | 'REVERTED'; actualGasCost: string; actualGasUsed: string; confirmations: number }
  | { kind: 'PENDING' }
  | { kind: 'REORGED' }
  | { kind: 'INDETERMINATE'; status: string }

export function isPilotSubmissionEligible(record: PilotRecoveryRecord): boolean {
  return record.stage === 'AUTHORIZED' && !record.transactionHash && record.submissionAttempts < 2
}

export async function withPilotLookupTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 18_000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Lookup timeout must be a positive integer')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs) }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function pilotFinalityConstraints(capabilities: Pick<DeploymentCapabilities, 'minConfirmations' | 'maxToleratedReorgDepth' | 'finalityRequirement'> | null | undefined) {
  const maxToleratedReorgDepth = Math.max(pilotMinReorgDepth, capabilities?.maxToleratedReorgDepth ?? 0)
  return {
    minConfirmations: Math.max(PILOT_MIN_CONFIRMATIONS, capabilities?.minConfirmations ?? 0, maxToleratedReorgDepth + 1),
    maxToleratedReorgDepth,
    ...(capabilities?.finalityRequirement === 'RPC_FINALIZED' ? { finalityRequirement: 'RPC_FINALIZED' as const } : {}),
  }
}

/** Treat each lookup source independently and fail closed when a negative result is incomplete. */
export function reconcilePilotRecoveryLookups(input: {
  expectedUserOperationHash: string
  bundlerReceipt: PromiseSettledResult<unknown>
  bundlerOperation: PromiseSettledResult<unknown>
  entryPointEvent: PromiseSettledResult<unknown>
}): PilotRecoveryLookupAssessment {
  if (input.bundlerReceipt.status === 'fulfilled' && input.bundlerReceipt.value != null) {
    const receipt = input.bundlerReceipt.value
    if (!isRecord(receipt) || typeof receipt.userOpHash !== 'string' || !hashPattern.test(receipt.userOpHash) || receipt.userOpHash.toLowerCase() !== input.expectedUserOperationHash.toLowerCase()) throw new TypeError('Bundler returned a receipt for a different or malformed UserOperation')
    if (typeof receipt.sender !== 'string' || !/^0x[0-9a-f]{40}$/i.test(receipt.sender) || receipt.sender.toLowerCase() !== PILOT_SAFE.toLowerCase()) throw new TypeError('Bundler returned a receipt for a different Safe account')
    const receiptBody = receipt.receipt
    const transactionHash = isRecord(receiptBody) ? receiptBody.transactionHash : null
    if (typeof transactionHash !== 'string' || !hashPattern.test(transactionHash)) throw new TypeError('Bundler returned a receipt without a valid outer transaction hash')
    return { kind: 'INCLUDED', transactionHash: transactionHash.toLowerCase() as `0x${string}`, source: 'bundler-receipt' }
  }

  if (input.entryPointEvent.status === 'fulfilled' && input.entryPointEvent.value != null) {
    if (typeof input.entryPointEvent.value !== 'string' || !hashPattern.test(input.entryPointEvent.value)) throw new TypeError('Base Sepolia RPC returned an invalid EntryPoint transaction hash')
    return { kind: 'INCLUDED', transactionHash: input.entryPointEvent.value.toLowerCase() as `0x${string}`, source: 'entrypoint-event' }
  }

  if (input.bundlerOperation.status === 'fulfilled' && input.bundlerOperation.value != null) {
    const knownOperation = input.bundlerOperation.value
    if (!isRecord(knownOperation)) throw new TypeError('Bundler returned malformed UserOperation lookup data')
    const transactionHash = knownOperation.transactionHash
    if (transactionHash == null) return { kind: 'PENDING' }
    if (typeof transactionHash !== 'string' || !hashPattern.test(transactionHash)) throw new TypeError('Bundler returned an invalid UserOperation transaction hash')
    return { kind: 'INCLUDED', transactionHash: transactionHash.toLowerCase() as `0x${string}`, source: 'bundler-operation' }
  }

  if ([input.bundlerReceipt, input.bundlerOperation, input.entryPointEvent].some((result) => result.status === 'rejected')) return { kind: 'INDETERMINATE' }
  return { kind: 'ABSENT' }
}

/** Validate the exact included UserOperation and require its signed finality bar before export. */
export function assessPilotObservation(result: ObservationResult, recovery: PilotRecoveryRecord, transactionHash: string): PilotObservationAssessment {
  const observation = result?.observation
  if (!observation || Number(observation.chainId) !== PILOT_CHAIN_ID || typeof observation.txHash !== 'string' || observation.txHash.toLowerCase() !== transactionHash.toLowerCase()) throw new TypeError('PriorSeal observation does not match the recovered Base Sepolia transaction')
  if (observation.status === 'REORGED') return { kind: 'REORGED' }
  if (observation.status === 'PENDING') {
    if (observation.userOperationHash && observation.userOperationHash.toLowerCase() !== recovery.userOperationHash.toLowerCase()) throw new TypeError('Pending observation refers to a different UserOperation')
    return { kind: 'PENDING' }
  }
  if (observation.status !== 'CONFIRMED' && observation.status !== 'REVERTED') return { kind: 'INDETERMINATE', status: observation.status }

  if (observation.executionDataAvailable !== true
    || observation.action !== 'ERC4337_USER_OPERATION'
    || observation.sender?.toLowerCase() !== PILOT_SAFE.toLowerCase()
    || observation.userOperationHash?.toLowerCase() !== recovery.userOperationHash.toLowerCase()
    || observation.entryPoint?.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()
    || observation.entryPointCodeHash?.toLowerCase() !== PILOT_ENTRY_POINT_CODE_HASH.toLowerCase()
    || observation.entryPointVersion !== '0.7'
    || observation.userOperationSuccess !== (observation.status === 'CONFIRMED')) throw new TypeError('PriorSeal observation does not match the saved UserOperation event')

  const expectedNonce = BigInt(String(recovery.userOperation.nonce)).toString(10)
  const call = decodeSafe4337CallData(recovery.userOperation.callData)
  if (String(observation.nonce) !== expectedNonce
    || observation.accountCallProfile !== 'safe-4337.v1'
    || observation.accountCallTarget?.toLowerCase() !== call.target.toLowerCase()
    || observation.accountCallValue !== call.value
    || observation.accountCallDataHash?.toLowerCase() !== call.dataHash.toLowerCase()) throw new TypeError('PriorSeal observation does not match the saved Safe call')

  const temporal = observation.temporalEvidence
  const actualGasCost = observation.actualGasCost
  const actualGasUsed = observation.gasUsed
  const blockNumber = Number(observation.blockNumber)
  if (!temporal
    || !['CONFIRMATIONS', 'RPC_FINALIZED'].includes(temporal.criterion)
    || !Number.isSafeInteger(temporal.requiredConfirmations)
    || temporal.requiredConfirmations < PILOT_MIN_CONFIRMATIONS
    || !Number.isSafeInteger(observation.confirmations)
    || Number(observation.confirmations) < temporal.requiredConfirmations
    || temporal.requiredConfirmations < Math.max(PILOT_MIN_CONFIRMATIONS, (temporal.maxToleratedReorgDepth ?? -1) + 1)
    || !Number.isSafeInteger(blockNumber) || blockNumber < 0
    || temporal.schema !== 'priorseal.temporal-evidence.v1'
    || !Number.isSafeInteger(temporal.observedHeadNumber) || temporal.observedHeadNumber < blockNumber
    || (temporal.maxToleratedReorgDepth != null && (!Number.isSafeInteger(temporal.maxToleratedReorgDepth) || temporal.maxToleratedReorgDepth < 0))
    || (temporal.criterion === 'RPC_FINALIZED' ? observation.finalityState !== 'FINALIZED' : !['CONFIRMED', 'FINALIZED'].includes(observation.finalityState ?? ''))
    || !hashPattern.test(observation.blockHash ?? '')
    || (temporal.criterion === 'RPC_FINALIZED' && (!temporal.finalizedBlock || !Number.isSafeInteger(temporal.finalizedBlock.number) || temporal.finalizedBlock.number < blockNumber || temporal.finalizedBlock.number > temporal.observedHeadNumber || !hashPattern.test(temporal.finalizedBlock.hash) || !hashPattern.test(temporal.observedHeadHash ?? '')))
    || typeof actualGasCost !== 'string' || !/^(0|[1-9][0-9]*)$/.test(actualGasCost)
    || typeof actualGasUsed !== 'string' || !/^(0|[1-9][0-9]*)$/.test(actualGasUsed)) throw new TypeError('PriorSeal observation has not met the pilot confirmation and execution-evidence requirements')
  if (result.authorizationAssociation !== 'FINAL' || result.executionCorrelation !== 'MATCH' || (result.receipt != null && result.verification?.valid !== true)) throw new TypeError('PriorSeal observation is not finally bound to this authorization or its receipt failed verification')

  return { kind: 'FINAL', status: observation.status, actualGasCost, actualGasUsed, confirmations: Number(observation.confirmations) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePilotRecoveryRecord(value: unknown): PilotRecoveryRecord {
  if (!isRecord(value)) throw new TypeError('Saved pilot recovery data must be an object')
  const allowedKeys = new Set(['schema', 'chainId', 'entryPoint', 'entryPointCodeHash', 'entryPointVersion', 'accountCallProfile', 'userOperation', 'userOperationHash', 'authorizationId', 'stage', 'submissionAttempts', 'transactionHash'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new TypeError('Saved pilot recovery data contains an unsupported field')
  if (value.schema !== 'priorseal.erc4337-pilot-recovery.v1' || value.chainId !== PILOT_CHAIN_ID || typeof value.entryPoint !== 'string' || value.entryPoint.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase() || typeof value.entryPointCodeHash !== 'string' || !entryPointCodeHashPattern.test(value.entryPointCodeHash) || value.entryPointCodeHash.toLowerCase() !== PILOT_ENTRY_POINT_CODE_HASH.toLowerCase() || value.entryPointVersion !== '0.7' || value.accountCallProfile !== 'safe-4337.v1') throw new TypeError('Saved pilot recovery data does not match the configured Base Sepolia profile')
  if (!isRecord(value.userOperation) || typeof value.userOperationHash !== 'string' || !hashPattern.test(value.userOperationHash) || typeof value.authorizationId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.authorizationId) || !['AUTHORIZED', 'SUBMITTING', 'SUBMITTED'].includes(String(value.stage))) throw new TypeError('Saved pilot recovery data is incomplete')
  const submissionAttempts = value.submissionAttempts ?? (value.stage === 'AUTHORIZED' ? 0 : 1)
  if (!Number.isSafeInteger(submissionAttempts) || Number(submissionAttempts) < 0 || Number(submissionAttempts) > 2) throw new TypeError('Saved pilot submission-attempt count is invalid')
  if (value.transactionHash !== undefined && (typeof value.transactionHash !== 'string' || !hashPattern.test(value.transactionHash))) throw new TypeError('Saved pilot transaction hash is invalid')
  const serializedOperation = JSON.stringify(value.userOperation)
  if (serializedOperation.length > 48_000) throw new TypeError('Saved UserOperation exceeds the pilot recovery size limit')
  const binding = bindERC4337UserOperation({
    chainId: PILOT_CHAIN_ID,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    accountCallProfile: 'safe-4337.v1',
    userOperation: value.userOperation,
  })
  if (binding.userOpHash.toLowerCase() !== value.userOperationHash.toLowerCase()) throw new TypeError('Saved UserOperation does not match its recorded hash')
  return {
    schema: 'priorseal.erc4337-pilot-recovery.v1',
    chainId: PILOT_CHAIN_ID,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    accountCallProfile: 'safe-4337.v1',
    userOperation: structuredClone(value.userOperation),
    userOperationHash: binding.userOpHash,
    authorizationId: value.authorizationId,
    stage: value.stage as PilotRecoveryRecord['stage'],
    submissionAttempts: Number(submissionAttempts),
    ...(typeof value.transactionHash === 'string' ? { transactionHash: value.transactionHash.toLowerCase() as `0x${string}` } : {}),
  }
}

export function createPilotRecoveryRecord(input: { userOperation: unknown; authorizationId: string; stage?: PilotRecoveryRecord['stage']; submissionAttempts?: number; transactionHash?: string }): PilotRecoveryRecord {
  if (!isRecord(input.userOperation)) throw new TypeError('Signed UserOperation must be an object')
  const binding = bindERC4337UserOperation({
    chainId: PILOT_CHAIN_ID,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    accountCallProfile: 'safe-4337.v1',
    userOperation: input.userOperation,
  })
  return parsePilotRecoveryRecord({
    schema: 'priorseal.erc4337-pilot-recovery.v1',
    chainId: PILOT_CHAIN_ID,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    accountCallProfile: 'safe-4337.v1',
    userOperation: input.userOperation,
    userOperationHash: binding.userOpHash,
    authorizationId: input.authorizationId,
    stage: input.stage ?? 'AUTHORIZED',
    submissionAttempts: input.submissionAttempts ?? 0,
    ...(input.transactionHash ? { transactionHash: input.transactionHash } : {}),
  })
}

export function readPilotRecoveryRecord(storage?: Pick<Storage, 'getItem'>): PilotRecoveryRead {
  try {
    const serialized = (storage ?? window.sessionStorage).getItem(recoveryStorageKey)
    if (serialized === null) return { record: null, error: null }
    if (serialized.length > maxRecoveryBytes) throw new TypeError('Saved pilot recovery data exceeds the size limit')
    return { record: parsePilotRecoveryRecord(JSON.parse(serialized) as unknown), error: null }
  } catch (error) {
    return { record: null, error: error instanceof Error ? error.message : 'Saved pilot recovery data is invalid' }
  }
}

export function savePilotRecoveryRecord(record: PilotRecoveryRecord, storage: Pick<Storage, 'setItem'> = window.sessionStorage) {
  const normalized = parsePilotRecoveryRecord(record)
  const serialized = JSON.stringify(normalized)
  if (serialized.length > maxRecoveryBytes) throw new TypeError('Pilot recovery data exceeds the session storage limit')
  storage.setItem(recoveryStorageKey, serialized)
}

export function clearPilotRecoveryRecord(storage: Pick<Storage, 'removeItem'> = window.sessionStorage) {
  storage.removeItem(recoveryStorageKey)
}
