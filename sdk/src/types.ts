export type ChainId = 1 | 8453 | 42161

export type ContextCommitment = { namespace: string; algorithm: 'keccak256' | 'sha256'; digest: string }
export type ContextCommitmentMatch = {
  matched: boolean
  code: 'OK' | 'CONTEXT_COMMITMENT_MISSING' | 'CONTEXT_COMMITMENT_AMBIGUOUS' | 'CONTEXT_COMMITMENT_ALGORITHM_MISMATCH' | 'CONTEXT_COMMITMENT_DIGEST_MISMATCH'
  commitment: ContextCommitment | null
}

export type Intent = {
  schema?: 'priorseal.intent.v1' | 'priorseal.intent.v2'
  executionProfile?: 'priorseal.execution-profile.exact-call.v1'
  intentId: string
  intentHash?: string
  chainId: number | string
  action: string
  asset: string
  amount: string
  sender: string
  recipient: string
  validUntil: number
  nonce?: string
  callTarget?: string
  calldataHash?: string
  transactionValue?: string
  contextCommitments?: ContextCommitment[]
  constraints?: { minConfirmations?: number; maxGasUsed?: string }
}

export type ExecutionStatus = 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'REORGED' | 'NOT_FOUND' | 'RPC_ERROR' | 'UNSUPPORTED_CHAIN'

export type Execution = {
  schema?: string
  chainId: ChainId | string
  txHash?: string
  status: ExecutionStatus
  blockNumber?: number | null
  blockHash?: string | null
  executedAt?: number | null
  observedAt?: number
  action?: string | null
  nonce?: string | null
  sender?: string | null
  recipient?: string | null
  target?: string | null
  calldataHash?: string | null
  asset?: string | null
  amount?: string | null
  transfers?: unknown[]
  transferMatchUnique?: boolean
  nativeValue?: string | null
  tokenValue?: string | null
  gasUsed?: string | null
  fee?: string | null
  executionDataAvailable?: boolean
  observationSource?: string
  finalityState?: string
  confirmations?: number
  previousBlockHash?: string
}

export type Binding = { bound: boolean; reasonCodes: string[]; [key: string]: unknown }
export type ComplianceStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_ASSESSABLE'
export type ComplianceAssessment = { schema: 'priorseal.compliance-assessment.v1'; status: ComplianceStatus; reasonCodes: string[] }

export type Authorization = {
  schema: 'priorseal.authorization.v1' | 'priorseal.authorization.v2'
  domain: string
  authorizationId: string
  intent: Intent
  intentHash: string
  principal: { type: 'user' | 'organization'; id: string; account: string }
  authorizer: { type: 'eip712' | 'eip1271'; address: string }
  delegate: { agentId: string; executor: string }
  issuedAt: number
  notBefore: number
  expiresAt: number
  authorizationNonce: string
  maxUses: string
  audience: string
  policyHash: string
  signature?: string
}

export type AuthorizationReceipt = {
  schema: string
  domain: string
  authorizationId: string
  authorizationHash: string
  intentHash: string
  acceptedAt: number
  sequence: number
  previousEntryHash: string | null
  entryHash: string
  status: string
  issuer: string
  algorithm: string
  keyId: string
  signature: string
}

export type PolicyEvidence = {
  schema: 'priorseal.policy-evidence.v1'
  policyHash: string
  document: Record<string, unknown> | null
  result: { allowed: boolean; reasonCodes: string[]; policyId: string | null; evaluatedAt: number }
}

export type TimestampPolicy = { schema: 'priorseal.timestamp-policy.v1'; profile: 'digicert-rfc3161-v1'; maxClockSkewSeconds: number }
export type TimestampEvidence = { schema: 'priorseal.rfc3161-evidence.v1'; domain: string; profile: string; tsaUrl: string; authorizationHash: string; requestedAt: number; nonce: string; timestamp: number; serialNumber: string; policyOid: string; digestAlgorithm: string; responseHash: string; response: string }
export type WitnessPolicy = { schema: 'priorseal.witness-policy.v1'; threshold: number; maxClockSkewSeconds: number; witnesses: { witnessId: string; keyId: string; algorithm: 'Ed25519'; publicKey: string }[] }
export type WitnessRequest = { schema: 'priorseal.witness-request.v1'; domain: string; authorizationId: string; authorizationHash: string; intentHash: string; requester: string; requestedAt: number; expiresAt: number }
export type WitnessAttestation = { schema: 'priorseal.witness-attestation.v1'; domain: string; witnessId: string; keyId: string; algorithm: 'Ed25519'; requestHash: string; authorizationId: string; authorizationHash: string; intentHash: string; observedAt: number; expiresAt: number; signature: string }
export type WitnessEvidence = { schema: 'priorseal.witness-evidence.v1'; domain: string; policyHash: string; request: WitnessRequest; attestations: WitnessAttestation[] }
export type TransparencyEntry = { sequence: number; authorizationHash: string; acceptedAt: number; previousEntryHash: string | null; entryHash: string }
export type TransparencyEvidence = { checkpoint: { schema: string; domain: string; size: number; headEntryHash: string; issuedAt: number; issuer: string; algorithm: string; keyId: string; anchor: null | { type: 'eip155'; chainId: number; contract: string; txHash: string; blockNumber: number; anchoredAt: number; size: number; headEntryHash: string }; signature: string }; chain: TransparencyEntry[] }

export type AuthorizationRecord = {
  authorization: Authorization
  acceptance: AuthorizationReceipt
  policyEvidence?: PolicyEvidence
  timestampEvidence?: TimestampEvidence
  witnessEvidence?: WitnessEvidence
  status?: string
  boundTxHash?: string | null
  uses?: number
}

export type Receipt = {
  schema: string
  domain: string
  receiptId: string
  intentHash: string
  executionHash: string
  execution: Execution
  issuer: string
  issuedAt: number
  validUntil: number
  outcome: string
  executionStatus?: ExecutionStatus
  compliance?: ComplianceAssessment
  reasonCodes: string[]
  binding: Binding
  algorithm: string
  keyId: string
  verifierVersion: string
  signature: string
  authorizationHash?: string
  authorizationEvidence?: { authorization: Authorization; acceptance: AuthorizationReceipt; policy: PolicyEvidence; timestamp?: TimestampEvidence; witnesses?: WitnessEvidence; transparency?: TransparencyEvidence }
}

export type VerificationResult = { valid: boolean; code: string; outcome?: string; executionStatus?: ExecutionStatus; complianceStatus?: ComplianceStatus; receiptId?: string; authorizationId?: string }
export type KeyEntry = { issuer: string; keyId: string; algorithm: string; publicKey: string; status: string; validFrom: number | null; validUntil: number | null }
export type KeyRegistry = { schema: string; issuer: string; keys: KeyEntry[]; verifierVersion?: string; schemaVersions?: string[] }
export type VerificationBundle = {
  schema: 'priorseal.verification-bundle.v1'
  receipt: Receipt
  keyRegistry: KeyRegistry
  assembledAt: number
  trust: { model: 'PIN_ISSUER_KEY_OUT_OF_BAND'; notice: string }
  bundleHash: string
}

export type PrepareAuthorizationInput = Omit<Authorization, 'schema' | 'domain' | 'authorizationId' | 'intentHash' | 'signature' | 'policyHash'> & { policyHash?: string }
export type ObserveExecutionInput = { intentId?: string; authorizationId?: string; chainId: number; txHash: string; confirmations?: number }
export type RequestOptions = { idempotencyKey?: string; signal?: AbortSignal; headers?: HeadersInit }

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export type WalletAuthorizationInput = {
  intent: Intent
  principal: { type: 'user' | 'organization'; id: string }
  delegate: { agentId: string; executor: string }
  account?: string
  issuedAt?: number
  notBefore?: number
  expiresAt?: number
  authorizationNonce?: string
  maxUses?: '1'
  audience?: string
}

export type PreparedAuthorization = { authorization: Authorization; typedData: Record<string, unknown>; requestId?: string }
export type AcceptedAuthorization = { authorization: Authorization; acceptance: AuthorizationReceipt; policyEvidence?: PolicyEvidence; timestampEvidence?: TimestampEvidence; witnessEvidence?: WitnessEvidence; policy: { allowed: boolean; reasonCodes: string[]; policyId: string | null }; requestId?: string }
export type ObservationResult = { observation: Execution; receipt: Receipt | null; authorizationAssociation?: 'CANDIDATE' | 'FINAL' | 'UNRELATED'; verification?: VerificationResult; observationJob?: ObservationJob; requestId?: string }

export type ExactCallTransaction = { chainId: ChainId | number; from: string; to: string; data: `0x${string}`; value?: bigint | number | string; nonce: bigint | number | string }
export type ExactCallIntentInput = { transaction: ExactCallTransaction; intentId: string; asset: string; amount: bigint | number | string; validUntil: number; contextCommitments?: ContextCommitment[]; constraints?: Intent['constraints'] }
export type ExactCallWalletAuthorizationInput = ExactCallIntentInput & { principal: { type: 'user' | 'organization'; id: string }; agentId: string; account?: string; issuedAt?: number; notBefore?: number; expiresAt?: number; authorizationNonce?: string; audience?: string }
export type ObservationJob = {
  jobId: string
  input: ObserveExecutionInput
  state: 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'COMPLETED' | 'UNDETERMINED' | 'FAILED' | string
  attempts: number
  createdAt: number
  nextAttemptAt: number
  observation: Execution | null
  result?: ObservationResult | null
  error: { code: string; message: string } | null
}
export type WaitForObservationOptions = RequestOptions & { pollIntervalMs?: number; timeoutMs?: number }
