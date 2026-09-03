export type ChainId = 1 | 8453 | 42161
export type ChainName = 'Ethereum' | 'Base' | 'Arbitrum'
export type Intent = {
  schema?: string; intentId: string; intentHash?: string; chainId: ChainId | string; action: string; asset: string; amount: string
  sender: string; recipient: string; validUntil: number; nonce?: string; constraints?: { minConfirmations?: number; maxGasUsed?: string }
}
export type ExecutionStatus = 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'NOT_FOUND' | 'RPC_ERROR' | 'UNSUPPORTED_CHAIN'
export type Execution = {
  schema?: string; chainId: ChainId | string; txHash?: string; status: ExecutionStatus; blockNumber?: number | null; blockHash?: string | null
  observedAt?: number; nonce?: string | null; sender?: string | null; recipient?: string | null; asset?: string | null; amount?: string | null
  transfers?: unknown[]; nativeValue?: string | null; tokenValue?: string | null; gasUsed?: string | null; fee?: string | null
  executionDataAvailable?: boolean; observationSource?: string; finalityState?: string; confirmations?: number
}
export type Binding = { bound: boolean; reasonCodes: string[]; [key: string]: unknown }
export type Receipt = {
  schema: string; domain: string; receiptId: string; intentHash: string; executionHash: string; execution: Execution; issuer: string; issuedAt: number
  validUntil: number; outcome: string; reasonCodes: string[]; binding: Binding; algorithm: string; keyId: string; verifierVersion: string; signature: string
}
export type ApiError = Error & { code?: string; status?: number; details?: unknown }
export type VerificationResult = { valid: boolean; code: string; outcome?: string; receiptId?: string }
export type KeyEntry = { issuer: string; keyId: string; algorithm: string; publicKey: string; status: 'active' | 'inactive' | 'expired' | string; validFrom: number | null; validUntil: number | null }
export type KeyRegistry = { schema: string; issuer: string; keys: KeyEntry[]; verifierVersion?: string; schemaVersions?: string[] }
export type LocalActivity = { intents: Intent[]; receipts: Receipt[]; observations: Execution[] }
