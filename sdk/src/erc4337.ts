import { getUserOperationHash } from 'viem/account-abstraction'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes } from 'viem'
import type { EntryPointVersion, UserOperation } from 'viem/account-abstraction'
import { parseContextCommitments } from './exact-call.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import type { ContextCommitment, Intent } from './types.js'

export const ERC4337_USER_OPERATION_NAMESPACE = 'priorseal.erc4337.user-operation.v1'
export const ERC4337_EXECUTION_EVENT_NAMESPACE = 'priorseal.erc4337.execution-event.v1'
export const ERC4337_EXECUTION_PROFILE = 'priorseal.execution-profile.erc4337-user-operation.v1'
export const ERC4337_EIP7702_FACTORY_MARKER = '0x7702'

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
  eip7702?: { delegateAddress: `0x${string}`; delegateCodeHash: `0x${string}` }
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
  eip7702?: { delegateAddress: `0x${string}`; delegateCodeHash: `0x${string}`; authorizationTupleHash?: `0x${string}` }
  commitment: ContextCommitment
}
export type ERC4337EIP7702DelegationEvidence = Omit<NonNullable<Intent['eip7702']>, 'authorizationTupleHash'> & {
  authorizationTupleHash: string | null
  schema: 'priorseal.eip7702.delegation-evidence.v1'
  authorizationIncluded: boolean
  operationIncluded: true
  operationSuccess: boolean | null
  outerTransactionStatus: 'SUCCESS' | 'REVERTED'
  outerTransactionGasUsed: string
  outerTransactionFee: string | null
  stateAtTransactionEnd: 'ACTIVE' | 'UNDELEGATED' | 'OTHER_DELEGATE' | 'NON_DELEGATED_CODE'
  delegateObservedForExecution: string | null
  delegateAfter: string | null
  transition: 'SET' | 'REPLACED' | 'UNCHANGED' | 'REVOKED' | 'OTHER'
}
export type ERC4337ExecutionEvidence = {
  schema: 'priorseal.erc4337.execution-evidence.v1'
  chainId: number
  entryPoint: `0x${string}`
  entryPointCodeHash: `0x${string}`
  entryPointVersion: ERC4337Version
  accountCall?: { profile: 'safe-4337.v1'; target: `0x${string}`; value: string; dataHash: `0x${string}` }
  eip7702Delegation?: ERC4337EIP7702DelegationEvidence
  userOpHash: `0x${string}`
  sender: `0x${string}`
  nonce: string
  success: boolean | null
  actualGasCost: string | null
  actualGasUsed: string | null
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
  const eip7702 = value.eip7702 === undefined ? undefined : parseEip7702Profile(value.eip7702)
  const userOperation = parseUserOperation(value.userOperation, value.entryPointVersion, Number(value.chainId))
  const parsedOperation = userOperation as Record<string, unknown>
  const factory = parsedOperation.factory
  if (factory === ERC4337_EIP7702_FACTORY_MARKER && !['0.8', '0.9'].includes(value.entryPointVersion)) throw new TypeError('EIP-7702 UserOperations require EntryPoint 0.8 or 0.9')
  if (eip7702 && value.entryPointVersion === '0.7') {
    if (factory !== undefined || (parsedOperation.factoryData !== undefined && parsedOperation.factoryData !== '0x')) throw new TypeError('EntryPoint 0.7 EIP-7702 observations require a predelegated sender with empty initCode')
  } else if ((factory === ERC4337_EIP7702_FACTORY_MARKER) !== Boolean(eip7702)) {
    throw new TypeError('EIP-7702 UserOperations require a matching eip7702 delegate profile')
  }
  if (eip7702 && !['0.7', '0.8', '0.9'].includes(value.entryPointVersion)) throw new TypeError('EIP-7702 observations require EntryPoint 0.7, 0.8 or 0.9')
  if (eip7702 && value.accountCallProfile != null) throw new TypeError('Safe account-call and EIP-7702 profiles cannot be combined')
  if (eip7702) {
    const authorization = (userOperation as Record<string, unknown>).authorization
    if (authorization !== undefined && (authorization as Record<string, unknown>).address !== eip7702.delegateAddress) throw new TypeError('EIP-7702 authorization delegate does not match the trusted delegate profile')
  }
  return {
    chainId: Number(value.chainId),
    entryPoint,
    entryPointCodeHash,
    entryPointVersion: value.entryPointVersion,
    ...(value.accountCallProfile ? { accountCallProfile: value.accountCallProfile } : {}),
    ...(eip7702 ? { eip7702 } : {}),
    userOperation,
  }
}

/** Compute the canonical ERC-4337 operation hash and its PriorSeal commitment. */
export function bindERC4337UserOperation(value: unknown): ERC4337OperationBinding {
  const input = parseERC4337UserOperationInput(value)
  const operation = input.userOperation as UserOperation<ERC4337Version>
  const operationForHash = input.eip7702 && ['0.8', '0.9'].includes(input.entryPointVersion) && !(operation as Record<string, unknown>).authorization
    ? { ...operation, authorization: { address: input.eip7702.delegateAddress, chainId: 0, nonce: 0, yParity: 0, r: `0x${'0'.repeat(64)}`, s: `0x${'0'.repeat(64)}` } } as UserOperation<ERC4337Version>
    : operation
  const userOpHash = getUserOperationHash({
    chainId: input.chainId,
    entryPointAddress: input.entryPoint,
    entryPointVersion: input.entryPointVersion,
    userOperation: operationForHash,
  })
  const accountCall = input.accountCallProfile ? decodeSafe4337CallData((operation as Record<string, unknown>).callData) : undefined
  const eip7702Authorization = input.eip7702 && (operation as Record<string, unknown>).authorization
    ? computeEIP7702AuthorizationTupleHash((operation as Record<string, unknown>).authorization)
    : undefined
  return {
    chainId: input.chainId,
    entryPoint: input.entryPoint,
    entryPointCodeHash: input.entryPointCodeHash,
    entryPointVersion: input.entryPointVersion,
    sender: operation.sender.toLowerCase() as `0x${string}`,
    nonce: operation.nonce.toString(10),
    userOpHash,
    ...(accountCall ? { accountCall } : {}),
    ...(input.eip7702 ? { eip7702: { ...input.eip7702, ...(eip7702Authorization ? { authorizationTupleHash: eip7702Authorization } : {}) } } : {}),
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
    ...(binding.eip7702 ? { eip7702: binding.eip7702 } : {}),
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
  intent: Pick<Intent, 'contextCommitments' | 'executionProfile' | 'entryPoint' | 'entryPointCodeHash' | 'entryPointVersion' | 'userOperationHash'> & Partial<Pick<Intent, 'accountCallProfile' | 'accountCallTarget' | 'accountCallValue' | 'accountCallDataHash' | 'eip7702'>>
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
  if (binding.eip7702 ? !input.intent.eip7702 || address(input.intent.eip7702.delegateAddress, 'intent.eip7702.delegateAddress') !== binding.eip7702.delegateAddress || hash(input.intent.eip7702.delegateCodeHash, 'intent.eip7702.delegateCodeHash') !== binding.eip7702.delegateCodeHash || (input.intent.eip7702.authorizationTupleHash == null ? null : hash(input.intent.eip7702.authorizationTupleHash, 'intent.eip7702.authorizationTupleHash')) !== (binding.eip7702.authorizationTupleHash ?? null) : input.intent.eip7702 != null) throw new TypeError('authorization intent does not match the EIP-7702 delegate binding')
  const intentMatch = matchUniqueContextCommitment(input.intent, binding.commitment)
  if (!intentMatch.matched) throw new TypeError(`authorization intent does not contain one matching UserOperation commitment: ${intentMatch.code}`)
  if (!record(input.receipt)) throw new TypeError('receipt must be an object')
  const receipt = input.receipt
  if ((binding.accountCall || binding.eip7702) && receipt.schema !== 'priorseal.execution-observation.v1') throw new TypeError('Safe or EIP-7702 evidence requires a PriorSeal observation of the included transaction')
  if (receipt.schema === 'priorseal.execution-observation.v1') {
    if (Number(receipt.chainId) !== binding.chainId || !['CONFIRMED', 'REVERTED'].includes(String(receipt.status)) || !['CONFIRMED', 'FINALIZED'].includes(String(receipt.finalityState))) throw new TypeError('PriorSeal observation is not a final UserOperation observation')
    const success: boolean | null = receipt.userOperationSuccess === null || receipt.userOperationSuccess === undefined
      ? null
      : typeof receipt.userOperationSuccess === 'boolean' ? receipt.userOperationSuccess : (() => { throw new TypeError('PriorSeal observation has an invalid UserOperation success status') })()
    if (!binding.eip7702 && success === null) throw new TypeError('PriorSeal observation has an invalid UserOperation success status')
    if (receipt.executionDataAvailable === false) throw new TypeError('PriorSeal observation is missing UserOperation execution data')
    const eip7702Evidence = binding.eip7702 ? parseEIP7702DelegationEvidence(receipt.eip7702Delegation, binding.eip7702, success, receipt.status === 'REVERTED' && receipt.userOperationSuccess == null) : undefined
    const body = {
      schema: 'priorseal.erc4337.execution-evidence.v1' as const,
      chainId: binding.chainId,
      entryPoint: expectedEntryPoint,
      entryPointCodeHash: expectedEntryPointCodeHash,
      entryPointVersion: binding.entryPointVersion,
      ...(binding.accountCall ? { accountCall: binding.accountCall } : {}),
      ...(eip7702Evidence ? { eip7702Delegation: eip7702Evidence } : {}),
      userOpHash: expectedHash,
      sender: address(receipt.sender, 'observation.sender'),
      nonce: uintString(receipt.nonce, 'observation.nonce'),
      success,
      actualGasCost: success == null ? null : uintString(receipt.actualGasCost, 'observation.actualGasCost'),
      actualGasUsed: success == null ? null : uintString(receipt.actualGasUsed ?? receipt.gasUsed, 'observation.actualGasUsed'),
      transactionHash: hash(receipt.txHash, 'observation.txHash'),
      blockNumber: uintString(receipt.blockNumber, 'observation.blockNumber'),
      blockHash: hash(receipt.blockHash, 'observation.blockHash'),
    }
    const outerRevertWithoutEvent = binding.eip7702 && receipt.status === 'REVERTED' && success === null && eip7702Evidence?.operationIncluded === true && eip7702Evidence.outerTransactionStatus === 'REVERTED'
    if ((!outerRevertWithoutEvent && (body.success === null || (body.success ? receipt.status !== 'CONFIRMED' : receipt.status !== 'REVERTED'))) || !sameAddress(body.sender, expectedSender) || body.nonce !== uintString(binding.nonce, 'binding.nonce') || !sameAddress(receipt.entryPoint, expectedEntryPoint) || hash(receipt.entryPointCodeHash, 'observation.entryPointCodeHash') !== expectedEntryPointCodeHash || receipt.entryPointVersion !== binding.entryPointVersion || hash(receipt.userOperationHash, 'observation.userOperationHash') !== expectedHash || !matchesAccountCall(receipt, binding.accountCall)) throw new TypeError('PriorSeal observation does not match the bound UserOperation event')
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
  const commonFields = ['sender', 'nonce', 'callData', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'signature']
  const versionFields = version === '0.6'
    ? ['initCode', 'paymasterAndData']
    : ['factory', 'factoryData', 'paymaster', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit', 'paymasterData', ...(version === '0.8' || version === '0.9' ? ['authorization', 'eip7702Auth'] : []), ...(version === '0.9' ? ['paymasterSignature'] : [])]
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
    if (value.factory !== undefined) {
      const parsedFactory = value.factory === ERC4337_EIP7702_FACTORY_MARKER || isPaddedEip7702FactoryMarker(value.factory)
        ? ERC4337_EIP7702_FACTORY_MARKER
        : address(value.factory, 'userOperation.factory')
      if (parsedFactory === ERC4337_EIP7702_FACTORY_MARKER && version !== '0.8' && version !== '0.9') throw new TypeError('EIP-7702 factory marker requires EntryPoint 0.8 or 0.9')
      parsed.factory = parsedFactory
    }
    if (value.paymaster !== undefined) parsed.paymaster = address(value.paymaster, 'userOperation.paymaster')
    for (const field of ['paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'] as const) if (value[field] !== undefined) parsed[field] = BigInt(uintString(value[field], `userOperation.${field}`))
    if (value.authorization !== undefined && value.eip7702Auth !== undefined) throw new TypeError('userOperation must not contain both authorization and eip7702Auth')
    const rawAuthorization = value.authorization ?? value.eip7702Auth
    if (rawAuthorization !== undefined) {
      if (!record(rawAuthorization)) throw new TypeError('userOperation authorization must be an object')
      if (version !== '0.8' && version !== '0.9') throw new TypeError('EIP-7702 authorization requires EntryPoint 0.8 or 0.9')
      const unknownAuthorizationField = Object.keys(rawAuthorization).find((field) => !['address', 'chainId', 'nonce', 'yParity', 'r', 's'].includes(field))
      if (unknownAuthorizationField) throw new TypeError(`userOperation.authorization contains unsupported field: ${unknownAuthorizationField}`)
      const authorizationChainId = safeUint(rawAuthorization.chainId, 'userOperation.authorization.chainId')
      if (authorizationChainId !== 0 && authorizationChainId !== chainId) throw new TypeError('userOperation.authorization.chainId must be 0 or match the operation chainId')
      const authorizationNonce = safeUint(rawAuthorization.nonce, 'userOperation.authorization.nonce', 0xffffffffffffffff - 1)
      const yParity = uint32(rawAuthorization.yParity, 'userOperation.authorization.yParity', 1)
      const r = hash(rawAuthorization.r, 'userOperation.authorization.r')
      const s = hash(rawAuthorization.s, 'userOperation.authorization.s')
      const rValue = BigInt(r)
      const sValue = BigInt(s)
      if (rValue === 0n || rValue >= SECP256K1_N || sValue === 0n || sValue > SECP256K1_N / 2n) throw new TypeError('userOperation.authorization signature scalar is invalid')
      parsed.authorization = {
        address: address(rawAuthorization.address, 'userOperation.authorization.address'),
        chainId: authorizationChainId,
        nonce: authorizationNonce,
        yParity,
        r,
        s,
      }
    }
  }
  return parsed
}

function parseEip7702Profile(value: unknown): NonNullable<ERC4337UserOperationInput['eip7702']> {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'delegateAddress,delegateCodeHash') throw new TypeError('eip7702 must contain only delegateAddress and delegateCodeHash')
  const delegateAddress = address(value.delegateAddress, 'eip7702.delegateAddress')
  if (delegateAddress === `0x${'0'.repeat(40)}`) throw new TypeError('eip7702.delegateAddress must not be the zero address')
  return { delegateAddress, delegateCodeHash: hash(value.delegateCodeHash, 'eip7702.delegateCodeHash') }
}

/** Commit to the exact signed EIP-7702 tuple without exposing its six fields in the intent. */
export function computeEIP7702AuthorizationTupleHash(value: unknown): `0x${string}` {
  if (!record(value)) throw new TypeError('EIP-7702 authorization must be an object')
  const tuple = {
    address: address(value.address, 'authorization.address'),
    chainId: BigInt(uintString(value.chainId, 'authorization.chainId')),
    nonce: BigInt(uintString(value.nonce, 'authorization.nonce')),
    yParity: uint32(value.yParity, 'authorization.yParity', 1),
    r: hash(value.r, 'authorization.r'),
    s: hash(value.s, 'authorization.s'),
  }
  if (tuple.chainId >= 1n << 256n || tuple.nonce >= 1n << 64n) throw new TypeError('EIP-7702 authorization integer exceeds its protocol range')
  return keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [tuple.chainId, tuple.address, tuple.nonce, tuple.yParity, tuple.r, tuple.s],
  ))
}

function parseEIP7702DelegationEvidence(value: unknown, expected: NonNullable<ERC4337OperationBinding['eip7702']>, operationSuccess: boolean | null, allowOuterRevert: boolean): ERC4337EIP7702DelegationEvidence {
  if (!record(value)) throw new TypeError('PriorSeal observation is missing EIP-7702 delegation evidence')
  const delegateAddress = address(value.delegateAddress, 'eip7702Delegation.delegateAddress')
  const delegateCodeHash = hash(value.delegateCodeHash, 'eip7702Delegation.delegateCodeHash')
  const authorizationTupleHash = value.authorizationTupleHash == null ? null : hash(value.authorizationTupleHash, 'eip7702Delegation.authorizationTupleHash')
  if (value.schema !== 'priorseal.eip7702.delegation-evidence.v1' || delegateAddress !== expected.delegateAddress || delegateCodeHash !== expected.delegateCodeHash || authorizationTupleHash !== (expected.authorizationTupleHash ?? null)) throw new TypeError('EIP-7702 delegation evidence does not match the signed intent')
  if (value.authorizationIncluded !== (expected.authorizationTupleHash != null) || value.operationIncluded !== true || value.operationSuccess !== operationSuccess) throw new TypeError('EIP-7702 evidence does not match the included authorization and UserOperation outcome')
  if (!['SUCCESS', 'REVERTED'].includes(String(value.outerTransactionStatus)) || (allowOuterRevert ? value.outerTransactionStatus !== 'REVERTED' : value.outerTransactionStatus !== 'SUCCESS')) throw new TypeError('EIP-7702 evidence has an inconsistent outer transaction status')
  const outerTransactionGasUsed = uintString(value.outerTransactionGasUsed, 'eip7702Delegation.outerTransactionGasUsed')
  const outerTransactionFee = value.outerTransactionFee == null ? null : uintString(value.outerTransactionFee, 'eip7702Delegation.outerTransactionFee')
  const delegateObservedForExecution = value.delegateObservedForExecution == null ? null : address(value.delegateObservedForExecution, 'eip7702Delegation.delegateObservedForExecution')
  const delegateAfter = value.delegateAfter == null ? null : address(value.delegateAfter, 'eip7702Delegation.delegateAfter')
  if (!['ACTIVE', 'UNDELEGATED', 'OTHER_DELEGATE', 'NON_DELEGATED_CODE'].includes(String(value.stateAtTransactionEnd)) || !['SET', 'REPLACED', 'UNCHANGED', 'REVOKED', 'OTHER'].includes(String(value.transition))) throw new TypeError('EIP-7702 delegation evidence contains an invalid state transition')
  const expectedTransition = delegationTransition(delegateObservedForExecution, delegateAfter, value.stateAtTransactionEnd)
  if (value.transition !== expectedTransition) throw new TypeError('EIP-7702 delegation transition is inconsistent with the before and after block states')
  if ((value.stateAtTransactionEnd === 'ACTIVE' && delegateAfter !== delegateAddress)
    || (value.stateAtTransactionEnd === 'UNDELEGATED' && delegateAfter !== null)
    || (value.stateAtTransactionEnd === 'OTHER_DELEGATE' && (!delegateAfter || delegateAfter === delegateAddress))
    || (value.stateAtTransactionEnd === 'NON_DELEGATED_CODE' && delegateAfter !== null)) throw new TypeError('EIP-7702 transaction-end state does not match its delegate address')
  return {
    schema: 'priorseal.eip7702.delegation-evidence.v1', delegateAddress, delegateCodeHash,
    authorizationTupleHash, authorizationIncluded: expected.authorizationTupleHash != null,
    operationIncluded: true, operationSuccess, outerTransactionStatus: value.outerTransactionStatus as 'SUCCESS' | 'REVERTED',
    outerTransactionGasUsed, outerTransactionFee, stateAtTransactionEnd: value.stateAtTransactionEnd as ERC4337EIP7702DelegationEvidence['stateAtTransactionEnd'],
    delegateObservedForExecution, delegateAfter, transition: expectedTransition,
  }
}

function delegationTransition(before: string | null, after: string | null, afterState: unknown): ERC4337EIP7702DelegationEvidence['transition'] {
  if (before === after) return 'UNCHANGED'
  if (afterState === 'NON_DELEGATED_CODE') return 'OTHER'
  if (!before && after) return 'SET'
  if (before && after) return 'REPLACED'
  if (before && !after && afterState === 'UNDELEGATED') return 'REVOKED'
  return 'OTHER'
}

function isUserOperationEvent(value: unknown, entryPoint: string, userOpHash: string): boolean {
  if (!record(value) || address(value.address, 'log.address') !== entryPoint || !Array.isArray(value.topics) || value.topics.length !== 4 || typeof value.data !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(value.data)) return false
  return hash(value.topics[0], 'log.topics[0]') === USER_OPERATION_EVENT_TOPIC && hash(value.topics[1], 'log.topics[1]') === userOpHash
}

function isPaddedEip7702FactoryMarker(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() === `0x7702${'0'.repeat(36)}`
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

function safeUint(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = uintString(value, field)
  const integer = Number(parsed)
  if (!Number.isSafeInteger(integer) || integer > max) throw new TypeError(`${field} must be an integer between 0 and ${max}`)
  return integer
}

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
