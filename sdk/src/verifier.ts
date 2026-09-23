import type { KeyEntry, KeyRegistry, Receipt, VerificationBundle, VerificationResult } from './types.js'
export { verifyRwaReceiptBundle, inspectRwaReceiptBundle } from './rwa-receipt.js'
import { verifyEd25519 } from './verifier-core.js'
/** Signature only. Does not establish issuer trust, claims, authorization or finality. */
export async function verifyReceiptSignature(receipt: Receipt, publicKey: string): Promise<boolean> {
  try { return await verifyEd25519(receipt, publicKey) } catch { return false }
}
export { buildReviewManifest, verifyReviewManifestLocally, parseTrustProfile } from './review-manifest.js'
export type { InsightProtocolTrust, InsightProtocolResult } from './insight-protocol-trust.js'
export type { ReviewManifest, ReviewAttachment, ReviewAttachmentInput, ReviewArtifactResult, ReviewResult, TrustProfile } from './review-manifest.js'
import {
  hashJson as hashCanonicalJson,
  verifyReceiptOffline as verifyWithTrustedKey,
  verifyTimestampProofOffline as verifyTimestamp,
} from './verifier-core.js'

export type TimestampProofResult = { status: 'VALID' | 'INVALID' | 'MISSING' | 'NOT_REQUIRED'; code: string }

export function verifyReceiptOffline(receipt: Receipt, key: KeyEntry, now?: number, expectedAudience = 'priorseal'): Promise<VerificationResult> {
  return verifyWithTrustedKey(receipt, key, now, expectedAudience)
}

export function verifyTimestampProofOffline(receipt: Receipt): Promise<TimestampProofResult> {
  return verifyTimestamp(receipt)
}

export type ExternalVerificationRequirement =
  | { type: 'ERC1271'; chainId: number; address: string }
  | { type: 'EVM_ANCHOR'; chainId: number; contract: string; txHash: string; blockNumber: number }

export type LocalVerificationResult = VerificationResult & {
  verificationScope: 'LOCAL_COMPLETE' | 'EXTERNAL_CHECK_REQUIRED'
  requiredExternalChecks: ExternalVerificationRequirement[]
}

export type LocalVerifierOptions = {
  trustedKeys?: KeyEntry | readonly KeyEntry[] | KeyRegistry
  now?: number
  expectedAudience?: string
}

export async function verifyReceiptLocally(receiptValue: unknown, options: LocalVerifierOptions = {}): Promise<LocalVerificationResult> {
  if (!isRecord(receiptValue)) {
    return { valid: false, code: 'INVALID_RECEIPT', verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] }
  }
  // The core verifier performs the complete schema validation. This initial
  // object check keeps the public offline boundary safe for untrusted JSON.
  const receipt = receiptValue as Receipt
  const requiredExternalChecks = externalRequirements(receipt)
  const keyResolution = resolveTrustedKey(receipt, options.trustedKeys)
  const result = keyResolution.key
    ? await verifyWithTrustedKey(receipt, keyResolution.key, options.now ?? Math.floor(Date.now() / 1000), options.expectedAudience ?? 'priorseal')
    : { valid: false, code: keyResolution.code, outcome: receipt?.outcome, receiptId: receipt?.receiptId }
  return {
    ...result,
    verificationScope: requiredExternalChecks.length ? 'EXTERNAL_CHECK_REQUIRED' : 'LOCAL_COMPLETE',
    requiredExternalChecks,
  }
}

export async function verifyVerificationBundleLocally(bundleValue: unknown, options: LocalVerifierOptions = {}): Promise<LocalVerificationResult> {
  if (!isRecord(bundleValue)) {
    return { valid: false, code: 'INVALID_VERIFICATION_BUNDLE', verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] }
  }
  // The checks below validate every bundle field before the embedded receipt
  // is handed to the receipt verifier.
  const bundle = bundleValue as VerificationBundle
  const receipt = bundle?.receipt
  const fail = (code: string): LocalVerificationResult => ({ valid: false, code, outcome: receipt?.outcome, receiptId: receipt?.receiptId, verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] })
  if (!bundle || bundle.schema !== 'priorseal.verification-bundle.v1' || bundle.trust?.model !== 'PIN_ISSUER_KEY_OUT_OF_BAND' || bundle.keyRegistry?.schema !== 'priorseal.keys.v1' || !Array.isArray(bundle.keyRegistry.keys) || bundle.keyRegistry.issuer !== receipt?.issuer || !Number.isSafeInteger(bundle.assembledAt) || bundle.assembledAt < 0 || !/^[0-9a-f]{64}$/.test(bundle.bundleHash ?? '')) return fail('INVALID_VERIFICATION_BUNDLE')
  const { bundleHash, ...unsigned } = bundle
  if (bundleHash !== await hashCanonicalJson(unsigned)) return fail('BUNDLE_HASH_MISMATCH')
  return verifyReceiptLocally(receipt, options)
}

export function verifyTimestampProofLocally(receipt: Receipt): Promise<TimestampProofResult> {
  return verifyTimestampProofOffline(receipt)
}

function resolveTrustedKey(receipt: Receipt, source?: KeyEntry | readonly KeyEntry[] | KeyRegistry) {
  if (isKeyRegistry(source) && (source.schema !== 'priorseal.keys.v1' || source.issuer !== receipt?.issuer)) return { key: undefined, code: 'INVALID_KEY_REGISTRY' }
  const keys: readonly KeyEntry[] = !source
    ? []
    : Array.isArray(source)
      ? source as readonly KeyEntry[]
      : isKeyRegistry(source)
        ? source.keys
        : [source as KeyEntry]
  const matches = keys.filter((key) => key.keyId === receipt?.keyId && key.issuer === receipt?.issuer)
  if (matches.length > 1) return { key: undefined, code: 'AMBIGUOUS_KEY' }
  return { key: matches[0], code: 'UNKNOWN_KEY' }
}

function isKeyRegistry(source?: KeyEntry | readonly KeyEntry[] | KeyRegistry): source is KeyRegistry {
  return Boolean(source && !Array.isArray(source) && 'keys' in source)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function externalRequirements(receipt: unknown): ExternalVerificationRequirement[] {
  const requirements: ExternalVerificationRequirement[] = []
  if (!isRecord(receipt) || !isRecord(receipt.authorizationEvidence)) return requirements
  const authorization = receipt.authorizationEvidence.authorization
  if (isRecord(authorization) && isRecord(authorization.authorizer) && authorization.authorizer.type === 'eip1271' && typeof authorization.authorizer.address === 'string' && isRecord(authorization.intent)) {
    const chainId = Number(authorization.intent.chainId)
    if (Number.isSafeInteger(chainId) && chainId > 0) {
      requirements.push({ type: 'ERC1271', chainId, address: authorization.authorizer.address })
    }
  }
  const transparency = receipt.authorizationEvidence.transparency
  const checkpoint = isRecord(transparency) ? transparency.checkpoint : undefined
  const anchor = isRecord(checkpoint) ? checkpoint.anchor : undefined
  if (isRecord(anchor) && anchor.type === 'eip155' && typeof anchor.chainId === 'number' && Number.isSafeInteger(anchor.chainId) && typeof anchor.contract === 'string' && typeof anchor.txHash === 'string' && typeof anchor.blockNumber === 'number' && Number.isSafeInteger(anchor.blockNumber)) {
    requirements.push({
      type: 'EVM_ANCHOR',
      chainId: anchor.chainId,
      contract: anchor.contract,
      txHash: anchor.txHash,
      blockNumber: anchor.blockNumber,
    })
  }
  return requirements
}

export { authorizationSigningData } from './verifier-core.js'
export { verifyRwaReport, rwaInstrumentId, rwaPolicyId, rwaReportDigest } from './insight-rwa.js'
export type { RwaTrust, RwaPolicy, SignedRwaReport } from './insight-rwa.js'
export { verifyCoverageReport, coveragePolicyId, coverageReportDigest } from './insight-coverage.js'
export type { CoverageTrust, CoveragePolicy, SignedCoverageReport } from './insight-coverage.js'
