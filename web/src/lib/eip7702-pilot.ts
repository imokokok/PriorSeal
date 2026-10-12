import { bindERC4337UserOperation, type DeploymentCapabilities, type ObservationResult } from 'priorseal-sdk'
import { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_USER_OPERATION_EVENT_TOPIC } from './erc4337-profile.ts'

export const PILOT_7702_DELEGATE = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B' as const
export const PILOT_7702_DELEGATE_CODE_HASH = '0x83805f9ac7395294043b10c3b7c1839b7e4582a3e693028c36df84978b09d4e2' as const
export const PILOT_7702_USER_OPERATION_EVENT_TOPIC = PILOT_USER_OPERATION_EVENT_TOPIC

const recoveryStorageKey = 'priorseal.eip7702-pilot-recovery.v1'
const setupStorageKey = 'priorseal.eip7702-pilot-setup.v1'
const maxRecoveryBytes = 64_000
const hashPattern = /^0x[0-9a-fA-F]{64}$/
const addressPattern = /^0x[0-9a-fA-F]{40}$/
const minConfirmations = 2

export type Eip7702RecoveryRecord = {
  schema: 'priorseal.eip7702-pilot-recovery.v1'
  chainId: typeof PILOT_CHAIN_ID
  entryPoint: typeof PILOT_ENTRY_POINT
  entryPointCodeHash: typeof PILOT_ENTRY_POINT_CODE_HASH
  entryPointVersion: '0.7'
  delegateAddress: typeof PILOT_7702_DELEGATE
  delegateCodeHash: typeof PILOT_7702_DELEGATE_CODE_HASH
  sender: `0x${string}`
  userOperation: Record<string, unknown>
  userOperationHash: `0x${string}`
  authorizationId: string
  stage: 'AUTHORIZED' | 'SUBMITTING' | 'SUBMITTED'
  submissionAttempts: number
  transactionHash?: `0x${string}`
}

export type Eip7702RecoveryRead = { record: Eip7702RecoveryRecord | null; error: string | null }
export type Eip7702LookupAssessment =
  | { kind: 'INCLUDED'; transactionHash: `0x${string}`; source: 'bundler-receipt' | 'entrypoint-event' | 'bundler-operation' }
  | { kind: 'PENDING' }
  | { kind: 'ABSENT' }
  | { kind: 'INDETERMINATE' }

export type Eip7702ObservationAssessment =
  | { kind: 'FINAL'; status: 'CONFIRMED' | 'REVERTED'; actualGasCost: string | null; actualGasUsed: string | null; outerTransactionFee: string | null; confirmations: number }
  | { kind: 'PENDING' }
  | { kind: 'REORGED' }
  | { kind: 'INDETERMINATE'; status: string }

export function isEip7702SubmissionEligible(record: Eip7702RecoveryRecord) {
  return record.stage === 'AUTHORIZED' && !record.transactionHash && record.submissionAttempts < 2
}

export function eip7702FinalityConstraints(capabilities: Pick<DeploymentCapabilities, 'minConfirmations' | 'maxToleratedReorgDepth' | 'finalityRequirement'> | null | undefined) {
  const maxToleratedReorgDepth = Math.max(1, capabilities?.maxToleratedReorgDepth ?? 0)
  return {
    minConfirmations: Math.max(minConfirmations, capabilities?.minConfirmations ?? 0, maxToleratedReorgDepth + 1),
    maxToleratedReorgDepth,
    ...(capabilities?.finalityRequirement === 'RPC_FINALIZED' ? { finalityRequirement: 'RPC_FINALIZED' as const } : {}),
  }
}

export async function withEip7702LookupTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 18_000): Promise<T> {
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

export function reconcileEip7702Lookups(input: {
  expectedUserOperationHash: string
  expectedSender: string
  bundlerReceipt: PromiseSettledResult<unknown>
  bundlerOperation: PromiseSettledResult<unknown>
  entryPointEvent: PromiseSettledResult<unknown>
}): Eip7702LookupAssessment {
  if (!hashPattern.test(input.expectedUserOperationHash) || !addressPattern.test(input.expectedSender)) throw new TypeError('Expected UserOperation identity is invalid')
  const included: { transactionHash: `0x${string}`; source: 'bundler-receipt' | 'entrypoint-event' | 'bundler-operation' }[] = []
  let pending = false
  if (input.bundlerReceipt.status === 'fulfilled' && input.bundlerReceipt.value != null) {
    const receipt = input.bundlerReceipt.value
    if (!isRecord(receipt) || typeof receipt.userOpHash !== 'string' || !hashPattern.test(receipt.userOpHash) || receipt.userOpHash.toLowerCase() !== input.expectedUserOperationHash.toLowerCase()) throw new TypeError('Bundler returned a receipt for a different or malformed UserOperation')
    if (typeof receipt.sender !== 'string' || !addressPattern.test(receipt.sender) || receipt.sender.toLowerCase() !== input.expectedSender.toLowerCase()) throw new TypeError('Bundler returned a receipt for a different account')
    const body = isRecord(receipt.receipt) ? receipt.receipt : null
    if (typeof body?.transactionHash !== 'string' || !hashPattern.test(body.transactionHash)) throw new TypeError('Bundler returned a receipt without a valid outer transaction hash')
    included.push({ transactionHash: body.transactionHash.toLowerCase() as `0x${string}`, source: 'bundler-receipt' })
  }

  if (input.entryPointEvent.status === 'fulfilled' && input.entryPointEvent.value != null) {
    const event = input.entryPointEvent.value
    if (!isRecord(event) || typeof event.transactionHash !== 'string' || !hashPattern.test(event.transactionHash) || typeof event.sender !== 'string' || !addressPattern.test(event.sender) || event.sender.toLowerCase() !== input.expectedSender.toLowerCase() || typeof event.userOperationHash !== 'string' || !hashPattern.test(event.userOperationHash) || event.userOperationHash.toLowerCase() !== input.expectedUserOperationHash.toLowerCase()) throw new TypeError('Base Sepolia returned a malformed or mismatched EntryPoint event')
    included.push({ transactionHash: event.transactionHash.toLowerCase() as `0x${string}`, source: 'entrypoint-event' })
  }

  if (input.bundlerOperation.status === 'fulfilled' && input.bundlerOperation.value != null) {
    const operation = input.bundlerOperation.value
    if (!isRecord(operation)) throw new TypeError('Bundler returned malformed UserOperation lookup data')
    if (typeof operation.userOperation !== 'object' || operation.userOperation === null || !isRecord(operation.userOperation) || typeof operation.userOperation.sender !== 'string' || !addressPattern.test(operation.userOperation.sender) || operation.userOperation.sender.toLowerCase() !== input.expectedSender.toLowerCase()) throw new TypeError('Bundler returned a different UserOperation sender')
    if (typeof operation.entryPoint !== 'string' || operation.entryPoint.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()) throw new TypeError('Bundler returned a different EntryPoint')
    if (operation.transactionHash == null) pending = true
    else {
      if (typeof operation.transactionHash !== 'string' || !hashPattern.test(operation.transactionHash)) throw new TypeError('Bundler returned an invalid UserOperation transaction hash')
      included.push({ transactionHash: operation.transactionHash.toLowerCase() as `0x${string}`, source: 'bundler-operation' })
    }
  }

  if (included.length > 1 && included.some((item) => item.transactionHash !== included[0].transactionHash)) throw new TypeError('Bundler and EntryPoint inclusion sources disagree on the outer transaction hash')
  if (included.length) return { kind: 'INCLUDED', transactionHash: included[0].transactionHash, source: included[0].source }
  if (pending) return { kind: 'PENDING' }
  if ([input.bundlerReceipt, input.bundlerOperation, input.entryPointEvent].some((result) => result.status === 'rejected')) return { kind: 'INDETERMINATE' }
  return { kind: 'ABSENT' }
}

export function assessEip7702Observation(result: ObservationResult, recovery: Eip7702RecoveryRecord, transactionHash: string): Eip7702ObservationAssessment {
  const observation = result?.observation
  if (!observation || Number(observation.chainId) !== PILOT_CHAIN_ID || typeof observation.txHash !== 'string' || observation.txHash.toLowerCase() !== transactionHash.toLowerCase()) throw new TypeError('PriorSeal observation does not match the recovered Base Sepolia transaction')
  if (observation.status === 'REORGED') return { kind: 'REORGED' }
  if (observation.status === 'PENDING') {
    if (observation.userOperationHash && observation.userOperationHash.toLowerCase() !== recovery.userOperationHash.toLowerCase()) throw new TypeError('Pending observation refers to a different UserOperation')
    return { kind: 'PENDING' }
  }
  if (observation.status !== 'CONFIRMED' && observation.status !== 'REVERTED') return { kind: 'INDETERMINATE', status: observation.status }

  const delegation = observation.eip7702Delegation
  if (observation.executionDataAvailable !== true
    || observation.action !== 'ERC4337_USER_OPERATION'
    || observation.sender?.toLowerCase() !== recovery.sender.toLowerCase()
    || observation.userOperationHash?.toLowerCase() !== recovery.userOperationHash.toLowerCase()
    || observation.entryPoint?.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()
    || observation.entryPointCodeHash?.toLowerCase() !== PILOT_ENTRY_POINT_CODE_HASH.toLowerCase()
    || observation.entryPointVersion !== '0.7'
    || !delegation
    || delegation.schema !== 'priorseal.eip7702.delegation-evidence.v1'
    || delegation.delegateAddress?.toLowerCase() !== PILOT_7702_DELEGATE.toLowerCase()
    || delegation.delegateCodeHash?.toLowerCase() !== PILOT_7702_DELEGATE_CODE_HASH.toLowerCase()
    || delegation.authorizationIncluded !== false
    || delegation.authorizationTupleHash !== null
    || delegation.operationIncluded !== true
    || delegation.delegateObservedForExecution?.toLowerCase() !== PILOT_7702_DELEGATE.toLowerCase()
    || delegation.stateAtTransactionEnd !== 'ACTIVE'
    || (observation.userOperationSuccess === true && (observation.status !== 'CONFIRMED' || delegation.operationSuccess !== true))
    || (observation.userOperationSuccess === false && (observation.status !== 'REVERTED' || delegation.operationSuccess !== false))
    || (observation.userOperationSuccess == null && (observation.status !== 'REVERTED' || delegation.operationSuccess !== null || delegation.outerTransactionStatus !== 'REVERTED'))
    || (observation.userOperationSuccess != null && delegation.outerTransactionStatus !== 'SUCCESS')) throw new TypeError('PriorSeal observation does not match the predelegated MetaMask UserOperation evidence')

  const expectedNonce = BigInt(String(recovery.userOperation.nonce)).toString(10)
  const temporal = observation.temporalEvidence
  const blockNumber = Number(observation.blockNumber)
  const userOperationSucceeded = observation.userOperationSuccess !== null && observation.userOperationSuccess !== undefined
  const actualGasCost = observation.actualGasCost
  const actualGasUsed = observation.gasUsed
  if (String(observation.nonce) !== expectedNonce
    || !temporal
    || !['CONFIRMATIONS', 'RPC_FINALIZED'].includes(temporal.criterion)
    || !Number.isSafeInteger(temporal.requiredConfirmations)
    || temporal.requiredConfirmations < minConfirmations
    || !Number.isSafeInteger(observation.confirmations)
    || Number(observation.confirmations) < temporal.requiredConfirmations
    || temporal.requiredConfirmations < Math.max(minConfirmations, (temporal.maxToleratedReorgDepth ?? -1) + 1)
    || !Number.isSafeInteger(blockNumber) || blockNumber < 0
    || temporal.schema !== 'priorseal.temporal-evidence.v1'
    || !Number.isSafeInteger(temporal.observedHeadNumber) || temporal.observedHeadNumber < blockNumber
    || (temporal.maxToleratedReorgDepth != null && (!Number.isSafeInteger(temporal.maxToleratedReorgDepth) || temporal.maxToleratedReorgDepth < 0))
    || (temporal.criterion === 'RPC_FINALIZED' ? observation.finalityState !== 'FINALIZED' : !['CONFIRMED', 'FINALIZED'].includes(observation.finalityState ?? ''))
    || !hashPattern.test(observation.blockHash ?? '')
    || (temporal.criterion === 'RPC_FINALIZED' && (!temporal.finalizedBlock || !Number.isSafeInteger(temporal.finalizedBlock.number) || temporal.finalizedBlock.number < blockNumber || temporal.finalizedBlock.number > temporal.observedHeadNumber || !hashPattern.test(temporal.finalizedBlock.hash) || !hashPattern.test(temporal.observedHeadHash ?? '')))
    || (userOperationSucceeded && (typeof actualGasCost !== 'string' || !/^(0|[1-9][0-9]*)$/.test(actualGasCost) || typeof actualGasUsed !== 'string' || !/^(0|[1-9][0-9]*)$/.test(actualGasUsed)))
    || typeof delegation.outerTransactionGasUsed !== 'string' || !/^(0|[1-9][0-9]*)$/.test(delegation.outerTransactionGasUsed)
    || (delegation.outerTransactionFee !== null && (typeof delegation.outerTransactionFee !== 'string' || !/^(0|[1-9][0-9]*)$/.test(delegation.outerTransactionFee)))) throw new TypeError('PriorSeal observation has not met the pilot confirmation and execution-evidence requirements')
  if (result.authorizationAssociation !== 'FINAL' || result.executionCorrelation !== 'MATCH' || (result.receipt != null && result.verification?.valid !== true)) throw new TypeError('PriorSeal observation is not finally bound to this authorization or its receipt failed verification')

  return {
    kind: 'FINAL',
    status: observation.status,
    actualGasCost: userOperationSucceeded ? actualGasCost as string : null,
    actualGasUsed: userOperationSucceeded ? actualGasUsed as string : null,
    outerTransactionFee: delegation.outerTransactionFee,
    confirmations: Number(observation.confirmations),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseRecoveryRecord(value: unknown): Eip7702RecoveryRecord {
  if (!isRecord(value)) throw new TypeError('Saved EIP-7702 recovery data must be an object')
  const allowedKeys = new Set(['schema', 'chainId', 'entryPoint', 'entryPointCodeHash', 'entryPointVersion', 'delegateAddress', 'delegateCodeHash', 'sender', 'userOperation', 'userOperationHash', 'authorizationId', 'stage', 'submissionAttempts', 'transactionHash'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new TypeError('Saved EIP-7702 recovery data contains an unsupported field')
  if (value.schema !== 'priorseal.eip7702-pilot-recovery.v1' || value.chainId !== PILOT_CHAIN_ID || value.entryPoint !== PILOT_ENTRY_POINT || value.entryPointCodeHash !== PILOT_ENTRY_POINT_CODE_HASH || value.entryPointVersion !== '0.7' || value.delegateAddress !== PILOT_7702_DELEGATE || value.delegateCodeHash !== PILOT_7702_DELEGATE_CODE_HASH) throw new TypeError('Saved recovery data does not match the configured Base Sepolia MetaMask profile')
  if (typeof value.sender !== 'string' || !addressPattern.test(value.sender) || !isRecord(value.userOperation) || typeof value.userOperationHash !== 'string' || !hashPattern.test(value.userOperationHash) || typeof value.authorizationId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.authorizationId) || !['AUTHORIZED', 'SUBMITTING', 'SUBMITTED'].includes(String(value.stage))) throw new TypeError('Saved EIP-7702 recovery data is incomplete')
  const attempts = value.submissionAttempts ?? (value.stage === 'AUTHORIZED' ? 0 : 1)
  if (!Number.isSafeInteger(attempts) || Number(attempts) < 0 || Number(attempts) > 2) throw new TypeError('Saved EIP-7702 submission-attempt count is invalid')
  if (value.transactionHash !== undefined && (typeof value.transactionHash !== 'string' || !hashPattern.test(value.transactionHash))) throw new TypeError('Saved EIP-7702 transaction hash is invalid')
  if (value.transactionHash !== undefined && value.stage !== 'SUBMITTED') throw new TypeError('A saved outer transaction hash requires the submitted recovery stage')
  if (JSON.stringify(value.userOperation).length > 48_000) throw new TypeError('Saved UserOperation exceeds the recovery size limit')
  const binding = bindERC4337UserOperation({ chainId: PILOT_CHAIN_ID, entryPoint: PILOT_ENTRY_POINT, entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH, entryPointVersion: '0.7', eip7702: { delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH }, userOperation: value.userOperation })
  if (binding.sender.toLowerCase() !== value.sender.toLowerCase() || binding.userOpHash.toLowerCase() !== value.userOperationHash.toLowerCase()) throw new TypeError('Saved UserOperation does not match its recorded account or hash')
  return {
    schema: 'priorseal.eip7702-pilot-recovery.v1',
    chainId: PILOT_CHAIN_ID,
    entryPoint: PILOT_ENTRY_POINT,
    entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH,
    entryPointVersion: '0.7',
    delegateAddress: PILOT_7702_DELEGATE,
    delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH,
    sender: value.sender.toLowerCase() as `0x${string}`,
    userOperation: structuredClone(value.userOperation),
    userOperationHash: binding.userOpHash,
    authorizationId: value.authorizationId,
    stage: value.stage as Eip7702RecoveryRecord['stage'],
    submissionAttempts: Number(attempts),
    ...(typeof value.transactionHash === 'string' ? { transactionHash: value.transactionHash.toLowerCase() as `0x${string}` } : {}),
  }
}

export function createEip7702RecoveryRecord(input: { sender: string; userOperation: unknown; authorizationId: string; stage?: Eip7702RecoveryRecord['stage']; submissionAttempts?: number; transactionHash?: string }): Eip7702RecoveryRecord {
  return parseRecoveryRecord({ schema: 'priorseal.eip7702-pilot-recovery.v1', chainId: PILOT_CHAIN_ID, entryPoint: PILOT_ENTRY_POINT, entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH, entryPointVersion: '0.7', delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH, ...input, stage: input.stage ?? 'AUTHORIZED', submissionAttempts: input.submissionAttempts ?? 0, userOperationHash: isRecord(input.userOperation) ? bindERC4337UserOperation({ chainId: PILOT_CHAIN_ID, entryPoint: PILOT_ENTRY_POINT, entryPointCodeHash: PILOT_ENTRY_POINT_CODE_HASH, entryPointVersion: '0.7', eip7702: { delegateAddress: PILOT_7702_DELEGATE, delegateCodeHash: PILOT_7702_DELEGATE_CODE_HASH }, userOperation: input.userOperation }).userOpHash : '' })
}

export function readEip7702RecoveryRecord(storage?: Pick<Storage, 'getItem'>): Eip7702RecoveryRead {
  try {
    const serialized = (storage ?? window.sessionStorage).getItem(recoveryStorageKey)
    if (serialized === null) return { record: null, error: null }
    if (serialized.length > maxRecoveryBytes) throw new TypeError('Saved EIP-7702 recovery data exceeds the size limit')
    return { record: parseRecoveryRecord(JSON.parse(serialized) as unknown), error: null }
  } catch (error) { return { record: null, error: error instanceof Error ? error.message : 'Saved EIP-7702 recovery data is invalid' }
  }
}

export function saveEip7702RecoveryRecord(record: Eip7702RecoveryRecord, storage: Pick<Storage, 'setItem'> = window.sessionStorage) {
  const normalized = parseRecoveryRecord(record)
  const serialized = JSON.stringify(normalized)
  if (serialized.length > maxRecoveryBytes) throw new TypeError('EIP-7702 recovery data exceeds the session storage limit')
  storage.setItem(recoveryStorageKey, serialized)
}

export function clearEip7702RecoveryRecord(storage: Pick<Storage, 'removeItem'> = window.sessionStorage) {
  storage.removeItem(recoveryStorageKey)
}

export function readEip7702SetupId(storage?: Pick<Storage, 'getItem'>): { id: string | null; error: string | null } {
  try {
    const value = (storage ?? window.sessionStorage).getItem(setupStorageKey)
    if (value === null) return { id: null, error: null }
    if (!/^0x[0-9a-f]{64,128}$/i.test(value)) throw new TypeError('Saved MetaMask setup batch ID is invalid')
    return { id: value.toLowerCase(), error: null }
  } catch (error) { return { id: null, error: error instanceof Error ? error.message : 'Saved MetaMask setup ID is invalid' }
  }
}

export function saveEip7702SetupId(id: string, storage: Pick<Storage, 'setItem'> = window.sessionStorage) {
  if (!/^0x[0-9a-f]{64,128}$/i.test(id)) throw new TypeError('MetaMask returned an invalid setup batch ID')
  storage.setItem(setupStorageKey, id.toLowerCase())
}

export function clearEip7702SetupId(storage: Pick<Storage, 'removeItem'> = window.sessionStorage) {
  storage.removeItem(setupStorageKey)
}
