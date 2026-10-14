import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { DecisionInputRequest, PreTradeRequest } from '../../insight/sdk/dist/types.js'

const fixtureSigner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const oracleDomain = { name: 'Insight Oracle Safety', version: '3', chainId: 1 } as const
const oracleTypes = {
  OracleSafetyCheck: [
    { name: 'verdict', type: 'string' },
    { name: 'sourceAssetId', type: 'string' },
    { name: 'destinationAssetId', type: 'string' },
    { name: 'subjectChainId', type: 'uint256' },
    { name: 'action', type: 'string' },
    { name: 'tradeAmountUsd', type: 'uint256' },
    { name: 'consensusPrice', type: 'uint256' },
    { name: 'maxDeviationBps', type: 'uint256' },
    { name: 'manipulationRiskBps', type: 'uint256' },
    { name: 'participantCount', type: 'uint256' },
    { name: 'requiredParticipantCount', type: 'uint256' },
    { name: 'coverageStatus', type: 'string' },
    { name: 'independenceStatus', type: 'string' },
    { name: 'sourceGroupCount', type: 'uint256' },
    { name: 'crossProviderAgreementBps', type: 'uint256' },
    { name: 'maxStablecoinDepegBps', type: 'uint256' },
    { name: 'maxDataAgeSeconds', type: 'uint256' },
    { name: 'recommendedMaxPositionUsd', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' },
    { name: 'requestHash', type: 'bytes32' },
    { name: 'evaluationScope', type: 'string' },
    { name: 'evaluatedAssetIdsHash', type: 'bytes32' },
    { name: 'providerObservationsHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'requiredSourceGroupCount', type: 'uint256' },
  ],
} as const
const decisionDomain = {
  name: 'Insight Decision Input Assessment',
  version: '1',
  chainId: 1,
} as const
const decisionTypes = {
  DecisionInputAssessment: [
    { name: 'assessmentHash', type: 'bytes32' },
    { name: 'linkedPreTradeUid', type: 'bytes32' },
    { name: 'verifyUrlHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const

type LocalPreTrade = {
  verdict: string
  attestation: { uid: string; [key: string]: unknown }
  decisionInputAssessment?: Record<string, unknown>
  [key: string]: unknown
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

export async function createInsightLocalDecisionInputFixture(input: {
  chainId: number
  inputToken: `0x${string}`
  outputToken: `0x${string}`
  tradeAmountUsd: number
  now: number
}) {
  const sourceAssetId = `eip155:${input.chainId}/erc20:${input.inputToken}`
  const destinationAssetId = `eip155:${input.chainId}/erc20:${input.outputToken}`
  const policy = {
    policyId: 'priorseal-local-chain-drill',
    version: '1',
    assetIds: { LOCAL_IN: sourceAssetId, LOCAL_OUT: destinationAssetId },
    maxReferenceDeviationBps: 100,
    maxSlippageBps: 50,
    maxQuoteAgeSeconds: 90,
  }
  const decisionInputTrust = {
    policy,
    keyRegistry: {
      public_keys: [{
        key_id: 'priorseal-local-chain-drill-key',
        public_key: fixtureSigner.address,
        revoked: false,
        role: 'attester',
        validFrom: new Date(0).toISOString(),
        validUntil: null,
      }],
    },
  }

  async function signedPreTrade(sourceSide: boolean): Promise<LocalPreTrade> {
    const checkedAt = input.now - 5
    const validUntil = checkedAt + 900
    const message = {
      verdict: 'PASS',
      sourceAssetId: sourceSide ? sourceAssetId : destinationAssetId,
      destinationAssetId: sourceSide ? destinationAssetId : sourceAssetId,
      subjectChainId: BigInt(input.chainId),
      action: 'swap',
      tradeAmountUsd: BigInt(input.tradeAmountUsd),
      consensusPrice: 100_000_000n,
      maxDeviationBps: 100n,
      manipulationRiskBps: 0n,
      participantCount: 3n,
      requiredParticipantCount: 3n,
      coverageStatus: 'SUFFICIENT',
      independenceStatus: 'ASSESSED',
      sourceGroupCount: 2n,
      crossProviderAgreementBps: 9_900n,
      maxStablecoinDepegBps: 0n,
      maxDataAgeSeconds: 20n,
      recommendedMaxPositionUsd: 1_000_000n,
      reasonCodesHash: `0x${'1'.repeat(64)}` as `0x${string}`,
      requestHash: `0x${sourceSide ? 'a' : 'b'}${'1'.repeat(63)}` as `0x${string}`,
      evaluationScope: 'SOURCE_ASSET_ONLY',
      evaluatedAssetIdsHash: `0x${'2'.repeat(64)}` as `0x${string}`,
      providerObservationsHash: `0x${'3'.repeat(64)}` as `0x${string}`,
      validUntil: BigInt(validUntil),
      checkedAt: BigInt(checkedAt),
      schemaVersion: 3n,
      requiredSourceGroupCount: 2n,
    }
    const typedData = { domain: oracleDomain, types: oracleTypes, primaryType: 'OracleSafetyCheck', message }
    const uid = hashTypedData(typedData as never)
    const signature = await fixtureSigner.signTypedData(typedData as never)
    const data = Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]))
    const attestation = {
      uid,
      schemaVersion: 3,
      attester: fixtureSigner.address,
      signature,
      signedAt: new Date(checkedAt * 1000).toISOString(),
      validUntil,
      validForSeconds: validUntil - checkedAt,
      verifyUrl: 'https://oracleinsight.xyz/api/v1/safety/attestation/verify',
      eip712: { domain: oracleDomain, types: oracleTypes, primaryType: 'OracleSafetyCheck' },
      data,
    }
    return {
      verdict: 'PASS',
      consensusPrice: 1,
      maxDeviationPct: 1,
      crossProviderAgreement: 0.99,
      recommendedMaxPositionUsd: 1_000_000,
      participantCount: 3,
      warnings: [],
      contributingFactors: [],
      evaluatedAt: new Date(checkedAt * 1000).toISOString(),
      attestation,
    } as LocalPreTrade
  }

  async function signedDecisionInput(asset: 'LOCAL_IN' | 'LOCAL_OUT', linkedPreTradeUid: string) {
    const issuedAt = input.now - 2
    const validUntil = issuedAt + 300
    const quoteObservedAt = new Date((input.now - 10) * 1000).toISOString()
    const unsigned = {
      schemaVersion: 1,
      status: 'SUFFICIENT',
      eligibleToProceed: true,
      asset,
      chainId: input.chainId,
      action: 'swap',
      tradeAmountUsd: input.tradeAmountUsd,
      evaluatedAt: new Date((input.now - 5) * 1000).toISOString(),
      operationRouteQuote: null,
      quoteInputHash: `0x${'4'.repeat(64)}`,
      policy: {
        maxReferenceDeviationBps: policy.maxReferenceDeviationBps,
        maxSlippageBps: policy.maxSlippageBps,
        maxQuoteAgeSeconds: policy.maxQuoteAgeSeconds,
      },
      prices: {
        decisionPriceUsd: 1,
        quotePriceUsd: 1.0001,
        quoteObservedAt,
        quoteAgeSeconds: 5,
        quoteDeviationBps: 1,
      },
      evidence: { source: 'isolated-local-chain-drill' },
      reasons: [],
      caveats: [],
    }
    const assessmentHash = keccak256(toBytes(canonicalJson(unsigned)))
    const verifyUrl = 'https://oracleinsight.xyz/api/v1/safety/decision-input/verify?uid=local-drill'
    const verifyUrlHash = keccak256(toBytes(verifyUrl))
    const message = {
      assessmentHash,
      linkedPreTradeUid: linkedPreTradeUid as `0x${string}`,
      verifyUrlHash,
      issuedAt: BigInt(issuedAt),
      validUntil: BigInt(validUntil),
      schemaVersion: 1n,
    }
    const typedData = { domain: decisionDomain, types: decisionTypes, primaryType: 'DecisionInputAssessment', message }
    const attestation = {
      type: 'DecisionInputAssessment',
      schemaVersion: 1,
      uid: hashTypedData(typedData as never),
      attester: fixtureSigner.address,
      attesterLabel: 'Insight Decision Input Assessment attester',
      signedAt: new Date(issuedAt * 1000).toISOString(),
      validForSeconds: 300,
      signature: await fixtureSigner.signTypedData(typedData as never),
      verifyUrl,
      data: { ...message, issuedAt, validUntil, schemaVersion: 1 },
      eip712: { domain: decisionDomain, types: decisionTypes, primaryType: 'DecisionInputAssessment' },
    }
    return { ...unsigned, attestation }
  }

  const [sourcePreTrade, destinationPreTrade] = await Promise.all([
    signedPreTrade(true),
    signedPreTrade(false),
  ])
  const source: PreTradeRequest & { decisionInput: DecisionInputRequest } = {
    asset: 'LOCAL_IN', destinationAsset: 'LOCAL_OUT', chainId: input.chainId,
    action: 'swap', tradeAmountUsd: input.tradeAmountUsd,
    decisionInput: {
      decisionPriceUsd: 1, quotePriceUsd: 1.0001,
      quoteObservedAt: new Date((input.now - 10) * 1000).toISOString(),
      maxReferenceDeviationBps: 100, maxSlippageBps: 50, maxQuoteAgeSeconds: 90,
    },
  }
  const destination: PreTradeRequest & { decisionInput: DecisionInputRequest } = {
    asset: 'LOCAL_OUT', destinationAsset: 'LOCAL_IN', chainId: input.chainId,
    action: 'swap', tradeAmountUsd: input.tradeAmountUsd,
    decisionInput: {
      decisionPriceUsd: 1, quotePriceUsd: 1.0001,
      quoteObservedAt: new Date((input.now - 10) * 1000).toISOString(),
      maxReferenceDeviationBps: 100, maxSlippageBps: 50, maxQuoteAgeSeconds: 90,
    },
  }
  sourcePreTrade.decisionInputAssessment = await signedDecisionInput('LOCAL_IN', sourcePreTrade.attestation.uid)
  destinationPreTrade.decisionInputAssessment = await signedDecisionInput('LOCAL_OUT', destinationPreTrade.attestation.uid)

  const fetch = async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request))
    if (url.pathname === '/api/v1/execution/attestation/issue' && init?.method === 'POST') {
      const receiptRequest = JSON.parse(String(init.body)) as Record<string, unknown>
      const attestationData = {
        ...receiptRequest,
        executionStatus: 'FAITHFUL',
        verificationOrigin: 'local-test-fixture',
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          attestation: {
            uid: keccak256(toBytes(canonicalJson(attestationData))),
            schemaVersion: 5,
            data: attestationData,
          },
          executionStatus: 'FAITHFUL',
          bindingMode: 'VERIFIED',
          binding: { bound: true, verificationOrigin: 'local-test-fixture' },
        },
        meta: { requestId: 'priorseal-local-chain-drill-receipt-fixture' },
      }), { headers: { 'content-type': 'application/json' } })
    }
    const asset = url.searchParams.get('asset')
    const data = asset === 'LOCAL_IN' ? sourcePreTrade : asset === 'LOCAL_OUT' ? destinationPreTrade : null
    if (data) {
      return new Response(JSON.stringify({ success: true, data, meta: { requestId: 'priorseal-local-chain-drill' } }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: false, error: { code: 'LOCAL_FIXTURE_UNAVAILABLE' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { source, destination, decisionInputTrust, fetch }
}
