import type { ContextCommitment, Intent, SolanaTransactionMessage } from './types.js'

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
export const SOLANA_TRANSACTION_PROFILE = 'priorseal.execution-profile.solana-transaction.v2'
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/

export type SolanaTransactionIntentInput = {
  intentId: string
  asset: string
  amount: string
  validUntil: number
  transaction: SolanaTransactionMessage
  /** Optional reviewed counterparty represented by the exact transaction. */
  recipient?: string
  contextCommitments?: ContextCommitment[]
  constraints?: Intent['constraints']
}

/**
 * Bind an already-built Solana mainnet transaction message to a PriorSeal
 * intent. The caller must resolve every address lookup table before invoking
 * this helper; both lookup indexes and their resolved addresses are committed.
 */
export function buildSolanaTransactionIntent(input: SolanaTransactionIntentInput): Intent {
  const transaction = normalizeMessage(input.transaction)
  if (typeof input.intentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.intentId)) throw new TypeError('intentId is invalid')
  if (typeof input.amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input.amount)) throw new TypeError('amount must be an unsigned decimal string')
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil <= 0) throw new TypeError('validUntil must be a positive Unix timestamp')
  if (!new RegExp(`^${SOLANA_MAINNET_CAIP2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/(?:slip44:501|spl:[1-9A-HJ-NP-Za-km-z]{32,44})$`).test(input.asset)) throw new TypeError('asset must be a Solana mainnet SOL or SPL CAIP-19 identifier')
  if (input.recipient !== undefined) assertPublicKey(input.recipient, 'recipient')
  if (input.constraints?.finalityRequirement === 'RPC_FINALIZED') throw new TypeError('Solana transaction profile currently supports confirmed commitment only')
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: SOLANA_TRANSACTION_PROFILE,
    intentId: input.intentId,
    chainId: 0,
    chainRef: SOLANA_MAINNET_CAIP2,
    action: 'SOLANA_TRANSACTION',
    asset: input.asset,
    amount: input.amount,
    sender: transaction.feePayer,
    recipient: input.recipient ?? transaction.feePayer,
    validUntil: input.validUntil,
    nonce: transaction.recentBlockhash,
    solanaTransaction: transaction,
    ...(input.contextCommitments ? { contextCommitments: input.contextCommitments } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  }
}

/** Exact UTF-8 payload to pass to a Solana wallet's off-chain message signer. */
export function solanaAuthorizationMessage(authorization: Record<string, unknown>): string {
  const { signature: _signature, ...unsigned } = authorization
  return `PriorSeal Solana authorization v2\n${canonicalize(unsigned)}`
}

/** SHA-256 of the exact serialized Solana message bytes, excluding signatures. */
export async function hashSolanaTransactionMessage(value: SolanaTransactionMessage): Promise<string> {
  const message = normalizeMessage(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(encodeMessageBytes(message)))
  return '0x' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function encodeMessageBytes(message: SolanaTransactionMessage): number[] {
  const header = [message.header.numRequiredSignatures, message.header.numReadonlySignedAccounts, message.header.numReadonlyUnsignedAccounts]
  const blockhash = [...decodeBase58Bytes(message.recentBlockhash)]
  const keys = message.accountKeys.flatMap((key) => [...decodeBase58Bytes(key)])
  const instructions = message.instructions
  if (message.messageVersion === 'v1') {
    if (message.accountKeys.length > 96 || instructions.length > 64) throw new TypeError('v1 message exceeds the supported address or instruction count')
    const config = message.transactionConfig!
    let mask = 0
    const configValues: number[] = []
    if (config.priorityFeeLamports !== null) {
      mask |= 0x3
      configValues.push(...uint64LittleEndian(BigInt(config.priorityFeeLamports)))
    }
    mask |= 0x4 | 0x8
    configValues.push(...uint32LittleEndian(config.computeUnitLimit!), ...uint32LittleEndian(config.loadedAccountsDataSizeLimit!))
    if (config.heapSize !== null) {
      mask |= 0x10
      configValues.push(...uint32LittleEndian(config.heapSize))
    }
    const instructionData = instructions.map((instruction) => [...decodeBase58Bytes(instruction.data)])
    const instructionHeaders = instructions.flatMap((instruction, index) => [
      instruction.programIdIndex,
      instruction.accountIndexes.length,
      instructionData[index].length & 0xff,
      instructionData[index].length >> 8,
    ])
    const instructionPayloads = instructions.flatMap((instruction, index) => [
      ...instruction.accountIndexes,
      ...instructionData[index],
    ])
    return [0x81, ...header, ...uint32LittleEndian(mask), ...blockhash, instructions.length, message.accountKeys.length, ...keys, ...configValues, ...instructionHeaders, ...instructionPayloads]
  }
  const bytes = [
    ...(message.messageVersion === 'v0' ? [0x80] : []),
    ...header,
    ...shortVector(message.accountKeys.length),
    ...keys,
    ...blockhash,
    ...shortVector(instructions.length),
  ]
  for (const instruction of instructions) {
    const data = [...decodeBase58Bytes(instruction.data)]
    bytes.push(instruction.programIdIndex, ...shortVector(instruction.accountIndexes.length), ...instruction.accountIndexes, ...shortVector(data.length), ...data)
  }
  if (message.messageVersion === 'v0') {
    bytes.push(...shortVector(message.addressTableLookups.length))
    for (const lookup of message.addressTableLookups) {
      bytes.push(...decodeBase58Bytes(lookup.accountKey), ...shortVector(lookup.writableIndexes.length), ...lookup.writableIndexes, ...shortVector(lookup.readonlyIndexes.length), ...lookup.readonlyIndexes)
    }
  }
  return bytes
}

function decodeBase58Bytes(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new TypeError('Invalid base58 value')
    integer = integer * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (integer > 0n) { bytes.push(Number(integer & 0xffn)); integer >>= 8n }
  bytes.reverse()
  let zeroes = 0
  while (value[zeroes] === '1') zeroes += 1
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes])
}

function shortVector(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new TypeError('Solana short vector is out of range')
  const bytes: number[] = []
  let remaining = value
  while (remaining >= 0x80) { bytes.push((remaining & 0x7f) | 0x80); remaining >>= 7 }
  bytes.push(remaining)
  return bytes
}

function uint32LittleEndian(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new TypeError('Solana v1 config value is out of range')
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function uint64LittleEndian(value: bigint): number[] {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new TypeError('Solana priority fee is out of range')
  const bytes: number[] = []
  for (let index = 0; index < 8; index += 1) bytes.push(Number((value >> BigInt(index * 8)) & 0xffn))
  return bytes
}

function normalizeMessage(value: SolanaTransactionMessage): SolanaTransactionMessage {
  if (!value || typeof value !== 'object' || value.network !== 'mainnet-beta') throw new TypeError('Only Solana mainnet-beta messages are supported')
  if (!['legacy', 'v0', 'v1'].includes(value.messageVersion)) throw new TypeError('messageVersion must be legacy, v0, or v1')
  const messageVersion = value.messageVersion
  let transactionConfig: SolanaTransactionMessage['transactionConfig']
  if (messageVersion === 'v1') {
    const config = value.transactionConfig
    if (!config || !Number.isSafeInteger(config.computeUnitLimit) || config.computeUnitLimit! < 0 || config.computeUnitLimit! > 0xffff_ffff || !Number.isSafeInteger(config.loadedAccountsDataSizeLimit) || config.loadedAccountsDataSizeLimit! < 0 || config.loadedAccountsDataSizeLimit! > 0xffff_ffff || !(config.heapSize === null || Number.isSafeInteger(config.heapSize) && config.heapSize >= 0 && config.heapSize <= 0xffff_ffff) || !(config.priorityFeeLamports === null || typeof config.priorityFeeLamports === 'string' && /^(0|[1-9][0-9]*)$/.test(config.priorityFeeLamports) && BigInt(config.priorityFeeLamports) <= 0xffff_ffff_ffff_ffffn)) throw new TypeError('v1 transactionConfig is invalid')
    transactionConfig = { ...config }
  } else if (value.transactionConfig !== undefined) {
    throw new TypeError('transactionConfig is only valid for v1 messages')
  }
  assertPublicKey(value.feePayer, 'feePayer')
  assertPublicKey(value.recentBlockhash, 'recentBlockhash')
  const accountKeys = value.accountKeys
  if (!Array.isArray(accountKeys) || accountKeys.length < 1 || accountKeys.length > 256) throw new TypeError('accountKeys must contain 1 to 256 keys')
  if (messageVersion === 'v1' && accountKeys.length > 96) throw new TypeError('v1 messages support at most 96 inline addresses')
  accountKeys.forEach((key, index) => assertPublicKey(key, `accountKeys[${index}]`))
  if (accountKeys[0] !== value.feePayer || new Set(accountKeys).size !== accountKeys.length) throw new TypeError('feePayer must be the first unique static account key')
  const header = value.header
  if (!header || !['numRequiredSignatures', 'numReadonlySignedAccounts', 'numReadonlyUnsignedAccounts'].every((key) => Number.isSafeInteger(header[key as keyof typeof header]))) throw new TypeError('message header is invalid')
  if (header.numRequiredSignatures < 1 || header.numRequiredSignatures > accountKeys.length || header.numReadonlySignedAccounts >= header.numRequiredSignatures || header.numReadonlyUnsignedAccounts > accountKeys.length - header.numRequiredSignatures) throw new TypeError('message header account counts are inconsistent')
  const addressTableLookups = value.addressTableLookups
  if (!Array.isArray(addressTableLookups) || addressTableLookups.length > 32) throw new TypeError('addressTableLookups is invalid')
  if (messageVersion !== 'v0' && addressTableLookups.length !== 0) throw new TypeError('address table lookups are only valid for v0 messages')
  const writableCount = addressTableLookups.reduce((sum, lookup, index) => {
    assertPublicKey(lookup.accountKey, `addressTableLookups[${index}].accountKey`)
    return sum + validIndexes(lookup.writableIndexes, `addressTableLookups[${index}].writableIndexes`).length
  }, 0)
  const readonlyCount = addressTableLookups.reduce((sum, lookup, index) => sum + validIndexes(lookup.readonlyIndexes, `addressTableLookups[${index}].readonlyIndexes`).length, 0)
  const writable = value.loadedAddresses?.writable
  const readonly = value.loadedAddresses?.readonly
  if (!Array.isArray(writable) || !Array.isArray(readonly) || writable.length !== writableCount || readonly.length !== readonlyCount) throw new TypeError('resolved address lookup keys do not match the lookup indexes')
  if (messageVersion === 'v1' && (writable.length !== 0 || readonly.length !== 0 || transactionConfig?.computeUnitLimit == null || transactionConfig.computeUnitLimit === 0 || transactionConfig.loadedAccountsDataSizeLimit == null || transactionConfig.loadedAccountsDataSizeLimit === 0)) throw new TypeError('v1 messages require positive explicit resource limits and cannot use address lookups')
  writable.forEach((key, index) => assertPublicKey(key, `loadedAddresses.writable[${index}]`))
  readonly.forEach((key, index) => assertPublicKey(key, `loadedAddresses.readonly[${index}]`))
  const accountCount = accountKeys.length + writable.length + readonly.length
  if (accountCount > 256 || !Array.isArray(value.instructions) || value.instructions.length < 1 || value.instructions.length > 128) throw new TypeError('compiled instruction list is invalid')
  if (messageVersion === 'v1' && value.instructions.length > 64) throw new TypeError('v1 messages support at most 64 instructions')
  const instructions = value.instructions.map((instruction, index) => {
    if (!Number.isSafeInteger(instruction.programIdIndex) || instruction.programIdIndex < 0 || instruction.programIdIndex >= accountCount || !Array.isArray(instruction.accountIndexes) || instruction.accountIndexes.length > (messageVersion === 'v1' ? 255 : 256) || instruction.accountIndexes.some((account) => !Number.isSafeInteger(account) || account < 0 || account >= accountCount) || typeof instruction.data !== 'string' || instruction.data.length > 8192 || (instruction.data.length > 0 && !BASE58.test(instruction.data))) throw new TypeError(`compiled instruction ${index} is invalid`)
    return { programIdIndex: instruction.programIdIndex, accountIndexes: [...instruction.accountIndexes], data: instruction.data }
  })
  return {
    network: 'mainnet-beta', messageVersion, ...(transactionConfig ? { transactionConfig } : {}), feePayer: value.feePayer, recentBlockhash: value.recentBlockhash,
    header: { ...header }, accountKeys: [...accountKeys],
    addressTableLookups: addressTableLookups.map((lookup) => ({ accountKey: lookup.accountKey, writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] })),
    loadedAddresses: { writable: [...writable], readonly: [...readonly] }, instructions,
  }
}

function assertPublicKey(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || !BASE58.test(value) || decodeBase58Length(value) !== 32) throw new TypeError(`${field} must be a 32-byte base58 public key`)
}
function decodeBase58Length(value: string): number {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) return -1
    integer = integer * 58n + BigInt(digit)
  }
  let bytes = 0
  while (integer > 0n) { integer >>= 8n; bytes += 1 }
  for (const character of value) { if (character !== '1') break; bytes += 1 }
  return bytes
}
function validIndexes(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length > 256 || value.some((index) => !Number.isSafeInteger(index) || index < 0 || index > 255) || new Set(value).size !== value.length) throw new TypeError(`${field} is invalid`)
  return value as number[]
}
function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not valid canonical JSON')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}
