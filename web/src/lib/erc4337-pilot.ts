import { bindERC4337UserOperation } from 'priorseal-sdk'
import { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH } from './erc4337-profile'

export { PILOT_CHAIN_ID, PILOT_ENTRY_POINT, PILOT_ENTRY_POINT_CODE_HASH, PILOT_MODULE, PILOT_OWNER, PILOT_SAFE, PILOT_USER_OPERATION_EVENT_TOPIC } from './erc4337-profile'

const recoveryStorageKey = 'priorseal.erc4337-pilot-recovery.v1'
const maxRecoveryBytes = 64_000
const hashPattern = /^0x[0-9a-fA-F]{64}$/
const entryPointCodeHashPattern = /^0x[0-9a-fA-F]{64}$/

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
  transactionHash?: `0x${string}`
}

export type PilotRecoveryRead = { record: PilotRecoveryRecord | null; error: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePilotRecoveryRecord(value: unknown): PilotRecoveryRecord {
  if (!isRecord(value)) throw new TypeError('Saved pilot recovery data must be an object')
  const allowedKeys = new Set(['schema', 'chainId', 'entryPoint', 'entryPointCodeHash', 'entryPointVersion', 'accountCallProfile', 'userOperation', 'userOperationHash', 'authorizationId', 'stage', 'transactionHash'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new TypeError('Saved pilot recovery data contains an unsupported field')
  if (value.schema !== 'priorseal.erc4337-pilot-recovery.v1' || value.chainId !== PILOT_CHAIN_ID || typeof value.entryPoint !== 'string' || value.entryPoint.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase() || typeof value.entryPointCodeHash !== 'string' || !entryPointCodeHashPattern.test(value.entryPointCodeHash) || value.entryPointCodeHash.toLowerCase() !== PILOT_ENTRY_POINT_CODE_HASH.toLowerCase() || value.entryPointVersion !== '0.7' || value.accountCallProfile !== 'safe-4337.v1') throw new TypeError('Saved pilot recovery data does not match the configured Base Sepolia profile')
  if (!isRecord(value.userOperation) || typeof value.userOperationHash !== 'string' || !hashPattern.test(value.userOperationHash) || typeof value.authorizationId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.authorizationId) || !['AUTHORIZED', 'SUBMITTING', 'SUBMITTED'].includes(String(value.stage))) throw new TypeError('Saved pilot recovery data is incomplete')
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
    ...(typeof value.transactionHash === 'string' ? { transactionHash: value.transactionHash.toLowerCase() as `0x${string}` } : {}),
  }
}

export function createPilotRecoveryRecord(input: { userOperation: unknown; authorizationId: string; stage?: PilotRecoveryRecord['stage']; transactionHash?: string }): PilotRecoveryRecord {
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
