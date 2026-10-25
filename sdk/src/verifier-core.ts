import type { Intent, KeyEntry, Receipt, TimestampPolicy, VerificationResult } from './types.js'
import { verifyTypedData } from 'viem'
import { solanaAuthorizationMessage, SOLANA_MAINNET_CAIP2, SOLANA_TRANSACTION_PROFILE } from './solana-transaction.js'
import { HYPERLIQUID_MAINNET_CHAIN_REF, HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS, HYPERLIQUID_OUTCOME_ASSET_ID_MIN, HYPERLIQUID_SPOT_IOC_ACTION, HYPERLIQUID_SPOT_IOC_PROFILE } from './hyperliquid-spot.js'

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const addressPattern = /^0x[0-9a-f]{40}$/
const uintPattern = /^(0|[1-9][0-9]*)$/
const hashPattern = /^[0-9a-f]{64}$/
const authorizedReceiptFields = ['algorithm', 'authorizationEvidence', 'authorizationHash', 'binding', 'compliance', 'domain', 'execution', 'executionHash', 'executionStatus', 'intentHash', 'issuedAt', 'issuer', 'keyId', 'outcome', 'reasonCodes', 'receiptId', 'schema', 'signature', 'validUntil', 'verifierVersion']
const legacyReceiptFields = ['algorithm', 'binding', 'domain', 'execution', 'executionHash', 'intentHash', 'issuedAt', 'issuer', 'keyId', 'outcome', 'reasonCodes', 'receiptId', 'schema', 'signature', 'validUntil', 'verifierVersion']
const authorizationFields = ['audience', 'authorizationId', 'authorizationNonce', 'authorizer', 'delegate', 'domain', 'expiresAt', 'intent', 'intentHash', 'issuedAt', 'maxUses', 'notBefore', 'policyHash', 'principal', 'schema', 'signature']
const intentFields = ['action', 'amount', 'asset', 'calldataHash', 'chainId', 'chainRef', 'chainIds', 'constraints', 'contextCommitments', 'entryPoint', 'entryPointCodeHash', 'entryPointVersion', 'executionProfile', 'intentHash', 'intentId', 'nonce', 'recipient', 'schema', 'sender', 'transactionValue', 'userOperationHash', 'validUntil', 'callTarget', 'accountCallProfile', 'accountCallTarget', 'accountCallValue', 'accountCallDataHash', 'solanaTransaction', 'hyperliquidOrder']

function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not valid canonical JSON')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number is not valid canonical JSON')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => {
    if (forbidden.has(key)) throw new TypeError('unsafe canonical JSON key')
    return `${JSON.stringify(key)}:${canonicalize(object[key])}`
  }).join(',')}}`
}

function decodeBase64(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function publicKeyBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  if (!encoded) throw new TypeError('Public key PEM is empty')
  return decodeBase64(encoded)
}

export async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyReceiptOffline(receipt: Receipt, key: KeyEntry, now = Math.floor(Date.now() / 1000), expectedAudience = 'priorseal'): Promise<VerificationResult> {
  const fail = (code: string): VerificationResult => ({ valid: false, code, ...receiptResultFields(receipt) })
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return fail('INVALID_RECEIPT')
    if (!receipt.signature) return fail('MISSING_SIGNATURE')
    if (['priorseal.execution-receipt.v2', 'priorseal.execution-receipt.v3'].includes(receipt.schema)) return await verifyAuthorizedReceiptOffline(receipt, key, now, expectedAudience)
    if (receipt.schema !== 'priorseal.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA')
    if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM')
    if (receipt.domain !== 'priorseal/execution-receipt/v1') return fail('INVALID_DOMAIN')
    if (!hasOnlyFields(receipt, legacyReceiptFields)) return fail('INVALID_RECEIPT')
    if (!key || key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY')
    if (!validTrustedKey(key) || key.issuer !== receipt.issuer) return fail('INVALID_KEY')
    if (key.validFrom != null && receipt.issuedAt < key.validFrom) return fail('KEY_NOT_YET_VALID')
    if (key.validUntil != null && receipt.issuedAt > key.validUntil) return fail('KEY_EXPIRED')
    if (receipt.issuedAt > now) return fail('NOT_YET_VALID')
    if (!validReceiptTimeline(receipt)) return fail('INVALID_RECEIPT_TIMELINE')
    if (!await verifyEd25519(receipt, key.publicKey)) return fail('INVALID_SIGNATURE')
    if (receipt.executionHash !== await hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH')
    const expectedReceiptId = `psr_${(await hashJson({ intentHash: receipt.intentHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId })).slice(0, 32)}`
    if (receipt.receiptId !== expectedReceiptId) return fail('RECEIPT_ID_MISMATCH')
    return { valid: true, code: 'OK', ...receiptResultFields(receipt) }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotSupportedError') return fail('UNSUPPORTED_CRYPTO')
    return fail('INVALID_RECEIPT')
  }
}

export type TimestampProofResult = { status: 'VALID' | 'INVALID' | 'MISSING' | 'NOT_REQUIRED'; code: string }

export async function verifyTimestampProofOffline(receipt: Receipt): Promise<TimestampProofResult> {
  const evidence = receipt.authorizationEvidence
  const timestamp = evidence?.timestamp
  const policy = evidence?.policy?.document?.timestampPolicy as TimestampPolicy | undefined
  if (!policy) return timestamp ? { status: 'INVALID', code: 'TIMESTAMP_POLICY_MISMATCH' } : { status: 'NOT_REQUIRED', code: 'TIMESTAMP_NOT_REQUIRED' }
  if (!timestamp || !evidence?.authorization || !evidence.acceptance) return { status: 'MISSING', code: 'INVALID_TIMESTAMP_EVIDENCE' }
  try {
    const authorizationHash = await hashJson(evidence.authorization)
    const { verifyTimestampEvidence } = await import('../../src/domain/rfc3161.mjs')
    const result = await verifyTimestampEvidence(timestamp, new TextEncoder().encode(canonicalize(evidence.authorization)), policy, {
      authorizationHash,
      requestedAt: evidence.acceptance.acceptedAt,
      before: receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0,
    })
    return result.valid ? { status: 'VALID', code: 'OK' } : { status: 'INVALID', code: result.code }
  } catch {
    return { status: 'INVALID', code: 'INVALID_TIMESTAMP_EVIDENCE' }
  }
}

async function verifyAuthorizedReceiptOffline(receipt: Receipt, key: KeyEntry, now: number, expectedAudience: string): Promise<VerificationResult> {
  const fail = (code: string): VerificationResult => ({ valid: false, code, ...receiptResultFields(receipt) })
  if (!hasOnlyFields(receipt, authorizedReceiptFields)) return fail('INVALID_RECEIPT')
  const evidence = receipt.authorizationEvidence
  if (!evidence?.authorization || !evidence.acceptance) return fail('MISSING_AUTHORIZATION_EVIDENCE')
  if (!hasOnlyFields(evidence, ['acceptance', 'authorization', 'policy', 'timestamp', 'transparency', 'witnesses'])) return fail('INVALID_RECEIPT')
  const authorization = evidence.authorization
  const acceptance = evidence.acceptance
  const receiptV3 = receipt.schema === 'priorseal.execution-receipt.v3'
  if (receipt.domain !== (receiptV3 ? 'priorseal/execution-receipt/v3' : 'priorseal/execution-receipt/v2') || receipt.algorithm !== 'Ed25519') return fail('INVALID_DOMAIN')
  if (!receiptV3 && (receipt.executionStatus !== undefined || receipt.compliance !== undefined)) return fail('INVALID_RECEIPT')
  if (!validAuthorizationShape(authorization)) return fail('INVALID_AUTHORIZATION')
  if (!validTemporalEvidence(authorization.intent, receipt.execution)) return fail('INVALID_TEMPORAL_EVIDENCE')
  if (authorization.audience !== expectedAudience) return fail('AUTHORIZATION_AUDIENCE_MISMATCH')
  if (authorization.notBefore < authorization.issuedAt || authorization.expiresAt < authorization.notBefore || authorization.expiresAt > authorization.intent.validUntil) return fail('INVALID_AUTHORIZATION')
  if (!validAcceptanceShape(acceptance) || acceptance.schema !== 'priorseal.authorization-receipt.v1' || acceptance.domain !== 'priorseal/authorization-receipt/v1' || acceptance.status !== 'ACCEPTED' || acceptance.algorithm !== 'Ed25519') return fail('INVALID_AUTHORIZATION_RECEIPT')
  if (acceptance.intentHash !== authorization.intentHash || acceptance.acceptedAt < authorization.notBefore || acceptance.acceptedAt > authorization.expiresAt || authorization.issuedAt > acceptance.acceptedAt || receipt.issuedAt < acceptance.acceptedAt) return fail('INVALID_AUTHORIZATION_RECEIPT')
  if (!key || key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY')
  if (!validTrustedKey(key) || key.issuer !== receipt.issuer) return fail('INVALID_KEY')
  if (key.validFrom != null && (acceptance.acceptedAt < key.validFrom || receipt.issuedAt < key.validFrom)) return fail('KEY_NOT_YET_VALID')
  if (key.validUntil != null && (acceptance.acceptedAt > key.validUntil || receipt.issuedAt > key.validUntil)) return fail('KEY_EXPIRED')
  if (receipt.issuedAt > now) return fail('NOT_YET_VALID')
  if (!validReceiptTimeline(receipt) || receipt.validUntil !== authorization.intent.validUntil) return fail(receipt.validUntil !== authorization.intent.validUntil ? 'VALID_UNTIL_MISMATCH' : 'INVALID_RECEIPT_TIMELINE')
  if (!await verifyEd25519(receipt, key.publicKey)) return fail('INVALID_SIGNATURE')
  if (authorization.intentHash !== await hashJson(stripIntentHash(authorization.intent))) return fail('INTENT_HASH_MISMATCH')
  const expectedAuthorizationId = `auth_${(await hashJson(stripAuthorizationMetadata(authorization))).slice(0, 32)}`
  if (authorization.authorizationId !== expectedAuthorizationId) return fail('AUTHORIZATION_ID_MISMATCH')
  const authorizationHash = await hashJson(authorization)
  if (receipt.authorizationHash !== authorizationHash || acceptance.authorizationHash !== authorizationHash || acceptance.authorizationId !== authorization.authorizationId) return fail('AUTHORIZATION_HASH_MISMATCH')
  if (!await verifyPolicyEvidence(authorization, evidence.policy, acceptance.acceptedAt)) return fail('INVALID_POLICY_EVIDENCE')
  const timestampPolicy = evidence.policy.document?.timestampPolicy as TimestampPolicy | undefined
  if (timestampPolicy) {
    const { verifyTimestampEvidence } = await import('../../src/domain/rfc3161.mjs')
    const timestamped = await verifyTimestampEvidence(evidence.timestamp, new TextEncoder().encode(canonicalize(authorization)), timestampPolicy, { authorizationHash, requestedAt: acceptance.acceptedAt, before: receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0 })
    if (!timestamped.valid) return fail(timestamped.code)
  } else if (evidence.timestamp) return fail('TIMESTAMP_POLICY_MISMATCH')
  const witnessPolicy = evidence.policy.document?.witnessQuorum as Record<string, unknown> | undefined
  if (witnessPolicy) {
    const witnessed = await verifyWitnessEvidence(evidence.witnesses, authorization, acceptance.acceptedAt, receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0, witnessPolicy)
    if (!witnessed) return fail('WITNESS_QUORUM_NOT_MET')
  } else if (evidence.witnesses) return fail('WITNESS_POLICY_MISMATCH')
  if (receipt.intentHash !== authorization.intentHash) return fail('INTENT_HASH_MISMATCH')
  if (receipt.executionHash !== await hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH')
  const expectedEntryHash = await hashJson({ sequence: acceptance.sequence, authorizationHash: acceptance.authorizationHash, acceptedAt: acceptance.acceptedAt, previousEntryHash: acceptance.previousEntryHash })
  if (acceptance.entryHash !== expectedEntryHash) return fail('AUTHORIZATION_RECEIPT_MISMATCH')
  if (acceptance.issuer !== receipt.issuer || acceptance.keyId !== receipt.keyId || !await verifyEd25519(acceptance, key.publicKey)) return fail('INVALID_AUTHORIZATION_RECEIPT')
  if (evidence.transparency && !await verifyTransparency(evidence.transparency, acceptance, key.publicKey, receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0)) return fail('INVALID_TRANSPARENCY_PROOF')
  if (!authorization.signature) return fail('MISSING_AUTHORIZATION_SIGNATURE')
  const requiresContractVerification = authorization.authorizer.type === 'eip1271'
  const authorizationValid = requiresContractVerification || (authorization.authorizer.type === 'solana-ed25519'
    ? await verifySolanaAuthorizationSignature(authorization)
    : await verifyTypedData({
      address: authorization.authorizer.address as `0x${string}`,
      ...authorizationTypedDataFor(authorization),
      signature: authorization.signature as `0x${string}`,
    }))
  if (!authorizationValid) return fail('INVALID_AUTHORIZATION_SIGNATURE')
  const expectedBinding = bindingFor(authorization.intent, receipt.execution, authorization.delegate.executor, acceptance.acceptedAt, authorization.notBefore, authorization.expiresAt)
  if (canonicalize(expectedBinding) !== canonicalize(receipt.binding) || canonicalize(expectedBinding.reasonCodes) !== canonicalize(receipt.reasonCodes)) return fail('BINDING_MISMATCH')
  const expectedOutcome = receiptV3 ? executionOutcomeFor(receipt.execution) : outcomeFor(authorization.intent, receipt.execution, expectedBinding)
  if (expectedOutcome !== receipt.outcome) return fail('OUTCOME_MISMATCH')
  if (receiptV3) {
    if (receipt.executionStatus !== receipt.execution.status) return fail('EXECUTION_STATUS_MISMATCH')
    const compliance = complianceFor(authorization, receipt.execution, expectedBinding)
    if (canonicalize(compliance) !== canonicalize(receipt.compliance)) return fail('COMPLIANCE_MISMATCH')
  }
  const receiptIdentity = { authorizationHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId }
  const expectedReceiptId = `psr_${(await hashJson(receiptV3 ? { schema: receipt.schema, ...receiptIdentity } : receiptIdentity)).slice(0, 32)}`
  if (receipt.receiptId !== expectedReceiptId) return fail('RECEIPT_ID_MISMATCH')
  if (requiresContractVerification) return fail('AUTHORIZATION_REQUIRES_CHAIN_VERIFICATION')
  return { valid: true, code: 'OK', ...receiptResultFields(receipt), authorizationId: authorization.authorizationId }
}

function hasOnlyFields(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key)))
}

function validAuthorizationShape(value: NonNullable<Receipt['authorizationEvidence']>['authorization']) {
  if (!hasOnlyFields(value, authorizationFields) || !hasOnlyFields(value.principal, ['account', 'id', 'type']) || !hasOnlyFields(value.authorizer, ['address', 'type']) || !hasOnlyFields(value.delegate, ['agentId', 'executor'])) return false
  const legacy = value.schema === 'priorseal.authorization.v1'
  if (!legacy && value.schema !== 'priorseal.authorization.v2') return false
  const solana = value.authorizer.type === 'solana-ed25519'
  if (value.domain !== (solana ? 'priorseal/authorization/solana/v2' : legacy ? 'priorseal/authorization/v1' : 'priorseal/authorization/v2') || !validIntentShape(value.intent)) return false
  if (!hashPattern.test(value.intentHash) || !/^auth_[0-9a-f]{32}$/.test(value.authorizationId)) return false
  if (!['user', 'organization'].includes(value.principal.type) || !identifierPattern.test(value.principal.id)) return false
  if (solana) {
    if (value.domain !== 'priorseal/authorization/solana/v2' || value.intent.executionProfile !== SOLANA_TRANSACTION_PROFILE
      || !solanaPublicKey(value.principal.account) || !solanaPublicKey(value.authorizer.address) || value.principal.account !== value.authorizer.address
      || !solanaPublicKey(value.delegate.executor)) return false
  } else if (!canonicalAddress(value.principal.account) || !['eip712', 'eip1271'].includes(value.authorizer.type)
    || !canonicalAddress(value.authorizer.address) || value.principal.account !== value.authorizer.address || !canonicalAddress(value.delegate.executor)) return false
  if (!identifierPattern.test(value.delegate.agentId)) return false
  if (![value.issuedAt, value.notBefore, value.expiresAt].every(positiveUnixSeconds)) return false
  if (!/^0x[0-9a-f]{64}$/.test(value.authorizationNonce) || !/^0x[0-9a-f]{64}$/.test(value.policyHash) || value.maxUses !== '1' || !identifierPattern.test(value.audience)) return false
  return value.signature === undefined || typeof value.signature === 'string'
}

function validIntentShape(value: Intent) {
  if (!hasOnlyFields(value, intentFields)) return false
  const record = value as unknown as Record<string, unknown>
  const exactCall = value.schema === 'priorseal.intent.v2'
  const erc4337 = value.executionProfile === 'priorseal.execution-profile.erc4337-user-operation.v1'
  const exactCallProfile = value.executionProfile === 'priorseal.execution-profile.exact-call.v1'
  const solanaTransaction = value.executionProfile === SOLANA_TRANSACTION_PROFILE
  const hyperliquidSpotIoc = value.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE
  if (!exactCall && value.schema !== 'priorseal.intent.v1') return false
  if (exactCall !== (exactCallProfile || erc4337 || solanaTransaction || hyperliquidSpotIoc) || (exactCallProfile && value.action !== 'CONTRACT_CALL') || (erc4337 && value.action !== 'ERC4337_USER_OPERATION') || (solanaTransaction && value.action !== 'SOLANA_TRANSACTION') || (hyperliquidSpotIoc && value.action !== HYPERLIQUID_SPOT_IOC_ACTION)) return false
  if (!identifierPattern.test(value.intentId) || !identifierPattern.test(value.action) || !positiveUnixSeconds(value.validUntil)) return false
  if (hyperliquidSpotIoc) {
    if (value.chainId !== 0 || value.chainRef !== HYPERLIQUID_MAINNET_CHAIN_REF || !canonicalAddress(value.sender) || value.recipient !== value.sender
      || !uintPattern.test(value.amount) || !uintPattern.test(value.nonce ?? '') || BigInt(value.nonce ?? '0') < 1_000_000_000_000n
      || !hashPattern.test(value.intentHash ?? '') || !validHyperliquidSpotIocOrder(value.hyperliquidOrder)
      || value.asset !== `hyperliquid:mainnet/spot:${value.hyperliquidOrder.assetId}` || value.validUntil > Math.floor(value.hyperliquidOrder.expiresAfter / 1000)
      || BigInt(value.nonce ?? '0') >= BigInt(value.hyperliquidOrder.expiresAfter)
      || BigInt(value.hyperliquidOrder.expiresAfter) - BigInt(value.nonce ?? '0') > BigInt(HYPERLIQUID_MAX_SPOT_IOC_LIFETIME_MS)
      || record.chainIds != null || value.callTarget != null || value.calldataHash != null || value.transactionValue != null
      || value.entryPoint != null || value.entryPointCodeHash != null || value.entryPointVersion != null || value.userOperationHash != null
      || value.accountCallProfile != null || value.accountCallTarget != null || value.accountCallValue != null || value.accountCallDataHash != null || value.eip7702 != null || value.solanaTransaction != null
      || !validContextCommitments(value.contextCommitments)) return false
  } else if (solanaTransaction) {
    if (value.chainId !== 0 || value.chainRef !== SOLANA_MAINNET_CAIP2 || !solanaPublicKey(value.sender) || value.recipient !== value.sender
      || !uintPattern.test(value.amount) || value.nonce !== value.solanaTransaction?.recentBlockhash || !hashPattern.test(value.intentHash ?? '')
      || !/^solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp\/(?:slip44:501|spl:[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(value.asset)
      || !validSolanaTransactionMessage(value.solanaTransaction) || value.solanaTransaction.feePayer !== value.sender
      || value.callTarget != null || value.calldataHash != null || value.transactionValue != null
      || value.entryPoint != null || value.userOperationHash != null || value.accountCallProfile != null) return false
  } else {
    if (value.chainRef != null || value.solanaTransaction != null || !positiveChainId(value.chainId)) return false
    if (!canonicalAddress(value.sender) || !canonicalAddress(value.recipient) || !uintPattern.test(value.amount) || !uintPattern.test(value.nonce ?? '0')) return false
    const asset = /^eip155:([1-9][0-9]*)\/(native|erc20:0x[0-9a-fA-F]{40})$/.exec(value.asset)
    if (!asset || Number(asset[1]) !== value.chainId || !hashPattern.test(value.intentHash ?? '')) return false
  }
  if (record.chainIds !== undefined && (!Array.isArray(record.chainIds) || !record.chainIds.every(positiveChainId))) return false
  if (value.callTarget !== undefined && !canonicalAddress(value.callTarget)) return false
  if (value.calldataHash !== undefined && !/^0x[0-9a-f]{64}$/.test(value.calldataHash)) return false
  if (value.transactionValue !== undefined && !uintPattern.test(value.transactionValue)) return false
  if (exactCallProfile && (value.nonce == null || value.callTarget == null || value.calldataHash == null || value.transactionValue == null || !validContextCommitments(value.contextCommitments))) return false
  if (erc4337 && (value.nonce == null || !canonicalAddress(value.entryPoint ?? '') || !/^0x[0-9a-f]{64}$/.test(value.entryPointCodeHash ?? '') || !['0.6', '0.7', '0.8', '0.9'].includes(String(value.entryPointVersion)) || !/^0x[0-9a-f]{64}$/.test(value.userOperationHash ?? '') || !validContextCommitments(value.contextCommitments))) return false
  if (value.accountCallProfile != null && (value.accountCallProfile !== 'safe-4337.v1' || !erc4337 || !canonicalAddress(value.accountCallTarget ?? '') || !uintPattern.test(value.accountCallValue ?? '') || !/^0x[0-9a-f]{64}$/.test(value.accountCallDataHash ?? ''))) return false
  if (!exactCall && (value.executionProfile != null || value.contextCommitments != null)) return false
  if (value.constraints !== undefined) {
    if (!hasOnlyFields(value.constraints, ['maxGasUsed', 'minConfirmations', 'maxToleratedReorgDepth', 'finalityRequirement'])) return false
    if (value.constraints.minConfirmations != null && (!Number.isSafeInteger(Number(value.constraints.minConfirmations)) || Number(value.constraints.minConfirmations) < 0 || Number(value.constraints.minConfirmations) > 10_000)) return false
    if (value.constraints.maxToleratedReorgDepth != null && (!Number.isSafeInteger(value.constraints.maxToleratedReorgDepth) || value.constraints.maxToleratedReorgDepth < 0 || value.constraints.maxToleratedReorgDepth > 9_999)) return false
    if (value.constraints.finalityRequirement != null && !['CONFIRMATIONS', 'RPC_FINALIZED'].includes(value.constraints.finalityRequirement)) return false
    if (value.constraints.maxGasUsed != null && !uintPattern.test(value.constraints.maxGasUsed)) return false
  }
  if (hyperliquidSpotIoc && (value.constraints?.maxGasUsed != null || value.constraints?.finalityRequirement === 'RPC_FINALIZED' || Number(value.constraints?.minConfirmations ?? 0) > 1 || (value.constraints?.maxToleratedReorgDepth != null && value.constraints.maxToleratedReorgDepth !== 0))) return false
  return true
}

function validHyperliquidSpotIocOrder(value: unknown): value is NonNullable<Intent['hyperliquidOrder']> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyFields(value, ['assetId', 'isBuy', 'limitPrice', 'size', 'timeInForce', 'clientOrderId', 'expiresAfter'])) return false
  const order = value as NonNullable<Intent['hyperliquidOrder']>
  return Number.isSafeInteger(order.assetId) && order.assetId >= 10_000 && order.assetId < HYPERLIQUID_OUTCOME_ASSET_ID_MIN
    && typeof order.isBuy === 'boolean'
    && canonicalDecimal(order.limitPrice, false)
    && canonicalDecimal(order.size, true)
    && order.timeInForce === 'Ioc'
    && /^0x[0-9a-f]{32}$/.test(order.clientOrderId)
    && Number.isSafeInteger(order.expiresAfter) && order.expiresAfter > 0
}

function validHyperliquidSpotIocExecution(value: unknown, expected: NonNullable<Intent['hyperliquidOrder']>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyFields(value, ['assetId', 'isBuy', 'limitPrice', 'size', 'timeInForce', 'clientOrderId', 'expiresAfter', 'orderId', 'orderStatus', 'filledSize', 'averagePrice', 'fee', 'statusTimestamp'])) return false
  const execution = value as Record<string, unknown>
  const orderInput = { assetId: execution.assetId, isBuy: execution.isBuy, limitPrice: execution.limitPrice, size: execution.size, timeInForce: execution.timeInForce, clientOrderId: execution.clientOrderId, expiresAfter: execution.expiresAfter }
  if (!validHyperliquidSpotIocOrder(orderInput) || !/^(0|[1-9][0-9]*)$/.test(String(execution.orderId ?? '')) || !hyperliquidTerminalDisposition(execution.orderStatus) || !Number.isSafeInteger(execution.statusTimestamp) || Number(execution.statusTimestamp) <= 0 || !canonicalDecimal(execution.filledSize, false) || (execution.averagePrice !== null && !canonicalDecimal(execution.averagePrice, true)) || (execution.fee !== null && !canonicalDecimal(execution.fee, false))) return false
  const actual = execution as unknown as NonNullable<Receipt['execution']['hyperliquidOrder']>
  if (actual.assetId !== expected.assetId || actual.isBuy !== expected.isBuy || actual.limitPrice !== expected.limitPrice || actual.size !== expected.size || actual.timeInForce !== expected.timeInForce || actual.clientOrderId !== expected.clientOrderId || actual.expiresAfter !== expected.expiresAfter) return false
  const filledSize = actual.filledSize
  const averagePrice = actual.averagePrice
  const disposition = hyperliquidTerminalDisposition(actual.orderStatus)
  if (compareDecimal(filledSize, actual.size) > 0 || (disposition === 'FILLED' && compareDecimal(filledSize, actual.size) !== 0) || (disposition === 'REJECTED' && compareDecimal(filledSize, '0') !== 0) || (compareDecimal(filledSize, '0') === 0 && averagePrice !== null) || (compareDecimal(filledSize, '0') > 0 && averagePrice === null)) return false
  return averagePrice === null || (actual.isBuy ? compareDecimal(averagePrice, actual.limitPrice) <= 0 : compareDecimal(averagePrice, actual.limitPrice) >= 0)
}

function hyperliquidTerminalDisposition(value: unknown): 'FILLED' | 'CANCELED' | 'REJECTED' | null {
  if (value === 'filled') return 'FILLED'
  const statuses = new Set(['canceled', 'marginCanceled', 'vaultWithdrawalCanceled', 'openInterestCapCanceled', 'selfTradeCanceled', 'reduceOnlyCanceled', 'siblingFilledCanceled', 'delistedCanceled', 'liquidatedCanceled', 'scheduledCancel', 'rejected', 'tickRejected', 'minTradeNtlRejected', 'perpMarginRejected', 'reduceOnlyRejected', 'badAloPxRejected', 'iocCancelRejected', 'badTriggerPxRejected', 'marketOrderNoLiquidityRejected', 'positionIncreaseAtOpenInterestCapRejected', 'positionFlipAtOpenInterestCapRejected', 'tooAggressiveAtOpenInterestCapRejected', 'openInterestIncreaseRejected', 'insufficientSpotBalanceRejected', 'oracleRejected', 'perpMaxPositionRejected'])
  if (typeof value !== 'string' || !statuses.has(value)) return null
  return value.endsWith('Rejected') || value === 'rejected' ? 'REJECTED' : 'CANCELED'
}

function validHyperliquidInfoObservation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyFields(value, ['schema', 'endpointHash', 'orderStatusRequestHash', 'orderStatusResponseHash', 'fillRequestHashes', 'fillResponseHashes', 'fillPageCount', 'fillResponseCount', 'relevantFillCount', 'fillsComplete', 'observedAtMillis'])) return false
  const evidence = value as Record<string, unknown>
  const digest = (candidate: unknown) => typeof candidate === 'string' && /^[0-9a-f]{64}$/.test(candidate)
  const count = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 1_000_000
  return evidence.schema === 'priorseal.hyperliquid-info-observation.v1' && digest(evidence.endpointHash) && digest(evidence.orderStatusRequestHash) && digest(evidence.orderStatusResponseHash)
    && Array.isArray(evidence.fillRequestHashes) && Array.isArray(evidence.fillResponseHashes) && evidence.fillRequestHashes.length <= 100 && evidence.fillRequestHashes.length === evidence.fillResponseHashes.length
    && evidence.fillRequestHashes.every(digest) && evidence.fillResponseHashes.every(digest) && count(evidence.fillPageCount) && evidence.fillPageCount === evidence.fillRequestHashes.length
    && count(evidence.fillResponseCount) && count(evidence.relevantFillCount) && typeof evidence.fillsComplete === 'boolean' && Number.isSafeInteger(evidence.observedAtMillis) && Number(evidence.observedAtMillis) > 0
}

function canonicalDecimal(value: unknown, positive: boolean): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value) || /\.0+$/.test(value)) return false
  return !positive || compareDecimal(value, '0') > 0
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.')
  const [rightWhole, rightFraction = ''] = right.split('.')
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const factor = 10n ** BigInt(scale)
  const integer = (whole: string, fraction: string) => BigInt(whole) * factor + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0')
  const difference = integer(leftWhole, leftFraction) - integer(rightWhole, rightFraction)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

function validTemporalEvidence(intent: Intent, execution: Receipt['execution']): boolean {
  const criterion = intent.constraints?.finalityRequirement ?? 'CONFIRMATIONS'
  const maxDepth = intent.constraints?.maxToleratedReorgDepth ?? null
  const evidence: unknown = execution.temporalEvidence
  if (evidence == null) return execution.finalityState !== 'FINALIZED' && (criterion !== 'RPC_FINALIZED' || !['CONFIRMED', 'REVERTED'].includes(execution.status))
  if (!hasOnlyFields(evidence, ['schema', 'criterion', 'requiredConfirmations', 'maxToleratedReorgDepth', 'observedHeadNumber', 'observedHeadHash', 'finalizedBlock'])) return false
  if (evidence.schema !== 'priorseal.temporal-evidence.v1' || evidence.criterion !== criterion || evidence.maxToleratedReorgDepth !== maxDepth) return false
  const height = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!height(evidence.requiredConfirmations) || evidence.requiredConfirmations > 10_000 || !height(evidence.observedHeadNumber)) return false
  if (criterion === 'RPC_FINALIZED' ? typeof evidence.observedHeadHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(evidence.observedHeadHash) : evidence.observedHeadHash !== null) return false
  if (evidence.requiredConfirmations < Math.max(intent.constraints?.minConfirmations ?? 0, maxDepth == null ? 0 : maxDepth + 1)) return false
  if (!height(execution.blockNumber) || typeof execution.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(execution.blockHash) || !height(execution.confirmations) || execution.blockNumber > evidence.observedHeadNumber) return false
  if (execution.confirmations !== evidence.observedHeadNumber - execution.blockNumber + 1) return false
  let finalizedNumber: number | null = null
  if (evidence.finalizedBlock !== null) {
    if (!hasOnlyFields(evidence.finalizedBlock, ['number', 'hash'])) return false
    if (!height(evidence.finalizedBlock.number) || evidence.finalizedBlock.number > evidence.observedHeadNumber || typeof evidence.finalizedBlock.hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(evidence.finalizedBlock.hash)) return false
    if (execution.status !== 'REORGED' && evidence.finalizedBlock.number === execution.blockNumber && evidence.finalizedBlock.hash !== execution.blockHash) return false
    if (evidence.finalizedBlock.number === evidence.observedHeadNumber && evidence.finalizedBlock.hash !== evidence.observedHeadHash) return false
    finalizedNumber = evidence.finalizedBlock.number
  }
  const reachedDepth = execution.confirmations >= evidence.requiredConfirmations
  const reachedFinalized = finalizedNumber !== null && finalizedNumber >= execution.blockNumber
  if (['CONFIRMED', 'REVERTED'].includes(execution.status)) {
    if (!reachedDepth) return false
    return criterion === 'RPC_FINALIZED' ? execution.finalityState === 'FINALIZED' && reachedFinalized : execution.finalityState === 'CONFIRMED'
  }
  if (execution.finalityState === 'FINALIZED' || execution.finalityState === 'CONFIRMED') return false
  if (execution.status === 'PENDING' && execution.finalityState === 'INSUFFICIENT_FINALITY' && reachedDepth && (criterion === 'CONFIRMATIONS' || reachedFinalized)) return false
  return true
}

function validAcceptanceShape(value: NonNullable<Receipt['authorizationEvidence']>['acceptance']) {
  if (!hasOnlyFields(value, ['acceptedAt', 'algorithm', 'authorizationHash', 'authorizationId', 'domain', 'entryHash', 'intentHash', 'issuer', 'keyId', 'previousEntryHash', 'schema', 'sequence', 'signature', 'status'])) return false
  return /^auth_[0-9a-f]{32}$/.test(value.authorizationId)
    && hashPattern.test(value.authorizationHash)
    && hashPattern.test(value.intentHash)
    && hashPattern.test(value.entryHash)
    && (value.previousEntryHash === null || hashPattern.test(value.previousEntryHash))
    && positiveUnixSeconds(value.acceptedAt)
    && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && typeof value.issuer === 'string' && value.issuer.length > 0
    && typeof value.keyId === 'string' && value.keyId.length > 0
    && typeof value.signature === 'string'
}

function validTrustedKey(key: KeyEntry) {
  if (!hasOnlyFields(key, ['algorithm', 'issuer', 'keyId', 'publicKey', 'status', 'validFrom', 'validUntil'])) return false
  if (key.algorithm !== 'Ed25519' || !['active', 'retired'].includes(key.status) || typeof key.issuer !== 'string' || !key.issuer || typeof key.keyId !== 'string' || !key.keyId || typeof key.publicKey !== 'string' || !key.publicKey) return false
  if (![key.validFrom, key.validUntil].every((entry) => entry === null || positiveUnixSeconds(entry))) return false
  return key.validFrom === null || key.validUntil === null || key.validFrom <= key.validUntil
}

function validReceiptTimeline(receipt: Receipt) {
  if (!positiveUnixSeconds(receipt.issuedAt) || !positiveUnixSeconds(receipt.validUntil)) return false
  const observedAt = receipt.execution?.observedAt ?? receipt.execution?.executedAt
  return observedAt == null || positiveUnixSeconds(observedAt) && receipt.issuedAt >= observedAt
}

function positiveUnixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function positiveChainId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function canonicalAddress(value: unknown): value is string {
  return typeof value === 'string' && addressPattern.test(value)
}

function solanaPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false
  try { return decodeBase58(value).length === 32 } catch { return false }
}

function decodeBase58(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let integer = 0n
  for (const character of value) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new TypeError('invalid base58')
    integer = integer * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (integer > 0n) { bytes.push(Number(integer & 0xffn)); integer >>= 8n }
  bytes.reverse()
  let zeroes = 0
  while (value[zeroes] === '1') zeroes += 1
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes])
}

function validSolanaTransactionMessage(value: unknown): value is NonNullable<Intent['solanaTransaction']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as NonNullable<Intent['solanaTransaction']>
  const baseKeys = 'accountKeys,addressTableLookups,feePayer,header,instructions,loadedAddresses,messageVersion,network,recentBlockhash'
  const expectedKeys = message.messageVersion === 'v1' ? `${baseKeys},transactionConfig` : baseKeys
  if (Object.keys(message).sort().join(',') !== expectedKeys
    || message.network !== 'mainnet-beta' || !solanaPublicKey(message.feePayer) || !solanaPublicKey(message.recentBlockhash)
    || !['legacy', 'v0', 'v1'].includes(message.messageVersion)
    || !message.header || !Array.isArray(message.accountKeys)
    || message.accountKeys.length < 1 || message.accountKeys.length > 256 || message.accountKeys[0] !== message.feePayer
    || !message.accountKeys.every(solanaPublicKey) || new Set(message.accountKeys).size !== message.accountKeys.length
    || !Array.isArray(message.addressTableLookups) || !Array.isArray(message.instructions) || message.instructions.length < 1 || message.instructions.length > 128
    || !message.loadedAddresses || !Array.isArray(message.loadedAddresses.writable) || !Array.isArray(message.loadedAddresses.readonly)) return false
  if (message.messageVersion === 'v1') {
    const config = message.transactionConfig
    if (!config || !Number.isSafeInteger(config.computeUnitLimit) || config.computeUnitLimit == null || config.computeUnitLimit <= 0 || config.computeUnitLimit > 0xffff_ffff || !Number.isSafeInteger(config.loadedAccountsDataSizeLimit) || config.loadedAccountsDataSizeLimit == null || config.loadedAccountsDataSizeLimit <= 0 || config.loadedAccountsDataSizeLimit > 0xffff_ffff || !(config.heapSize === null || Number.isSafeInteger(config.heapSize) && config.heapSize >= 0 && config.heapSize <= 0xffff_ffff) || !(config.priorityFeeLamports === null || uintPattern.test(config.priorityFeeLamports))) return false
  } else if (message.transactionConfig !== undefined) return false
  const header = message.header
  if (!['numRequiredSignatures', 'numReadonlySignedAccounts', 'numReadonlyUnsignedAccounts'].every((key) => Number.isSafeInteger(header[key as keyof typeof header]))
    || header.numRequiredSignatures < 1 || header.numRequiredSignatures > message.accountKeys.length
    || header.numReadonlySignedAccounts >= header.numRequiredSignatures || header.numReadonlyUnsignedAccounts > message.accountKeys.length - header.numRequiredSignatures) return false
  const total = message.accountKeys.length + message.loadedAddresses.writable.length + message.loadedAddresses.readonly.length
  if (total > 256 || !message.loadedAddresses.writable.every(solanaPublicKey) || !message.loadedAddresses.readonly.every(solanaPublicKey)) return false
  if (message.addressTableLookups.length > 32 || message.messageVersion !== 'v0' && message.addressTableLookups.length > 0
    || message.addressTableLookups.some((lookup) => !solanaPublicKey(lookup.accountKey)
      || !validByteIndexes(lookup.writableIndexes) || !validByteIndexes(lookup.readonlyIndexes))) return false
  if (message.loadedAddresses.writable.length !== message.addressTableLookups.reduce((n, entry) => n + entry.writableIndexes.length, 0)
    || message.loadedAddresses.readonly.length !== message.addressTableLookups.reduce((n, entry) => n + entry.readonlyIndexes.length, 0)) return false
  if (message.messageVersion === 'v1' && (message.accountKeys.length > 96 || message.instructions.length > 64
    || message.instructions.some((instruction) => instruction.accountIndexes.length > 255))) return false
  return message.instructions.every((instruction) => Number.isSafeInteger(instruction.programIdIndex) && instruction.programIdIndex >= 0 && instruction.programIdIndex < total
    && Array.isArray(instruction.accountIndexes) && instruction.accountIndexes.every((index) => Number.isSafeInteger(index) && index >= 0 && index < total)
    && typeof instruction.data === 'string' && instruction.data.length <= 8192 && (instruction.data.length === 0 || /^[1-9A-HJ-NP-Za-km-z]+$/.test(instruction.data)))
}

function validByteIndexes(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 256 && value.every((index) => Number.isSafeInteger(index) && index >= 0 && index <= 255) && new Set(value).size === value.length
}

async function verifySolanaAuthorizationSignature(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization']) {
  if (typeof authorization.signature !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(authorization.signature)) return false
  let signature: Uint8Array
  try { signature = decodeBase64(authorization.signature) } catch { return false }
  if (signature.length !== 64 || btoa(String.fromCharCode(...signature)) !== authorization.signature) return false
  const rawKey = new Uint8Array(decodeBase58(authorization.authorizer.address))
  const message = new Uint8Array(new TextEncoder().encode(solanaAuthorizationMessage(authorization)))
  const key = await crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, key, new Uint8Array(signature).buffer as ArrayBuffer, message.buffer as ArrayBuffer)
}

function stripIntentHash(intent: Intent) {
  const { intentHash, ...unsigned } = intent as unknown as Record<string, unknown>
  return unsigned
}

function stripAuthorizationMetadata(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization']) {
  const { authorizationId, signature, ...unsigned } = authorization
  return unsigned
}

function bindingFor(intent: NonNullable<Receipt['authorizationEvidence']>['authorization']['intent'], execution: Receipt['execution'], executor: string, acceptedAt: number, authorizationNotBefore: number, authorizationExpiresAt: number) {
  const reasons: string[] = []
  const same = (left: unknown, right: unknown) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
  const solana = intent.executionProfile === SOLANA_TRANSACTION_PROFILE
  const hyperliquid = intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE
  const sameIdentity = (left: unknown, right: unknown) => solana ? String(left ?? '') === String(right ?? '') : same(left, right)
  const exactCall = intent.executionProfile === 'priorseal.execution-profile.exact-call.v1' || solana || hyperliquid
  const erc4337 = intent.executionProfile === 'priorseal.execution-profile.erc4337-user-operation.v1'
  if (execution.executionDataAvailable === false) reasons.push('EXECUTION_UNAVAILABLE')
  if (Number(execution.chainId) !== Number(intent.chainId)) reasons.push('CHAIN_MISMATCH')
  if ((execution.chainRef ?? null) !== (intent.chainRef ?? null)) reasons.push('CHAINREF_MISMATCH')
  if (!same(execution.action, intent.action)) reasons.push('ACTION_MISMATCH')
  if (!sameIdentity(execution.sender, intent.sender)) reasons.push('SENDER_MISMATCH')
  if (!exactCall && !sameIdentity(execution.recipient, intent.recipient)) reasons.push('RECIPIENT_MISMATCH')
  if (!exactCall && !same(execution.asset, intent.asset)) reasons.push('ASSET_MISMATCH')
  if (!exactCall && String(execution.amount ?? '') !== String(intent.amount)) reasons.push('AMOUNT_MISMATCH')
  if (String(execution.nonce ?? '') !== String(intent.nonce ?? '0')) reasons.push('NONCE_MISMATCH')
  if (intent.callTarget != null && !same(execution.target, intent.callTarget)) reasons.push('CALL_TARGET_MISMATCH')
  if (intent.calldataHash != null && !same(execution.calldataHash, intent.calldataHash)) reasons.push('CALLDATA_MISMATCH')
  if (intent.transactionValue != null && String(execution.nativeValue ?? '') !== String(intent.transactionValue)) reasons.push('TRANSACTION_VALUE_MISMATCH')
  if (solana && (!intent.solanaTransaction || !execution.solanaTransaction || canonicalize(intent.solanaTransaction) !== canonicalize(execution.solanaTransaction))) reasons.push('SOLANA_MESSAGE_MISMATCH')
  if (hyperliquid && (!intent.hyperliquidOrder || !validHyperliquidSpotIocExecution(execution.hyperliquidOrder, intent.hyperliquidOrder))) reasons.push('HYPERLIQUID_ORDER_MISMATCH')
  if (hyperliquid && (!validHyperliquidInfoObservation(execution.hyperliquidInfoObservation) || !execution.hyperliquidInfoObservation?.fillsComplete)) reasons.push('EXECUTION_UNAVAILABLE')
  if (erc4337 && !same(execution.userOperationHash, intent.userOperationHash)) reasons.push('USER_OPERATION_HASH_MISMATCH')
  if (erc4337 && !same(execution.entryPoint, intent.entryPoint)) reasons.push('ENTRY_POINT_MISMATCH')
  if (erc4337 && !same(execution.entryPointCodeHash, intent.entryPointCodeHash)) reasons.push('ENTRY_POINT_CODE_HASH_MISMATCH')
  if (intent.accountCallProfile != null && (execution.accountCallProfile !== intent.accountCallProfile || !same(execution.accountCallTarget, intent.accountCallTarget) || !same(execution.accountCallValue, intent.accountCallValue) || !same(execution.accountCallDataHash, intent.accountCallDataHash))) reasons.push('CALLDATA_MISMATCH')
  if (erc4337 && !same(execution.entryPointVersion, intent.entryPointVersion)) reasons.push('ENTRY_POINT_VERSION_MISMATCH')
  if ((execution.executedAt ?? execution.observedAt ?? 0) > intent.validUntil) reasons.push('OUTSIDE_TIME_WINDOW')
  if (intent.constraints?.minConfirmations != null && Number(execution.confirmations ?? 0) < intent.constraints.minConfirmations) reasons.push('INSUFFICIENT_FINALITY')
  if (intent.constraints?.maxToleratedReorgDepth != null && Number(execution.confirmations ?? 0) <= intent.constraints.maxToleratedReorgDepth) reasons.push('INSUFFICIENT_FINALITY')
  if (intent.constraints?.finalityRequirement === 'RPC_FINALIZED' && execution.finalityState !== 'FINALIZED') reasons.push('INSUFFICIENT_FINALITY')
  if (intent.constraints?.maxGasUsed != null) {
    if (execution.gasUsed == null) reasons.push('EXECUTION_UNAVAILABLE')
    else if (BigInt(execution.gasUsed) > BigInt(intent.constraints.maxGasUsed)) reasons.push('GAS_LIMIT_EXCEEDED')
  }
  if (!exactCall && Array.isArray(execution.transfers) && execution.transfers.length > 1 && !execution.transferMatchUnique) reasons.push('AMBIGUOUS_TRANSFER')
  if (!sameIdentity(execution.sender, executor)) reasons.push('EXECUTOR_MISMATCH')
  const executedAt = execution.executedAt ?? execution.observedAt ?? 0
  if (acceptedAt > executedAt) reasons.push('AUTHORIZATION_AFTER_EXECUTION')
  if (executedAt < authorizationNotBefore || executedAt > authorizationExpiresAt) reasons.push('OUTSIDE_AUTHORIZATION_WINDOW')
  const reasonCodes = [...new Set(reasons)]
  return { bound: reasonCodes.length === 0, reasonCodes }
}

function validContextCommitments(value: Intent['contextCommitments']) {
  if (value == null) return true
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return false
  const keys: string[] = []
  for (const entry of value) {
    if (!entry || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.namespace) || !['keccak256', 'sha256'].includes(entry.algorithm) || !/^0x[0-9a-f]{64}$/.test(entry.digest)) return false
    if (Object.keys(entry).sort().join(',') !== 'algorithm,digest,namespace') return false
    keys.push(`${entry.namespace}:${entry.algorithm}:${entry.digest}`)
  }
  return keys.every((key, index) => index === 0 || keys[index - 1] < key)
}

function outcomeFor(intent: NonNullable<Receipt['authorizationEvidence']>['authorization']['intent'], execution: Receipt['execution'], binding: { bound: boolean }) {
  if (execution.status === 'REORGED' || execution.finalityState === 'REORGED') return 'REORGED'
  if (execution.finalityState === 'INSUFFICIENT_FINALITY') return 'PENDING'
  if (execution.status === 'PENDING') return 'PENDING'
  if (execution.status === 'REVERTED') return 'FAILED'
  if (['NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(execution.status)) return 'UNDETERMINED'
  if (execution.status !== 'CONFIRMED' || !binding.bound) return 'UNDETERMINED'
  if ((execution.executedAt ?? execution.observedAt ?? 0) > intent.validUntil) return 'EXPIRED'
  return 'COMPLETED'
}

function executionOutcomeFor(execution: Receipt['execution']) {
  if (execution.status === 'REORGED' || execution.finalityState === 'REORGED') return 'REORGED'
  if (execution.finalityState === 'INSUFFICIENT_FINALITY') return 'PENDING'
  if (execution.status === 'PENDING') return 'PENDING'
  if (execution.status === 'REVERTED') return 'FAILED'
  if (execution.status === 'CONFIRMED') return 'COMPLETED'
  return 'UNDETERMINED'
}

function complianceFor(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization'], execution: Receipt['execution'], binding: { bound: boolean; reasonCodes: string[] }) {
  const assessment = (status: 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_ASSESSABLE', reasonCodes: string[]) => ({ schema: 'priorseal.compliance-assessment.v1', status, reasonCodes })
  if (execution.executionDataAvailable === false) return assessment('NOT_ASSESSABLE', ['EXECUTION_UNAVAILABLE'])
  if (execution.status === 'REORGED' || execution.finalityState === 'REORGED') return assessment('NOT_ASSESSABLE', ['EXECUTION_REORGED'])
  if (execution.finalityState === 'INSUFFICIENT_FINALITY') return assessment('NOT_ASSESSABLE', ['EXECUTION_PENDING'])
  if (execution.status === 'PENDING') return assessment('NOT_ASSESSABLE', ['EXECUTION_PENDING'])
  if (execution.status === 'NOT_FOUND') return assessment('NOT_ASSESSABLE', ['EXECUTION_NOT_FOUND'])
  if (['RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(execution.status) || !['CONFIRMED', 'REVERTED'].includes(execution.status)) return assessment('NOT_ASSESSABLE', ['EXECUTION_UNAVAILABLE'])
  const unavailableBindingReasons = binding.reasonCodes.filter((code) => ['EXECUTION_UNAVAILABLE', 'INSUFFICIENT_FINALITY'].includes(code))
  if (unavailableBindingReasons.length) return assessment('NOT_ASSESSABLE', unavailableBindingReasons)
  const correlationReasons: string[] = []
  const solana = authorization.authorizer.type === 'solana-ed25519'
  const hyperliquid = authorization.intent.executionProfile === HYPERLIQUID_SPOT_IOC_PROFILE
  if (Number(execution.chainId) !== Number(authorization.intent.chainId)) correlationReasons.push('CHAIN_MISMATCH')
  if ((solana || hyperliquid) && execution.chainRef !== authorization.intent.chainRef) correlationReasons.push('CHAIN_MISMATCH')
  if (solana ? String(execution.sender ?? '') !== authorization.delegate.executor : String(execution.sender ?? '').toLowerCase() !== authorization.delegate.executor.toLowerCase()) correlationReasons.push('EXECUTOR_MISMATCH')
  if (String(execution.nonce ?? '') !== String(authorization.intent.nonce)) correlationReasons.push('NONCE_MISMATCH')
  if (correlationReasons.length) return assessment('NOT_ASSESSABLE', correlationReasons)
  return binding.bound ? assessment('COMPLIANT', []) : assessment('NON_COMPLIANT', [...binding.reasonCodes])
}

function receiptResultFields(receipt: Receipt) {
  return { outcome: receipt?.outcome, executionStatus: receipt?.executionStatus ?? receipt?.execution?.status, complianceStatus: receipt?.compliance?.status, receiptId: receipt?.receiptId }
}

export async function verifyEd25519(statement: object & { signature?: string }, publicKey: string) {
  const { signature, ...unsigned } = statement
  if (!signature || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false
  const signatureBytes = decodeBase64(signature)
  if (signatureBytes.length !== 64 || encodeBase64Url(signatureBytes) !== signature) return false
  const imported = await crypto.subtle.importKey('spki', publicKeyBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, imported, signatureBytes, new TextEncoder().encode(canonicalize(unsigned)))
}

function encodeBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function verifyTransparency(evidence: NonNullable<Receipt['authorizationEvidence']>['transparency'], acceptance: NonNullable<Receipt['authorizationEvidence']>['acceptance'], publicKey: string, executedAt: number) {
  if (!evidence) return false
  if (evidence.checkpoint?.schema === 'priorseal.transparency-checkpoint.v2') return verifyMerkleTransparency(evidence, acceptance, publicKey, executedAt)
  if (!hasOnlyFields(evidence, ['chain', 'checkpoint']) || !hasOnlyFields(evidence.checkpoint, ['algorithm', 'anchor', 'domain', 'headEntryHash', 'issuedAt', 'issuer', 'keyId', 'schema', 'signature', 'size'])) return false
  if (!evidence.checkpoint.signature || evidence.checkpoint.schema !== 'priorseal.transparency-checkpoint.v1' || evidence.checkpoint.domain !== 'priorseal/transparency-checkpoint/v1' || evidence.checkpoint.algorithm !== 'Ed25519' || evidence.checkpoint.issuer !== acceptance.issuer || evidence.checkpoint.keyId !== acceptance.keyId || !positiveUnixSeconds(evidence.checkpoint.issuedAt) || evidence.checkpoint.issuedAt < acceptance.acceptedAt || !Number.isSafeInteger(evidence.checkpoint.size) || evidence.checkpoint.size < 1 || !hashPattern.test(evidence.checkpoint.headEntryHash) || !Array.isArray(evidence.chain) || !evidence.chain.length) return false
  const first = evidence.chain[0]
  if (first.sequence !== acceptance.sequence || first.entryHash !== acceptance.entryHash) return false
  for (let index = 0; index < evidence.chain.length; index += 1) {
    const entry = evidence.chain[index]
    if (!hasOnlyFields(entry, ['acceptedAt', 'authorizationHash', 'entryHash', 'previousEntryHash', 'sequence']) || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || !positiveUnixSeconds(entry.acceptedAt) || !hashPattern.test(entry.authorizationHash) || !hashPattern.test(entry.entryHash) || (entry.previousEntryHash !== null && !hashPattern.test(entry.previousEntryHash))) return false
    if (entry.entryHash !== await hashJson({ sequence: entry.sequence, authorizationHash: entry.authorizationHash, acceptedAt: entry.acceptedAt, previousEntryHash: entry.previousEntryHash })) return false
    if (index > 0 && (entry.sequence !== evidence.chain[index - 1].sequence + 1 || entry.previousEntryHash !== evidence.chain[index - 1].entryHash)) return false
  }
  const last = evidence.chain.at(-1)!
  if (last.entryHash !== evidence.checkpoint.headEntryHash || last.sequence !== evidence.checkpoint.size) return false
  if (evidence.checkpoint.anchor && (!validTransparencyAnchor(evidence.checkpoint.anchor) || evidence.checkpoint.anchor.merkleRoot || evidence.checkpoint.anchor.size !== evidence.checkpoint.size || evidence.checkpoint.anchor.headEntryHash !== evidence.checkpoint.headEntryHash || evidence.checkpoint.anchor.anchoredAt > executedAt)) return false
  return verifyEd25519(evidence.checkpoint, publicKey)
}

async function verifyMerkleTransparency(evidence: NonNullable<Receipt['authorizationEvidence']>['transparency'], acceptance: NonNullable<Receipt['authorizationEvidence']>['acceptance'], publicKey: string, executedAt: number) {
  if (!evidence) return false
  const checkpoint = evidence.checkpoint
  if (!hasOnlyFields(evidence, ['checkpoint', 'proof']) || !hasOnlyFields(checkpoint, ['algorithm', 'anchor', 'domain', 'headEntryHash', 'issuedAt', 'issuer', 'keyId', 'merkleRoot', 'schema', 'signature', 'size'])) return false
  if (!checkpoint.signature || checkpoint.domain !== 'priorseal/transparency-checkpoint/v2' || checkpoint.algorithm !== 'Ed25519' || checkpoint.issuer !== acceptance.issuer || checkpoint.keyId !== acceptance.keyId || !positiveUnixSeconds(checkpoint.issuedAt) || checkpoint.issuedAt < acceptance.acceptedAt || !Number.isSafeInteger(checkpoint.size) || checkpoint.size < acceptance.sequence || !hashPattern.test(checkpoint.headEntryHash) || !hashPattern.test(checkpoint.merkleRoot ?? '')) return false
  if (acceptance.entryHash !== await hashJson({ sequence: acceptance.sequence, authorizationHash: acceptance.authorizationHash, acceptedAt: acceptance.acceptedAt, previousEntryHash: acceptance.previousEntryHash })) return false
  if (!Array.isArray(evidence.proof)) return false
  let start = 1
  let count = checkpoint.size
  const sides: ('left' | 'right')[] = []
  while (count > 1) {
    const leftCount = 2 ** Math.floor(Math.log2(count - 1))
    const containsLeft = acceptance.sequence < start + leftCount
    sides.push(containsLeft ? 'right' : 'left')
    if (!containsLeft) start += leftCount
    count = containsLeft ? leftCount : count - leftCount
  }
  sides.reverse()
  if (evidence.proof.length !== sides.length) return false
  let root = await hashJson({ domain: 'priorseal/transparency-leaf/v1', entryHash: acceptance.entryHash })
  for (const [index, step] of evidence.proof.entries()) {
    if (!hasOnlyFields(step, ['hash', 'side']) || step.side !== sides[index] || !hashPattern.test(step.hash)) return false
    root = step.side === 'left' ? await hashJson({ domain: 'priorseal/transparency-node/v1', left: step.hash, right: root }) : await hashJson({ domain: 'priorseal/transparency-node/v1', left: root, right: step.hash })
  }
  if (root !== checkpoint.merkleRoot) return false
  const anchor = checkpoint.anchor
  if (anchor && (!validTransparencyAnchor(anchor) || !anchor.merkleRoot || anchor.merkleRoot !== checkpoint.merkleRoot || anchor.headEntryHash !== checkpoint.headEntryHash || anchor.size !== checkpoint.size || anchor.anchoredAt > executedAt)) return false
  return verifyEd25519(checkpoint, publicKey)
}

function validTransparencyAnchor(anchor: NonNullable<NonNullable<Receipt['authorizationEvidence']>['transparency']>['checkpoint']['anchor']) {
  return hasOnlyFields(anchor, ['anchoredAt', 'blockNumber', 'chainId', 'contract', 'headEntryHash', 'merkleRoot', 'size', 'txHash', 'type'])
    && anchor.type === 'eip155'
    && positiveChainId(anchor.chainId)
    && canonicalAddress(anchor.contract)
    && /^0x[0-9a-f]{64}$/.test(anchor.txHash)
    && Number.isSafeInteger(anchor.blockNumber) && anchor.blockNumber >= 0
    && Number.isSafeInteger(anchor.anchoredAt) && anchor.anchoredAt >= 0
    && Number.isSafeInteger(anchor.size) && anchor.size > 0
    && hashPattern.test(anchor.headEntryHash)
    && (anchor.merkleRoot === undefined || hashPattern.test(anchor.merkleRoot))
}

async function verifyWitnessEvidence(evidence: NonNullable<Receipt['authorizationEvidence']>['witnesses'], authorization: NonNullable<Receipt['authorizationEvidence']>['authorization'], acceptedAt: number, executedAt: number, inputPolicy: Record<string, unknown>) {
  if (!evidence || evidence.schema !== 'priorseal.witness-evidence.v1' || evidence.domain !== 'priorseal/witness-evidence/v1') return false
  if (inputPolicy.schema !== 'priorseal.witness-policy.v1' || !Array.isArray(inputPolicy.witnesses)) return false
  const witnesses = inputPolicy.witnesses as { witnessId: string; keyId: string; algorithm: string; publicKey: string }[]
  const threshold = Number(inputPolicy.threshold)
  const maxClockSkewSeconds = Number(inputPolicy.maxClockSkewSeconds ?? 60)
  if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > witnesses.length || !Number.isSafeInteger(maxClockSkewSeconds)) return false
  if (new Set(witnesses.map((entry) => entry.witnessId)).size !== witnesses.length) return false
  if (new Set(witnesses.map((entry) => pemFingerprint(entry.publicKey))).size !== witnesses.length) return false
  const policy = { schema: 'priorseal.witness-policy.v1', threshold, maxClockSkewSeconds, witnesses: witnesses.map((entry) => ({ witnessId: entry.witnessId, keyId: entry.keyId, algorithm: entry.algorithm, publicKey: entry.publicKey.trim() })) }
  if (evidence.policyHash !== await hashJson(policy)) return false
  const request = evidence.request
  if (request.schema !== 'priorseal.witness-request.v1' || request.domain !== 'priorseal/witness-request/v1') return false
  if (request.authorizationId !== authorization.authorizationId || request.authorizationHash !== await hashJson(authorization) || request.intentHash !== authorization.intentHash || request.requestedAt !== acceptedAt || request.expiresAt !== authorization.expiresAt) return false
  if (request.requestedAt < authorization.issuedAt || request.requestedAt > authorization.expiresAt) return false
  const requestHash = await hashJson(request)
  const validWitnesses = new Set<string>()
  for (const attestation of evidence.attestations ?? []) {
    const witness = witnesses.find((entry) => entry.witnessId === attestation.witnessId)
    if (!witness || validWitnesses.has(witness.witnessId) || witness.algorithm !== 'Ed25519') continue
    if (attestation.schema !== 'priorseal.witness-attestation.v1' || attestation.domain !== 'priorseal/witness-attestation/v1' || attestation.algorithm !== 'Ed25519') continue
    if (attestation.keyId !== witness.keyId || attestation.requestHash !== requestHash || attestation.authorizationId !== request.authorizationId || attestation.authorizationHash !== request.authorizationHash || attestation.intentHash !== request.intentHash || attestation.expiresAt !== request.expiresAt) continue
    if (!Number.isSafeInteger(attestation.observedAt) || attestation.observedAt < request.requestedAt - maxClockSkewSeconds || attestation.observedAt > request.expiresAt || attestation.observedAt > executedAt) continue
    if (await verifyEd25519(attestation, witness.publicKey)) validWitnesses.add(witness.witnessId)
  }
  return validWitnesses.size >= threshold
}

function pemFingerprint(publicKey: string) {
  return [...publicKeyBytes(publicKey)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyPolicyEvidence(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization'], evidence: NonNullable<Receipt['authorizationEvidence']>['policy'], evaluatedAt: number) {
  if (!evidence || evidence.schema !== 'priorseal.policy-evidence.v1') return false
  const expectedHash = evidence.document ? `0x${await hashJson(evidence.document)}` : `0x${'0'.repeat(64)}`
  if (evidence.policyHash !== authorization.policyHash || evidence.policyHash !== expectedHash) return false
  const expected = evaluatePolicy(authorization, evidence.document, evaluatedAt)
  return expected.allowed && canonicalize(expected) === canonicalize(evidence.result)
}

function evaluatePolicy(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization'], policy: Record<string, unknown> | null, evaluatedAt: number) {
  if (!policy) return { allowed: true, reasonCodes: [], policyId: null, evaluatedAt }
  const reasons: string[] = []
  const solana = authorization.authorizer.type === 'solana-ed25519'
  const listMisses = (value: unknown, candidate: unknown, caseSensitive = false) => Array.isArray(value) && !(caseSensitive
    ? value.map(String).includes(String(candidate))
    : value.map(String).map((item) => item.toLowerCase()).includes(String(candidate).toLowerCase()))
  const intent = authorization.intent
  const listFields = ['allowedChainIds', 'allowedActions', 'allowedAssets', 'allowedSenders', 'allowedRecipients']
  const invalidPolicy = listFields.some((field) => policy[field] !== undefined && !Array.isArray(policy[field]))
    || (policy.principals !== undefined && !Array.isArray(policy.principals))
    || (policy.maxAmount != null && !/^(0|[1-9][0-9]*)$/.test(String(policy.maxAmount)))
    || (policy.maxValiditySeconds != null && (typeof policy.maxValiditySeconds !== 'number' || !Number.isSafeInteger(policy.maxValiditySeconds) || policy.maxValiditySeconds < 0))
    || (policy.minConfirmations != null && (typeof policy.minConfirmations !== 'number' || !Number.isSafeInteger(policy.minConfirmations) || policy.minConfirmations < 1 || policy.minConfirmations > 10_000))
    || (policy.maxToleratedReorgDepth != null && (typeof policy.maxToleratedReorgDepth !== 'number' || !Number.isSafeInteger(policy.maxToleratedReorgDepth) || policy.maxToleratedReorgDepth < 0 || policy.maxToleratedReorgDepth > 9_999))
    || (policy.finalityRequirement != null && !['CONFIRMATIONS', 'RPC_FINALIZED'].includes(String(policy.finalityRequirement)))
    || (policy.requireDistinctAuthorizerAndExecutor != null && typeof policy.requireDistinctAuthorizerAndExecutor !== 'boolean')
  if (invalidPolicy) reasons.push('POLICY_INVALID')
  if (listMisses(policy.allowedChainIds, intent.chainId)) reasons.push('POLICY_CHAIN_NOT_ALLOWED')
  if (listMisses(policy.allowedActions, intent.action)) reasons.push('POLICY_ACTION_NOT_ALLOWED')
  if (listMisses(policy.allowedAssets, intent.asset, solana)) reasons.push('POLICY_ASSET_NOT_ALLOWED')
  if (listMisses(policy.allowedSenders, intent.sender, solana)) reasons.push('POLICY_SENDER_NOT_ALLOWED')
  if (listMisses(policy.allowedRecipients, intent.recipient, solana)) reasons.push('POLICY_RECIPIENT_NOT_ALLOWED')
  try {
    if (policy.maxAmount != null && BigInt(intent.amount) > BigInt(String(policy.maxAmount))) reasons.push('POLICY_AMOUNT_EXCEEDED')
    if (policy.maxValiditySeconds != null && intent.validUntil > evaluatedAt + Number(policy.maxValiditySeconds)) reasons.push('POLICY_EXPIRY_TOO_FAR')
    if (policy.minConfirmations != null && Number(intent.constraints?.minConfirmations ?? 0) < Number(policy.minConfirmations)) reasons.push('POLICY_MIN_CONFIRMATIONS_REQUIRED')
    if (policy.finalityRequirement === 'RPC_FINALIZED' && intent.constraints?.finalityRequirement !== 'RPC_FINALIZED') reasons.push('POLICY_FINALIZED_BLOCK_REQUIRED')
    if (policy.maxToleratedReorgDepth != null && Number(intent.constraints?.maxToleratedReorgDepth ?? -1) < Number(policy.maxToleratedReorgDepth)) reasons.push('POLICY_REORG_BUFFER_REQUIRED')
  } catch {
    reasons.push('POLICY_INVALID')
  }
  if (Array.isArray(policy.principals)) {
    const matched = policy.principals.some((value) => {
      const principal = value as Record<string, unknown>
      return principal.id === authorization.principal.id && principal.type === authorization.principal.type && (solana ? String(principal.account) === authorization.principal.account : String(principal.account).toLowerCase() === authorization.principal.account) && principal.authorizerType === authorization.authorizer.type
    })
    if (!matched) reasons.push('POLICY_PRINCIPAL_NOT_ALLOWED')
  }
  if (policy.requireDistinctAuthorizerAndExecutor === true && (solana ? authorization.authorizer.address === authorization.delegate.executor : authorization.authorizer.address.toLowerCase() === authorization.delegate.executor.toLowerCase())) reasons.push('POLICY_AUTHORIZER_EXECUTOR_NOT_DISTINCT')
  return { allowed: reasons.length === 0, reasonCodes: [...new Set(reasons)], policyId: typeof policy.policyId === 'string' ? policy.policyId : null, evaluatedAt }
}

function authorizationTypedDataFor(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization']) {
  const legacyAuthorization = authorization.schema === 'priorseal.authorization.v1'
  return {
    domain: { name: 'PriorSeal', version: legacyAuthorization ? '1' : '2', chainId: Number(authorization.intent.chainId) },
    types: { PriorSealAuthorization: legacyAuthorization ? [
      { name: 'intentHash', type: 'bytes32' }, { name: 'principalId', type: 'string' }, { name: 'principalAccount', type: 'address' }, { name: 'authorizer', type: 'address' }, { name: 'executor', type: 'address' }, { name: 'issuedAt', type: 'uint256' }, { name: 'notBefore', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'authorizationNonce', type: 'bytes32' }, { name: 'maxUses', type: 'uint256' }, { name: 'audience', type: 'string' }, { name: 'policyHash', type: 'bytes32' },
    ] : [
      { name: 'intentHash', type: 'bytes32' }, { name: 'principalType', type: 'string' }, { name: 'principalId', type: 'string' }, { name: 'principalAccount', type: 'address' }, { name: 'authorizerType', type: 'string' }, { name: 'authorizer', type: 'address' }, { name: 'agentId', type: 'string' }, { name: 'executor', type: 'address' }, { name: 'issuedAt', type: 'uint256' }, { name: 'notBefore', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'authorizationNonce', type: 'bytes32' }, { name: 'maxUses', type: 'uint256' }, { name: 'audience', type: 'string' }, { name: 'policyHash', type: 'bytes32' },
    ] },
    primaryType: 'PriorSealAuthorization',
    message: { intentHash: `0x${authorization.intentHash}` as `0x${string}`, ...(!legacyAuthorization ? { principalType: authorization.principal.type } : {}), principalId: authorization.principal.id, principalAccount: authorization.principal.account as `0x${string}`, ...(!legacyAuthorization ? { authorizerType: authorization.authorizer.type } : {}), authorizer: authorization.authorizer.address as `0x${string}`, ...(!legacyAuthorization ? { agentId: authorization.delegate.agentId } : {}), executor: authorization.delegate.executor as `0x${string}`, issuedAt: BigInt(authorization.issuedAt), notBefore: BigInt(authorization.notBefore), expiresAt: BigInt(authorization.expiresAt), authorizationNonce: authorization.authorizationNonce as `0x${string}`, maxUses: BigInt(authorization.maxUses), audience: authorization.audience, policyHash: authorization.policyHash as `0x${string}` },
  } as const
}

/** Validate hashes before showing any authorization to a wallet. Never uses supplied type layouts. */
export async function authorizationSigningData(authorization: NonNullable<Receipt['authorizationEvidence']>['authorization']) {
  if (!validAuthorizationShape(authorization)) throw new TypeError('Invalid prepared authorization')
  if (authorization.notBefore < authorization.issuedAt || authorization.expiresAt < authorization.notBefore || authorization.expiresAt > authorization.intent.validUntil) throw new TypeError('Invalid authorization time window')
  if (authorization.intentHash !== authorization.intent.intentHash || authorization.intentHash !== await hashJson(stripIntentHash(authorization.intent))) throw new TypeError('Prepared intent hash does not match its contents')
  if (authorization.authorizationId !== `auth_${(await hashJson(stripAuthorizationMetadata(authorization))).slice(0, 32)}`) throw new TypeError('Prepared authorization ID does not match its contents')
  if (authorization.authorizer.type === 'solana-ed25519') return { profile: 'solana-ed25519' as const, message: solanaAuthorizationMessage(authorization) }
  return authorizationTypedDataFor(authorization)
}
