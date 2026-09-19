import { encodeAbiParameters, keccak256 } from 'viem'
import type { KeyRegistry as InsightKeyRegistry, RoutableAttestation } from 'verify-insight-receipt'
import { hashJson } from './verifier-core.js'
import { verifyVerificationBundleLocally, type LocalVerifierOptions, type LocalVerificationResult } from './verifier.js'
import { matchUniqueContextCommitment } from './context-commitment.js'
import type { KeyEntry, VerificationBundle } from './types.js'

export type TrustProfile = {
  schema: 'priorseal.trust-profile.v1'
  id?: string
  name?: string
  issuer: string
  audience: string
  keys: KeyEntry[]
  source: string
  confirmedAt: number
  insightKeyRegistry?: InsightKeyRegistry
}

/** Parsing never confers trust: the caller must confirm the source independently. */
export function parseTrustProfile(input: unknown): TrustProfile {
  const p = input as TrustProfile
  if (!p || p.schema !== 'priorseal.trust-profile.v1' || !p.issuer?.trim() || !p.audience?.trim() || !p.source?.trim() || !Number.isSafeInteger(p.confirmedAt) || p.confirmedAt < 0 || !Array.isArray(p.keys) || !p.keys.length || p.keys.length > 100) throw new TypeError('Invalid trust profile')
  const ids = new Set<string>()
  for (const key of p.keys) {
    if (key.issuer !== p.issuer || !key.keyId || ids.has(key.keyId) || key.algorithm !== 'Ed25519' || !key.publicKey?.includes('BEGIN PUBLIC KEY') || !['active', 'retired', 'revoked'].includes(key.status)) throw new TypeError('Invalid or ambiguous trust key')
    ids.add(key.keyId)
    for (const time of [key.validFrom, key.validUntil]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new TypeError('Invalid key time window')
    if (key.validFrom !== null && key.validUntil !== null && key.validFrom > key.validUntil) throw new TypeError('Invalid key time window')
  }
  if (p.insightKeyRegistry) {
    const keys = p.insightKeyRegistry.public_keys ?? p.insightKeyRegistry.keys
    if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new TypeError('Invalid Insight key registry')
    const seen = new Set<string>()
    for (const key of keys) {
      const address = key.public_key?.toLowerCase()
      if (!/^0x[0-9a-f]{40}$/.test(address) || seen.has(address) || typeof key.revoked !== 'boolean' || !Number.isFinite(Date.parse(key.validFrom)) || (key.validUntil !== null && (!Number.isFinite(Date.parse(key.validUntil)) || Date.parse(key.validUntil) < Date.parse(key.validFrom)))) throw new TypeError('Invalid or ambiguous Insight trust key')
      seen.add(address)
    }
  }
  return structuredClone(p)
}

export type ReviewAttachmentInput = { id: string; role: string; profile: string; rawJson: string }
export type ReviewAttachment = ReviewAttachmentInput & { sha256: string }
export type ReviewManifest = {
  schema: 'priorseal.review-manifest.v1'
  bundle: VerificationBundle
  attachments: ReviewAttachment[]
  expectedTxHash: string | null
  assembledAt: number
  manifestHash: string
}
export type ReviewArtifactResult = { id: string; role: string; profile: string; integrityValid: boolean; signatureValid: boolean | null; trusted: boolean | null; code: string }
export type ReviewResult = {
  valid: boolean
  code: string
  verificationOrigin: 'local'
  priorSeal: LocalVerificationResult
  artifacts: ReviewArtifactResult[]
  relations: { transaction: boolean | null; insightPair: boolean | null; insightAuthorizationBinding: boolean | null }
  requiredExternalChecks: LocalVerificationResult['requiredExternalChecks']
  unverified: string[]
}

const roles = new Set(['insight.source', 'insight.destination', 'insight.execution'])
const txHashPattern = /^0x[0-9a-fA-F]{64}$/
const MAX_ATTACHMENT_BYTES = 512 * 1024

function validateAttachments(attachments: ReviewAttachmentInput[]) {
  if (!Array.isArray(attachments) || attachments.length > 32) throw new TypeError('At most 32 evidence attachments are allowed')
  const ids = new Set<string>(), uniqueRoles = new Set<string>()
  for (const artifact of attachments) {
    if (!artifact || !/^[A-Za-z0-9._:-]{1,128}$/.test(artifact.id) || ids.has(artifact.id) || typeof artifact.profile !== 'string' || !artifact.profile || artifact.profile.length > 128 || typeof artifact.role !== 'string' || !artifact.role || artifact.role.length > 128 || typeof artifact.rawJson !== 'string' || new TextEncoder().encode(artifact.rawJson).length > MAX_ATTACHMENT_BYTES) throw new TypeError('Invalid evidence attachment')
    ids.add(artifact.id)
    if (roles.has(artifact.role)) {
      if (uniqueRoles.has(artifact.role)) throw new TypeError('Ambiguous evidence role')
      uniqueRoles.add(artifact.role)
    }
    JSON.parse(artifact.rawJson)
  }
}

async function hashBytes(raw: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

async function insightVerifier() {
  // The upstream package is CommonJS; browser bundlers can expose only `default`.
  const namespace = await import('verify-insight-receipt')
  return ((namespace as unknown as { default?: typeof namespace }).default ?? namespace)
}

/** Keeps original signed bytes alongside, never re-signs or upgrades their authority. */
export async function buildReviewManifest(input: { bundle: VerificationBundle; attachments?: ReviewAttachmentInput[]; expectedTxHash?: string; assembledAt?: number }): Promise<ReviewManifest> {
  const attachments = input.attachments ?? []
  validateAttachments(attachments)
  if (input.bundle?.schema !== 'priorseal.verification-bundle.v1') throw new TypeError('A native verification bundle is required')
  const expectedTxHash = input.expectedTxHash ?? input.bundle.receipt.execution.txHash ?? null
  if (expectedTxHash !== null && !txHashPattern.test(expectedTxHash)) throw new TypeError('Invalid expected transaction hash')
  const assembledAt = input.assembledAt ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(assembledAt) || assembledAt < 0) throw new TypeError('Invalid assembly time')
  const content = {
    schema: 'priorseal.review-manifest.v1' as const,
    bundle: structuredClone(input.bundle),
    attachments: await Promise.all(attachments.map(async item => ({ ...item, sha256: await hashBytes(item.rawJson) }))),
    expectedTxHash,
    assembledAt,
  }
  return { ...content, manifestHash: await hashJson(content) }
}

/** The manifest's keys are discovery metadata only. All verification uses caller trust. */
export async function verifyReviewManifestLocally(manifest: ReviewManifest, options: LocalVerifierOptions & { insightKeyRegistry?: InsightKeyRegistry } = {}): Promise<ReviewResult> {
  const empty: LocalVerificationResult = { valid: false, code: 'INVALID_REVIEW_MANIFEST', verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] }
  const result: ReviewResult = { valid: false, code: 'INVALID_REVIEW_MANIFEST', verificationOrigin: 'local', priorSeal: empty, artifacts: [], relations: { transaction: null, insightPair: null, insightAuthorizationBinding: null }, requiredExternalChecks: [], unverified: [] }
  try {
    if (manifest?.schema !== 'priorseal.review-manifest.v1' || !Number.isSafeInteger(manifest.assembledAt) || manifest.assembledAt < 0 || !/^[0-9a-f]{64}$/.test(manifest.manifestHash) || (manifest.expectedTxHash !== null && !txHashPattern.test(manifest.expectedTxHash))) return result
    validateAttachments(manifest.attachments)
    const { manifestHash, ...content } = manifest
    if (await hashJson(content) !== manifestHash) return { ...result, code: 'MANIFEST_HASH_MISMATCH' }
    result.priorSeal = await verifyVerificationBundleLocally(manifest.bundle, options)
    result.requiredExternalChecks = result.priorSeal.requiredExternalChecks
    const proofs: Record<string, RoutableAttestation> = {}
    const registry = options.insightKeyRegistry
    const registryKeys = registry?.public_keys ?? registry?.keys ?? []
    for (const attachment of manifest.attachments) {
      const row: ReviewArtifactResult = { id: attachment.id, role: attachment.role, profile: attachment.profile, integrityValid: await hashBytes(attachment.rawJson) === attachment.sha256, signatureValid: null, trusted: null, code: 'UNSUPPORTED_VERIFIER_PROFILE' }
      result.artifacts.push(row)
      if (!row.integrityValid) { row.code = 'ARTIFACT_HASH_MISMATCH'; continue }
      const proof = JSON.parse(attachment.rawJson) as RoutableAttestation
      const version = Number(proof?.data?.schemaVersion ?? proof?.schemaVersion)
      const supported = roles.has(attachment.role) && (attachment.role === 'insight.execution' ? attachment.profile === `insight.execution.v${version}` && [2, 3, 4].includes(version) : attachment.profile === `insight.pretrade.v${version}` && [2, 3].includes(version))
      if (!supported) { result.unverified.push(attachment.id); continue }
      const { verifyReceipt: verifyInsight, verifyExecutionReceipt } = await insightVerifier()
      const verified = attachment.role === 'insight.execution' ? await verifyExecutionReceipt(proof, { keyRegistry: registry }) : await verifyInsight(proof, { keyRegistry: registry })
      row.signatureValid = ['ok', 'expired'].includes(verified.code)
      const matches = registryKeys.filter(key => key.public_key.toLowerCase() === proof.attester?.toLowerCase())
      row.trusted = verified.keyStatus === 'valid' && matches.length === 1 && matches[0].role !== 'sample'
      row.code = row.signatureValid ? row.trusted ? verified.expired ? 'HISTORICAL_SIGNATURE_VALID' : 'OK' : 'SIGNER_UNTRUSTED' : verified.code
      if (row.signatureValid && row.trusted) proofs[attachment.role] = proof
    }
    const receipt = manifest.bundle.receipt
    const expected = receipt.execution.txHash?.toLowerCase()
    const execution = proofs['insight.execution']
    result.relations.transaction = Boolean(expected && txHashPattern.test(expected) && (!manifest.expectedTxHash || manifest.expectedTxHash.toLowerCase() === expected) && (!execution || (
      String(execution.data.txHash).toLowerCase() === expected &&
      Number(execution.data.settlementChainId) === Number(receipt.execution.chainId) &&
      Number(execution.data.settlementChainId) === Number(receipt.authorizationEvidence?.authorization.intent.chainId) &&
      Number(execution.data.executedAt) === Number(receipt.execution.executedAt) &&
      String(execution.data.taker).toLowerCase() === receipt.execution.sender?.toLowerCase() &&
      String(execution.data.taker).toLowerCase() === receipt.authorizationEvidence?.authorization.delegate.executor.toLowerCase()
    )))
    const source = proofs['insight.source'], destination = proofs['insight.destination']
    const hasInsight = manifest.attachments.some(attachment => roles.has(attachment.role))
    const commitsInsight = receipt.authorizationEvidence?.authorization.intent.contextCommitments?.some(c => c.namespace === 'insight.pretrade-pair.v1')
    if (hasInsight || commitsInsight) {
      if (!source || !destination || !execution) result.unverified.push('insight.complete_pair')
      if (source && destination && execution) {
        const { verifyExecutionPair } = await insightVerifier()
        const pair = await verifyExecutionPair(source, execution, destination, { keyRegistry: registry })
        // A legacy single-sided C4 cannot establish this manifest's two-sided claim.
        result.relations.insightPair = Number(execution.data.schemaVersion) >= 3 &&
          String(execution.data.preTradeUid).toLowerCase() === source.uid.toLowerCase() &&
          String(execution.data.destinationPreTradeUid).toLowerCase() === destination.uid.toLowerCase() && pair.pairedValid
        const slippage = Number(execution.data.maxSlippageBps)
        const commitment = { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256' as const, digest: keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }], [source.uid as `0x${string}`, destination.uid as `0x${string}`, source.data.requestHash as `0x${string}`, destination.data.requestHash as `0x${string}`, slippage])) }
        const authorization = receipt.authorizationEvidence?.authorization
        const inAuthorizationWindow = [source, destination].every(proof => authorization && Number(proof.data.checkedAt) <= authorization.issuedAt && Number(proof.data.validUntil) >= authorization.expiresAt)
        result.relations.insightAuthorizationBinding = Boolean(authorization && inAuthorizationWindow && matchUniqueContextCommitment(authorization.intent, commitment).matched)
      }
    }
    const artifactsVerified = result.artifacts.every(row => row.integrityValid && row.signatureValid === true && row.trusted === true)
    const relationsValid = Object.values(result.relations).every(value => value !== false)
    result.valid = result.priorSeal.valid && artifactsVerified && relationsValid && result.unverified.length === 0 && result.requiredExternalChecks.length === 0
    result.code = result.valid ? 'OK' : !result.priorSeal.valid ? result.priorSeal.code : !relationsValid ? 'EVIDENCE_RELATION_MISMATCH' : 'INCOMPLETE_VERIFICATION'
    return result
  } catch {
    return { ...result, valid: false, code: 'INVALID_REVIEW_MANIFEST' }
  }
}
