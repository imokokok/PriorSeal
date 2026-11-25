import assert from 'node:assert/strict'
import test from 'node:test'

import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN,
  INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES,
  insightPolymarketMarketAssessmentCommitment,
  verifyInsightPolymarketMarketAssessment,
  verifyInsightPolymarketMarketAssessmentAttestation,
} from '../../sdk/dist/index.js'

const signer = privateKeyToAccount(`0x${'44'.repeat(32)}` as `0x${string}`)
const now = 1_800_000_000
const keyRegistry = {
  keys: [{ key_id: 'polymarket-test', public_key: signer.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' as const }],
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

async function signedAssessment() {
  const assessment = {
    schema: 'insight.polymarket-market-assessment.v1',
    verdict: 'ALLOW',
    evaluatedAt: new Date(now * 1000).toISOString(),
    metadataSource: 'polymarket-gamma',
    market: {
      id: '202', conditionId: `0x${'22'.repeat(32)}`, protocolVersion: 'v2', slug: 'team-a-win',
      question: 'Will Team A win the final?', endDate: new Date((now + 3600) * 1000).toISOString(),
      active: true, closed: false, resolutionSource: 'https://example.test/results', liquidity: 250, volume: 1200,
    },
    outcome: { name: 'yes', probability: 0.52 },
    quotes: {
      source: 'polymarket-clob', bestBid: 0.5, bestBidSize: 20, bestAsk: 0.53, bestAskSize: 30,
      spread: 0.03, timestamp: new Date(now * 1000).toISOString(), hash: `0x${'ab'.repeat(32)}`,
    },
    checks: [{ id: 'lifecycle', status: 'pass', detail: 'Market is active and not closed' }],
    reasons: [],
    scope: { transactionAuthority: 'none', forecast: 'not_provided', execution: 'not_performed', suitability: 'not_assessed' },
    disclosure: 'Venue metadata and public CLOB snapshot only.',
  }
  const assessmentHash = keccak256(toBytes(canonical(assessment)))
  const issuedAt = now
  const validUntil = now + 60
  const message = { assessmentHash, marketId: '202', outcome: 'yes', verdict: 0, issuedAt: BigInt(issuedAt), validUntil: BigInt(validUntil), schemaVersion: 1n }
  const typedData = {
    domain: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN,
    types: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES,
    primaryType: 'PolymarketMarketAssessment' as const,
    message,
  }
  return {
    success: true,
    data: {
      assessment,
      attestation: {
        schema: 'insight.polymarket-market-assessment-attestation.v1',
        decisionHash: assessmentHash,
        attestation: {
          type: 'PolymarketMarketAssessment', schemaVersion: 1, uid: hashTypedData(typedData),
          attester: signer.address, signedAt: new Date(issuedAt * 1000).toISOString(), validForSeconds: 60,
          signature: await signer.signTypedData(typedData),
          data: { assessmentHash, marketId: '202', outcome: 'yes', verdict: 0, issuedAt, validUntil, schemaVersion: 1 },
          eip712: { domain: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_DOMAIN, types: INSIGHT_POLYMARKET_MARKET_ASSESSMENT_TYPES, primaryType: 'PolymarketMarketAssessment' },
        },
      },
    },
  }
}

test('verifies signed assessment, trust epoch and canonical context commitment', async () => {
  const response = await signedAssessment()
  assert.doesNotThrow(() => insightPolymarketMarketAssessmentCommitment(response.data.assessment))
  const verification = await verifyInsightPolymarketMarketAssessmentAttestation(response, { keyRegistry, now })
  assert.equal(verification.valid, true, JSON.stringify(verification))
  assert.equal(verification.signatureValid, true)
  assert.equal(verification.trusted, true)

  const commitment = insightPolymarketMarketAssessmentCommitment(response.data.assessment)
  assert.equal(commitment.digest, response.data.attestation.decisionHash)
  assert.equal(verifyInsightPolymarketMarketAssessment(response.data.assessment, commitment.digest).valid, true)
})

test('rejects changed assessment bytes, untrusted issuers, expiry, and altered context digests', async () => {
  const response = await signedAssessment()
  const altered = structuredClone(response)
  altered.data.assessment.market.question = 'Different question'
  assert.equal((await verifyInsightPolymarketMarketAssessmentAttestation(altered, { keyRegistry, now })).valid, false)

  assert.equal((await verifyInsightPolymarketMarketAssessmentAttestation(response, { now })).reason, 'SIGNER_UNTRUSTED')
  assert.equal((await verifyInsightPolymarketMarketAssessmentAttestation(response, { keyRegistry, now: now + 60 })).reason, 'EXPIRED')
  const commitment = insightPolymarketMarketAssessmentCommitment(response.data.assessment)
  assert.equal(verifyInsightPolymarketMarketAssessment(response.data.assessment, `0x${'00'.repeat(32)}`).reason, 'HASH_MISMATCH')
  assert.equal(commitment.algorithm, 'keccak256')
})
