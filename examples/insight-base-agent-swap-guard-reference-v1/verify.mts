// Offline review of the Insight Base Agent Swap Guard reference fixture.
// Verifies the committed artifacts without any API, RPC, or network access:
//
//   assess  — Insight's signed ALLOW with both exact calldata bindings
//   bind    — two ordered exact-call intents carrying the decision commitment
//   authorize — two principal-signed exact-call authorizations, adjacent nonces
//   observe — one signed PriorSeal receipt per call, approval before swap
//   review  — the full receipt bundle plus fail-closed counterexamples
//   close   — Insight's signed settlement cross-bound to the same decision
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  detectInsightBaseAgentSwapGuardSettlementContradictions,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyBaseAgentSwapGuardReceiptBundle,
  verifyBaseAgentSwapGuardSettlementForDecision,
  verifyInsightBaseAgentSwapGuardDecision,
} from '../../sdk/dist/index.js'
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js'

const directory = dirname(fileURLToPath(import.meta.url))
const sha256 = (path: string) => createHash('sha256').update(readFileSync(join(directory, path))).digest('hex')
const readJson = (relativePath: string): unknown => JSON.parse(readFileSync(join(directory, relativePath), 'utf8'))

type Check = { id: string; stage: 'assess' | 'bind' | 'authorize' | 'observe' | 'review' | 'close'; expected: string; actual: string; pass: boolean }

const checks: Check[] = []
const record = (id: string, stage: Check['stage'], expected: string, actual: string) =>
  checks.push({ id, stage, expected, actual, pass: expected === actual })

const decision = readJson('fixture/insight-decision.json')
const insightTrust = { keyRegistry: readJson('fixture/insight-key-registry.json') as never, now: 1_792_252_800 }
const priorSealTrust = { trustedKeys: readJson('fixture/issuer-key.json') as never, now: 1_792_252_821, expectedAudience: 'priorseal' }
const intents = readJson('fixture/intents.json') as { approval: Record<string, unknown>; swap: Record<string, unknown> }
const approvalReceipt = readJson('fixture/receipts/approval.json')
const swapReceipt = readJson('fixture/receipts/swap.json')
const manifest = readJson('MANIFEST.json') as { files: Record<string, { sha256: string }>; timeline: Record<string, number> }

// Fixture integrity: every committed artifact matches the generated manifest.
for (const [relativePath, expected] of Object.entries(manifest.files)) {
  record(`integrity:${relativePath}`, 'review', expected.sha256, sha256(relativePath))
}

// Stage 1 — assess: Insight's signed ALLOW, independently verified.
const decisionResult = await verifyInsightBaseAgentSwapGuardDecision(decision, insightTrust)
record('assess:decision-valid', 'assess', 'true', String(decisionResult.valid))
record('assess:reason', 'assess', 'OK', decisionResult.reason)

// Stage 2 — bind: the committed intents carry the decision commitment.
const expectedDigest = String((decision as { decisionHash: string }).decisionHash).toLowerCase()
for (const stage of ['approval', 'swap'] as const) {
  const commitments = Array.isArray(intents[stage].contextCommitments) ? intents[stage].contextCommitments as Array<{ namespace: string; digest: string }> : []
  const matched = commitments.some((entry) => entry.namespace === 'insight.base-agent-swap-guard.v1' && entry.digest === expectedDigest)
  record(`bind:${stage}-commitment`, 'bind', 'true', String(matched))
}
record('bind:ordered-nonces', 'bind', '1', String(BigInt(String(intents.swap.nonce)) - BigInt(String(intents.approval.nonce))))

// Stage 3 — authorize: both authorizations verified as an ordered pair.
const authorizationResult = await verifyBaseAgentSwapGuardAuthorizationBundle({
  approval: readJson('fixture/authorizations/approval.json'),
  swap: readJson('fixture/authorizations/swap.json'),
  decision,
}, { keyRegistry: insightTrust.keyRegistry })
record('authorize:bundle-valid', 'authorize', 'true', String(authorizationResult.valid))
record('authorize:reason', 'authorize', 'OK', authorizationResult.reason)
// Stage 4 — observe: one valid signed receipt per call, approval first.
for (const [stage, receipt] of [['approval', approvalReceipt], ['swap', swapReceipt]] as const) {
  const result = await verifyReceiptLocally(receipt, priorSealTrust)
  record(`observe:${stage}-receipt`, 'observe', 'true', String(result.valid))
}
const approvalExecutedAt = Number((approvalReceipt as { execution: { executedAt: number } }).execution.executedAt)
const swapExecutedAt = Number((swapReceipt as { execution: { executedAt: number } }).execution.executedAt)
record('observe:approval-before-swap', 'observe', 'true', String(approvalExecutedAt < swapExecutedAt))

// Stage 5 — review: the full receipt bundle, offline.
const bundleResult = await verifyBaseAgentSwapGuardReceiptBundle({
  approvalReceipt,
  swapReceipt,
  decision,
  priorSealTrust,
  insightTrust,
})
record('review:receipt-bundle', 'review', 'true', String(bundleResult.valid))
record('review:receipt-bundle-reason', 'review', 'OK', bundleResult.reason)

// Fail-closed: a tampered swap receipt is rejected by the bundle verifier.
const tamperedSwapReceipt = structuredClone(swapReceipt) as { signature: string }
tamperedSwapReceipt.signature = `${tamperedSwapReceipt.signature.slice(0, -1)}${tamperedSwapReceipt.signature.endsWith('A') ? 'B' : 'A'}`
const tamperedResult = await verifyBaseAgentSwapGuardReceiptBundle({
  approvalReceipt,
  swapReceipt: tamperedSwapReceipt,
  decision,
  priorSealTrust,
  insightTrust,
})
record('review:tampered-swap-receipt-rejected', 'review', 'false', String(tamperedResult.valid))

// Fail-closed: an authorization that outlives the signed Insight decision.
const outlivesResult = await verifyBaseAgentSwapGuardAuthorizationBundle({
  approval: readJson('fixture/authorizations/outlives.json'),
  swap: readJson('fixture/authorizations/swap.json'),
  decision,
}, { keyRegistry: insightTrust.keyRegistry })
record('review:authorization-outlives-decision-rejected', 'review', 'AUTHORIZATION_OUTLIVES_INSIGHT_DECISION', outlivesResult.reason)

// Stage 6 — close: Insight's signed settlement, cross-bound to the same
// decision, with double-settlement contradiction detection over the pair.
const settlement = readJson('fixture/settlement.json')
const contradictorySettlement = readJson('fixture/settlement-contradictory.json')
const closeResult = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement, decision }, insightTrust)
record('close:settlement-for-decision', 'close', 'true', String(closeResult.valid))
record('close:settlement-reason', 'close', 'OK', closeResult.reason)

// Fail-closed: a settlement whose swap transaction was altered after signing.
const tamperedSettlement = structuredClone(settlement) as { data: { swapTxHash: string } }
tamperedSettlement.data.swapTxHash = `0x${'f0'.repeat(32)}`
const tamperedClose = await verifyBaseAgentSwapGuardSettlementForDecision({ settlement: tamperedSettlement, decision }, insightTrust)
record('close:tampered-settlement-rejected', 'close', 'false', String(tamperedClose.valid))

// Fail-closed: two closures of one decision claiming different executed
// transactions — something no honest settlement can produce.
const contradictoryReport = await detectInsightBaseAgentSwapGuardSettlementContradictions([settlement, contradictorySettlement], insightTrust)
record('close:contradiction-detected', 'close', 'false', String(contradictoryReport.consistent))
record('close:contradiction-count', 'close', '1', String(contradictoryReport.contradictions.length))

// A single consistent closure (the honest pair would be a byte-identical replay).
const consistentReport = await detectInsightBaseAgentSwapGuardSettlementContradictions([settlement], insightTrust)
record('close:single-settlement-consistent', 'close', 'true', String(consistentReport.consistent))

// The committed report must describe exactly this review. `--update` writes it
// after regenerating fixtures; a plain run only reads and compares.
const reportPath = join(directory, 'report.json')
const update = process.argv.includes('--update')
const failed = checks.filter((entry) => !entry.pass)
const summary = { result: failed.length === 0 ? 'PASS' : 'FAIL', total: checks.length, failed: failed.length }
const reportContent = `${JSON.stringify({ schema: 'insight.base-agent-swap-guard.reference-report.v1', fixtureId: 'insight-base-agent-swap-guard-reference-v1', summary, checks }, null, 2)}\n`
if (update) {
  writeFileSync(reportPath, reportContent)
} else {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { checks: Array<Pick<Check, 'id' | 'expected' | 'actual' | 'pass'>>; summary: { result: string } }
  const reportMatches = report.checks.length === checks.length &&
    checks.every((entry, index) => report.checks[index].id === entry.id && report.checks[index].expected === entry.expected && report.checks[index].actual === entry.actual && report.checks[index].pass === entry.pass) &&
    report.summary.result === summary.result
  record('report:matches-recomputed-review', 'review', 'true', String(reportMatches))
  const finalFailed = checks.filter((entry) => !entry.pass)
  const finalSummary = { result: finalFailed.length === 0 ? 'PASS' : 'FAIL', total: checks.length, failed: finalFailed.length }
  console.log(JSON.stringify({ schema: 'insight.base-agent-swap-guard.reference-report.v1', fixtureId: 'insight-base-agent-swap-guard-reference-v1', summary: finalSummary, checks }, null, 2))
  if (finalSummary.result !== 'PASS') process.exitCode = 1
}
if (update) console.log(JSON.stringify({ report: 'updated', summary }, null, 2))
