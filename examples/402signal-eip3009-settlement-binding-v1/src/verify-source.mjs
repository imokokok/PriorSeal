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
import { RouteGuardError, verifyRoute } from '../vendor/route-guard-v0.7.3.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const readText = (path) => readFileSync(resolve(root, path), 'utf8')
const readJson = (path) => JSON.parse(readText(path))
const lower = (value) => String(value).toLowerCase()
const sameAddress = (left, right) => lower(left) === lower(right)

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
]

function paymentTypedData(record) {
  return {
    domain: record.domain,
    types: record.types,
    primaryType: record.primaryType,
    message: {
      ...record.message,
      value: BigInt(record.message.value),
      validAfter: BigInt(record.message.validAfter),
      validBefore: BigInt(record.message.validBefore),
    },
  }
}

function bindingTypedData(record) {
  return {
    domain: record.domain,
    types: record.types,
    primaryType: record.primaryType,
    message: {
      ...record.message,
      issuedAt: BigInt(record.message.issuedAt),
      expiresAt: BigInt(record.message.expiresAt),
    },
  }
}

function blocked(reason) {
  return {
    release: 'BLOCKED_BEFORE_RELEASE',
    settlement: 'NOT_CHECKED',
    replacement: 'NOT_APPLICABLE',
    reason,
  }
}

function verifyManifest() {
  const manifest = readJson('MANIFEST.json')
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

function routeOptions(raw, context, now) {
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

async function verifyAuthorizationAndBinding({ pair, signed, verifiedRoute, routeDigest, now }) {
  const paymentData = paymentTypedData(pair.payment)
  if (!(await verifyTypedData({ ...paymentData, address: pair.payment.message.from, signature: pair.payment.signature }))) {
    return blocked('PAYMENT_SIGNATURE_INVALID')
  }
  const paymentDigest = hashTypedData(paymentData)
  if (lower(paymentDigest) !== lower(pair.payment.digest)) return blocked('PAYMENT_DIGEST_MISMATCH')
  if (!sameAddress(pair.payment.message.from, signed.buyer)) return blocked('PAYMENT_SIGNER_MISMATCH')

  const bindingData = bindingTypedData(pair.binding)
  if (!(await verifyTypedData({ ...bindingData, address: pair.payment.message.from, signature: pair.binding.signature }))) {
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

function verifySettlementPayload(evidence, payment) {
  assert.equal(evidence.transaction.hash, evidence.receipt.transactionHash)
  assert.equal(evidence.receipt.status, 'success')
  assert.ok(sameAddress(evidence.transaction.to, payment.domain.verifyingContract))
  assert.ok(evidence.receipt.logs.every((log) => sameAddress(log.address, payment.domain.verifyingContract)))

  const decoded = decodeFunctionData({ abi: paymentAbi, data: evidence.transaction.input })
  assert.equal(decoded.functionName, 'transferWithAuthorization')
  const [from, to, value, validAfter, validBefore, nonce, v, r, s] = decoded.args
  const signature = parseSignature(payment.signature)
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
    data: log.data,
    topics: log.topics,
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

function settlementOutcome(variant, evidence, payment) {
  if (variant === 'timeout') {
    assert.equal(evidence.submission.outcome, 'timeout')
    assert.equal(evidence.receipt, null)
    assert.equal(evidence.authorizationState, 'unknown')
    return { settlement: 'SETTLEMENT_PENDING', replacement: 'BLOCKED', reason: 'RECONCILIATION_REQUIRED' }
  }

  verifySettlementPayload(evidence, payment)
  assert.equal(evidence.receipt.blockHash, evidence.canonicalBlock.hash)
  assert.equal(evidence.receipt.blockNumber, evidence.canonicalBlock.number)

  if (variant === 'reorg') {
    assert.equal(evidence.previouslyMatched, true)
    assert.equal(evidence.canonicalBlock.canonical, false)
    return { settlement: 'REORGED', replacement: 'BLOCKED', reason: 'REORG_RECONCILIATION_REQUIRED' }
  }

  assert.equal(variant, 'matching')
  assert.equal(evidence.canonicalBlock.canonical, true)
  assert.ok(evidence.canonicalBlock.confirmations >= evidence.canonicalBlock.requiredConfirmations)
  assert.ok(Number(evidence.canonicalBlock.timestamp) > Number(payment.message.validAfter))
  assert.ok(Number(evidence.canonicalBlock.timestamp) < Number(payment.message.validBefore))
  assert.equal(evidence.authorizationState, true)
  return { settlement: 'SETTLED_CONFIRMED', replacement: 'NOT_REQUIRED', reason: 'OK' }
}

function releasePaymentPayload(pair, verifiedRoute) {
  assert.equal(pair.wire.headerName, 'PAYMENT-SIGNATURE')
  assert.match(pair.wire.headerValue, /^[A-Za-z0-9+/]+={0,2}$/)
  const bytes = Buffer.from(pair.wire.headerValue, 'base64')
  assert.equal(bytes.toString('base64'), pair.wire.headerValue)
  const payload = JSON.parse(bytes.toString('utf8'))
  assert.equal(payload.x402Version, 2)
  assert.deepEqual(payload.accepted, verifiedRoute.accepted)
  assert.deepEqual(payload.payload.authorization, pair.payment.message)
  assert.equal(payload.payload.signature, pair.payment.signature)
  return pair.wire
}

async function evaluate(vector, inputs) {
  let releaseCalls = 0
  const finish = (result) => {
    assert.equal(releaseCalls, result.release === 'PAYLOAD_RELEASED' ? 1 : 0, `${vector.id}: release call count`)
    return result
  }
  let verifiedRoute
  try {
    verifiedRoute = verifyRoute(routeOptions(inputs.raw, inputs.context, vector.now))
  } catch (error) {
    if (error instanceof RouteGuardError && error.code === 'quote_expired') return finish(blocked('ROUTE_EVIDENCE_EXPIRED'))
    throw error
  }

  const pair = structuredClone(inputs.signed.variants[vector.paymentVariant])
  if (vector.mutation?.paymentValue) pair.payment.message.value = vector.mutation.paymentValue
  const preReleaseFailure = await verifyAuthorizationAndBinding({
    pair,
    signed: inputs.signed,
    verifiedRoute,
    routeDigest: `0x${inputs.routeLeafHash}`,
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
  const outcome = settlementOutcome(
    vector.settlementVariant,
    inputs.settlement[vector.settlementVariant],
    pair.payment,
  )
  return finish({ release: 'PAYLOAD_RELEASED', ...outcome })
}

const manifest = verifyManifest()
const inputs = {
  raw: {
    request: readText('fixture/raw/route-request.json'),
    response: readText('fixture/raw/route-response.json'),
    challenge: readText('fixture/raw/seller-challenge.json'),
  },
  context: readJson('fixture/raw/route-context.json'),
  signed: readJson('fixture/generated/signed-authorizations.json'),
  settlement: readJson('fixture/generated/settlement-evidence.json'),
  cases: readJson('fixture/generated/cases.json'),
}

inputs.routeLeafHash = JSON.parse(inputs.raw.response).pq_trust.transparency.receipt.leaf_hash

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
