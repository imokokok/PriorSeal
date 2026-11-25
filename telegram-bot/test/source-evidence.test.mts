import assert from 'node:assert/strict'
import test from 'node:test'
import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
  INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
  insightPolymarketSourceEvidenceCommitment,
} from '../../sdk/src/insight-polymarket-market-evidence.js'
import { collectMarketEvidence } from '../src/source-evidence.ts'

const signer = privateKeyToAccount(`0x${'47'.repeat(32)}` as `0x${string}`)
const now = Math.floor(Date.now() / 1000)
const keyRegistry = {
  keys: [{
    key_id: 'insight-polymarket-test',
    public_key: signer.address,
    validFrom: new Date(0).toISOString(),
    validUntil: null,
    revoked: false,
    role: 'attester',
  }],
}
const evidence = {
  schema: 'insight.polymarket-source-evidence.v1',
  collectedAt: new Date((now - 30) * 1000).toISOString(),
  market: {
    id: 'market-1', slug: 'cpi-market', question: 'A market question?',
    rulesDigest: `0x${'12'.repeat(32)}`, resolutionSource: 'https://www.bls.gov/',
    endDate: new Date((now + 3600) * 1000).toISOString(), outcomeNames: ['Yes', 'No'],
  },
  binding: { source: 'server-reviewed-source-binding', reviewedAt: new Date((now - 60) * 1000).toISOString(), reviewer: 'market-source-review' },
  checks: { marketActive: true, marketOpen: true, rulesDigestStable: true, resolutionSourceDeclared: true, sourceEvidenceRetrieved: true },
  observations: [{
    id: 'unemployment', provider: 'bls.series', evidence: {
      schema: 'insight.polymarket-bls-series-evidence.v1', source: 'us-bls-public-data-api-v1', apiVersion: 1,
      sourceUrl: 'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000', seriesId: 'LNS14000000',
      observation: { year: '2026', period: 'M10', periodName: 'October', value: '4.0', numericValue: 4, footnotes: [] },
      retrievedAt: new Date((now - 30) * 1000).toISOString(),
      disclosure: 'BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.',
    },
  }],
  reviewWarnings: [], requiresHumanReview: false,
  scope: { outcomeEvaluation: 'not_performed', settlement: 'not_performed', transactionAuthority: 'none', execution: 'not_performed' },
  disclosure: 'This record contains market-integrity checks and source observations only. It does not compare an observation to a market threshold and does not evaluate an event outcome, produce a forecast, recommend a position, or authorize execution.',
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

async function signedResponse() {
  const evidenceHash = keccak256(toBytes(canonical(evidence)))
  const issuedAt = now
  const validUntil = now + 300
  const typedData = {
    domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN,
    types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES,
    primaryType: 'PolymarketSourceEvidence' as const,
    message: { evidenceHash, marketId: evidence.market.id, issuedAt: BigInt(issuedAt), validUntil: BigInt(validUntil), schemaVersion: 1n },
  }
  return {
    success: true,
    data: {
      evidence,
      attestation: {
        schema: 'insight.polymarket-source-evidence-attestation.v1',
        decisionHash: evidenceHash,
        attestation: {
          type: 'PolymarketSourceEvidence', schemaVersion: 1, uid: hashTypedData(typedData),
          attester: signer.address, signedAt: new Date(issuedAt * 1000).toISOString(), validForSeconds: 300,
          signature: await signer.signTypedData(typedData),
          data: { evidenceHash, marketId: evidence.market.id, issuedAt, validUntil, schemaVersion: 1 },
          eip712: { domain: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_DOMAIN, types: INSIGHT_POLYMARKET_SOURCE_EVIDENCE_TYPES, primaryType: 'PolymarketSourceEvidence' },
        },
      },
    },
  }
}

function mockFetcher(response: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/.well-known/oracle-keys.json')) {
      return new Response(JSON.stringify(keyRegistry), { headers: { 'content-type': 'application/json' } })
    }
    if (url.endsWith('/api/v1/polymarket/evidence')) {
      return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('unexpected URL', { status: 404 })
  }
  return { calls, fetcher }
}

test('fetches reviewed evidence, verifies Insight signature, and returns a PriorSeal commitment', async () => {
  const response = await signedResponse()
  const { calls, fetcher } = mockFetcher(response)
  const record = await collectMarketEvidence({
    INSIGHT_API_KEY: 'test-api-key',
    INSIGHT_BASE_URL: 'https://www.oracleinsight.xyz',
    INSIGHT_KEY_REGISTRY_URL: 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json',
  }, evidence.market.id, fetcher)
  const commitment = insightPolymarketSourceEvidenceCommitment(response)
  assert.match(record.summary, /PriorSeal: Insight signature and trusted key verified/)
  assert.match(record.summary, new RegExp(commitment.digest))
  assert.match(record.summary, /Outcome evaluation and settlement: not performed/)
  assert.equal(record.evidenceHash, commitment.digest)
  assert.match(record.payloadJson, /insight\.polymarket-source-evidence-attestation\.v1/)
  assert.ok(calls.some((call) => call.url.endsWith('/api/v1/polymarket/evidence') && call.init.method === 'POST'))
  const evidenceCall = calls.find((call) => call.url.endsWith('/api/v1/polymarket/evidence'))!
  assert.equal(new Headers(evidenceCall.init.headers).get('X-API-Key'), 'test-api-key')
  assert.deepEqual(JSON.parse(String(evidenceCall.init.body)), { marketId: 'market-1' })
})

test('fails closed on modified evidence and rejects non-Insight upstream origins', async () => {
  const response = await signedResponse()
  response.data.evidence.market.question = 'Modified question'
  const { fetcher } = mockFetcher(response)
  await assert.rejects(collectMarketEvidence({
    INSIGHT_API_KEY: 'test-api-key',
    INSIGHT_BASE_URL: 'https://www.oracleinsight.xyz',
    INSIGHT_KEY_REGISTRY_URL: 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json',
  }, evidence.market.id, fetcher), /EVIDENCE_ATTESTATION_EVIDENCE_HASH_MISMATCH/)
  const unsigned = { success: true, data: { evidence } }
  const { fetcher: unsignedFetcher } = mockFetcher(unsigned)
  await assert.rejects(collectMarketEvidence({
    INSIGHT_API_KEY: 'test-api-key',
    INSIGHT_BASE_URL: 'https://www.oracleinsight.xyz',
    INSIGHT_KEY_REGISTRY_URL: 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json',
  }, evidence.market.id, unsignedFetcher), /EVIDENCE_ATTESTATION_MALFORMED/)
  await assert.rejects(collectMarketEvidence({
    INSIGHT_API_KEY: 'test-api-key',
    INSIGHT_BASE_URL: 'https://attacker.example',
    INSIGHT_KEY_REGISTRY_URL: 'https://attacker.example/.well-known/oracle-keys.json',
  }, evidence.market.id, fetcher), /BOT_UPSTREAM_URL_INVALID/)
})
