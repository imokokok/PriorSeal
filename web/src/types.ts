export type ChainId = 1 | 8453 | 42161
export type ChainName = 'Ethereum' | 'Base' | 'Arbitrum'
export type Intent = {
  schema?: string; intentId: string; intentHash?: string; chainId: ChainId | string; action: string; asset: string; amount: string
  sender: string; recipient: string; validUntil: number; nonce?: string; callTarget?: string; calldataHash?: string; transactionValue?: string; constraints?: { minConfirmations?: number; maxGasUsed?: string }
}
export type ExecutionStatus = 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'REORGED' | 'NOT_FOUND' | 'RPC_ERROR' | 'UNSUPPORTED_CHAIN'
export type Execution = {
  schema?: string; chainId: ChainId | string; txHash?: string; status: ExecutionStatus; blockNumber?: number | null; blockHash?: string | null
  executedAt?: number | null; observedAt?: number; action?: string | null; nonce?: string | null; sender?: string | null; recipient?: string | null; target?: string | null; calldataHash?: string | null; asset?: string | null; amount?: string | null
  transfers?: unknown[]; transferMatchUnique?: boolean; nativeValue?: string | null; tokenValue?: string | null; gasUsed?: string | null; fee?: string | null
  executionDataAvailable?: boolean; observationSource?: string; finalityState?: string; confirmations?: number
  previousBlockHash?: string
}
export type Binding = { bound: boolean; reasonCodes: string[]; [key: string]: unknown }
export type Authorization = {
  schema: 'runproof.authorization.v1'; domain: string; authorizationId: string; intent: Intent; intentHash: string
  principal: { type: 'user' | 'organization'; id: string; account: string }
  authorizer: { type: 'eip712' | 'eip1271'; address: string }
  delegate: { agentId: string; executor: string }
  issuedAt: number; notBefore: number; expiresAt: number; authorizationNonce: string; maxUses: string; audience: string; policyHash: string; signature?: string
}
export type AuthorizationReceipt = { schema: string; domain: string; authorizationId: string; authorizationHash: string; intentHash: string; acceptedAt: number; sequence: number; previousEntryHash: string | null; entryHash: string; status: string; issuer: string; algorithm: string; keyId: string; signature: string }
export type PolicyEvidence = { schema: 'runproof.policy-evidence.v1'; policyHash: string; document: Record<string, unknown> | null; result: { allowed: boolean; reasonCodes: string[]; policyId: string | null; evaluatedAt: number } }
export type TimestampPolicy = { schema: 'runproof.timestamp-policy.v1'; profile: 'digicert-rfc3161-v1'; maxClockSkewSeconds: number }
export type TimestampEvidence = { schema: 'runproof.rfc3161-evidence.v1'; domain: string; profile: string; tsaUrl: string; authorizationHash: string; requestedAt: number; nonce: string; timestamp: number; serialNumber: string; policyOid: string; digestAlgorithm: string; responseHash: string; response: string }
export type WitnessPolicy = { schema: 'runproof.witness-policy.v1'; threshold: number; maxClockSkewSeconds: number; witnesses: { witnessId: string; keyId: string; algorithm: 'Ed25519'; publicKey: string }[] }
export type WitnessRequest = { schema: 'runproof.witness-request.v1'; domain: string; authorizationId: string; authorizationHash: string; intentHash: string; requester: string; requestedAt: number; expiresAt: number }
export type WitnessAttestation = { schema: 'runproof.witness-attestation.v1'; domain: string; witnessId: string; keyId: string; algorithm: 'Ed25519'; requestHash: string; authorizationId: string; authorizationHash: string; intentHash: string; observedAt: number; expiresAt: number; signature: string }
export type WitnessEvidence = { schema: 'runproof.witness-evidence.v1'; domain: string; policyHash: string; request: WitnessRequest; attestations: WitnessAttestation[] }
export type TransparencyEntry = { sequence: number; authorizationHash: string; acceptedAt: number; previousEntryHash: string | null; entryHash: string }
export type TransparencyEvidence = { checkpoint: { schema: string; domain: string; size: number; headEntryHash: string; issuedAt: number; issuer: string; algorithm: string; keyId: string; anchor: null | { type: 'eip155'; chainId: number; contract: string; txHash: string; blockNumber: number; anchoredAt: number; size: number; headEntryHash: string }; signature: string }; chain: TransparencyEntry[] }
export type AuthorizationRecord = { authorization: Authorization; acceptance: AuthorizationReceipt; policyEvidence?: PolicyEvidence; timestampEvidence?: TimestampEvidence; witnessEvidence?: WitnessEvidence; status?: string; boundTxHash?: string | null; uses?: number }
export type Receipt = {
  schema: string; domain: string; receiptId: string; intentHash: string; executionHash: string; execution: Execution; issuer: string; issuedAt: number
  validUntil: number; outcome: string; reasonCodes: string[]; binding: Binding; algorithm: string; keyId: string; verifierVersion: string; signature: string
  authorizationHash?: string; authorizationEvidence?: { authorization: Authorization; acceptance: AuthorizationReceipt; policy: PolicyEvidence; timestamp?: TimestampEvidence; witnesses?: WitnessEvidence; transparency?: TransparencyEvidence }
}
export type ApiError = Error & { code?: string; status?: number; details?: unknown }
export type VerificationResult = { valid: boolean; code: string; outcome?: string; receiptId?: string; authorizationId?: string }
export type KeyEntry = { issuer: string; keyId: string; algorithm: string; publicKey: string; status: 'active' | 'inactive' | 'expired' | string; validFrom: number | null; validUntil: number | null }
export type KeyRegistry = { schema: string; issuer: string; keys: KeyEntry[]; verifierVersion?: string; schemaVersions?: string[] }
export type LocalActivity = { intents: Intent[]; authorizations: AuthorizationRecord[]; receipts: Receipt[]; observations: Execution[] }
