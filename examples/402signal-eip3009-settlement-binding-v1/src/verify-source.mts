import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeEventLog,
  decodeFunctionData,
  hashTypedData,
  parseSignature,
  verifyTypedData,
} from 'viem'
import {
  RouteGuardError,
  verifyRoute,
  type RouteGuardOptions,
  type VerifiedRoute,
} from '../vendor/route-guard-v0.7.3.mjs'

type Manifest = typeof import('../MANIFEST.json', { with: { type: 'json' } })
type RouteContext = typeof import('../fixture/raw/route-context.json', { with: { type: 'json' } })
type SignedAuthorizations = typeof import('../fixture/generated/signed-authorizations.json', { with: { type: 'json' } })
type SettlementEvidence = typeof import('../fixture/generated/settlement-evidence.json', { with: { type: 'json' } })
type CaseDocument = typeof import('../fixture/generated/cases.json', { with: { type: 'json' } })
type Pair = SignedAuthorizations['variants'][keyof SignedAuthorizations['variants']]
type PaymentRecord = Pair['payment']
type BindingRecord = Pair['binding']
type CompletedSettlement = SettlementEvidence['matching'] | SettlementEvidence['reorg']
type SettlementVariant = 'matching' | 'timeout' | 'reorg'
type CaseVector = CaseDocument['vectors'][number]
type VerificationResult = { release: string; settlement: string; replacement: string; reason: string }
type Inputs = {
  raw: { request: string; response: string; challenge: string }
  context: RouteContext
  signed: SignedAuthorizations
  settlement: SettlementEvidence
  cases: CaseDocument
  routeLeafHash: string
}

const root = dirname(fileURLToPath(import.meta.url))
const readText = (path: string) => readFileSync(resolve(root, path), 'utf8')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson<T extends object>(path: string): T {
  const value: unknown = JSON.parse(readText(path))
  if (!isRecord(value)) throw new TypeError(`${path} must contain a JSON object`)
  return value as T
}

function responseLeafHash(text: string): string {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || !isRecord(value.pq_trust) || !isRecord(value.pq_trust.transparency)
    || !isRecord(value.pq_trust.transparency.receipt)
    || typeof value.pq_trust.transparency.receipt.leaf_hash !== 'string') {
    throw new TypeError('route response leaf hash is missing')
  }
  return value.pq_trust.transparency.receipt.leaf_hash
}

function hex(value: string, label: string): `0x${string}` {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new TypeError(`${label} must be 0x-prefixed bytes`)
  return value as `0x${string}`
}

const lower = (value: unknown) => String(value).toLowerCase()
const sameAddress = (left: unknown, right: unknown) => lower(left) === lower(right)

const paymentAbi = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'AuthorizationUsed',
    inputs: [
      { name: 'authorizer', type: 'address', indexed: true },
      { name: 'nonce', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const

const paymentTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

const bindingTypes = {
  PriorSealEip3009SettlementBinding: [
    { name: 'routeReceiptDigest', type: 'bytes32' },
    { name: 'paymentAuthorizationDigest', type: 'bytes32' },
    { name: 'authorizationNonce', type: 'bytes32' },
    { name: 'bindingNonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'audience', type: 'string' },
  ],
} as const

function paymentTypedData(record: PaymentRecord) {
  assert.equal(record.primaryType, 'TransferWithAuthorization')
  assert.deepEqual(record.types, paymentTypes)
  return {
    domain: {
      ...record.domain,
      verifyingContract: hex(record.domain.verifyingContract, 'payment verifying contract'),
    },
    types: paymentTypes,
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      ...record.message,
      from: hex(record.message.from, 'payment sender'),
      to: hex(record.message.to, 'payment recipient'),
      value: BigInt(record.message.value),
      validAfter: BigInt(record.message.validAfter),
      validBefore: BigInt(record.message.validBefore),
      nonce: hex(record.message.nonce, 'payment nonce'),
    },
  }
}

function bindingTypedData(record: BindingRecord) {
  assert.equal(record.primaryType, 'PriorSealEip3009SettlementBinding')
  assert.deepEqual(record.types, bindingTypes)
  return {
    domain: record.domain,
    types: bindingTypes,
    primaryType: 'PriorSealEip3009SettlementBinding' as const,
    message: {
      ...record.message,
      routeReceiptDigest: hex(record.message.routeReceiptDigest, 'route receipt digest'),
      paymentAuthorizationDigest: hex(record.message.paymentAuthorizationDigest, 'payment authorization digest'),
      authorizationNonce: hex(record.message.authorizationNonce, 'authorization nonce'),
      bindingNonce: hex(record.message.bindingNonce, 'binding nonce'),
      issuedAt: BigInt(record.message.issuedAt),
      expiresAt: BigInt(record.message.expiresAt),
    },
  }
}

function blocked(reason: string): VerificationResult {
  return {
    release: 'BLOCKED_BEFORE_RELEASE',
    settlement: 'NOT_CHECKED',
    replacement: 'NOT_APPLICABLE',
    reason,
  }
}

function verifyManifest(): Manifest {
  const manifest = readJson<Manifest>('MANIFEST.json')
  assert.equal(manifest.exactRunCommand, 'node verify.mjs')
  for (const entry of manifest.files) {
    assert.match(entry.path, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    const path = resolve(root, entry.path)
    assert.ok(path.startsWith(`${root}${sep}`) || path === root)
    const bytes = readFileSync(path)
    assert.equal(bytes.length, entry.bytes, `byte length: ${entry.path}`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `sha256: ${entry.path}`)
  }
  return manifest
}

function routeOptions(raw: Inputs['raw'], context: RouteContext, now: number): RouteGuardOptions {
  return {
    routeResponseJson: raw.response,
    routeRequestJson: raw.request,
    trustedLogVkey: context.trustedLogVkey,
    request: {
      url: context.sellerRequest.url,
      method: context.sellerRequest.method,
      body: Buffer.from(context.sellerRequest.bodyBase64, 'base64'),
    },
    challenge: { status: 402, bodyText: raw.challenge },
    now,
  }
}

async function verifyAuthorizationAndBinding({ pair, signed, verifiedRoute, routeDigest, now }: {
  pair: Pair
  signed: SignedAuthorizations
  verifiedRoute: VerifiedRoute
  routeDigest: `0x${string}`
  now: number
}): Promise<VerificationResult | null> {
  const paymentData = paymentTypedData(pair.payment)
  if (!(await verifyTypedData({
    ...paymentData,
    address: hex(pair.payment.message.from, 'payment sender'),
    signature: hex(pair.payment.signature, 'payment signature'),
  }))) {
    return blocked('PAYMENT_SIGNATURE_INVALID')
  }
  const paymentDigest = hashTypedData(paymentData)
  if (lower(paymentDigest) !== lower(pair.payment.digest)) return blocked('PAYMENT_DIGEST_MISMATCH')
  if (!sameAddress(pair.payment.message.from, signed.buyer)) return blocked('PAYMENT_SIGNER_MISMATCH')

  const bindingData = bindingTypedData(pair.binding)
  if (!(await verifyTypedData({
    ...bindingData,
    address: hex(pair.payment.message.from, 'payment sender'),
    signature: hex(pair.binding.signature, 'binding signature'),
  }))) {
    return blocked('BINDING_SIGNATURE_INVALID')
  }
  if (lower(hashTypedData(bindingData)) !== lower(pair.binding.digest)) return blocked('BINDING_DIGEST_MISMATCH')
  if (lower(pair.binding.message.routeReceiptDigest) !== lower(routeDigest)) return blocked('ROUTE_DIGEST_MISMATCH')
  if (lower(pair.binding.message.paymentAuthorizationDigest) !== lower(paymentDigest)) return blocked('PAYMENT_BINDING_MISMATCH')
  if (lower(pair.binding.message.authorizationNonce) !== lower(pair.payment.message.nonce)) return blocked('AUTHORIZATION_NONCE_MISMATCH')
  if (pair.binding.message.audience !== '402signal.route-binding-receipt.v1') return blocked('BINDING_AUDIENCE_MISMATCH')

  const paymentValidAfter = Number(pair.payment.message.validAfter)
  const paymentValidBefore = Number(pair.payment.message.validBefore)
  const bindingIssuedAt = Number(pair.binding.message.issuedAt)
  const bindingExpiresAt = Number(pair.binding.message.expiresAt)
  if (!Number.isSafeInteger(paymentValidAfter) || !Number.isSafeInteger(paymentValidBefore) || now <= paymentValidAfter) {
    return blocked('PAYMENT_NOT_YET_VALID')
  }
  if (now >= paymentValidBefore) return blocked('PAYMENT_AUTHORIZATION_EXPIRED')
  if (!Number.isSafeInteger(bindingIssuedAt) || !Number.isSafeInteger(bindingExpiresAt) || now < bindingIssuedAt || now >= bindingExpiresAt) {
    return blocked('BINDING_EXPIRED')
  }
  if (bindingExpiresAt > paymentValidBefore || bindingExpiresAt > verifiedRoute.expires_at) {
    return blocked('BINDING_WINDOW_TOO_WIDE')
  }

  const accepted = verifiedRoute.accepted
  if (accepted.network !== `eip155:${pair.payment.domain.chainId}`) return blocked('PAYMENT_NETWORK_MISMATCH')
  if (!sameAddress(accepted.asset, pair.payment.domain.verifyingContract)) return blocked('PAYMENT_TOKEN_MISMATCH')
  if (!sameAddress(accepted.payTo, pair.payment.message.to)) return blocked('PAYMENT_RECIPIENT_MISMATCH')
  if (BigInt(accepted.amount) !== BigInt(pair.payment.message.value)) return blocked('PAYMENT_AMOUNT_MISMATCH')
  return null
}

function verifySettlementPayload(evidence: CompletedSettlement, payment: PaymentRecord) {
  assert.equal(evidence.transaction.hash, evidence.receipt.transactionHash)
  assert.equal(evidence.receipt.status, 'success')
  assert.ok(sameAddress(evidence.transaction.to, payment.domain.verifyingContract))
  assert.ok(evidence.receipt.logs.every((log) => sameAddress(log.address, payment.domain.verifyingContract)))

  const decoded = decodeFunctionData({
    abi: paymentAbi,
    data: hex(evidence.transaction.input, 'settlement transaction input'),
  })
  assert.equal(decoded.functionName, 'transferWithAuthorization')
  const [from, to, value, validAfter, validBefore, nonce, v, r, s] = decoded.args
  const signature = parseSignature(hex(payment.signature, 'payment signature'))
  assert.ok(sameAddress(from, payment.message.from))
  assert.ok(sameAddress(to, payment.message.to))
  assert.equal(value, BigInt(payment.message.value))
  assert.equal(validAfter, BigInt(payment.message.validAfter))
  assert.equal(validBefore, BigInt(payment.message.validBefore))
  assert.equal(lower(nonce), lower(payment.message.nonce))
  assert.equal(Number(v), Number(signature.yParity) + 27)
  assert.equal(lower(r), lower(signature.r))
  assert.equal(lower(s), lower(signature.s))

  const events = evidence.receipt.logs.map((log) => decodeEventLog({
    abi: paymentAbi,
    data: hex(log.data, 'settlement log data'),
    topics: log.topics.map((topic) => hex(topic, 'settlement log topic')) as [`0x${string}`, ...`0x${string}`[]],
    strict: true,
  }))
  const used = events.find((event) => event.eventName === 'AuthorizationUsed')
  const transfer = events.find((event) => event.eventName === 'Transfer')
  assert.ok(used)
  assert.ok(transfer)
  assert.ok(sameAddress(used.args.authorizer, payment.message.from))
  assert.equal(lower(used.args.nonce), lower(payment.message.nonce))
  assert.ok(sameAddress(transfer.args.from, payment.message.from))
  assert.ok(sameAddress(transfer.args.to, payment.message.to))
  assert.equal(transfer.args.value, BigInt(payment.message.value))
}

function settlementOutcome(
  variant: SettlementVariant,
  evidence: SettlementEvidence[SettlementVariant],
  payment: PaymentRecord,
): Omit<VerificationResult, 'release'> {
  if (variant === 'timeout') {
    assert.ok('submission' in evidence)
    assert.equal(evidence.submission.outcome, 'timeout')
    assert.equal(evidence.receipt, null)
    assert.equal(evidence.authorizationState, 'unknown')
    return { settlement: 'SETTLEMENT_PENDING', replacement: 'BLOCKED', reason: 'RECONCILIATION_REQUIRED' }
  }

  assert.ok('transaction' in evidence && evidence.receipt && evidence.canonicalBlock)
  const completed = evidence as CompletedSettlement
  verifySettlementPayload(completed, payment)
  assert.equal(completed.receipt.blockHash, completed.canonicalBlock.hash)
  assert.equal(completed.receipt.blockNumber, completed.canonicalBlock.number)

  if (variant === 'reorg') {
    assert.ok('previouslyMatched' in completed)
    assert.equal(completed.previouslyMatched, true)
    assert.equal(completed.canonicalBlock.canonical, false)
    return { settlement: 'REORGED', replacement: 'BLOCKED', reason: 'REORG_RECONCILIATION_REQUIRED' }
  }

  assert.equal(variant, 'matching')
  assert.equal(completed.canonicalBlock.canonical, true)
  assert.ok(completed.canonicalBlock.confirmations >= completed.canonicalBlock.requiredConfirmations)
  assert.ok(Number(completed.canonicalBlock.timestamp) > Number(payment.message.validAfter))
  assert.ok(Number(completed.canonicalBlock.timestamp) < Number(payment.message.validBefore))
  assert.equal(completed.authorizationState, true)
  return { settlement: 'SETTLED_CONFIRMED', replacement: 'NOT_REQUIRED', reason: 'OK' }
}

function releasePaymentPayload(pair: Pair, verifiedRoute: VerifiedRoute) {
  assert.equal(pair.wire.headerName, 'PAYMENT-SIGNATURE')
  assert.match(pair.wire.headerValue, /^[A-Za-z0-9+/]+={0,2}$/)
  const bytes = Buffer.from(pair.wire.headerValue, 'base64')
  assert.equal(bytes.toString('base64'), pair.wire.headerValue)
  const payload: unknown = JSON.parse(bytes.toString('utf8'))
  assert.ok(isRecord(payload) && isRecord(payload.payload))
  assert.equal(payload.x402Version, 2)
  assert.deepEqual(payload.accepted, verifiedRoute.accepted)
  assert.deepEqual(payload.payload.authorization, pair.payment.message)
  assert.equal(payload.payload.signature, pair.payment.signature)
  return pair.wire
}

async function evaluate(vector: CaseVector, inputs: Inputs): Promise<VerificationResult> {
  let releaseCalls = 0
  const finish = (result: VerificationResult): VerificationResult => {
    assert.equal(releaseCalls, result.release === 'PAYLOAD_RELEASED' ? 1 : 0, `${vector.id}: release call count`)
    return result
  }
  let verifiedRoute: VerifiedRoute
  try {
    verifiedRoute = verifyRoute(routeOptions(inputs.raw, inputs.context, vector.now))
  } catch (error) {
    if (error instanceof RouteGuardError && error.code === 'quote_expired') return finish(blocked('ROUTE_EVIDENCE_EXPIRED'))
    throw error
  }

  if (!(vector.paymentVariant in inputs.signed.variants)) throw new Error(`unknown payment variant: ${vector.paymentVariant}`)
  const paymentVariant = vector.paymentVariant as keyof SignedAuthorizations['variants']
  const pair = structuredClone(inputs.signed.variants[paymentVariant]) as Pair
  if (vector.mutation?.paymentValue) pair.payment.message.value = vector.mutation.paymentValue
  const preReleaseFailure = await verifyAuthorizationAndBinding({
    pair,
    signed: inputs.signed,
    verifiedRoute,
    routeDigest: hex(`0x${inputs.routeLeafHash}`, 'route receipt digest'),
    now: vector.now,
  })
  if (preReleaseFailure) return finish(preReleaseFailure)

  if (vector.preReleaseState?.authorizationUsed) return finish(blocked('AUTHORIZATION_ALREADY_USED'))
  if (vector.preReleaseState?.bindingNonceSeen) return finish(blocked('BINDING_NONCE_ALREADY_USED'))

  if (!vector.settlementVariant) {
    throw new Error(`case ${vector.id} passed the release gate unexpectedly`)
  }
  releasePaymentPayload(pair, verifiedRoute)
  releaseCalls += 1
  if (!['matching', 'timeout', 'reorg'].includes(vector.settlementVariant)) {
    throw new Error(`unknown settlement variant: ${vector.settlementVariant}`)
  }
  const settlementVariant = vector.settlementVariant as SettlementVariant
  const outcome = settlementOutcome(
    settlementVariant,
    inputs.settlement[settlementVariant],
    pair.payment,
  )
  return finish({ release: 'PAYLOAD_RELEASED', ...outcome })
}

const manifest = verifyManifest()
const rawResponse = readText('fixture/raw/route-response.json')
const inputs: Inputs = {
  raw: {
    request: readText('fixture/raw/route-request.json'),
    response: rawResponse,
    challenge: readText('fixture/raw/seller-challenge.json'),
  },
  context: readJson<RouteContext>('fixture/raw/route-context.json'),
  signed: readJson<SignedAuthorizations>('fixture/generated/signed-authorizations.json'),
  settlement: readJson<SettlementEvidence>('fixture/generated/settlement-evidence.json'),
  cases: readJson<CaseDocument>('fixture/generated/cases.json'),
  routeLeafHash: responseLeafHash(rawResponse),
}

assert.equal(inputs.signed.privateKeyIncluded, false)
assert.equal(inputs.cases.categories, 6)
assert.equal(inputs.cases.vectors.length, 9)
assert.equal(inputs.routeLeafHash, inputs.context.expectedLeafHash)
assert.equal(inputs.signed.routeReceiptDigest, `0x${inputs.routeLeafHash}`)

const results = []
for (const vector of inputs.cases.vectors) {
  const actual = await evaluate(vector, inputs)
  assert.deepEqual(actual, vector.expected, vector.id)
  results.push({ id: vector.id, ...actual })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    profile: manifest.profile,
    routeLeafHash: inputs.routeLeafHash,
    buyer: inputs.signed.buyer,
    passed: results.length,
    total: inputs.cases.vectors.length,
    results,
  }, null, 2))
} else {
  for (const result of results) {
    console.log(`PASS ${result.id} release=${result.release} settlement=${result.settlement} replacement=${result.replacement} reason=${result.reason}`)
  }
  console.log(`SUMMARY ${results.length}/${inputs.cases.vectors.length} PASS`)
}
