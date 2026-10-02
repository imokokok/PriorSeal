import { matchUniqueContextCommitment } from './context-commitment.js'
import type {
  ContextCommitment,
  HeadlessMarketStateCheck,
  HeadlessMarketStateKey,
  HeadlessMarketStatePairResult,
  HeadlessMarketStatePolicy,
  HeadlessMarketStateReceipt,
  Intent,
} from './types.js'

export const HEADLESS_MARKET_STATE_NAMESPACE = 'headlessoracle.market-state.v1'

const baseReceiptFields = [
  'expires_at',
  'halt_detection',
  'issued_at',
  'issuer',
  'mic',
  'public_key_id',
  'receipt_id',
  'receipt_mode',
  'schema_version',
  'signature',
  'source',
  'status',
] as const

const hex64 = /^[0-9a-f]{64}$/
const hex128 = /^[0-9a-f]{128}$/
const digestHex = /^0x[0-9a-f]{64}$/

/** Exact UTF-8 bytes signed by the Headless Oracle v5 receipt issuer. */
export function canonicalHeadlessMarketStateReceiptBytes(receipt: HeadlessMarketStateReceipt): Uint8Array {
  assertReceiptShape(receipt)
  const body = Object.fromEntries(Object.entries(receipt).filter(([field]) => field !== 'signature'))
  return new TextEncoder().encode(canonicalize(body))
}

/** SHA-256 commitment over the same canonical bytes covered by the issuer signature. */
export async function headlessMarketStateCommitment(
  receipt: HeadlessMarketStateReceipt,
): Promise<ContextCommitment> {
  const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(canonicalHeadlessMarketStateReceiptBytes(receipt)))
  return {
    namespace: HEADLESS_MARKET_STATE_NAMESPACE,
    algorithm: 'sha256',
    digest: `0x${bytesToHex(new Uint8Array(digest))}`,
  }
}

/**
 * Verify one receipt without network access. The default is production-safe:
 * only live receipts are accepted unless demo is explicitly allowed.
 */
export async function verifyHeadlessMarketStateReceipt(
  receipt: HeadlessMarketStateReceipt,
  key: HeadlessMarketStateKey,
  observedAt: string,
  policy: HeadlessMarketStatePolicy,
  expectedCommitment?: ContextCommitment,
): Promise<HeadlessMarketStateCheck> {
  const reasonCodes: string[] = []
  let commitment = emptyCommitment()
  let coverage: Record<string, unknown> | null = null

  try {
    commitment = await headlessMarketStateCommitment(receipt)
  } catch {
    return rejected(commitment, null, ['INVALID_RECEIPT_SHAPE'])
  }

  if (expectedCommitment !== undefined) {
    if (!validExpectedCommitment(expectedCommitment)) reasonCodes.push('INVALID_EXPECTED_COMMITMENT')
    else if (
      expectedCommitment.namespace !== commitment.namespace
      || expectedCommitment.algorithm !== commitment.algorithm
      || expectedCommitment.digest.toLowerCase() !== commitment.digest
    ) reasonCodes.push('COMMITMENT_MISMATCH')
  }

  if (!validPolicy(policy)) return rejected(commitment, null, [...reasonCodes, 'INVALID_POLICY'])

  if (!validKey(key) || receipt.public_key_id !== key.key_id) {
    reasonCodes.push('UNKNOWN_OR_INVALID_KEY')
  } else if (!await verifySignature(receipt, key.public_key)) {
    reasonCodes.push('INVALID_SIGNATURE')
  }

  const issuedAt = Date.parse(receipt.issued_at)
  const expiresAt = Date.parse(receipt.expires_at)
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN
  if (![issuedAt, expiresAt, observed].every(Number.isFinite) || issuedAt > expiresAt) {
    reasonCodes.push('INVALID_TIME_FORMAT_OR_WINDOW')
  } else if (observed < issuedAt || observed > expiresAt) {
    reasonCodes.push('EXECUTION_OUTSIDE_RECEIPT_WINDOW')
  }

  if (receipt.mic !== policy.expectedMic) reasonCodes.push('VENUE_MISMATCH')
  if ((receipt.status !== 'OPEN' && receipt.status !== 'CLOSED') || !policy.allowedStatuses.includes(receipt.status)) {
    reasonCodes.push('STATUS_NOT_ALLOWED')
  }
  if (!(policy.allowedReceiptModes ?? ['live']).includes(receipt.receipt_mode)) {
    reasonCodes.push('RECEIPT_MODE_NOT_ALLOWED')
  }
  if (receipt.issuer !== (policy.expectedIssuer ?? 'headlessoracle.com')) reasonCodes.push('ISSUER_MISMATCH')
  if (receipt.schema_version !== (policy.expectedSchemaVersion ?? 'v5.0')) {
    reasonCodes.push('SCHEMA_VERSION_MISMATCH')
  }

  if (receipt.coverage === undefined) {
    if (policy.requiredFeedState) reasonCodes.push('FEED_STATE_UNAVAILABLE')
  } else {
    try {
      const parsed = JSON.parse(receipt.coverage) as unknown
      if (!isRecord(parsed) || typeof parsed.feed_state !== 'string') throw new TypeError('invalid coverage')
      coverage = parsed
      if (
        (coverage.feed_state !== 'live' && coverage.feed_state !== 'not_covered')
        || (policy.requiredFeedState && coverage.feed_state !== policy.requiredFeedState)
      ) reasonCodes.push('FEED_STATE_NOT_ALLOWED')
    } catch {
      reasonCodes.push('INVALID_COVERAGE')
    }
  }

  if (reasonCodes.length) return rejected(commitment, coverage, reasonCodes)
  return { valid: true, code: 'OK', reasonCodes: [], commitment, coverage }
}

/**
 * Bind the authority-time receipt to the signed intent and independently grade
 * a fresh execution-time receipt. The latter commitment belongs in the final
 * evidence bundle; this helper never claims it existed at authorization time.
 */
export async function verifyHeadlessMarketStateReceiptPair(input: {
  intent: Pick<Intent, 'contextCommitments'>
  authorityReceipt: HeadlessMarketStateReceipt
  executionReceipt: HeadlessMarketStateReceipt
  key: HeadlessMarketStateKey
  authorityTime: string
  executionTime: string
  policy: HeadlessMarketStatePolicy
}): Promise<HeadlessMarketStatePairResult> {
  if (!isRecord(input)) return rejectedPair('INVALID_PAIR_INPUT')
  const authorityCommitment = await safeCommitment(input.authorityReceipt)
  let authorizationBinding: HeadlessMarketStatePairResult['authorizationBinding']
  try {
    authorizationBinding = matchUniqueContextCommitment(input.intent, authorityCommitment)
  } catch {
    authorizationBinding = { matched: false, code: 'CONTEXT_COMMITMENT_INVALID', commitment: null }
  }
  const [authority, execution] = await Promise.all([
    verifyHeadlessMarketStateReceipt(
      input.authorityReceipt,
      input.key,
      input.authorityTime,
      input.policy,
    ),
    verifyHeadlessMarketStateReceipt(
      input.executionReceipt,
      input.key,
      input.executionTime,
      input.policy,
    ),
  ])

  const reasonCodes: string[] = []
  if (!authorizationBinding.matched) reasonCodes.push(authorizationBinding.code)
  reasonCodes.push(...authority.reasonCodes.map((code) => `AUTHORITY_${code}`))
  reasonCodes.push(...execution.reasonCodes.map((code) => `EXECUTION_${code}`))
  if (
    isRecord(input.authorityReceipt)
    && isRecord(input.executionReceipt)
    && input.authorityReceipt.receipt_id === input.executionReceipt.receipt_id
  ) {
    reasonCodes.push('RECEIPTS_NOT_DISTINCT')
  }
  const authorityTime = typeof input.authorityTime === 'string' ? Date.parse(input.authorityTime) : NaN
  const executionTime = typeof input.executionTime === 'string' ? Date.parse(input.executionTime) : NaN
  if (!Number.isFinite(authorityTime) || !Number.isFinite(executionTime) || executionTime < authorityTime) {
    reasonCodes.push('INVALID_PAIR_TIMELINE')
  } else if (
    isRecord(input.executionReceipt)
    && typeof input.executionReceipt.issued_at === 'string'
    && Number.isFinite(Date.parse(input.executionReceipt.issued_at))
    && Date.parse(input.executionReceipt.issued_at) < authorityTime
  ) {
    reasonCodes.push('EXECUTION_RECEIPT_PRECEDES_AUTHORITY')
  }

  return {
    valid: reasonCodes.length === 0,
    code: reasonCodes.length === 0 ? 'OK' : 'HEADLESS_MARKET_STATE_PAIR_REJECTED',
    reasonCodes,
    authorizationBinding,
    authority,
    execution,
    executionEvidenceCommitment: execution.commitment,
  }
}

function assertReceiptShape(value: HeadlessMarketStateReceipt): void {
  if (!isRecord(value)) throw new TypeError('receipt must be an object')
  const fields: Record<string, unknown> = value
  const expectedFields: string[] = [...baseReceiptFields]
  if (Object.hasOwn(value, 'coverage')) expectedFields.push('coverage')
  if (Object.hasOwn(value, 'reason')) expectedFields.push('reason')
  const keys = Object.keys(value).sort()
  const expected = expectedFields.sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('receipt fields do not match a known v5 signed field set')
  }
  if (expected.some((field) => typeof fields[field] !== 'string' || (fields[field] as string).length === 0)) {
    throw new TypeError('receipt fields must be non-empty strings')
  }
  if (value.source === 'OVERRIDE' && !Object.hasOwn(value, 'reason')) {
    throw new TypeError('override receipt must have a signed reason')
  }
  if (Object.hasOwn(value, 'reason') && value.source !== 'OVERRIDE') {
    throw new TypeError('reason is only supported on override receipts')
  }
  if (!hex128.test((value.signature as string).toLowerCase())) throw new TypeError('signature must be 64-byte hex')
}

function validKey(key: HeadlessMarketStateKey): boolean {
  return isRecord(key)
    && key.algorithm === 'Ed25519'
    && typeof key.key_id === 'string'
    && key.key_id.length > 0
    && typeof key.public_key === 'string'
    && hex64.test(key.public_key.toLowerCase())
}

function validPolicy(policy: HeadlessMarketStatePolicy): boolean {
  return isRecord(policy)
    && typeof policy.expectedMic === 'string'
    && policy.expectedMic.length > 0
    && Array.isArray(policy.allowedStatuses)
    && policy.allowedStatuses.length > 0
    && policy.allowedStatuses.every((status: unknown) => typeof status === 'string' && status.length > 0)
    && (policy.allowedReceiptModes === undefined || (
      Array.isArray(policy.allowedReceiptModes)
      && policy.allowedReceiptModes.length > 0
      && policy.allowedReceiptModes.every((mode: unknown) => typeof mode === 'string' && mode.length > 0)
    ))
    && (policy.requiredFeedState === undefined || (typeof policy.requiredFeedState === 'string' && policy.requiredFeedState.length > 0))
    && (policy.expectedIssuer === undefined || (typeof policy.expectedIssuer === 'string' && policy.expectedIssuer.length > 0))
    && (policy.expectedSchemaVersion === undefined || (typeof policy.expectedSchemaVersion === 'string' && policy.expectedSchemaVersion.length > 0))
}

function validExpectedCommitment(value: ContextCommitment): boolean {
  return isRecord(value)
    && typeof value.namespace === 'string'
    && (value.algorithm === 'sha256' || value.algorithm === 'keccak256')
    && typeof value.digest === 'string'
    && digestHex.test(value.digest.toLowerCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function verifySignature(receipt: HeadlessMarketStateReceipt, publicKey: string): Promise<boolean> {
  try {
    const imported = await crypto.subtle.importKey(
      'raw',
      asArrayBuffer(hexToBytes(publicKey)),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      imported,
      asArrayBuffer(hexToBytes(receipt.signature)),
      asArrayBuffer(canonicalHeadlessMarketStateReceiptBytes(receipt)),
    )
  } catch {
    return false
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.toLowerCase()
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) throw new TypeError('invalid hex')
  return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function emptyCommitment(): ContextCommitment {
  return { namespace: HEADLESS_MARKET_STATE_NAMESPACE, algorithm: 'sha256', digest: `0x${'0'.repeat(64)}` }
}

async function safeCommitment(receipt: HeadlessMarketStateReceipt): Promise<ContextCommitment> {
  try {
    return await headlessMarketStateCommitment(receipt)
  } catch {
    return emptyCommitment()
  }
}

function rejected(
  commitment: ContextCommitment,
  coverage: Record<string, unknown> | null,
  reasonCodes: string[],
): HeadlessMarketStateCheck {
  return { valid: false, code: 'HEADLESS_MARKET_STATE_REJECTED', reasonCodes, commitment, coverage }
}

function rejectedPair(reasonCode: string): HeadlessMarketStatePairResult {
  const check = rejected(emptyCommitment(), null, ['INVALID_RECEIPT_SHAPE'])
  return {
    valid: false,
    code: 'HEADLESS_MARKET_STATE_PAIR_REJECTED',
    reasonCodes: [reasonCode],
    authorizationBinding: { matched: false, code: 'CONTEXT_COMMITMENT_INVALID', commitment: null },
    authority: check,
    execution: check,
    executionEvidenceCommitment: emptyCommitment(),
  }
}
