import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseSignature,
  stringToHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const raw = resolve(root, 'fixture', 'raw')
const generated = resolve(root, 'fixture', 'generated')
mkdirSync(generated, { recursive: true })

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const response = readJson(resolve(raw, 'route-response.json'))
const challenge = readJson(resolve(raw, 'seller-challenge.json'))
const context = readJson(resolve(raw, 'route-context.json'))
const accepted = challenge.accepts[0]

const privateKey = generatePrivateKey()
const buyer = privateKeyToAccount(privateKey)
const routeReceiptDigest = `0x${context.expectedLeafHash}`
const routeExpiresAt = response.decision_binding.expires_at
const paymentValidAfter = response.decision_binding.observed_at - 10
const paymentValidBefore = routeExpiresAt + 60

const paymentTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

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
}

const paymentDomain = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: accepted.asset,
}

const bindingDomain = {
  name: 'PriorSeal EIP-3009 Settlement Binding',
  version: '1',
  chainId: 8453,
}

const typedPayment = (message) => ({
  domain: paymentDomain,
  types: paymentTypes,
  primaryType: 'TransferWithAuthorization',
  message,
})

const typedBinding = (message) => ({
  domain: bindingDomain,
  types: bindingTypes,
  primaryType: 'PriorSealEip3009SettlementBinding',
  message,
})

async function signedPair({ to, value, authorizationNonce, bindingNonce }) {
  const paymentMessage = {
    from: buyer.address,
    to,
    value,
    validAfter: paymentValidAfter,
    validBefore: paymentValidBefore,
    nonce: authorizationNonce,
  }
  const paymentTypedData = typedPayment(paymentMessage)
  const paymentAuthorizationDigest = hashTypedData(paymentTypedData)
  const paymentSignature = await buyer.signTypedData(paymentTypedData)
  const wireAuthorization = Object.fromEntries(Object.entries(paymentMessage).map(([key, entry]) => [key, typeof entry === 'bigint' ? entry.toString() : entry]))
  const paymentPayload = {
    x402Version: 2,
    accepted,
    payload: { authorization: wireAuthorization, signature: paymentSignature },
  }
  const bindingMessage = {
    routeReceiptDigest,
    paymentAuthorizationDigest,
    authorizationNonce,
    bindingNonce,
    issuedAt: context.evaluationNow,
    expiresAt: routeExpiresAt,
    audience: '402signal.route-binding-receipt.v1',
  }
  const bindingTypedData = typedBinding(bindingMessage)
  return {
    payment: {
      ...paymentTypedData,
      message: wireAuthorization,
      digest: paymentAuthorizationDigest,
      signature: paymentSignature,
    },
    binding: {
      ...bindingTypedData,
      message: Object.fromEntries(Object.entries(bindingMessage).map(([key, entry]) => [key, typeof entry === 'bigint' ? entry.toString() : entry])),
      digest: hashTypedData(bindingTypedData),
      signature: await buyer.signTypedData(bindingTypedData),
    },
    wire: {
      headerName: 'PAYMENT-SIGNATURE',
      headerValue: Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
    },
  }
}

const matching = await signedPair({
  to: accepted.payTo,
  value: BigInt(accepted.amount),
  authorizationNonce: `0x${'11'.repeat(32)}`,
  bindingNonce: `0x${'a1'.repeat(32)}`,
})
const recipientMismatch = await signedPair({
  to: '0x2222222222222222222222222222222222222222',
  value: BigInt(accepted.amount),
  authorizationNonce: `0x${'22'.repeat(32)}`,
  bindingNonce: `0x${'a2'.repeat(32)}`,
})
const amountMismatch = await signedPair({
  to: accepted.payTo,
  value: BigInt(accepted.amount) + 1n,
  authorizationNonce: `0x${'33'.repeat(32)}`,
  bindingNonce: `0x${'a3'.repeat(32)}`,
})

const authorizationAbi = [
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

const parsed = parseSignature(matching.payment.signature)
const callArgs = [
  matching.payment.message.from,
  matching.payment.message.to,
  BigInt(matching.payment.message.value),
  BigInt(matching.payment.message.validAfter),
  BigInt(matching.payment.message.validBefore),
  matching.payment.message.nonce,
  Number(parsed.yParity) + 27,
  parsed.r,
  parsed.s,
]
const transactionHash = keccak256(stringToHex(`synthetic-402signal-eip3009-${randomBytes(16).toString('hex')}`))
const blockHash = keccak256(stringToHex(`synthetic-block-${randomBytes(16).toString('hex')}`))
const blockNumber = 37_000_000
const transaction = {
  hash: transactionHash,
  from: '0xfaC0000000000000000000000000000000000001',
  to: accepted.asset,
  input: encodeFunctionData({
    abi: authorizationAbi,
    functionName: 'transferWithAuthorization',
    args: callArgs,
  }),
}
const receipt = {
  transactionHash,
  status: 'success',
  blockNumber,
  blockHash,
  logs: [
    {
      address: accepted.asset,
      topics: encodeEventTopics({
        abi: authorizationAbi,
        eventName: 'AuthorizationUsed',
        args: { authorizer: matching.payment.message.from, nonce: matching.payment.message.nonce },
      }),
      data: '0x',
    },
    {
      address: accepted.asset,
      topics: encodeEventTopics({
        abi: authorizationAbi,
        eventName: 'Transfer',
        args: { from: matching.payment.message.from, to: matching.payment.message.to },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(matching.payment.message.value)]),
    },
  ],
}
const canonicalBlock = {
  number: blockNumber,
  hash: blockHash,
  timestamp: context.evaluationNow + 8,
  canonical: true,
  confirmations: 12,
  requiredConfirmations: 12,
}

const signed = {
  schema: 'priorseal.eip3009-settlement-binding-fixtures.v1',
  nonproduction: true,
  privateKeyIncluded: false,
  buyer: buyer.address,
  routeReceiptDigest,
  variants: { matching, recipientMismatch, amountMismatch },
}
const settlement = {
  schema: 'priorseal.synthetic-eip3009-settlement-evidence.v1',
  nonproduction: true,
  matching: { transaction, receipt, canonicalBlock, authorizationState: true },
  timeout: {
    submission: { transactionHash, outcome: 'timeout' },
    receipt: null,
    canonicalBlock: null,
    authorizationState: 'unknown',
  },
  reorg: {
    transaction,
    receipt,
    canonicalBlock: { ...canonicalBlock, canonical: false, confirmations: 0 },
    authorizationState: 'unknown',
    previouslyMatched: true,
  },
}

const normalNow = context.evaluationNow
const cases = {
  schema: 'priorseal.402signal-eip3009-offline-cases.v1',
  categories: 6,
  vectors: [
    {
      id: 'matching',
      paymentVariant: 'matching',
      now: normalNow,
      settlementVariant: 'matching',
      expected: { release: 'PAYLOAD_RELEASED', settlement: 'SETTLED_CONFIRMED', replacement: 'NOT_REQUIRED', reason: 'OK' },
    },
    {
      id: 'changed-terms',
      paymentVariant: 'matching',
      now: normalNow,
      mutation: { paymentValue: (BigInt(accepted.amount) + 1n).toString() },
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'PAYMENT_SIGNATURE_INVALID' },
    },
    {
      id: 'authorization-nonce-replay',
      paymentVariant: 'matching',
      now: normalNow,
      preReleaseState: { authorizationUsed: true, bindingNonceSeen: false },
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'AUTHORIZATION_ALREADY_USED' },
    },
    {
      id: 'binding-nonce-replay',
      paymentVariant: 'matching',
      now: normalNow,
      preReleaseState: { authorizationUsed: false, bindingNonceSeen: true },
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'BINDING_NONCE_ALREADY_USED' },
    },
    {
      id: 'timeout-reconciliation',
      paymentVariant: 'matching',
      now: normalNow,
      settlementVariant: 'timeout',
      expected: { release: 'PAYLOAD_RELEASED', settlement: 'SETTLEMENT_PENDING', replacement: 'BLOCKED', reason: 'RECONCILIATION_REQUIRED' },
    },
    {
      id: 'reorg-reconciliation',
      paymentVariant: 'matching',
      now: normalNow,
      settlementVariant: 'reorg',
      expected: { release: 'PAYLOAD_RELEASED', settlement: 'REORGED', replacement: 'BLOCKED', reason: 'REORG_RECONCILIATION_REQUIRED' },
    },
    {
      id: 'signed-recipient-mismatch',
      paymentVariant: 'recipientMismatch',
      now: normalNow,
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'PAYMENT_RECIPIENT_MISMATCH' },
    },
    {
      id: 'signed-amount-mismatch',
      paymentVariant: 'amountMismatch',
      now: normalNow,
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'PAYMENT_AMOUNT_MISMATCH' },
    },
    {
      id: 'expired-route-valid-payment',
      paymentVariant: 'matching',
      now: routeExpiresAt,
      expected: { release: 'BLOCKED_BEFORE_RELEASE', settlement: 'NOT_CHECKED', replacement: 'NOT_APPLICABLE', reason: 'ROUTE_EVIDENCE_EXPIRED' },
    },
  ],
}

const writeJson = (name, value) => {
  writeFileSync(resolve(generated, name), `${JSON.stringify(value, null, 2)}\n`)
}

writeJson('signed-authorizations.json', signed)
writeJson('settlement-evidence.json', settlement)
writeJson('cases.json', cases)
console.log(`Generated public-only signed fixtures for ${buyer.address}; the private key was not written.`)
