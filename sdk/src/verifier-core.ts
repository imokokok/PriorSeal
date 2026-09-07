import type { Intent, KeyEntry, Receipt, TimestampPolicy, VerificationResult } from './types.js'
import { verifyTypedData } from 'viem'

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])

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

export async function verifyReceiptOffline(receipt: Receipt, key: KeyEntry, now = Math.floor(Date.now() / 1000)): Promise<VerificationResult> {
  const fail = (code: string): VerificationResult => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId })
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return fail('INVALID_RECEIPT')
    if (!receipt.signature) return fail('MISSING_SIGNATURE')
    if (receipt.schema === 'priorseal.execution-receipt.v2') return await verifyAuthorizedReceiptOffline(receipt, key, now)
    if (receipt.schema !== 'priorseal.execution-receipt.v1') return fail('UNSUPPORTED_SCHEMA')
    if (receipt.algorithm !== 'Ed25519') return fail('UNSUPPORTED_ALGORITHM')
    if (receipt.domain !== 'priorseal/execution-receipt/v1') return fail('INVALID_DOMAIN')
    if (!key || key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY')
    if (key.algorithm !== 'Ed25519' || key.status === 'revoked' || key.issuer !== receipt.issuer) return fail('INVALID_KEY')
    if (key.validFrom != null && receipt.issuedAt < key.validFrom) return fail('KEY_NOT_YET_VALID')
    if (key.validUntil != null && receipt.issuedAt > key.validUntil) return fail('KEY_EXPIRED')
    if (receipt.issuedAt > now) return fail('NOT_YET_VALID')
    if (receipt.executionHash !== await hashJson(receipt.execution)) return fail('EXECUTION_HASH_MISMATCH')
    const { signature, ...unsigned } = receipt
    const imported = await crypto.subtle.importKey('spki', publicKeyBytes(key.publicKey), { name: 'Ed25519' }, false, ['verify'])
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, imported, decodeBase64(signature), new TextEncoder().encode(canonicalize(unsigned)))
    return valid ? { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId } : fail('INVALID_SIGNATURE')
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

async function verifyAuthorizedReceiptOffline(receipt: Receipt, key: KeyEntry, now: number): Promise<VerificationResult> {
  const fail = (code: string): VerificationResult => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId })
  const evidence = receipt.authorizationEvidence
  if (!evidence?.authorization || !evidence.acceptance) return fail('MISSING_AUTHORIZATION_EVIDENCE')
  const authorization = evidence.authorization
  const acceptance = evidence.acceptance
  if (receipt.domain !== 'priorseal/execution-receipt/v2' || receipt.algorithm !== 'Ed25519') return fail('INVALID_DOMAIN')
  const legacyAuthorization = authorization.schema === 'priorseal.authorization.v1'
  if (!legacyAuthorization && authorization.schema !== 'priorseal.authorization.v2') return fail('INVALID_AUTHORIZATION')
  if (authorization.domain !== (legacyAuthorization ? 'priorseal/authorization/v1' : 'priorseal/authorization/v2')) return fail('INVALID_AUTHORIZATION')
  if (!['priorseal.intent.v1', 'priorseal.intent.v2'].includes(authorization.intent.schema ?? '')) return fail('INVALID_AUTHORIZATION')
  const exactCall = authorization.intent.schema === 'priorseal.intent.v2'
  if (exactCall && (authorization.intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1' || authorization.intent.action !== 'CONTRACT_CALL' || authorization.intent.nonce == null || authorization.intent.callTarget == null || authorization.intent.calldataHash == null || authorization.intent.transactionValue == null || !validContextCommitments(authorization.intent.contextCommitments))) return fail('INVALID_AUTHORIZATION')
  if (!exactCall && (authorization.intent.executionProfile != null || authorization.intent.contextCommitments != null)) return fail('INVALID_AUTHORIZATION')
  if (authorization.principal.account.toLowerCase() !== authorization.authorizer.address.toLowerCase()) return fail('INVALID_AUTHORIZATION')
  if (!['user', 'organization'].includes(authorization.principal.type) || !authorization.principal.id || !authorization.delegate.agentId) return fail('INVALID_AUTHORIZATION')
  if (!['eip712', 'eip1271'].includes(authorization.authorizer.type) || authorization.maxUses !== '1') return fail('INVALID_AUTHORIZATION')
  if (!/^0x[0-9a-f]{64}$/i.test(authorization.authorizationNonce) || !/^0x[0-9a-f]{64}$/i.test(authorization.policyHash) || !authorization.audience) return fail('INVALID_AUTHORIZATION')
  if (authorization.notBefore < authorization.issuedAt || authorization.expiresAt < authorization.notBefore || authorization.expiresAt > authorization.intent.validUntil) return fail('INVALID_AUTHORIZATION')
  if (acceptance.schema !== 'priorseal.authorization-receipt.v1' || acceptance.domain !== 'priorseal/authorization-receipt/v1' || acceptance.status !== 'ACCEPTED' || acceptance.algorithm !== 'Ed25519') return fail('INVALID_AUTHORIZATION_RECEIPT')
  if (acceptance.intentHash !== authorization.intentHash || acceptance.acceptedAt < authorization.notBefore || acceptance.acceptedAt > authorization.expiresAt || authorization.issuedAt > acceptance.acceptedAt || receipt.issuedAt < acceptance.acceptedAt) return fail('INVALID_AUTHORIZATION_RECEIPT')
  if (!key || key.keyId !== receipt.keyId) return fail('UNKNOWN_KEY')
  if (key.algorithm !== 'Ed25519' || key.status === 'revoked' || key.issuer !== receipt.issuer) return fail('INVALID_KEY')
  if (key.validFrom != null && (acceptance.acceptedAt < key.validFrom || receipt.issuedAt < key.validFrom)) return fail('KEY_NOT_YET_VALID')
  if (key.validUntil != null && (acceptance.acceptedAt > key.validUntil || receipt.issuedAt > key.validUntil)) return fail('KEY_EXPIRED')
  if (receipt.issuedAt > now) return fail('NOT_YET_VALID')
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
  if (evidence.transparency && !await verifyTransparency(evidence.transparency, acceptance, key.publicKey)) return fail('INVALID_TRANSPARENCY_PROOF')
  if (!authorization.signature) return fail('MISSING_AUTHORIZATION_SIGNATURE')
  if (authorization.authorizer.type === 'eip1271') return fail('AUTHORIZATION_REQUIRES_CHAIN_VERIFICATION')
  const authorizationValid = await verifyTypedData({
    address: authorization.authorizer.address as `0x${string}`,
    domain: { name: 'PriorSeal', version: legacyAuthorization ? '1' : '2', chainId: Number(authorization.intent.chainId) },
    types: { PriorSealAuthorization: legacyAuthorization ? [
      { name: 'intentHash', type: 'bytes32' }, { name: 'principalId', type: 'string' }, { name: 'principalAccount', type: 'address' }, { name: 'authorizer', type: 'address' }, { name: 'executor', type: 'address' }, { name: 'issuedAt', type: 'uint256' }, { name: 'notBefore', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'authorizationNonce', type: 'bytes32' }, { name: 'maxUses', type: 'uint256' }, { name: 'audience', type: 'string' }, { name: 'policyHash', type: 'bytes32' },
    ] : [
      { name: 'intentHash', type: 'bytes32' }, { name: 'principalType', type: 'string' }, { name: 'principalId', type: 'string' }, { name: 'principalAccount', type: 'address' }, { name: 'authorizerType', type: 'string' }, { name: 'authorizer', type: 'address' }, { name: 'agentId', type: 'string' }, { name: 'executor', type: 'address' }, { name: 'issuedAt', type: 'uint256' }, { name: 'notBefore', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'authorizationNonce', type: 'bytes32' }, { name: 'maxUses', type: 'uint256' }, { name: 'audience', type: 'string' }, { name: 'policyHash', type: 'bytes32' },
    ] },
    primaryType: 'PriorSealAuthorization',
    message: { intentHash: `0x${authorization.intentHash}` as `0x${string}`, ...(!legacyAuthorization ? { principalType: authorization.principal.type } : {}), principalId: authorization.principal.id, principalAccount: authorization.principal.account as `0x${string}`, ...(!legacyAuthorization ? { authorizerType: authorization.authorizer.type } : {}), authorizer: authorization.authorizer.address as `0x${string}`, ...(!legacyAuthorization ? { agentId: authorization.delegate.agentId } : {}), executor: authorization.delegate.executor as `0x${string}`, issuedAt: BigInt(authorization.issuedAt), notBefore: BigInt(authorization.notBefore), expiresAt: BigInt(authorization.expiresAt), authorizationNonce: authorization.authorizationNonce as `0x${string}`, maxUses: BigInt(authorization.maxUses), audience: authorization.audience, policyHash: authorization.policyHash as `0x${string}` },
    signature: authorization.signature as `0x${string}`,
  })
  if (!authorizationValid) return fail('INVALID_AUTHORIZATION_SIGNATURE')
  const expectedBinding = bindingFor(authorization.intent, receipt.execution, authorization.delegate.executor, acceptance.acceptedAt, authorization.notBefore, authorization.expiresAt)
  if (canonicalize(expectedBinding) !== canonicalize(receipt.binding) || canonicalize(expectedBinding.reasonCodes) !== canonicalize(receipt.reasonCodes)) return fail('BINDING_MISMATCH')
  if (outcomeFor(authorization.intent, receipt.execution, expectedBinding) !== receipt.outcome) return fail('OUTCOME_MISMATCH')
  const expectedReceiptId = `psr_${(await hashJson({ authorizationHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId })).slice(0, 32)}`
  if (receipt.receiptId !== expectedReceiptId) return fail('RECEIPT_ID_MISMATCH')
  if (!await verifyEd25519(receipt, key.publicKey)) return fail('INVALID_SIGNATURE')
  return { valid: true, code: 'OK', outcome: receipt.outcome, receiptId: receipt.receiptId, authorizationId: authorization.authorizationId }
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
  const exactCall = intent.executionProfile === 'priorseal.execution-profile.exact-call.v1'
  if (execution.executionDataAvailable === false) reasons.push('EXECUTION_UNAVAILABLE')
  if (Number(execution.chainId) !== Number(intent.chainId)) reasons.push('CHAIN_MISMATCH')
  if (!same(execution.action, intent.action)) reasons.push('ACTION_MISMATCH')
  if (!same(execution.sender, intent.sender)) reasons.push('SENDER_MISMATCH')
  if (!exactCall && !same(execution.recipient, intent.recipient)) reasons.push('RECIPIENT_MISMATCH')
  if (!exactCall && !same(execution.asset, intent.asset)) reasons.push('ASSET_MISMATCH')
  if (!exactCall && String(execution.amount ?? '') !== String(intent.amount)) reasons.push('AMOUNT_MISMATCH')
  if (execution.nonce != null && String(execution.nonce) !== String(intent.nonce ?? '0')) reasons.push('NONCE_MISMATCH')
  if (intent.callTarget != null && !same(execution.target, intent.callTarget)) reasons.push('CALL_TARGET_MISMATCH')
  if (intent.calldataHash != null && !same(execution.calldataHash, intent.calldataHash)) reasons.push('CALLDATA_MISMATCH')
  if (intent.transactionValue != null && String(execution.nativeValue ?? '') !== String(intent.transactionValue)) reasons.push('TRANSACTION_VALUE_MISMATCH')
  if ((execution.executedAt ?? execution.observedAt ?? 0) > intent.validUntil) reasons.push('OUTSIDE_TIME_WINDOW')
  if (intent.constraints?.minConfirmations != null && Number(execution.confirmations ?? 0) < intent.constraints.minConfirmations) reasons.push('INSUFFICIENT_FINALITY')
  if (intent.constraints?.maxGasUsed != null && BigInt(execution.gasUsed ?? 0) > BigInt(intent.constraints.maxGasUsed)) reasons.push('GAS_LIMIT_EXCEEDED')
  if (!exactCall && Array.isArray(execution.transfers) && execution.transfers.length > 1 && !execution.transferMatchUnique) reasons.push('AMBIGUOUS_TRANSFER')
  if (!same(execution.sender, executor)) reasons.push('EXECUTOR_MISMATCH')
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
  if (execution.status === 'PENDING') return 'PENDING'
  if (execution.status === 'REVERTED') return 'FAILED'
  if (['NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(execution.status)) return 'UNDETERMINED'
  if (execution.status !== 'CONFIRMED' || !binding.bound) return 'UNDETERMINED'
  if ((execution.executedAt ?? execution.observedAt ?? 0) > intent.validUntil) return 'EXPIRED'
  return 'COMPLETED'
}

async function verifyEd25519(statement: object & { signature?: string }, publicKey: string) {
  const { signature, ...unsigned } = statement
  if (!signature) return false
  const imported = await crypto.subtle.importKey('spki', publicKeyBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'Ed25519' }, imported, decodeBase64(signature), new TextEncoder().encode(canonicalize(unsigned)))
}

async function verifyTransparency(evidence: NonNullable<Receipt['authorizationEvidence']>['transparency'], acceptance: NonNullable<Receipt['authorizationEvidence']>['acceptance'], publicKey: string) {
  if (!evidence?.checkpoint?.signature || !evidence.chain.length) return false
  const first = evidence.chain[0]
  if (first.sequence !== acceptance.sequence || first.entryHash !== acceptance.entryHash) return false
  for (let index = 0; index < evidence.chain.length; index += 1) {
    const entry = evidence.chain[index]
    if (entry.entryHash !== await hashJson({ sequence: entry.sequence, authorizationHash: entry.authorizationHash, acceptedAt: entry.acceptedAt, previousEntryHash: entry.previousEntryHash })) return false
    if (index > 0 && (entry.sequence !== evidence.chain[index - 1].sequence + 1 || entry.previousEntryHash !== evidence.chain[index - 1].entryHash)) return false
  }
  const last = evidence.chain.at(-1)!
  if (last.entryHash !== evidence.checkpoint.headEntryHash || last.sequence !== evidence.checkpoint.size) return false
  if (evidence.checkpoint.anchor && (evidence.checkpoint.anchor.size !== evidence.checkpoint.size || evidence.checkpoint.anchor.headEntryHash !== evidence.checkpoint.headEntryHash)) return false
  return verifyEd25519(evidence.checkpoint, publicKey)
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
  const listMisses = (value: unknown, candidate: unknown) => Array.isArray(value) && !value.map(String).map((item) => item.toLowerCase()).includes(String(candidate).toLowerCase())
  const intent = authorization.intent
  if (listMisses(policy.allowedChainIds, intent.chainId)) reasons.push('POLICY_CHAIN_NOT_ALLOWED')
  if (listMisses(policy.allowedActions, intent.action)) reasons.push('POLICY_ACTION_NOT_ALLOWED')
  if (listMisses(policy.allowedAssets, intent.asset)) reasons.push('POLICY_ASSET_NOT_ALLOWED')
  if (listMisses(policy.allowedSenders, intent.sender)) reasons.push('POLICY_SENDER_NOT_ALLOWED')
  if (listMisses(policy.allowedRecipients, intent.recipient)) reasons.push('POLICY_RECIPIENT_NOT_ALLOWED')
  if (policy.maxAmount != null && BigInt(intent.amount) > BigInt(String(policy.maxAmount))) reasons.push('POLICY_AMOUNT_EXCEEDED')
  if (policy.maxValiditySeconds != null && intent.validUntil > evaluatedAt + Number(policy.maxValiditySeconds)) reasons.push('POLICY_EXPIRY_TOO_FAR')
  if (policy.minConfirmations != null && Number(intent.constraints?.minConfirmations ?? 0) < Number(policy.minConfirmations)) reasons.push('POLICY_MIN_CONFIRMATIONS_REQUIRED')
  if (Array.isArray(policy.principals)) {
    const matched = policy.principals.some((value) => {
      const principal = value as Record<string, unknown>
      return principal.id === authorization.principal.id && principal.type === authorization.principal.type && String(principal.account).toLowerCase() === authorization.principal.account && principal.authorizerType === authorization.authorizer.type
    })
    if (!matched) reasons.push('POLICY_PRINCIPAL_NOT_ALLOWED')
  }
  return { allowed: reasons.length === 0, reasonCodes: reasons, policyId: typeof policy.policyId === 'string' ? policy.policyId : null, evaluatedAt }
}
