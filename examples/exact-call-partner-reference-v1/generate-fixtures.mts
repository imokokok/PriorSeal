// Generates the deterministic, synthetic inputs for the exact-call reference.
// The signing material below is deliberately public TEST material. It is not a
// secret, must never be funded, and must never be used outside this fixture.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from 'viem/accounts'
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  signReceipt,
} from '../../src/index.mjs'
import { signAuthorizationReceipt } from '../../src/domain/authorization.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const principal = privateKeyToAccount(`0x${'31'.repeat(32)}`)
const issuerSeed = '83'.repeat(32)
const issuerPrivateKeyPem = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${issuerSeed}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
}).export({ type: 'pkcs8', format: 'pem' }).toString()
const issuerPublicKeyPem = createPublicKey(issuerPrivateKeyPem)
  .export({ type: 'spki', format: 'pem' }).toString()

const issuer = 'priorseal-partner-reference-test-issuer'
const keyId = 'partner-reference-test-key-1'
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string) => sha256(readFileSync(path))

export const fixture = {
  chainId: 8453,
  executor: '0x2222222222222222222222222222222222222222',
  target: '0x3333333333333333333333333333333333333333',
  otherTarget: '0x4444444444444444444444444444444444444444',
  recipient: '0x5555555555555555555555555555555555555555',
  calldataHash: `0x${'6a'.repeat(32)}`,
  otherCalldataHash: `0x${'6b'.repeat(32)}`,
  transactionValue: '1000000000000000',
  nonce: '17',
  issuedAt: 1_000,
  acceptedAt: 1_001,
  executedAt: 1_100,
  validUntil: 2_000,
} as const

type ExecutionChanges = {
  chainId?: number
  target?: string
  calldataHash?: string
  executedAt?: number
  observedAt?: number
}

type CaseSpec = {
  id: string
  changes?: ExecutionChanges
  expected: { bound: boolean; reasonCodes: string[]; complianceStatus: string; outcome: string }
}

const contextApproval = {
  schema: 'partner.reference-approval.v1',
  decisionId: 'reference-decision-001',
  decision: 'ALLOW',
  scope: 'synthetic exact-call envelope only',
}
const mismatchedContextApproval = { ...contextApproval, decision: 'DENY' }
const contextCommitment = {
  namespace: 'partner.reference-approval.v1',
  algorithm: 'sha256' as const,
  digest: `0x${sha256(JSON.stringify(contextApproval))}`,
}

function writeJson(relativePath: string, value: unknown) {
  const path = join(directory, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function buildManifest(schema: string, componentPaths: readonly string[], extra: Record<string, unknown>, baseDirectory = '') {
  const files = Object.fromEntries(componentPaths.map((relativePath) => [relativePath, { sha256: fileHash(join(directory, baseDirectory, relativePath)) }]))
  return { schema, fixtureId: 'exact-call-partner-reference-v1', files, ...extra }
}

function buildExecution(caseId: string, changes: ExecutionChanges = {}) {
  const executedAt = changes.executedAt ?? fixture.executedAt
  return {
    schema: 'priorseal.execution-observation.v1',
    chainId: changes.chainId ?? fixture.chainId,
    txHash: `0x${sha256(`synthetic:${caseId}`)}`,
    status: 'CONFIRMED',
    blockNumber: 9_001,
    blockHash: `0x${'ac'.repeat(32)}`,
    executedAt,
    observedAt: changes.observedAt ?? executedAt + 1,
    action: 'CONTRACT_CALL',
    nonce: fixture.nonce,
    sender: fixture.executor,
    recipient: fixture.target,
    target: changes.target ?? fixture.target,
    calldataHash: changes.calldataHash ?? fixture.calldataHash,
    asset: 'eip155:8453/native',
    amount: fixture.transactionValue,
    nativeValue: fixture.transactionValue,
    tokenValue: null,
    transfers: [],
    transferMatchUnique: false,
    gasUsed: '21000',
    fee: null,
    executionDataAvailable: true,
    observationSource: 'synthetic-offline-fixture',
    finalityState: 'CONFIRMED',
    confirmations: 12,
  }
}

async function signedAuthorization() {
  const unsigned = buildAuthorization({
    intent: {
      schema: 'priorseal.intent.v2',
      executionProfile: 'priorseal.execution-profile.exact-call.v1',
      intentId: 'partner-reference-exact-call-001',
      chainId: fixture.chainId,
      action: 'CONTRACT_CALL',
      asset: 'eip155:8453/native',
      amount: fixture.transactionValue,
      sender: fixture.executor,
      recipient: fixture.recipient,
      validUntil: fixture.validUntil,
      nonce: fixture.nonce,
      callTarget: fixture.target,
      calldataHash: fixture.calldataHash,
      transactionValue: fixture.transactionValue,
      contextCommitments: [contextCommitment],
    },
    principal: { type: 'user', id: 'partner-reference-principal', account: principal.address },
    authorizer: { type: 'eip712', address: principal.address },
    delegate: { agentId: 'partner-reference-agent', executor: fixture.executor },
    issuedAt: fixture.issuedAt,
    notBefore: fixture.issuedAt,
    expiresAt: fixture.validUntil,
    authorizationNonce: `0x${'91'.repeat(32)}`,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: `0x${'00'.repeat(32)}`,
  })
  const authorization = buildAuthorization({ ...unsigned, signature: await principal.signTypedData(authorizationTypedData(unsigned)) })
  const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
    authorization,
    issuer,
    keyId,
    acceptedAt: fixture.acceptedAt,
  }), issuerPrivateKeyPem)
  return { authorization, acceptance }
}

function keyRegistry() {
  return {
    schema: 'priorseal.keys.v1',
    issuer,
    keys: [{
      issuer,
      keyId,
      algorithm: 'Ed25519',
      publicKey: issuerPublicKeyPem,
      validFrom: null,
      validUntil: null,
      status: 'active',
    }],
  }
}

export async function generateFixtures() {
  const { authorization, acceptance } = await signedAuthorization()
  const cases: CaseSpec[] = [
    { id: 'exact-match', expected: { bound: true, reasonCodes: [], complianceStatus: 'COMPLIANT', outcome: 'COMPLETED' } },
    { id: 'target-mismatch', changes: { target: fixture.otherTarget }, expected: { bound: false, reasonCodes: ['CALL_TARGET_MISMATCH'], complianceStatus: 'NON_COMPLIANT', outcome: 'COMPLETED' } },
    { id: 'calldata-mismatch', changes: { calldataHash: fixture.otherCalldataHash }, expected: { bound: false, reasonCodes: ['CALLDATA_MISMATCH'], complianceStatus: 'NON_COMPLIANT', outcome: 'COMPLETED' } },
    { id: 'chain-mismatch', changes: { chainId: 1 }, expected: { bound: false, reasonCodes: ['CHAIN_MISMATCH'], complianceStatus: 'NOT_ASSESSABLE', outcome: 'COMPLETED' } },
    { id: 'authorization-expired', changes: { executedAt: fixture.validUntil + 1 }, expected: { bound: false, reasonCodes: ['OUTSIDE_AUTHORIZATION_WINDOW', 'OUTSIDE_TIME_WINDOW'], complianceStatus: 'NON_COMPLIANT', outcome: 'COMPLETED' } },
  ]

  const receipts = Object.fromEntries(cases.map((entry) => {
    const execution = buildExecution(entry.id, entry.changes)
    const receipt = signReceipt(buildAuthorizedReceipt({
      authorization,
      acceptance,
      execution,
      issuer,
      keyId,
      issuedAt: execution.observedAt,
    }), issuerPrivateKeyPem)
    return [entry.id, receipt]
  }))

  const exactReceipt = receipts['exact-match'] as Record<string, unknown>
  const tamperedReceipt = structuredClone(exactReceipt)
  const signature = String(tamperedReceipt.signature)
  tamperedReceipt.signature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

  writeJson('fixture/authorization.json', authorization)
  writeJson('fixture/issuer-key.json', keyRegistry())
  writeJson('fixture/context-approval.json', contextApproval)
  writeJson('fixture/context-approval-mismatched.json', mismatchedContextApproval)
  for (const [id, receipt] of Object.entries(receipts)) writeJson(`fixture/receipts/${id}.json`, receipt)

  writeJson('verification-bundle/authorization.json', authorization)
  writeJson('verification-bundle/issuer-key.json', keyRegistry())
  writeJson('verification-bundle/context-approval.json', contextApproval)
  writeJson('verification-bundle/receipt.json', exactReceipt)
  writeJson('verification-bundle/receipt-tampered-signature.json', tamperedReceipt)

  const bundleComponents = [
    'authorization.json',
    'context-approval.json',
    'issuer-key.json',
    'receipt.json',
    'receipt-tampered-signature.json',
  ]
  writeJson('verification-bundle/MANIFEST.json', buildManifest('priorseal.portable-verification-bundle.manifest.v1', bundleComponents, {
    schemaVersion: 'priorseal.execution-receipt.v3',
    profile: 'priorseal.execution-profile.exact-call.v1',
    verifier: { package: 'priorseal-sdk', version: '0.11.1', surface: 'verifyReceiptLocally' },
    expected: {
      valid: true,
      code: 'OK',
      outcome: 'COMPLETED',
      executionStatus: 'CONFIRMED',
      complianceStatus: 'COMPLIANT',
      tamperedReceipt: { valid: false, code: 'INVALID_SIGNATURE' },
    },
  }, 'verification-bundle'))

  const topComponents = [
    'README.md', 'TEST-RECORD.md', 'generate-fixtures.mts', 'generate-fixtures.mjs', 'verify.mts', 'verify.mjs',
    'fixture/authorization.json', 'fixture/issuer-key.json', 'fixture/context-approval.json', 'fixture/context-approval-mismatched.json',
    ...cases.map((entry) => `fixture/receipts/${entry.id}.json`),
    'verification-bundle/MANIFEST.json',
  ].filter((path) => existsSync(join(directory, path)))
  writeJson('MANIFEST.json', buildManifest('priorseal.exact-call-partner-reference.manifest.v1', topComponents, {
    schemaVersion: 'priorseal.execution-receipt.v3',
    profile: 'priorseal.execution-profile.exact-call.v1',
    verifier: { package: 'priorseal-sdk', version: '0.11.1', surface: 'verifyReceiptLocally' },
    contextCommitment,
    cases: cases.map((entry) => ({ id: entry.id, receipt: `fixture/receipts/${entry.id}.json`, ...entry.expected })),
    contextMismatch: { document: 'fixture/context-approval-mismatched.json', code: 'CONTEXT_COMMITMENT_DIGEST_MISMATCH' },
    limits: [
      'Synthetic offline fixture only; no transaction is constructed, signed, or broadcast by this example.',
      'The public issuer key enables signature verification but does not establish issuer trust.',
      'The context document is application-owned data; PriorSeal binds only its declared digest.',
    ],
  }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateFixtures()
