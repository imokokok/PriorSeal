import { verifyReceiptLocally, verifyReceiptSignature, type LocalVerifierOptions } from './verifier.js'
import { verifyRwaExecutionPair, type RwaProof } from './rwa-binding.js'
import { inspectRwaReport, type RwaTrust, type SignedRwaReport } from './insight-rwa.js'
import { inspectRwaReportV2, type RwaTrustV2, type SignedRwaReportV2 } from './insight-rwa-v2.js'
import { assessRwaCallOutcome } from './insight-rwa-call.js'
import type { Receipt, KeyEntry, KeyRegistry } from './types.js'

type Axis = 'PASS' | 'FAIL' | 'NOT_CHECKED'
type Bundle = { receipt: Receipt; authority: RwaProof; execution: RwaProof }
export type RwaReceiptDetails = {
  integrity: Axis; trust: Axis; claims: Axis; time: Axis; policy: Axis
  execution: 'SATISFIED' | 'FAILED' | 'NOT_CHECKED'
  externalChecks: 'REQUIRED' | 'NONE'; admissible: boolean
  reasons: string[]; executionEvidenceDigest: string | null
}
/** Independent axes: authentic failed executions are not forged evidence.
 * PASS verifies signed observer claims, not independent RPC finality or asset ownership.
 */
export async function inspectRwaReceiptBundle(input: Bundle, trust: RwaTrust | RwaTrustV2, receiptOptions: LocalVerifierOptions): Promise<RwaReceiptDetails> {
  const out: RwaReceiptDetails = { integrity: 'NOT_CHECKED', trust: 'NOT_CHECKED', claims: 'NOT_CHECKED', time: 'NOT_CHECKED', policy: 'NOT_CHECKED', execution: 'NOT_CHECKED', externalChecks: 'NONE', admissible: false, reasons: [], executionEvidenceDigest: null }
  try {
    const b = structuredClone(input), pins = structuredClone(trust), options = structuredClone(receiptOptions), r = b.receipt
    const source = options.trustedKeys
    const registry = source && !Array.isArray(source) && 'keys' in source ? source as KeyRegistry : undefined
    const keys: readonly KeyEntry[] = !source ? [] : Array.isArray(source) ? source : registry ? registry.keys : [source as KeyEntry]
    const matches = keys.filter(k => k.issuer === r.issuer && k.keyId === r.keyId)
    if (matches.length !== 1) { out.trust = 'FAIL'; out.reasons.push('RWA_RECEIPT_KEY_MISSING_OR_AMBIGUOUS'); return out }
    out.integrity = await verifyReceiptSignature(r, matches[0].publicKey) ? 'PASS' : 'FAIL'
    const local = await verifyReceiptLocally(r, options)
    out.externalChecks = local.requiredExternalChecks.length ? 'REQUIRED' : 'NONE'
    const key = matches[0]
    const windows = [key.validFrom, key.validUntil].every(v => v == null || (Number.isSafeInteger(v) && v > 0)) && (key.validFrom == null || key.validUntil == null || key.validFrom <= key.validUntil)
    out.trust = windows && key.algorithm === 'Ed25519' && ['active', 'retired'].includes(key.status) && (key.validFrom == null || r.issuedAt >= key.validFrom) && (key.validUntil == null || r.issuedAt <= key.validUntil) && !(registry && (registry.schema !== 'priorseal.keys.v1' || registry.issuer !== r.issuer)) ? 'PASS' : 'FAIL'
    if (out.integrity !== 'PASS' || out.trust !== 'PASS') { out.reasons.push(local.code); return out }
    out.claims = local.valid ? 'PASS' : out.externalChecks === 'REQUIRED' && ['AUTHORIZATION_VERIFIER_UNAVAILABLE', 'AUTHORIZATION_REQUIRES_CHAIN_VERIFICATION'].includes(local.code) ? 'NOT_CHECKED' : 'FAIL'
    if (!local.valid) out.reasons.push(local.code)
    const e = r.authorizationEvidence, executedAt = r.execution.executedAt
    if (!e || executedAt == null) { out.reasons.push('RWA_EXECUTION_TIME_OR_AUTHORIZATION_MISSING'); return out }
    const inspect = (proof: RwaProof, at: number) => proof.report.schema === 'insight.rwa-report.v2' ? inspectRwaReportV2(proof as SignedRwaReportV2, pins as RwaTrustV2, at) : inspectRwaReport(proof as SignedRwaReport, pins, at)
    const [a, x] = await Promise.all([inspect(b.authority, e.acceptance.acceptedAt), inspect(b.execution, executedAt)])
    if (a.integrity !== 'PASS' || x.integrity !== 'PASS') out.integrity = 'FAIL'
    if (a.trust !== 'PASS' || x.trust !== 'PASS') out.trust = 'FAIL'
    out.time = a.time === 'PASS' && x.time === 'PASS' && executedAt < e.authorization.intent.validUntil && r.issuedAt <= (options.now ?? Math.floor(Date.now() / 1000)) ? 'PASS' : 'FAIL'
    const pair = await verifyRwaExecutionPair({ intent: e.authorization.intent, authority: { proof: b.authority, trust: pins }, execution: { proof: b.execution, trust: pins }, authorityTime: e.acceptance.acceptedAt, executionTime: executedAt })
    out.policy = pair.valid ? 'PASS' : 'FAIL'
    out.reasons.push(...pair.reasons)
    out.executionEvidenceDigest = pair.executionEvidenceDigest
    out.execution = r.schema === 'priorseal.execution-receipt.v3' && r.binding.bound && r.compliance?.status === 'COMPLIANT' && r.executionStatus === 'CONFIRMED' && r.outcome === 'COMPLETED' ? 'SATISFIED' : 'FAILED'
    if (out.execution === 'FAILED') out.reasons.push('RWA_RECEIPT_NOT_COMPLIANT')
    if (out.claims !== 'PASS') out.execution = 'NOT_CHECKED'
    if (out.execution === 'SATISFIED' && b.execution.report.schema === 'insight.rwa-report.v2' && out.policy !== 'PASS') out.execution = 'NOT_CHECKED'
    if (out.execution === 'SATISFIED' && b.execution.report.schema === 'insight.rwa-report.v2') {
      if (!Array.isArray(r.execution.transfers)) { out.execution = 'NOT_CHECKED'; out.reasons.push('RWA_TRANSFERS_MISSING') }
      else {
        out.execution = 'NOT_CHECKED'
        const transfers = r.execution.transfers.map(t => { const v = (t ?? {}) as Record<string, unknown>; return { token: v.asset as string, from: v.sender as string, to: v.recipient as string, amount: v.amount as string, logIndex: v.logIndex as number } })
        const outcome = assessRwaCallOutcome(b.execution.report.semantics, e.authorization.intent.sender!, transfers)
        out.execution = outcome.satisfied ? 'SATISFIED' : 'FAILED'
        if (!outcome.satisfied) { out.execution = 'FAILED'; out.reasons.push(...outcome.reasons) }
      }
    }
    out.admissible = [out.integrity, out.trust, out.claims, out.time, out.policy].every(v => v === 'PASS') && out.execution === 'SATISFIED' && out.externalChecks === 'NONE'
    if (out.externalChecks === 'REQUIRED') out.reasons.push('RWA_EXTERNAL_CHECK_REQUIRED')
  } catch (error) { out.admissible = false; out.reasons.push(error instanceof Error ? error.message : 'RWA_RECEIPT_INVALID') }
  return out
}
/** Strict execution acceptance. Use inspectRwaReceiptBundle to inspect authentic failures. */
export async function verifyRwaReceiptBundle(input: Bundle, trust: RwaTrust | RwaTrustV2, receiptOptions: LocalVerifierOptions) {
  const r = await inspectRwaReceiptBundle(input, trust, receiptOptions)
  return { valid: r.admissible, reasons: r.reasons, executionEvidenceDigest: r.admissible ? r.executionEvidenceDigest : null }
}
