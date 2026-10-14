import type {
  AcceptedAuthorization,
  ObservationJob,
  ObservationResult,
  PreparedAuthorization,
  WaitForObservationOptions,
} from '../sdk/dist/types.js'

/**
 * Keep the local cross-repository drill buildable from a standalone PriorSeal
 * checkout. Runtime execution still loads the actual Insight SDK module.
 */
export interface DecisionInputRequest {
  decisionPriceUsd: number
  quotePriceUsd: number
  quoteObservedAt: string
  maxReferenceDeviationBps: number
  maxSlippageBps: number
  maxQuoteAgeSeconds: number
}

export interface PreTradeRequest {
  asset: string
  destinationAsset: string
  chainId: number
  action: 'swap'
  tradeAmountUsd: number
  decisionInput: DecisionInputRequest
}

export interface DecisionInputTrust {
  policy: {
    policyId: string
    version: string
    assetIds: Record<string, string>
    maxReferenceDeviationBps: number
    maxSlippageBps: number
    maxQuoteAgeSeconds: number
  }
  keyRegistry: { public_keys: Array<Record<string, unknown>> }
}

export interface GuardOptions {
  apiKey: string
  fetch: typeof globalThis.fetch
  decisionInputTrust: DecisionInputTrust
}

export interface PriorSealGuardedSwapResult {
  status: 'executed'
  transactionRisk: { status: string; [key: string]: unknown }
  evidenceStatus: string
  assuranceValid: boolean | null
  transactionCorrelation: boolean | null
  independentVerificationPerformed: boolean
  priorSealAuthorization: AcceptedAuthorization
  transaction: { txHash: string; [key: string]: unknown }
}

export interface PriorSealDrillClient {
  prepareAuthorization(input: unknown, signal?: AbortSignal): Promise<PreparedAuthorization>
  acceptAuthorization(authorization: unknown, signal?: AbortSignal): Promise<AcceptedAuthorization>
  observeExecution(input: unknown, signal?: AbortSignal): Promise<ObservationResult>
  getObservationJob(jobId: string, signal?: AbortSignal): Promise<ObservationJob>
  waitForObservationJob(jobId: string, options?: WaitForObservationOptions): Promise<ObservationJob>
}

export interface TrustedV3PriorSealGuardedSwapRequest<TClient extends PriorSealDrillClient> {
  source: PreTradeRequest
  destination: PreTradeRequest
  receipt: { settlementChainId: number; maxSlippageBps: number }
  v3Risk: {
    routerAddress: `0x${string}`
    routerCodeHash: `0x${string}`
    maxOracleDeviationBps: number
    maxSlippageBps: number
    maxBlockAgeSeconds: number
    reader: {
      getBlock(...args: never[]): Promise<unknown>
      getBytecode(...args: never[]): Promise<unknown>
      readContract(...args: never[]): Promise<unknown>
      call(...args: never[]): Promise<unknown>
    }
  }
  priorSeal: {
    client: TClient
    principal: { type: 'user'; id: string; account: string }
    agentId: string
    issuedAt: number
    confirmations: number
    audience: string
    signAuthorization(input: { typedData: unknown }): Promise<string>
  }
  prepareTransaction(...args: never[]): Promise<unknown>
  submitTransaction: (...args: never[]) => Promise<unknown>
}

