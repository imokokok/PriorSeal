import { hashJson } from './verifier-core.js'
import { verifyReviewManifestLocally, type ReviewManifest, type ReviewResult } from './review-manifest.js'

const LIMITS = [
  'The native review manifest is the evidence object; this wrapper does not issue a signature or verdict.',
  'Insight and PriorSeal retain separate trust roots and verification scopes.',
  'A service payment, including x402, is not authorization for the subject action and is not execution evidence.',
] as const

export type ServicePaymentAttachment = { kind: 'x402-service-payment'; rawJson: string }
export type ActionEvidencePassportSummary = { assessmentArtifactIds: string[]; authorizationId: string; receiptId: string; txHash: string; executionStatus: string; complianceStatus: string }
export type ActionEvidencePassport = {
  schema: 'priorseal.action-evidence-passport.v1'
  kind: 'presentation-wrapper'
  title: string
  assembledAt: number
  reviewManifest: ReviewManifest
  summary: ActionEvidencePassportSummary
  servicePayment: (ServicePaymentAttachment & { sha256: string }) | null
  limits: typeof LIMITS
}
export type ActionEvidencePassportVerification = {
  valid: boolean
  code: 'OK' | 'INVALID_PASSPORT' | 'PASSPORT_SUMMARY_MISMATCH' | 'SERVICE_PAYMENT_BYTES_MISMATCH' | 'NATIVE_REVIEW_INVALID'
  review: ReviewResult | null
  servicePayment: 'ABSENT' | 'UNVERIFIED_SERVICE_PAYMENT'
}

type JsonRecord = Record<string, unknown>
function record(value: unknown, label: string): JsonRecord { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as JsonRecord }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value || value.length > 512) throw new TypeError(`${label} must be a non-empty string up to 512 characters`); return value }
function rawJson(value: unknown): string { if (typeof value !== 'string' || !value || new TextEncoder().encode(value).byteLength > 512 * 1024) throw new TypeError('service payment must be JSON bytes up to 512 KiB'); JSON.parse(value); return value }
async function rawJsonHash(value: string) { return hashJson({ rawJson: value }) }

export function summarizeActionEvidencePassport(manifest: ReviewManifest): ActionEvidencePassportSummary {
  const receipt = record(manifest.bundle?.receipt, 'review manifest receipt')
  const execution = record(receipt.execution, 'review manifest execution')
  const authorization = record(record(receipt.authorizationEvidence, 'review manifest authorization evidence').authorization, 'review manifest authorization')
  const compliance = record(receipt.compliance, 'review manifest compliance')
  return {
    assessmentArtifactIds: manifest.attachments.filter((attachment) => attachment.role.startsWith('insight.')).map((attachment) => attachment.id),
    authorizationId: text(authorization.authorizationId, 'authorizationId'), receiptId: text(receipt.receiptId, 'receiptId'), txHash: text(execution.txHash, 'txHash'),
    executionStatus: text(receipt.executionStatus, 'executionStatus'), complianceStatus: text(compliance.status, 'compliance status'),
  }
}

/** Builds a portable presentation wrapper without changing embedded evidence bytes or claims. */
export async function createActionEvidencePassport(input: { title: string; assembledAt?: number; reviewManifest: ReviewManifest; servicePayment?: ServicePaymentAttachment }): Promise<ActionEvidencePassport> {
  const assembledAt = input.assembledAt ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(assembledAt) || assembledAt < 0) throw new TypeError('assembledAt must be a Unix-second timestamp')
  if (!input.reviewManifest || input.reviewManifest.schema !== 'priorseal.review-manifest.v1') throw new TypeError('A native PriorSeal review manifest is required')
  const paymentBytes = input.servicePayment === undefined ? null : rawJson(input.servicePayment.rawJson)
  return { schema: 'priorseal.action-evidence-passport.v1', kind: 'presentation-wrapper', title: text(input.title, 'title'), assembledAt, reviewManifest: structuredClone(input.reviewManifest), summary: summarizeActionEvidencePassport(input.reviewManifest), servicePayment: paymentBytes === null ? null : { kind: 'x402-service-payment', rawJson: paymentBytes, sha256: await rawJsonHash(paymentBytes) }, limits: LIMITS }
}

function sameSummary(left: ActionEvidencePassportSummary, right: ActionEvidencePassportSummary) {
  return left.authorizationId === right.authorizationId && left.receiptId === right.receiptId && left.txHash === right.txHash && left.executionStatus === right.executionStatus && left.complianceStatus === right.complianceStatus && Array.isArray(left.assessmentArtifactIds) && left.assessmentArtifactIds.length === right.assessmentArtifactIds.length && left.assessmentArtifactIds.every((id, index) => id === right.assessmentArtifactIds[index])
}

/** Parses the wrapper only; it never grants trust to the embedded keys or evidence. */
export function parseActionEvidencePassport(value: unknown): ActionEvidencePassport {
  const passport = record(value, 'Action Evidence Passport')
  if (passport.schema !== 'priorseal.action-evidence-passport.v1' || passport.kind !== 'presentation-wrapper') throw new TypeError('Unsupported Action Evidence Passport')
  if (!Number.isSafeInteger(passport.assembledAt) || Number(passport.assembledAt) < 0) throw new TypeError('Invalid Passport assembly time')
  const reviewManifest = passport.reviewManifest as ReviewManifest
  if (!reviewManifest || reviewManifest.schema !== 'priorseal.review-manifest.v1') throw new TypeError('Passport has no native review manifest')
  const summary = record(passport.summary, 'Passport summary') as unknown as ActionEvidencePassportSummary
  if (!Array.isArray(summary.assessmentArtifactIds) || summary.assessmentArtifactIds.some((id) => typeof id !== 'string') || typeof summary.authorizationId !== 'string' || typeof summary.receiptId !== 'string' || typeof summary.txHash !== 'string' || typeof summary.executionStatus !== 'string' || typeof summary.complianceStatus !== 'string') throw new TypeError('Invalid Passport summary')
  let servicePayment: ActionEvidencePassport['servicePayment'] = null
  if (passport.servicePayment !== null && passport.servicePayment !== undefined) {
    const attachment = record(passport.servicePayment, 'service payment')
    if (attachment.kind !== 'x402-service-payment' || typeof attachment.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(attachment.sha256)) throw new TypeError('Invalid service payment attachment')
    servicePayment = { kind: 'x402-service-payment', rawJson: rawJson(attachment.rawJson), sha256: attachment.sha256 }
  }
  if (!Array.isArray(passport.limits) || passport.limits.length !== LIMITS.length || passport.limits.some((limit, index) => limit !== LIMITS[index])) throw new TypeError('Invalid Passport limits')
  return { schema: 'priorseal.action-evidence-passport.v1', kind: 'presentation-wrapper', title: text(passport.title, 'title'), assembledAt: Number(passport.assembledAt), reviewManifest, summary, servicePayment, limits: LIMITS }
}

/** Verifies the original manifest and its summary; payment bytes remain unverified service metadata. */
export async function verifyActionEvidencePassport(input: unknown, options: Parameters<typeof verifyReviewManifestLocally>[1] = {}): Promise<ActionEvidencePassportVerification> {
  let passport: ActionEvidencePassport
  try { passport = parseActionEvidencePassport(input) } catch { return { valid: false, code: 'INVALID_PASSPORT', review: null, servicePayment: 'ABSENT' } }
  const servicePayment = passport.servicePayment === null ? 'ABSENT' : 'UNVERIFIED_SERVICE_PAYMENT'
  if (passport.servicePayment && passport.servicePayment.sha256 !== await rawJsonHash(passport.servicePayment.rawJson)) return { valid: false, code: 'SERVICE_PAYMENT_BYTES_MISMATCH', review: null, servicePayment }
  let summary: ActionEvidencePassportSummary
  try { summary = summarizeActionEvidencePassport(passport.reviewManifest) } catch { return { valid: false, code: 'INVALID_PASSPORT', review: null, servicePayment } }
  if (!sameSummary(passport.summary, summary)) return { valid: false, code: 'PASSPORT_SUMMARY_MISMATCH', review: null, servicePayment }
  const review = await verifyReviewManifestLocally(passport.reviewManifest, options)
  return review.valid ? { valid: true, code: 'OK', review, servicePayment } : { valid: false, code: 'NATIVE_REVIEW_INVALID', review, servicePayment }
}
