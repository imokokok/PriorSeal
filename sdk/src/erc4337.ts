import { getUserOperationHash } from 'viem/account-abstraction'
import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, toBytes } from 'viem'
import type { EntryPointVersion, UserOperation } from 'viem/account-abstraction'
import { parseContextCommitments } from './exact-call.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import type { ContextCommitment, Intent } from './types.js'

export const ERC4337_USER_OPERATION_NAMESPACE = 'priorseal.erc4337.user-operation.v1'
export const ERC4337_EXECUTION_EVENT_NAMESPACE = 'priorseal.erc4337.execution-event.v1'
export const ERC4337_EXECUTION_PROFILE = 'priorseal.execution-profile.erc4337-user-operation.v1'

const USER_OPERATION_EVENT_TOPIC = keccak256(toBytes('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'))
const SAFE_4337_EXECUTION_ABI = parseAbi([
  'function executeUserOp(address to,uint256 value,bytes data,uint8 operation)',
  'function executeUserOpWithErrorString(address to,uint256 value,bytes data,uint8 operation)',
])

/** Compute the hash to pin for an EntryPoint's deployed runtime bytecode. */
export function computeERC4337EntryPointCodeHash(code: unknown): `0x${string}` {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new TypeError('EntryPoint runtime code must be non-empty even-length hex data')
  return keccak256(code as `0x${string}`)
}

export type ERC4337Version = EntryPointVersion
export type ERC4337UserOperationInput = {
  chainId: number
  entryPoint: `0x${string}`
  entryPointCodeHash: `0x${string}`
  entryPointVersion: ERC4337Version
  accountCallProfile?: 'safe-4337.v1'
  userOperation: unknown
}
export type ERC4337AuthorizationIntentInput = ERC4337UserOperationInput & {
  intentId: string
  asset?: string
  amount?: bigint | number | string
  validUntil: number
  contextCommitments?: ContextCommitment[]
  constraints?: Intent['constraints']
}
export type ERC4337OperationBinding = {
  chainId: number
  entryPoint: `0x${string}`
  entryPointCodeHash: `0x${string}`
  entryPointVersion: ERC4337Version
  sender: `0x${string}`
  nonce: string
  userOpHash: `0x${string}`
  accountCall?: { profile: 'safe-4337.v1'; target: `0x${string}`; value: string; dataHash: `0x${string}` }
  commitment: ContextCommitment
}
export type ERC4337ExecutionEvidence = {
  schema: 'priorseal.erc4337.execution-evidence.v1'
  chainId: number
  entryPoint: `0x${string}`
  entryPointCodeHash: `0x${string}`
  entryPointVersion: ERC4337Version
  accountCall?: { profile: 'safe-4337.v1'; target: `0x${string}`; value: string; dataHash: `0x${string}` }
  userOpHash: `0x${string}`
  sender: `0x${string}`
  nonce: string
  success: boolean
  actualGasCost: string
  actualGasUsed: string
  transactionHash: `0x${string}`
  blockNumber: string
  blockHash: `0x${string}`
  executionCommitment: ContextCommitment
}

/** Parse untrusted JSON from a bundler or wallet before hashing it. */
export function parseERC4337UserOperationInput(value: unknown): ERC4337UserOperationInput {
  if (!record(value)) throw new TypeError('ERC-4337 input must be an object')
  if (!Number.isSafeInteger(value.chainId) || Number(value.chainId) < 1) throw new TypeError('chainId must be a positive safe integer')
  const entryPoint = address(value.entryPoint, 'entryPoint')
  const entryPointCodeHash = hash(value.entryPointCodeHash, 'entryPointCodeHash')
  if (!isEntryPointVersion(value.entryPointVersion)) throw new TypeError('entryPointVersion must be 0.6, 0.7, 0.8 or 0.9')
  if (value.accountCallProfile !== undefined && value.accountCallProfile !== 'safe-4337.v1') throw new TypeError('accountCallProfile must be safe-4337.v1')
  return {
    chainId: Number(value.chainId),
    entryPoint,
    entryPointCodeHash,
    entryPointVersion: value.entryPointVersion,
    ...(value.accountCallProfile ? { accountCallProfile: value.accountCallProfile } : {}),
    userOperation: parseUserOperation(value.userOperation, value.entryPointVersion, Number(value.chainId)),
  }
}

/** Compute the canonical ERC-4337 operation hash and its PriorSeal commitment. */
export function bindERC4337UserOperation(value: unknown): ERC4337OperationBinding {
  const input = parseERC4337UserOperationInput(value)
  const operation = input.userOperation as UserOperation<ERC4337Version>
  const userOpHash = getUserOperationHash({
    chainId: input.chainId,
    entryPointAddress: input.entryPoint,
    entryPointVersion: input.entryPointVersion,
    userOperation: operation,
  })
  const accountCall = input.accountCallProfile ? decodeSafe4337CallData((operation as Record<string, unknown>).callData) : undefined
  return {
    chainId: input.chainId,
    entryPoint: input.entryPoint,
    entryPointCodeHash: input.entryPointCodeHash,
    entryPointVersion: input.entryPointVersion,
    sender: operation.sender.toLowerCase() as `0x${string}`,
    nonce: operation.nonce.toString(10),
    userOpHash,
    ...(accountCall ? { accountCall } : {}),
    commitment: { namespace: ERC4337_USER_OPERATION_NAMESPACE, algorithm: 'keccak256', digest: userOpHash },
  }
}

/** Build an intent bound to one UserOperation hash and, when selected, its decoded Safe call. */
export function buildERC4337UserOperationIntent(input: ERC4337AuthorizationIntentInput): Intent {
  const binding = bindERC4337UserOperation(input)
  if (typeof input.intentId !== 'string' || input.intentId.length < 1 || input.intentId.length > 256) throw new TypeError('intentId must contain 1 to 256 characters')
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil < 1) throw new TypeError('validUntil must be positive Unix seconds')
  const commitments = parseContextCommitments([...(input.contextCommitments ?? []), binding.commitment])
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: ERC4337_EXECUTION_PROFILE,
    intentId: input.intentId,
    chainId: binding.chainId,
    action: 'ERC4337_USER_OPERATION',
    asset: input.asset ?? `eip155:${binding.chainId}/native`,
    amount: uintString(input.amount ?? 0, 'amount'),
    sender: binding.sender,
    recipient: binding.sender,
    validUntil: input.validUntil,
    nonce: binding.nonce,
    entryPoint: binding.entryPoint,
    entryPointCodeHash: binding.entryPointCodeHash,
    entryPointVersion: binding.entryPointVersion,
    userOperationHash: binding.userOpHash,
    ...(binding.accountCall ? {
      accountCallProfile: binding.accountCall.profile,
      accountCallTarget: binding.accountCall.target,
      accountCallValue: binding.accountCall.value,
      accountCallDataHash: binding.accountCall.dataHash,
    } : {}),
    contextCommitments: commitments,
    ...(input.constraints ? { constraints: input.constraints } : {}),
  }
}

/** Match one EntryPoint UserOperationEvent to a previously bound operation.
 * Pass a transaction receipt fetched from a trusted chain RPC. This verifies
 * event inclusion in that receipt; it does not verify canonicality/finality.
 */
export function verifyERC4337ExecutionEvidence(input: {
  binding: ERC4337OperationBinding
  intent: Pick<Intent, 'contextCommitments' | 'executionProfile' | 'entryPoint' | 'entryPointCodeHash' | 'entryPointVersion' | 'userOperationHash'> & Partial<Pick<Intent, 'accountCallProfile' | 'accountCallTarget' | 'accountCallValue' | 'accountCallDataHash'>>
  receipt: unknown
}): ERC4337ExecutionEvidence {
  const { binding } = input
  if (!binding || !isEntryPointVersion(binding.entryPointVersion) || !Number.isSafeInteger(binding.chainId) || binding.chainId < 1) throw new TypeError('binding is invalid')
  const expectedEntryPoint = address(binding.entryPoint, 'binding.entryPoint')
  const expectedEntryPointCodeHash = hash(binding.entryPointCodeHash, 'binding.entryPointCodeHash')
  const expectedSender = address(binding.sender, 'binding.sender')
  const expectedHash = hash(binding.userOpHash, 'binding.userOpHash')
  if (binding.commitment?.namespace !== ERC4337_USER_OPERATION_NAMESPACE || binding.commitment.algorithm !== 'keccak256' || hash(binding.commitment.digest, 'binding.commitment.digest') !== expectedHash) throw new TypeError('binding commitment does not match the operation hash')
  if (input.intent.executionProfile !== ERC4337_EXECUTION_PROFILE || address(input.intent.entryPoint, 'intent.entryPoint') !== expectedEntryPoint || hash(input.intent.entryPointCodeHash, 'intent.entryPointCodeHash') !== expectedEntryPointCodeHash || input.intent.entryPointVersion !== binding.entryPointVersion || hash(input.intent.userOperationHash, 'intent.userOperationHash') !== expectedHash) throw new TypeError('authorization intent does not match the bound EntryPoint operation')
  if (binding.accountCall ? input.intent.accountCallProfile !== binding.accountCall.profile || address(input.intent.accountCallTarget, 'intent.accountCallTarget') !== binding.accountCall.target || uintString(input.intent.accountCallValue, 'intent.accountCallValue') !== binding.accountCall.value || hash(input.intent.accountCallDataHash, 'intent.accountCallDataHash') !== binding.accountCall.dataHash : input.intent.accountCallProfile != null) throw new TypeError('authorization intent does not match the decoded account call')
  const intentMatch = matchUniqueContextCommitment(input.intent, binding.commitment)
  if (!intentMatch.matched) throw new TypeError(`authorization intent does not contain one matching UserOperation commitment: ${intentMatch.code}`)
  if (!record(input.receipt)) throw new TypeError('receipt must be an object')
  const receipt = input.receipt
  if (binding.accountCall && receipt.schema !== 'priorseal.execution-observation.v1') throw new TypeError('Safe call evidence requires a PriorSeal observation that decoded the included handleOps transaction')
  if (receipt.schema === 'priorseal.execution-observation.v1') {
    if (Number(receipt.chainId) !== binding.chainId || receipt.executionDataAvailable === false || !['CONFIRMED', 'REVERTED'].includes(String(receipt.status)) || !['CONFIRMED', 'FINALIZED'].includes(String(receipt.finalityState))) throw new TypeError('PriorSeal observation is not a final UserOperation observation')
    const success = receipt.userOperationSuccess
    if (typeof success !== 'boolean') throw new TypeError('PriorSeal observation is missing UserOperation success status')
    const body = {
      schema: 'priorseal.erc4337.execution-evidence.v1' as const,
      chainId: binding.chainId,
      entryPoint: expectedEntryPoint,
      entryPointCodeHash: expectedEntryPointCodeHash,
      entryPointVersion: binding.entryPointVersion,
      ...(binding.accountCall ? { accountCall: binding.accountCall } : {}),
      userOpHash: expectedHash,
      sender: address(receipt.sender, 'observation.sender'),
      nonce: uintString(receipt.nonce, 'observation.nonce'),
      success,
      actualGasCost: uintString(receipt.actualGasCost, 'observation.actualGasCost'),
      actualGasUsed: uintString(receipt.gasUsed, 'observation.gasUsed'),
      transactionHash: hash(receipt.txHash, 'observation.txHash'),
      blockNumber: uintString(receipt.blockNumber, 'observation.blockNumber'),
      blockHash: hash(receipt.blockHash, 'observation.blockHash'),
    }
    if ((body.success ? receipt.status !== 'CONFIRMED' : receipt.status !== 'REVERTED') || !sameAddress(body.sender, expectedSender) || body.nonce !== uintString(binding.nonce, 'binding.nonce') || !sameAddress(receipt.entryPoint, expectedEntryPoint) || hash(receipt.entryPointCodeHash, 'observation.entryPointCodeHash') !== expectedEntryPointCodeHash || receipt.entryPointVersion !== binding.entryPointVersion || hash(receipt.userOperationHash, 'observation.userOperationHash') !== expectedHash || !matchesAccountCall(receipt, binding.accountCall)) throw new TypeError('PriorSeal observation does not match the bound UserOperation event')
    return sealExecutionEvidence(body)
  }
  const transactionHash = hash(receipt.transactionHash, 'receipt.transactionHash')
  const blockHash = hash(receipt.blockHash, 'receipt.blockHash')
  const blockNumber = uintString(receipt.blockNumber, 'receipt.blockNumber')
  if (receipt.status !== 'success' && receipt.status !== '0x1' && receipt.status !== 1) throw new TypeError('receipt must have successful transaction status')
  if (!Array.isArray(receipt.logs)) throw new TypeError('receipt.logs must be an array')
  const events = receipt.logs.filter((entry) => isUserOperationEvent(entry, expectedEntryPoint, expectedHash))
  if (events.length !== 1) throw new TypeError(`expected exactly one matching EntryPoint UserOperationEvent, found ${events.length}`)
  const log = events[0] as Record<string, unknown>
  const topics = log.topics as string[]
  const data = log.data as string
  const sender = address(`0x${topics[2].slice(-40)}`, 'UserOperationEvent.sender')
  if (sender !== expectedSender) throw new TypeError('UserOperationEvent sender does not match the bound operation')
  const words = data.slice(2).match(/.{64}/g) ?? []
  if (words.length !== 4) throw new TypeError('UserOperationEvent data must contain nonce, success, actualGasCost and actualGasUsed')
  const nonce = BigInt(`0x${words[0]}`).toString(10)
  if (nonce !== uintString(binding.nonce, 'binding.nonce')) throw new TypeError('UserOperationEvent nonce does not match the bound operation')
  if (words[1] !== `${'0'.repeat(63)}1` && words[1] !== `${'0'.repeat(64)}`) throw new TypeError('UserOperationEvent success field is invalid')
  const success = BigInt(`0x${words[1]}`) === 1n
  const actualGasCost = BigInt(`0x${words[2]}`).toString(10)
  const actualGasUsed = BigInt(`0x${words[3]}`).toString(10)
  const body = {
    schema: 'priorseal.erc4337.execution-evidence.v1' as const,
    chainId: binding.chainId,
    entryPoint: expectedEntryPoint,
    entryPointCodeHash: expectedEntryPointCodeHash,
    entryPointVersion: binding.entryPointVersion,
    ...(binding.accountCall ? { accountCall: binding.accountCall } : {}),
    userOpHash: expectedHash,
    sender,
    nonce,
    success,
    actualGasCost,
    actualGasUsed,
    transactionHash,
    blockNumber,
    blockHash,
  }
  return sealExecutionEvidence(body)
}

function parseUserOperation(value: unknown, version: ERC4337Version, chainId: number): Record<string, unknown> {
  if (!record(value)) throw new TypeError('userOperation must be an object')
  const commonFields = ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'signature', 'authorization']
  const versionFields = version === '0.6'
    ? ['initCode', 'paymasterAndData']
    : ['factory', 'factoryData', 'paymaster', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit', 'paymasterData', ...(version === '0.9' ? ['paymasterSignature'] : [])]
  const unknownField = Object.keys(value).find((field) => !commonFields.includes(field) && !versionFields.includes(field))
  if (unknownField) throw new TypeError(`userOperation contains unsupported ${version} field: ${unknownField}`)
  const parsed: Record<string, unknown> = {
    sender: address(value.sender, 'userOperation.sender'),
    nonce: BigInt(uintString(value.nonce, 'userOperation.nonce')),
    callData: hex(value.callData, 'userOperation.callData'),
    callGasLimit: BigInt(uintString(value.callGasLimit, 'userOperation.callGasLimit')),
    verificationGasLimit: BigInt(uintString(value.verificationGasLimit, 'userOperation.verificationGasLimit')),
    preVerificationGas: BigInt(uintString(value.preVerificationGas, 'userOperation.preVerificationGas')),
    maxFeePerGas: BigInt(uintString(value.maxFeePerGas, 'userOperation.maxFeePerGas')),
    maxPriorityFeePerGas: BigInt(uintString(value.maxPriorityFeePerGas, 'userOperation.maxPriorityFeePerGas')),
    signature: hex(value.signature, 'userOperation.signature'),
  }
  if (version === '0.6') {
    if (value.initCode !== undefined) parsed.initCode = hex(value.initCode, 'userOperation.initCode')
    if (value.paymasterAndData !== undefined) parsed.paymasterAndData = hex(value.paymasterAndData, 'userOperation.paymasterAndData')
  } else {
    for (const field of ['factoryData', 'paymasterData', 'paymasterSignature'] as const) if (value[field] !== undefined) parsed[field] = hex(value[field], `userOperation.${field}`)
    for (const field of ['factory', 'paymaster'] as const) if (value[field] !== undefined) parsed[field] = address(value[field], `userOperation.${field}`)
    for (const field of ['paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) if (value[field] !== undefined) parsed[field] = BigInt(uintString(value[field], `userOperation.${field}`))
    if (value.authorization !== undefined) {
      if (!record(value.authorization)) throw new TypeError('userOperation.authorization must be an object')
      const authorizationChainId = uint32(value.authorization.chainId, 'userOperation.authorization.chainId')
      if (authorizationChainId !== 0 && authorizationChainId !== chainId) throw new TypeError('userOperation.authorization.chainId must be 0 or match the operation chainId')
      parsed.authorization = {
        address: address(value.authorization.address, 'userOperation.authorization.address'),
        chainId: authorizationChainId,
        nonce: uint32(value.authorization.nonce, 'userOperation.authorization.nonce'),
        yParity: uint32(value.authorization.yParity, 'userOperation.authorization.yParity', 1),
        r: hash(value.authorization.r, 'userOperation.authorization.r'),
        s: hash(value.authorization.s, 'userOperation.authorization.s'),
      }
    }
  }
  return parsed
}

function isUserOperationEvent(value: unknown, entryPoint: string, userOpHash: string): boolean {
  if (!record(value) || address(value.address, 'log.address') !== entryPoint || !Array.isArray(value.topics) || value.topics.length !== 4 || typeof value.data !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(value.data)) return false
  return hash(value.topics[0], 'log.topics[0]') === USER_OPERATION_EVENT_TOPIC && hash(value.topics[1], 'log.topics[1]') === userOpHash
}

/** Decode the single-call Safe4337Module execution envelope; delegatecall is intentionally rejected. */
export function decodeSafe4337CallData(callData: unknown): NonNullable<ERC4337OperationBinding['accountCall']> {
  const data = hex(callData, 'userOperation.callData')
  let decoded: ReturnType<typeof decodeFunctionData<typeof SAFE_4337_EXECUTION_ABI>>
  try { decoded = decodeFunctionData({ abi: SAFE_4337_EXECUTION_ABI, data }) } catch { throw new TypeError('Safe account callData is not a supported executeUserOp call') }
  if (decoded.functionName !== 'executeUserOp' && decoded.functionName !== 'executeUserOpWithErrorString') throw new TypeError('Safe account callData function is unsupported')
  const [rawTarget, rawValue, rawData, rawOperation] = decoded.args
  if (rawOperation !== 0) throw new TypeError('Safe delegatecall execution is unsupported')
  const target = address(rawTarget, 'Safe call target')
  const value = uintString(rawValue, 'Safe call value')
  const innerData = hex(rawData, 'Safe call data')
  if (encodeFunctionData({ abi: SAFE_4337_EXECUTION_ABI, functionName: decoded.functionName, args: [target, BigInt(value), innerData, 0] }).toLowerCase() !== data.toLowerCase()) throw new TypeError('Safe account callData is not canonical ABI encoding')
  return { profile: 'safe-4337.v1', target, value, dataHash: keccak256(innerData) }
}

function matchesAccountCall(receipt: Record<string, unknown>, expected?: ERC4337OperationBinding['accountCall']): boolean {
  if (!expected) return true
  return receipt.accountCallProfile === expected.profile
    && sameAddress(receipt.accountCallTarget, expected.target)
    && uintString(receipt.accountCallValue, 'observation.accountCallValue') === expected.value
    && hash(receipt.accountCallDataHash, 'observation.accountCallDataHash') === expected.dataHash
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  throw new TypeError('value must contain finite JSON data')
}
function sealExecutionEvidence(body: Omit<ERC4337ExecutionEvidence, 'executionCommitment'>): ERC4337ExecutionEvidence {
  return { ...body, executionCommitment: { namespace: ERC4337_EXECUTION_EVENT_NAMESPACE, algorithm: 'keccak256', digest: keccak256(toBytes(canonicalJson(body))) } }
}
function sameAddress(left: unknown, right: string) { return typeof left === 'string' && left.toLowerCase() === right.toLowerCase() }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function address(value: unknown, field: string): `0x${string}` { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError(`${field} must be a 20-byte EVM address`); return value.toLowerCase() as `0x${string}` }
function hash(value: unknown, field: string): `0x${string}` { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${field} must be a 32-byte hash`); return value.toLowerCase() as `0x${string}` }
function hex(value: unknown, field: string): `0x${string}` { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new TypeError(`${field} must be 0x-prefixed bytes`); return value.toLowerCase() as `0x${string}` }
function uintString(value: unknown, field: string): string { try { if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error(); if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error(); const result = BigInt(value); if (result < 0n) throw new Error(); return result.toString(10) } catch { throw new TypeError(`${field} must be an unsigned integer`) } }
function uint32(value: unknown, field: string, max = 0xffffffff): number { const parsed = uintString(value, field); const integer = Number(parsed); if (!Number.isSafeInteger(integer) || integer > max) throw new TypeError(`${field} must be an integer between 0 and ${max}`); return integer }
function isEntryPointVersion(value: unknown): value is ERC4337Version { return value === '0.6' || value === '0.7' || value === '0.8' || value === '0.9' }
