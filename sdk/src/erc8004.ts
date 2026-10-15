import {
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { matchUniqueContextCommitment } from './context-commitment.js'
import type { Authorization, ContextCommitment } from './types.js'

export const ERC8004_IDENTITY_SNAPSHOT_SCHEMA = 'priorseal.erc8004.identity-snapshot.v1' as const
export const ERC8004_IDENTITY_COMMITMENT_NAMESPACE = 'priorseal.erc8004.identity-snapshot.v1'
export const ERC8004_TRUST_DECISION_NAMESPACE = 'priorseal.erc8004.trust-decision.v1'
export const ERC8004_REPUTATION_REGISTRY_ABI = parseAbi([
  'function getIdentityRegistry() view returns (address identityRegistry)',
  'function getClients(uint256 agentId) view returns (address[] memory)',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
])
export const ERC8004_VALIDATION_REGISTRY_ABI = parseAbi([
  'function getIdentityRegistry() view returns (address identityRegistry)',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)',
])
export const ERC8004_IDENTITY_REGISTRY_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address owner)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const UINT256_MAX = (1n << 256n) - 1n
const UINT64_MAX = (1n << 64n) - 1n
const INT128_MIN = -(1n << 127n)
const INT128_MAX = (1n << 127n) - 1n
const INT256_MIN = -(1n << 255n)
const INT256_MAX = (1n << 255n) - 1n
const MAX_TRUSTED_REVIEWERS = 32
const MAX_REPUTATION_FEEDBACK = 4096
const MAX_CANONICAL_PAYLOAD_BYTES = 1_048_576

export type ERC8004AgentReference = {
  chainId: number
  identityRegistry: Address
  agentId: string
}

export type ERC8004IdentitySnapshot = {
  schema: typeof ERC8004_IDENTITY_SNAPSHOT_SCHEMA
  agentRef: string
  agentRegistry: string
  chainId: number
  identityRegistry: Address
  agentId: string
  blockNumber: string
  blockHash: Hash
  blockTimestamp: string
  registryCodeHash: Hash
  owner: Address
  agentWallet: Address
  tokenURI: string
  executor: Address | null
  bindingStatus: 'MATCH' | 'MISMATCH' | 'NOT_CHECKED'
}

export type ERC8004RegistryTrust = {
  address: Address
  codeHash: Hash
  chainId: number
  status: 'ALLOWLISTED'
}

export type ERC8004ResolveOptions = {
  /** Registry trust is a caller policy. Unknown addresses are never treated as official. */
  trustedRegistryAddresses: readonly string[]
  /** Optional code-hash pins add protection against a changed or substituted contract. */
  trustedRegistryCodeHashes?: readonly string[]
  /** Supply a block for historical verification; otherwise the current head is used. */
  blockNumber?: string | bigint
  executor?: string
}

export type ERC8004IdentityBindingResult = {
  valid: boolean
  code: 'OK' | 'AGENT_REFERENCE_MISMATCH' | 'EXECUTOR_MISMATCH' | 'IDENTITY_SNAPSHOT_NOT_COMMITTED' | 'IDENTITY_SNAPSHOT_COMMITMENT_MISMATCH' | 'IDENTITY_SNAPSHOT_CHAIN_STATE_MISMATCH' | 'IDENTITY_SNAPSHOT_CHAIN_STATE_UNAVAILABLE'
  agentReferenceBound: boolean
  executorBound: boolean
  snapshotCommitment: ContextCommitment
  commitmentMatched: boolean
  chainStateVerified: boolean
  snapshot: ERC8004IdentitySnapshot
}

/**
 * Return a canonical, globally namespaced ERC-8004 agent ID suitable for the
 * existing signed `delegate.agentId` field. The registry trust policy remains
 * separate from the identifier itself.
 */
export function formatERC8004AgentRef(input: ERC8004AgentReference): string {
  const ref = normalizeERC8004AgentReference(input)
  return validateBoundedString(`erc8004:eip155:${ref.chainId}:${ref.identityRegistry}:${ref.agentId}`, 'canonical ERC-8004 agent reference', 128)
}

export function parseERC8004AgentRef(value: unknown): ERC8004AgentReference {
  if (typeof value !== 'string') throw new TypeError('ERC-8004 agent reference must be a string')
  const match = /^erc8004:eip155:([1-9][0-9]*):(0x[0-9a-fA-F]{40}):(0|[1-9][0-9]*)$/.exec(value)
  if (!match) throw new TypeError('ERC-8004 agent reference is not in canonical form')
  const ref = normalizeERC8004AgentReference({ chainId: Number(match[1]), identityRegistry: match[2], agentId: match[3] })
  if (formatERC8004AgentRef(ref) !== value) throw new TypeError('ERC-8004 agent reference must use canonical lowercase address encoding')
  return ref
}

export function erc8004AgentRegistry(refValue: ERC8004AgentReference | string): string {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  return `eip155:${ref.chainId}:${ref.identityRegistry}`
}

export function erc8004AgentId(refValue: ERC8004AgentReference | string): string {
  return typeof refValue === 'string' ? parseERC8004AgentRef(refValue).agentId : normalizeERC8004AgentReference(refValue).agentId
}

/** Resolve the registry and wallet binding at one pinned EVM block. */
export async function resolveERC8004Identity(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  options: ERC8004ResolveOptions,
): Promise<ERC8004IdentitySnapshot> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const blockNumber = options.blockNumber === undefined
    ? await client.getBlockNumber()
    : toBlockNumber(options.blockNumber)
  const registryTrust = await assertTrustedRegistry(client, ref.chainId, ref.identityRegistry, { ...options, blockNumber })
  const block = await client.getBlock({ blockNumber })
  const [ownerValue, walletValue, tokenURI] = await Promise.all([
    client.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [BigInt(ref.agentId)], blockNumber }),
    client.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'getAgentWallet', args: [BigInt(ref.agentId)], blockNumber }),
    client.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'tokenURI', args: [BigInt(ref.agentId)], blockNumber }),
  ])
  const owner = normalizeAddress(ownerValue, 'ERC-8004 owner')
  const agentWallet = normalizeAddress(walletValue, 'ERC-8004 agentWallet')
  if (owner === ZERO_ADDRESS) throw new TypeError('ERC-8004 ownerOf returned the zero address')
  const executor = options.executor === undefined ? null : normalizeAddress(options.executor, 'executor')
  const bindingStatus = executor === null ? 'NOT_CHECKED' : agentWallet !== ZERO_ADDRESS && executor === agentWallet ? 'MATCH' : 'MISMATCH'
  return {
    schema: ERC8004_IDENTITY_SNAPSHOT_SCHEMA,
    agentRef: formatERC8004AgentRef(ref),
    agentRegistry: erc8004AgentRegistry(ref),
    chainId: ref.chainId,
    identityRegistry: ref.identityRegistry,
    agentId: ref.agentId,
    blockNumber: blockNumber.toString(10),
    blockHash: normalizeHash(block.hash, 'block hash'),
    blockTimestamp: block.timestamp.toString(10),
    registryCodeHash: registryTrust.codeHash,
    owner,
    agentWallet,
    tokenURI: validateBoundedString(tokenURI, 'tokenURI', 4096),
    executor,
    bindingStatus,
  }
}

/** Resolve an agent and report whether its registered agentWallet matches the requested executor. */
export async function verifyERC8004AgentIdentity(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  executorValue: string,
  options: Omit<ERC8004ResolveOptions, 'executor'>,
): Promise<{ verified: boolean; code: 'OK' | 'EXECUTOR_MISMATCH' | 'IDENTITY_UNAVAILABLE'; snapshot: ERC8004IdentitySnapshot | null }> {
  try {
    const snapshot = await resolveERC8004Identity(client, refValue, { ...options, executor: executorValue })
    const verified = snapshot.bindingStatus === 'MATCH'
    return { verified, code: verified ? 'OK' : 'EXECUTOR_MISMATCH', snapshot }
  } catch {
    return { verified: false, code: 'IDENTITY_UNAVAILABLE', snapshot: null }
  }
}

/** Hash the full pinned identity claim for a PriorSeal v2 context commitment. */
export function erc8004IdentitySnapshotCommitment(snapshotValue: unknown): ContextCommitment {
  const snapshot = parseERC8004IdentitySnapshot(snapshotValue)
  const fields = [
    snapshot.schema,
    snapshot.agentRef,
    snapshot.agentRegistry,
    String(snapshot.chainId),
    snapshot.identityRegistry,
    snapshot.agentId,
    snapshot.blockNumber,
    snapshot.blockHash,
    snapshot.blockTimestamp,
    snapshot.registryCodeHash,
    snapshot.owner,
    snapshot.agentWallet,
    snapshot.tokenURI,
    snapshot.executor ?? ZERO_ADDRESS,
    snapshot.bindingStatus,
  ]
  return {
    namespace: ERC8004_IDENTITY_COMMITMENT_NAMESPACE,
    algorithm: 'keccak256',
    digest: keccak256(toBytes(JSON.stringify(fields))),
  }
}

/** Hash a JSON payload using ERC-8004's keccak256 commitment convention. */
export function hashERC8004Payload(value: unknown): Hash {
  const bytes = toBytes(canonicalJson(value))
  if (bytes.length > MAX_CANONICAL_PAYLOAD_BYTES) throw new TypeError(`canonical ERC-8004 payload is limited to ${MAX_CANONICAL_PAYLOAD_BYTES} bytes`)
  return keccak256(bytes)
}

/** Hash the exact UTF-8 string or byte sequence stored at an ERC-8004 content URI. */
export function hashERC8004ContentBytes(value: string | Uint8Array): Hash {
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new TypeError('ERC-8004 content must be a string or Uint8Array')
  return keccak256(typeof value === 'string' ? new TextEncoder().encode(value) : value)
}

/**
 * Check a snapshot against the selected registry at its original block. This
 * authenticates the RPC result only under the caller's chain/RPC trust policy;
 * the digest by itself is not a chain-state proof.
 */
export async function verifyERC8004IdentitySnapshot(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  snapshotValue: unknown,
  options: Omit<ERC8004ResolveOptions, 'blockNumber' | 'executor'>,
): Promise<{ valid: boolean; code: 'OK' | 'SNAPSHOT_MISMATCH' | 'CHAIN_STATE_UNAVAILABLE'; resolved: ERC8004IdentitySnapshot | null }> {
  const snapshot = parseERC8004IdentitySnapshot(snapshotValue)
  try {
    const resolved = await resolveERC8004Identity(client, snapshot.agentRef, {
      ...options,
      blockNumber: snapshot.blockNumber,
      ...(snapshot.executor === null ? {} : { executor: snapshot.executor }),
    })
    const valid = erc8004IdentitySnapshotCommitment(resolved).digest === erc8004IdentitySnapshotCommitment(snapshot).digest
    return { valid, code: valid ? 'OK' : 'SNAPSHOT_MISMATCH', resolved }
  } catch {
    return { valid: false, code: 'CHAIN_STATE_UNAVAILABLE', resolved: null }
  }
}

/** Verify that a signed PriorSeal authorization names and commits to a registry snapshot. */
export async function verifyERC8004AuthorizationBinding(
  authorizationValue: Authorization | unknown,
  snapshotValue: ERC8004IdentitySnapshot | unknown,
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  options: Omit<ERC8004ResolveOptions, 'blockNumber' | 'executor'>,
): Promise<ERC8004IdentityBindingResult> {
  const authorization = parseAuthorizationForERC8004(authorizationValue)
  const snapshot = parseERC8004IdentitySnapshot(snapshotValue)
  const agentReferenceBound = authorization.delegate.agentId === snapshot.agentRef
  const executorBound = authorization.delegate.executor.toLowerCase() === snapshot.executor?.toLowerCase()
    && snapshot.bindingStatus === 'MATCH'
  const snapshotCommitment = erc8004IdentitySnapshotCommitment(snapshot)
  let commitmentMatched = false
  try {
    commitmentMatched = matchUniqueContextCommitment(authorization.intent, snapshotCommitment).matched
  } catch {
    commitmentMatched = false
  }
  const chainCheck = await verifyERC8004IdentitySnapshot(client, snapshot, options)
  let code: ERC8004IdentityBindingResult['code'] = 'OK'
  if (!agentReferenceBound) code = 'AGENT_REFERENCE_MISMATCH'
  else if (!executorBound) code = 'EXECUTOR_MISMATCH'
  else if (!commitmentMatched) code = authorization.intent.contextCommitments?.some((entry) => entry.namespace === ERC8004_IDENTITY_COMMITMENT_NAMESPACE)
    ? 'IDENTITY_SNAPSHOT_COMMITMENT_MISMATCH'
    : 'IDENTITY_SNAPSHOT_NOT_COMMITTED'
  else if (!chainCheck.valid) code = chainCheck.code === 'CHAIN_STATE_UNAVAILABLE' ? 'IDENTITY_SNAPSHOT_CHAIN_STATE_UNAVAILABLE' : 'IDENTITY_SNAPSHOT_CHAIN_STATE_MISMATCH'
  return {
    valid: code === 'OK',
    code,
    agentReferenceBound,
    executorBound,
    snapshotCommitment,
    commitmentMatched,
    chainStateVerified: chainCheck.valid,
    snapshot,
  }
}

export type ERC8004RegistrationFile = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'
  name: string
  description: string
  image: string
  services: unknown[]
  registrations: Array<{ agentId: string; agentRegistry: string }>
  [key: string]: unknown
}

/** Validate an externally fetched registration document without fetching its URI. */
export function validateERC8004RegistrationFile(value: unknown, refValue: ERC8004AgentReference | string): { valid: boolean; digest: Hash; file: ERC8004RegistrationFile } {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const record = requireRecord(value, 'registration file')
  if (record.type !== 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1') throw new TypeError('registration file.type is unsupported')
  const name = validateBoundedString(record.name, 'registration file.name', 256)
  const description = validateBoundedString(record.description, 'registration file.description', 8192)
  const image = validateBoundedString(record.image, 'registration file.image', 4096)
  if (!Array.isArray(record.services) || record.services.length > 128) throw new TypeError('registration file.services must be an array with at most 128 entries')
  const services = record.services.map((entry, index) => {
    const service = requireRecord(entry, `registration file.services[${index}]`)
    validateBoundedString(service.name, `registration file.services[${index}].name`, 128)
    validateBoundedString(service.endpoint, `registration file.services[${index}].endpoint`, 4096)
    if (service.version !== undefined) validateBoundedString(service.version, `registration file.services[${index}].version`, 128)
    return service
  })
  if (record.active !== undefined && typeof record.active !== 'boolean') throw new TypeError('registration file.active must be a boolean')
  if (record.x402Support !== undefined && typeof record.x402Support !== 'boolean') throw new TypeError('registration file.x402Support must be a boolean')
  if (record.supportedTrust !== undefined && (!Array.isArray(record.supportedTrust) || record.supportedTrust.length > 32 || record.supportedTrust.some((entry) => typeof entry !== 'string' || entry.length > 128))) throw new TypeError('registration file.supportedTrust is invalid')
  if (!Array.isArray(record.registrations) || record.registrations.length < 1 || record.registrations.length > 128) throw new TypeError('registration file.registrations must contain 1 to 128 entries')
  const agentRegistry = erc8004AgentRegistry(ref)
  const registrations = record.registrations.map((entry, index) => {
    const registration = requireRecord(entry, `registration file.registrations[${index}]`)
    const agentId = normalizeUint(registration.agentId, `registration file.registrations[${index}].agentId`)
    const registry = validateBoundedString(registration.agentRegistry, `registration file.registrations[${index}].agentRegistry`, 128)
    return { agentId, agentRegistry: registry }
  })
  if (!registrations.some((entry) => entry.agentId === ref.agentId && entry.agentRegistry.toLowerCase() === agentRegistry.toLowerCase())) {
    throw new TypeError('registration file does not declare the referenced ERC-8004 agent')
  }
  const file = { ...record, type: record.type, name, description, image, services, registrations } as ERC8004RegistrationFile
  return { valid: true, digest: hashERC8004Payload(file), file }
}

export type ERC8004ReputationFeedback = {
  clientAddress: Address
  feedbackIndex: string
  value: string
  valueDecimals: number
  tag1: string
  tag2: string
  isRevoked: boolean
}

export type ERC8004ReputationSnapshot = {
  schema: 'priorseal.erc8004.reputation-snapshot.v1'
  agentRef: string
  reputationRegistry: Address
  reputationRegistryCodeHash: Hash
  blockNumber: string
  blockHash: Hash
  blockTimestamp: string
  trustedReviewers: Address[]
  feedback: ERC8004ReputationFeedback[]
  truncatedReviewers: Address[]
  maxFeedbackPerReviewer: number
}

export type ERC8004ReputationPolicy = {
  trustedReviewers: readonly string[]
  minimumFeedbackCount: number
  minimumDistinctReviewers?: number
  requiredTag1?: string
  requiredTag2?: string
  minimumAverageValue?: { value: string; valueDecimals: number }
}

export type ERC8004TrustEvaluation = {
  result: 'PASS' | 'FAIL' | 'INDETERMINATE'
  /** PASS/FAIL is only the policy calculation; `result` stays INDETERMINATE until source state is chain-verified. */
  policyResult: 'PASS' | 'FAIL' | 'INDETERMINATE'
  sourceState: 'VERIFIED' | 'UNVERIFIED_SNAPSHOT'
  reasonCodes: string[]
  evidenceCount: number
  distinctReviewerCount: number
  averageValue: { value: string; valueDecimals: 18 } | null
  truncatedReviewers: Address[]
}

export type ERC8004TrustDecisionBundle = {
  schema: 'priorseal.erc8004.trust-decision.v1'
  agentRef: string
  executor: Address
  assessedAt: number
  identitySnapshot: ERC8004IdentitySnapshot
  reputation?: { snapshot: ERC8004ReputationSnapshot; policy: ERC8004ReputationPolicy; evaluation: ERC8004TrustEvaluation }
  validations?: { snapshot: ERC8004ValidationSnapshot; policy: ERC8004ValidationPolicy; evaluation: ERC8004TrustEvaluation }
  result: 'PASS'
  commitment: ContextCommitment
}

export type ERC8004TrustDecisionOptions = {
  identityRegistry: Omit<ERC8004ResolveOptions, 'blockNumber' | 'executor'>
  reputationRegistry?: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] }
  validationRegistry?: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] }
}

/** Read feedback only from reviewers explicitly trusted by the caller. */
export async function readERC8004Reputation(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  reputationRegistryValue: string,
  policy: ERC8004ReputationPolicy,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[]; maxFeedbackPerReviewer?: number; blockNumber?: string | bigint },
): Promise<ERC8004ReputationSnapshot> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const reputationRegistry = normalizeAddress(reputationRegistryValue, 'reputation registry')
  const chainId = await client.getChainId()
  if (chainId !== ref.chainId) throw new TypeError('public client chain does not match the ERC-8004 agent')
  const blockNumber = options.blockNumber === undefined ? await client.getBlockNumber() : toBlockNumber(options.blockNumber)
  const registryTrust = await assertTrustedRegistry(client, ref.chainId, reputationRegistry, {
    trustedRegistryAddresses: options.trustedRegistryAddresses,
    trustedRegistryCodeHashes: options.trustedRegistryCodeHashes,
    blockNumber,
  })
  const reviewerAddresses = normalizeAddressList(policy.trustedReviewers, 'trusted reviewers', MAX_TRUSTED_REVIEWERS)
  if (reviewerAddresses.length < 1) throw new TypeError('at least one trusted reviewer is required')
  const block = await client.getBlock({ blockNumber })
  const identityRegistry = normalizeAddress(await client.readContract({
    address: reputationRegistry,
    abi: ERC8004_REPUTATION_REGISTRY_ABI,
    functionName: 'getIdentityRegistry',
    blockNumber,
  }), 'reputation registry identity')
  if (identityRegistry !== ref.identityRegistry) throw new TypeError('reputation registry points to a different identity registry')
  const maxFeedback = options.maxFeedbackPerReviewer ?? 128
  if (!Number.isSafeInteger(maxFeedback) || maxFeedback < 1 || maxFeedback > 1024) throw new TypeError('maxFeedbackPerReviewer must be an integer from 1 to 1024')
  if (reviewerAddresses.length * maxFeedback > MAX_REPUTATION_FEEDBACK) throw new TypeError(`reputation snapshot is limited to ${MAX_REPUTATION_FEEDBACK} feedback records`)
  const feedback: ERC8004ReputationFeedback[] = []
  const truncatedReviewers: Address[] = []
  for (const clientAddress of reviewerAddresses) {
    const lastIndex = BigInt(await client.readContract({
      address: reputationRegistry,
      abi: ERC8004_REPUTATION_REGISTRY_ABI,
      functionName: 'getLastIndex',
      args: [BigInt(ref.agentId), clientAddress],
      blockNumber,
    }))
    const start = lastIndex > BigInt(maxFeedback) ? lastIndex - BigInt(maxFeedback) + 1n : 1n
    if (start > 1n) truncatedReviewers.push(clientAddress)
    for (let index = start; index <= lastIndex; index += 1n) {
      const result = await client.readContract({
        address: reputationRegistry,
        abi: ERC8004_REPUTATION_REGISTRY_ABI,
        functionName: 'readFeedback',
        args: [BigInt(ref.agentId), clientAddress, index],
        blockNumber,
      })
      feedback.push({
        clientAddress,
        feedbackIndex: index.toString(10),
        value: result[0].toString(10),
        valueDecimals: result[1],
        tag1: validateBoundedString(result[2], 'feedback.tag1', 128),
        tag2: validateBoundedString(result[3], 'feedback.tag2', 128),
        isRevoked: result[4],
      })
    }
  }
  return {
    schema: 'priorseal.erc8004.reputation-snapshot.v1',
    agentRef: formatERC8004AgentRef(ref),
    reputationRegistry,
    reputationRegistryCodeHash: registryTrust.codeHash,
    blockNumber: blockNumber.toString(10),
    blockHash: normalizeHash(block.hash, 'block hash'),
    blockTimestamp: block.timestamp.toString(10),
    trustedReviewers: reviewerAddresses,
    feedback,
    truncatedReviewers,
    maxFeedbackPerReviewer: maxFeedback,
  }
}

/** Re-read a reputation snapshot at its recorded block before using it in policy. */
export async function verifyERC8004ReputationSnapshot(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  snapshotValue: unknown,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<{ valid: boolean; code: 'OK' | 'SNAPSHOT_MISMATCH' | 'CHAIN_STATE_UNAVAILABLE'; resolved: ERC8004ReputationSnapshot | null }> {
  const snapshot = parseERC8004ReputationSnapshot(snapshotValue)
  try {
    const resolved = await readERC8004Reputation(client, snapshot.agentRef, snapshot.reputationRegistry, {
      trustedReviewers: snapshot.trustedReviewers,
      minimumFeedbackCount: 1,
    }, { ...options, maxFeedbackPerReviewer: snapshot.maxFeedbackPerReviewer, blockNumber: snapshot.blockNumber })
    const valid = hashERC8004Payload(resolved) === hashERC8004Payload(snapshot)
    return { valid, code: valid ? 'OK' : 'SNAPSHOT_MISMATCH', resolved }
  } catch {
    return { valid: false, code: 'CHAIN_STATE_UNAVAILABLE', resolved: null }
  }
}

/** Apply a buyer-defined policy without inventing a universal reputation score. */
export function evaluateERC8004Reputation(snapshotValue: unknown, policy: ERC8004ReputationPolicy): ERC8004TrustEvaluation {
  const snapshot = parseERC8004ReputationSnapshot(snapshotValue)
  const normalizedPolicy = normalizeERC8004ReputationPolicy(policy)
  const trustedReviewers = new Set(normalizedPolicy.trustedReviewers)
  const minimumFeedbackCount = normalizedPolicy.minimumFeedbackCount
  const minimumDistinctReviewers = normalizedPolicy.minimumDistinctReviewers ?? 1
  const accepted = snapshot.feedback.filter((item) => trustedReviewers.has(item.clientAddress)
    && !item.isRevoked
    && (normalizedPolicy.requiredTag1 === undefined || item.tag1 === normalizedPolicy.requiredTag1)
    && (normalizedPolicy.requiredTag2 === undefined || item.tag2 === normalizedPolicy.requiredTag2))
  const distinctReviewerCount = new Set(accepted.map((item) => item.clientAddress)).size
  const sum = accepted.reduce((total, item) => total + scaleTo18(item.value, item.valueDecimals), 0n)
  const averageValue = accepted.length ? { value: (sum / BigInt(accepted.length)).toString(10), valueDecimals: 18 as const } : null
  const reasons: string[] = []
  if (snapshot.truncatedReviewers.length > 0) reasons.push('FEEDBACK_HISTORY_TRUNCATED')
  if (accepted.length < minimumFeedbackCount) reasons.push('INSUFFICIENT_FEEDBACK')
  if (distinctReviewerCount < minimumDistinctReviewers) reasons.push('INSUFFICIENT_DISTINCT_REVIEWERS')
  if (normalizedPolicy.minimumAverageValue !== undefined) {
    const threshold = scaleTo18(normalizedPolicy.minimumAverageValue.value, normalizedPolicy.minimumAverageValue.valueDecimals)
    if (averageValue === null || BigInt(averageValue.value) < threshold) reasons.push('AVERAGE_FEEDBACK_BELOW_POLICY')
  }
  const policyResult = snapshot.truncatedReviewers.length > 0
    ? 'INDETERMINATE'
    : reasons.length > 0 ? 'FAIL' : 'PASS'
  return { result: 'INDETERMINATE', policyResult, sourceState: 'UNVERIFIED_SNAPSHOT', reasonCodes: reasons, evidenceCount: accepted.length, distinctReviewerCount, averageValue, truncatedReviewers: snapshot.truncatedReviewers }
}

export async function verifyAndEvaluateERC8004Reputation(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  snapshotValue: unknown,
  policy: ERC8004ReputationPolicy,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<ERC8004TrustEvaluation> {
  const preview = evaluateERC8004Reputation(snapshotValue, policy)
  const verification = await verifyERC8004ReputationSnapshot(client, snapshotValue, options)
  if (!verification.valid) return { ...preview, result: 'INDETERMINATE', sourceState: 'UNVERIFIED_SNAPSHOT', reasonCodes: [...preview.reasonCodes, verification.code === 'CHAIN_STATE_UNAVAILABLE' ? 'REPUTATION_CHAIN_STATE_UNAVAILABLE' : 'REPUTATION_SNAPSHOT_MISMATCH'] }
  return { ...preview, result: preview.policyResult, sourceState: 'VERIFIED' }
}

export type ERC8004ValidationEvidence = {
  requestHash: Hash
  validatorAddress: Address
  agentId: string
  response: number
  responseHash: Hash
  tag: string
  lastUpdate: string
}

export type ERC8004ValidationSnapshot = {
  schema: 'priorseal.erc8004.validation-snapshot.v1'
  agentRef: string
  validationRegistry: Address
  validationRegistryCodeHash: Hash
  blockNumber: string
  blockHash: Hash
  blockTimestamp: string
  validations: ERC8004ValidationEvidence[]
}

export type ERC8004ValidationPolicy = {
  trustedValidators: readonly string[]
  minimumResponse: number
  requiredTag?: string
  maxAgeSeconds?: number
}

/** Resolve named validation request hashes from an allowlisted registry. */
export async function readERC8004Validations(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  validationRegistryValue: string,
  requestHashes: readonly string[],
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[]; blockNumber?: string | bigint },
): Promise<ERC8004ValidationSnapshot> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const validationRegistry = normalizeAddress(validationRegistryValue, 'validation registry')
  const chainId = await client.getChainId()
  if (chainId !== ref.chainId) throw new TypeError('public client chain does not match the ERC-8004 agent')
  const blockNumber = options.blockNumber === undefined ? await client.getBlockNumber() : toBlockNumber(options.blockNumber)
  const registryTrust = await assertTrustedRegistry(client, ref.chainId, validationRegistry, { ...options, blockNumber })
  const hashes = normalizeHashList(requestHashes, 'request hashes', 128)
  if (hashes.length < 1) throw new TypeError('at least one validation request hash is required')
  const block = await client.getBlock({ blockNumber })
  const identityRegistry = normalizeAddress(await client.readContract({
    address: validationRegistry,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: 'getIdentityRegistry',
    blockNumber,
  }), 'validation registry identity')
  if (identityRegistry !== ref.identityRegistry) throw new TypeError('validation registry points to a different identity registry')
  const validations: ERC8004ValidationEvidence[] = []
  for (const requestHash of hashes) {
    const result = await client.readContract({
      address: validationRegistry,
      abi: ERC8004_VALIDATION_REGISTRY_ABI,
      functionName: 'getValidationStatus',
      args: [requestHash],
      blockNumber,
    })
    if (BigInt(result[1]) !== BigInt(ref.agentId)) throw new TypeError(`validation request ${requestHash} belongs to a different agent`)
    if (normalizeAddress(result[0], 'validation validator') === ZERO_ADDRESS) throw new TypeError(`validation request ${requestHash} is not registered`)
    validations.push({
      requestHash,
      validatorAddress: normalizeAddress(result[0], 'validation validator'),
      agentId: BigInt(result[1]).toString(10),
      response: result[2],
      responseHash: normalizeHash(result[3], 'validation response hash'),
      tag: validateBoundedString(result[4], 'validation tag', 128),
      lastUpdate: BigInt(result[5]).toString(10),
    })
  }
  return {
    schema: 'priorseal.erc8004.validation-snapshot.v1',
    agentRef: formatERC8004AgentRef(ref),
    validationRegistry,
    validationRegistryCodeHash: registryTrust.codeHash,
    blockNumber: blockNumber.toString(10),
    blockHash: normalizeHash(block.hash, 'block hash'),
    blockTimestamp: block.timestamp.toString(10),
    validations,
  }
}

/** Re-read validation status at the recorded block before using it in policy. */
export async function verifyERC8004ValidationSnapshot(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  snapshotValue: unknown,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<{ valid: boolean; code: 'OK' | 'SNAPSHOT_MISMATCH' | 'CHAIN_STATE_UNAVAILABLE'; resolved: ERC8004ValidationSnapshot | null }> {
  const snapshot = parseERC8004ValidationSnapshot(snapshotValue)
  try {
    const resolved = await readERC8004Validations(client, snapshot.agentRef, snapshot.validationRegistry, snapshot.validations.map((item) => item.requestHash), {
      ...options,
      blockNumber: snapshot.blockNumber,
    })
    const valid = hashERC8004Payload(resolved) === hashERC8004Payload(snapshot)
    return { valid, code: valid ? 'OK' : 'SNAPSHOT_MISMATCH', resolved }
  } catch {
    return { valid: false, code: 'CHAIN_STATE_UNAVAILABLE', resolved: null }
  }
}

export function evaluateERC8004Validations(snapshotValue: unknown, policy: ERC8004ValidationPolicy, now = Math.floor(Date.now() / 1000)): ERC8004TrustEvaluation {
  const snapshot = parseERC8004ValidationSnapshot(snapshotValue)
  const normalizedPolicy = normalizeERC8004ValidationPolicy(policy)
  const trustedValidators = new Set(normalizedPolicy.trustedValidators)
  const minimumResponse = normalizedPolicy.minimumResponse
  if (!Number.isSafeInteger(now) || now < 1) throw new TypeError('now must be positive Unix seconds')
  const maxAgeSeconds = normalizedPolicy.maxAgeSeconds
  const candidates = snapshot.validations.filter((item) => trustedValidators.has(item.validatorAddress)
    && item.response >= minimumResponse
    && (normalizedPolicy.requiredTag === undefined || item.tag === normalizedPolicy.requiredTag))
  const accepted = candidates.filter((item) => BigInt(item.lastUpdate) <= BigInt(now)
    && (maxAgeSeconds === undefined || BigInt(item.lastUpdate) >= BigInt(now - maxAgeSeconds)))
  const stale = candidates.some((item) => BigInt(item.lastUpdate) > BigInt(now))
  const outOfWindow = maxAgeSeconds !== undefined && candidates.some((item) => BigInt(item.lastUpdate) <= BigInt(now - maxAgeSeconds))
  const reasons: string[] = []
  if (stale) reasons.push('VALIDATION_TIME_IN_FUTURE')
  if (accepted.length === 0 && outOfWindow) reasons.push('VALIDATION_EVIDENCE_STALE')
  if (accepted.length === 0 && !outOfWindow) reasons.push('NO_VALIDATION_MATCHES_POLICY')
  const policyResult = stale ? 'INDETERMINATE' : accepted.length > 0 ? 'PASS' : 'FAIL'
  return { result: 'INDETERMINATE', policyResult, sourceState: 'UNVERIFIED_SNAPSHOT', reasonCodes: reasons, evidenceCount: accepted.length, distinctReviewerCount: new Set(accepted.map((item) => item.validatorAddress)).size, averageValue: null, truncatedReviewers: [] }
}

export async function verifyAndEvaluateERC8004Validations(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  snapshotValue: unknown,
  policy: ERC8004ValidationPolicy,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
  now = Math.floor(Date.now() / 1000),
): Promise<ERC8004TrustEvaluation> {
  const preview = evaluateERC8004Validations(snapshotValue, policy, now)
  const verification = await verifyERC8004ValidationSnapshot(client, snapshotValue, options)
  if (!verification.valid) return { ...preview, result: 'INDETERMINATE', sourceState: 'UNVERIFIED_SNAPSHOT', reasonCodes: [...preview.reasonCodes, verification.code === 'CHAIN_STATE_UNAVAILABLE' ? 'VALIDATION_CHAIN_STATE_UNAVAILABLE' : 'VALIDATION_SNAPSHOT_MISMATCH'] }
  return { ...preview, result: preview.policyResult, sourceState: 'VERIFIED' }
}

/**
 * Verify identity and optional trust sources, then create a principal-signable
 * digest for the exact policy decision. At least one reputation or validation
 * source is required so this cannot be mistaken for an identity-only check.
 */
export async function createERC8004TrustDecisionBundle(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  input: {
    identitySnapshot: unknown
    reputation?: { snapshot: unknown; policy: ERC8004ReputationPolicy }
    validations?: { snapshot: unknown; policy: ERC8004ValidationPolicy }
    assessedAt?: number
  },
  options: ERC8004TrustDecisionOptions,
): Promise<ERC8004TrustDecisionBundle> {
  if (!input.reputation && !input.validations) throw new TypeError('a reputation or validation source is required for an ERC-8004 trust decision')
  const identitySnapshot = parseERC8004IdentitySnapshot(input.identitySnapshot)
  if (identitySnapshot.bindingStatus !== 'MATCH' || identitySnapshot.executor === null) throw new TypeError('identity snapshot must bind a nonzero agentWallet to an executor')
  const assessedAt = requireBoundedInteger(input.assessedAt ?? Math.floor(Date.now() / 1000), 'assessedAt', 1, Number.MAX_SAFE_INTEGER)
  if (BigInt(identitySnapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('identity snapshot is later than assessedAt')
  const identityVerification = await verifyERC8004IdentitySnapshot(client, identitySnapshot, options.identityRegistry)
  if (!identityVerification.valid) throw new TypeError(`ERC-8004 identity snapshot verification failed: ${identityVerification.code}`)
  const reputation = input.reputation ? await createVerifiedReputationBundle(client, identitySnapshot, input.reputation, options.reputationRegistry, assessedAt) : undefined
  const validations = input.validations ? await createVerifiedValidationBundle(client, identitySnapshot, input.validations, options.validationRegistry, assessedAt) : undefined
  const body = {
    schema: 'priorseal.erc8004.trust-decision.v1' as const,
    agentRef: identitySnapshot.agentRef,
    executor: identitySnapshot.executor,
    assessedAt,
    identitySnapshot,
    ...(reputation ? { reputation } : {}),
    ...(validations ? { validations } : {}),
    result: 'PASS' as const,
  }
  const commitment: ContextCommitment = { namespace: ERC8004_TRUST_DECISION_NAMESPACE, algorithm: 'keccak256', digest: hashERC8004Payload(body) }
  return { ...body, commitment }
}

/** Re-verify every source at its recorded block and the bundle's content commitment. */
export async function verifyERC8004TrustDecisionBundle(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  bundleValue: unknown,
  options: ERC8004TrustDecisionOptions,
): Promise<{ valid: boolean; code: 'OK' | 'TRUST_DECISION_COMMITMENT_MISMATCH' | 'IDENTITY_SNAPSHOT_INVALID' | 'REPUTATION_POLICY_NOT_PASSED' | 'VALIDATION_POLICY_NOT_PASSED'; identityVerified: boolean; reputationVerified: boolean | null; validationsVerified: boolean | null; bundle: ERC8004TrustDecisionBundle }> {
  const bundle = parseERC8004TrustDecisionBundle(bundleValue)
  const { commitment, ...body } = bundle
  const commitmentValid = hashERC8004Payload(body) === commitment.digest
  const identity = await verifyERC8004IdentitySnapshot(client, bundle.identitySnapshot, options.identityRegistry)
  const reputation = bundle.reputation
    ? await verifyAndEvaluateERC8004Reputation(client, bundle.reputation.snapshot, bundle.reputation.policy, requiredRegistryOptions(options.reputationRegistry, 'reputationRegistry'))
    : null
  const validations = bundle.validations
    ? await verifyAndEvaluateERC8004Validations(client, bundle.validations.snapshot, bundle.validations.policy, requiredRegistryOptions(options.validationRegistry, 'validationRegistry'), bundle.assessedAt)
    : null
  const reputationVerified = bundle.reputation ? reputation?.result === 'PASS' && hashERC8004Payload(reputation) === hashERC8004Payload(bundle.reputation.evaluation) : null
  const validationsVerified = bundle.validations ? validations?.result === 'PASS' && hashERC8004Payload(validations) === hashERC8004Payload(bundle.validations.evaluation) : null
  let code: 'OK' | 'TRUST_DECISION_COMMITMENT_MISMATCH' | 'IDENTITY_SNAPSHOT_INVALID' | 'REPUTATION_POLICY_NOT_PASSED' | 'VALIDATION_POLICY_NOT_PASSED' = 'OK'
  if (!identity.valid || bundle.identitySnapshot.executor !== bundle.executor || bundle.identitySnapshot.agentRef !== bundle.agentRef) code = 'IDENTITY_SNAPSHOT_INVALID'
  else if (bundle.reputation && !reputationVerified) code = 'REPUTATION_POLICY_NOT_PASSED'
  else if (bundle.validations && !validationsVerified) code = 'VALIDATION_POLICY_NOT_PASSED'
  else if (!commitmentValid) code = 'TRUST_DECISION_COMMITMENT_MISMATCH'
  return {
    valid: code === 'OK',
    code,
    identityVerified: identity.valid,
    reputationVerified,
    validationsVerified,
    bundle,
  }
}

/** Match a reviewed trust-decision bundle to the principal-signed authorization. */
export async function verifyERC8004AuthorizationTrustDecision(
  authorizationValue: unknown,
  bundleValue: unknown,
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  options: ERC8004TrustDecisionOptions,
): Promise<{ valid: boolean; code: 'OK' | 'AGENT_REFERENCE_MISMATCH' | 'EXECUTOR_MISMATCH' | 'TRUST_DECISION_AFTER_AUTHORIZATION' | 'TRUST_DECISION_NOT_COMMITTED' | 'TRUST_DECISION_COMMITMENT_MISMATCH' | 'IDENTITY_SNAPSHOT_INVALID' | 'REPUTATION_POLICY_NOT_PASSED' | 'VALIDATION_POLICY_NOT_PASSED'; commitmentMatched: boolean; trustDecision: Awaited<ReturnType<typeof verifyERC8004TrustDecisionBundle>> }> {
  const authorization = parseAuthorizationForERC8004(authorizationValue)
  const bundle = parseERC8004TrustDecisionBundle(bundleValue)
  const trustDecision = await verifyERC8004TrustDecisionBundle(client, bundle, options)
  const agentReferenceBound = authorization.delegate.agentId === bundle.agentRef
  const executorBound = authorization.delegate.executor === bundle.executor
  const assessedBeforeAuthorization = bundle.assessedAt <= authorization.issuedAt
  const validationFreshAtAuthorization = bundle.validations === undefined
    || evaluateERC8004Validations(bundle.validations.snapshot, bundle.validations.policy, authorization.issuedAt).policyResult === 'PASS'
  let commitmentMatched = false
  try {
    commitmentMatched = matchUniqueContextCommitment(authorization.intent, bundle.commitment).matched
  } catch {
    commitmentMatched = false
  }
  let code: 'OK' | 'AGENT_REFERENCE_MISMATCH' | 'EXECUTOR_MISMATCH' | 'TRUST_DECISION_AFTER_AUTHORIZATION' | 'TRUST_DECISION_NOT_COMMITTED' | 'TRUST_DECISION_COMMITMENT_MISMATCH' | 'IDENTITY_SNAPSHOT_INVALID' | 'REPUTATION_POLICY_NOT_PASSED' | 'VALIDATION_POLICY_NOT_PASSED' = 'OK'
  if (!agentReferenceBound) code = 'AGENT_REFERENCE_MISMATCH'
  else if (!executorBound) code = 'EXECUTOR_MISMATCH'
  else if (!assessedBeforeAuthorization) code = 'TRUST_DECISION_AFTER_AUTHORIZATION'
  else if (!authorization.intent.contextCommitments?.some((entry) => entry.namespace === ERC8004_TRUST_DECISION_NAMESPACE)) code = 'TRUST_DECISION_NOT_COMMITTED'
  else if (!commitmentMatched || !trustDecision.valid) {
    code = trustDecision.code === 'IDENTITY_SNAPSHOT_INVALID' || trustDecision.code === 'REPUTATION_POLICY_NOT_PASSED' || trustDecision.code === 'VALIDATION_POLICY_NOT_PASSED'
      ? trustDecision.code
      : 'TRUST_DECISION_COMMITMENT_MISMATCH'
  }
  else if (!validationFreshAtAuthorization) code = 'VALIDATION_POLICY_NOT_PASSED'
  return { valid: code === 'OK', code, commitmentMatched, trustDecision }
}

export type ERC8004FeedbackInput = {
  reputationRegistry: string
  value: bigint | string | number
  valueDecimals: number
  tag1?: string
  tag2?: string
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: string
}

/** Submit feedback only through the caller's explicitly supplied wallet. */
export async function submitERC8004Feedback(
  walletClient: WalletClient,
  publicClient: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  input: ERC8004FeedbackInput,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<Hash> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const chainId = await publicClient.getChainId()
  if (chainId !== ref.chainId || await walletClient.getChainId() !== ref.chainId) throw new TypeError('wallet and public client must use the ERC-8004 agent chain')
  const reputationRegistry = normalizeAddress(input.reputationRegistry, 'reputation registry')
  await assertTrustedRegistry(publicClient, ref.chainId, reputationRegistry, options)
  const linkedIdentityRegistry = normalizeAddress(await publicClient.readContract({ address: reputationRegistry, abi: ERC8004_REPUTATION_REGISTRY_ABI, functionName: 'getIdentityRegistry' }), 'reputation registry identity')
  if (linkedIdentityRegistry !== ref.identityRegistry) throw new TypeError('reputation registry points to a different identity registry')
  const actor = walletAddress(walletClient)
  const owner = normalizeAddress(await publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [BigInt(ref.agentId)] }), 'ERC-8004 owner')
  const [approved, approvedForAll] = await Promise.all([
    publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'getApproved', args: [BigInt(ref.agentId)] }),
    publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'isApprovedForAll', args: [owner, actor] }),
  ])
  if (actor === owner || (approved !== ZERO_ADDRESS && actor === normalizeAddress(approved, 'approved operator')) || approvedForAll) throw new TypeError('ERC-8004 agent owners and approved operators cannot submit feedback for their own agent')
  const value = normalizeInt128(input.value, 'feedback.value')
  const valueDecimals = requireBoundedInteger(input.valueDecimals, 'feedback.valueDecimals', 0, 18)
  const tag1 = validateBoundedString(input.tag1 ?? '', 'feedback.tag1', 128)
  const tag2 = validateBoundedString(input.tag2 ?? '', 'feedback.tag2', 128)
  const endpoint = validateBoundedString(input.endpoint ?? '', 'feedback.endpoint', 2048)
  const feedbackURI = validateBoundedString(input.feedbackURI ?? '', 'feedback.feedbackURI', 4096)
  const feedbackHash = normalizeHash(input.feedbackHash ?? ZERO_HASH, 'feedback.feedbackHash')
  return walletClient.writeContract({
    chain: walletClient.chain,
    address: reputationRegistry,
    abi: ERC8004_REPUTATION_REGISTRY_ABI,
    functionName: 'giveFeedback',
    args: [BigInt(ref.agentId), value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash],
    account: actor,
  })
}

export type ERC8004ValidationRequestInput = {
  validationRegistry: string
  validatorAddress: string
  requestURI: string
  requestHash: string
}

/** Submit a validation request through the agent owner/operator wallet. */
export async function submitERC8004ValidationRequest(
  walletClient: WalletClient,
  publicClient: Pick<PublicClient, 'getChainId' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  input: ERC8004ValidationRequestInput,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<Hash> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const chainId = await publicClient.getChainId()
  if (chainId !== ref.chainId || await walletClient.getChainId() !== ref.chainId) throw new TypeError('wallet and public client must use the ERC-8004 agent chain')
  const validationRegistry = normalizeAddress(input.validationRegistry, 'validation registry')
  await assertTrustedRegistry(publicClient, ref.chainId, validationRegistry, options)
  const linkedIdentityRegistry = normalizeAddress(await publicClient.readContract({ address: validationRegistry, abi: ERC8004_VALIDATION_REGISTRY_ABI, functionName: 'getIdentityRegistry' }), 'validation registry identity')
  if (linkedIdentityRegistry !== ref.identityRegistry) throw new TypeError('validation registry points to a different identity registry')
  const actor = walletAddress(walletClient)
  const owner = normalizeAddress(await publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'ownerOf', args: [BigInt(ref.agentId)] }), 'ERC-8004 owner')
  const [approved, approvedForAll] = await Promise.all([
    publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'getApproved', args: [BigInt(ref.agentId)] }),
    publicClient.readContract({ address: ref.identityRegistry, abi: ERC8004_IDENTITY_REGISTRY_ABI, functionName: 'isApprovedForAll', args: [owner, actor] }),
  ])
  if (actor !== owner && (approved === ZERO_ADDRESS || actor !== normalizeAddress(approved, 'approved operator')) && !approvedForAll) throw new TypeError('validation requests must be submitted by the agent owner or approved operator')
  const validatorAddress = normalizeAddress(input.validatorAddress, 'validator address')
  const requestURI = validateBoundedString(input.requestURI, 'validation request URI', 4096)
  const requestHash = normalizeHash(input.requestHash, 'validation request hash')
  return walletClient.writeContract({
    chain: walletClient.chain,
    address: validationRegistry,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: 'validationRequest',
    args: [validatorAddress, BigInt(ref.agentId), requestURI, requestHash],
    account: actor,
  })
}

export type ERC8004ValidationResponseInput = {
  validationRegistry: string
  requestHash: string
  response: number
  responseURI?: string
  responseHash?: string
  tag?: string
}

/** Respond only when this wallet is the validator named by the on-chain request. */
export async function submitERC8004ValidationResponse(
  walletClient: WalletClient,
  publicClient: Pick<PublicClient, 'getChainId' | 'getCode' | 'readContract'>,
  refValue: ERC8004AgentReference | string,
  input: ERC8004ValidationResponseInput,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] },
): Promise<Hash> {
  const ref = typeof refValue === 'string' ? parseERC8004AgentRef(refValue) : normalizeERC8004AgentReference(refValue)
  const chainId = await publicClient.getChainId()
  if (chainId !== ref.chainId || await walletClient.getChainId() !== ref.chainId) throw new TypeError('wallet and public client must use the ERC-8004 agent chain')
  const validationRegistry = normalizeAddress(input.validationRegistry, 'validation registry')
  await assertTrustedRegistry(publicClient, ref.chainId, validationRegistry, options)
  const linkedIdentityRegistry = normalizeAddress(await publicClient.readContract({ address: validationRegistry, abi: ERC8004_VALIDATION_REGISTRY_ABI, functionName: 'getIdentityRegistry' }), 'validation registry identity')
  if (linkedIdentityRegistry !== ref.identityRegistry) throw new TypeError('validation registry points to a different identity registry')
  const requestHash = normalizeHash(input.requestHash, 'validation request hash')
  const status = await publicClient.readContract({ address: validationRegistry, abi: ERC8004_VALIDATION_REGISTRY_ABI, functionName: 'getValidationStatus', args: [requestHash] })
  if (BigInt(status[1]) !== BigInt(ref.agentId)) throw new TypeError('validation request belongs to a different ERC-8004 agent')
  const actor = walletAddress(walletClient)
  if (normalizeAddress(status[0], 'requested validator') !== actor) throw new TypeError('connected wallet is not the requested validator')
  const response = requireBoundedInteger(input.response, 'validation response', 0, 100)
  const responseURI = validateBoundedString(input.responseURI ?? '', 'validation response URI', 4096)
  const responseHash = normalizeHash(input.responseHash ?? ZERO_HASH, 'validation response hash')
  const tag = validateBoundedString(input.tag ?? '', 'validation response tag', 128)
  return walletClient.writeContract({
    chain: walletClient.chain,
    address: validationRegistry,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: 'validationResponse',
    args: [requestHash, response, responseURI, responseHash, tag],
    account: actor,
  })
}

export function parseERC8004IdentitySnapshot(value: unknown): ERC8004IdentitySnapshot {
  const input = requireRecord(value, 'ERC-8004 identity snapshot')
  const allowed = ['schema', 'agentRef', 'agentRegistry', 'chainId', 'identityRegistry', 'agentId', 'blockNumber', 'blockHash', 'blockTimestamp', 'registryCodeHash', 'owner', 'agentWallet', 'tokenURI', 'executor', 'bindingStatus']
  assertOnlyFields(input, allowed, 'ERC-8004 identity snapshot')
  if (input.schema !== ERC8004_IDENTITY_SNAPSHOT_SCHEMA) throw new TypeError('ERC-8004 identity snapshot schema is unsupported')
  const ref = parseERC8004AgentRef(input.agentRef)
  if (input.agentRegistry !== erc8004AgentRegistry(ref) || input.chainId !== ref.chainId || normalizeAddress(input.identityRegistry, 'snapshot identityRegistry') !== ref.identityRegistry || normalizeUint(input.agentId, 'snapshot agentId') !== ref.agentId) throw new TypeError('ERC-8004 identity snapshot reference fields disagree')
  const executor = input.executor === null ? null : normalizeAddress(input.executor, 'snapshot executor')
  const bindingStatus = input.bindingStatus
  if (!['MATCH', 'MISMATCH', 'NOT_CHECKED'].includes(String(bindingStatus))) throw new TypeError('ERC-8004 identity snapshot bindingStatus is invalid')
  if ((executor === null) !== (bindingStatus === 'NOT_CHECKED')) throw new TypeError('ERC-8004 identity snapshot executor and bindingStatus disagree')
  const agentWallet = normalizeAddress(input.agentWallet, 'snapshot agentWallet')
  if (executor !== null && (bindingStatus === 'MATCH') !== (agentWallet !== ZERO_ADDRESS && executor === agentWallet)) throw new TypeError('ERC-8004 identity snapshot bindingStatus does not match agentWallet')
  const owner = normalizeAddress(input.owner, 'snapshot owner')
  if (owner === ZERO_ADDRESS) throw new TypeError('ERC-8004 identity snapshot owner must not be the zero address')
  return {
    schema: ERC8004_IDENTITY_SNAPSHOT_SCHEMA,
    agentRef: formatERC8004AgentRef(ref),
    agentRegistry: erc8004AgentRegistry(ref),
    chainId: ref.chainId,
    identityRegistry: ref.identityRegistry,
    agentId: ref.agentId,
    blockNumber: normalizeUint(input.blockNumber, 'snapshot blockNumber'),
    blockHash: normalizeHash(input.blockHash, 'snapshot blockHash'),
    blockTimestamp: normalizeUint(input.blockTimestamp, 'snapshot blockTimestamp'),
    registryCodeHash: normalizeHash(input.registryCodeHash, 'snapshot registryCodeHash'),
    owner,
    agentWallet,
    tokenURI: validateBoundedString(input.tokenURI, 'snapshot tokenURI', 4096),
    executor,
    bindingStatus: bindingStatus as ERC8004IdentitySnapshot['bindingStatus'],
  }
}

function parseERC8004ReputationSnapshot(value: unknown): ERC8004ReputationSnapshot {
  const input = requireRecord(value, 'ERC-8004 reputation snapshot')
  assertOnlyFields(input, ['schema', 'agentRef', 'reputationRegistry', 'reputationRegistryCodeHash', 'blockNumber', 'blockHash', 'blockTimestamp', 'trustedReviewers', 'feedback', 'truncatedReviewers', 'maxFeedbackPerReviewer'], 'ERC-8004 reputation snapshot')
  if (input.schema !== 'priorseal.erc8004.reputation-snapshot.v1') throw new TypeError('ERC-8004 reputation snapshot schema is unsupported')
  const agentRef = parseERC8004AgentRef(input.agentRef)
  if (!Array.isArray(input.trustedReviewers) || !Array.isArray(input.feedback) || !Array.isArray(input.truncatedReviewers)) throw new TypeError('ERC-8004 reputation snapshot arrays are invalid')
  const trustedReviewers = normalizeAddressList(input.trustedReviewers, 'snapshot trusted reviewers', MAX_TRUSTED_REVIEWERS)
  const truncatedReviewers = normalizeAddressList(input.truncatedReviewers, 'snapshot truncated reviewers', MAX_TRUSTED_REVIEWERS)
  if (input.feedback.length > MAX_REPUTATION_FEEDBACK) throw new TypeError(`snapshot feedback must contain at most ${MAX_REPUTATION_FEEDBACK} records`)
  const feedback = input.feedback.map((item, index) => {
    const entry = requireRecord(item, `snapshot feedback[${index}]`)
    assertOnlyFields(entry, ['clientAddress', 'feedbackIndex', 'value', 'valueDecimals', 'tag1', 'tag2', 'isRevoked'], `snapshot feedback[${index}]`)
    const value = normalizeInt128(entry.value, 'feedback.value')
    const valueDecimals = requireBoundedInteger(entry.valueDecimals, 'feedback.valueDecimals', 0, 18)
    if (typeof entry.isRevoked !== 'boolean') throw new TypeError('feedback.isRevoked must be a boolean')
    return {
      clientAddress: normalizeAddress(entry.clientAddress, 'feedback.clientAddress'),
      feedbackIndex: normalizeUint(entry.feedbackIndex, 'feedback.feedbackIndex'),
      value: value.toString(10),
      valueDecimals,
      tag1: validateBoundedString(entry.tag1, 'feedback.tag1', 128),
      tag2: validateBoundedString(entry.tag2, 'feedback.tag2', 128),
      isRevoked: entry.isRevoked,
    }
  })
  if (feedback.some((entry) => BigInt(entry.feedbackIndex) > UINT64_MAX)) throw new TypeError('snapshot feedback index exceeds uint64')
  const maximumFeedback = requireBoundedInteger(input.maxFeedbackPerReviewer, 'snapshot maxFeedbackPerReviewer', 1, 1024)
  if (feedback.length > trustedReviewers.length * maximumFeedback) throw new TypeError('snapshot contains more feedback records than its configured reviewer bounds allow')
  if (feedback.some((entry) => !trustedReviewers.includes(entry.clientAddress))) throw new TypeError('snapshot contains feedback from an untrusted reviewer')
  if (truncatedReviewers.some((entry) => !trustedReviewers.includes(entry))) throw new TypeError('snapshot truncation list contains an untrusted reviewer')
  return {
    schema: 'priorseal.erc8004.reputation-snapshot.v1',
    agentRef: formatERC8004AgentRef(agentRef),
    reputationRegistry: normalizeAddress(input.reputationRegistry, 'snapshot reputationRegistry'),
    reputationRegistryCodeHash: normalizeHash(input.reputationRegistryCodeHash, 'snapshot reputationRegistryCodeHash'),
    blockNumber: normalizeUint(input.blockNumber, 'snapshot blockNumber'),
    blockHash: normalizeHash(input.blockHash, 'snapshot blockHash'),
    blockTimestamp: normalizeUint(input.blockTimestamp, 'snapshot blockTimestamp'),
    trustedReviewers,
    feedback,
    truncatedReviewers,
    maxFeedbackPerReviewer: maximumFeedback,
  }
}

async function createVerifiedReputationBundle(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  identitySnapshot: ERC8004IdentitySnapshot,
  input: { snapshot: unknown; policy: ERC8004ReputationPolicy },
  registryOptions: ERC8004TrustDecisionOptions['reputationRegistry'],
  assessedAt: number,
): Promise<NonNullable<ERC8004TrustDecisionBundle['reputation']>> {
  const options = requiredRegistryOptions(registryOptions, 'reputationRegistry')
  const snapshot = parseERC8004ReputationSnapshot(input.snapshot)
  if (snapshot.agentRef !== identitySnapshot.agentRef) throw new TypeError('reputation snapshot references a different agent')
  if (BigInt(snapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('reputation snapshot is later than assessedAt')
  const policy = normalizeERC8004ReputationPolicy(input.policy)
  const evaluation = await verifyAndEvaluateERC8004Reputation(client, snapshot, policy, options)
  if (evaluation.result !== 'PASS') throw new TypeError(`ERC-8004 reputation policy did not pass: ${evaluation.reasonCodes.join(',') || evaluation.result}`)
  return { snapshot, policy, evaluation }
}

async function createVerifiedValidationBundle(
  client: Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getCode' | 'readContract'>,
  identitySnapshot: ERC8004IdentitySnapshot,
  input: { snapshot: unknown; policy: ERC8004ValidationPolicy },
  registryOptions: ERC8004TrustDecisionOptions['validationRegistry'],
  assessedAt: number,
): Promise<NonNullable<ERC8004TrustDecisionBundle['validations']>> {
  const options = requiredRegistryOptions(registryOptions, 'validationRegistry')
  const snapshot = parseERC8004ValidationSnapshot(input.snapshot)
  if (snapshot.agentRef !== identitySnapshot.agentRef) throw new TypeError('validation snapshot references a different agent')
  if (BigInt(snapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('validation snapshot is later than assessedAt')
  const policy = normalizeERC8004ValidationPolicy(input.policy)
  const evaluation = await verifyAndEvaluateERC8004Validations(client, snapshot, policy, options, assessedAt)
  if (evaluation.result !== 'PASS') throw new TypeError(`ERC-8004 validation policy did not pass: ${evaluation.reasonCodes.join(',') || evaluation.result}`)
  return { snapshot, policy, evaluation }
}

function normalizeERC8004ReputationPolicy(value: unknown): ERC8004ReputationPolicy {
  const input = requireRecord(value, 'ERC-8004 reputation policy')
  assertOnlyFields(input, ['trustedReviewers', 'minimumFeedbackCount', 'minimumDistinctReviewers', 'requiredTag1', 'requiredTag2', 'minimumAverageValue'], 'ERC-8004 reputation policy')
  if (!Array.isArray(input.trustedReviewers)) throw new TypeError('reputation policy trustedReviewers must be an array')
  const policy: ERC8004ReputationPolicy = {
    trustedReviewers: normalizeAddressList(input.trustedReviewers, 'reputation policy trustedReviewers', MAX_TRUSTED_REVIEWERS),
    minimumFeedbackCount: requireBoundedInteger(input.minimumFeedbackCount, 'reputation policy minimumFeedbackCount', 1, 100000),
    ...(input.minimumDistinctReviewers === undefined ? {} : { minimumDistinctReviewers: requireBoundedInteger(input.minimumDistinctReviewers, 'reputation policy minimumDistinctReviewers', 1, MAX_TRUSTED_REVIEWERS) }),
    ...(input.requiredTag1 === undefined ? {} : { requiredTag1: validateBoundedString(input.requiredTag1, 'reputation policy requiredTag1', 128) }),
    ...(input.requiredTag2 === undefined ? {} : { requiredTag2: validateBoundedString(input.requiredTag2, 'reputation policy requiredTag2', 128) }),
  }
  if (input.minimumAverageValue !== undefined) {
    const minimum = requireRecord(input.minimumAverageValue, 'reputation policy minimumAverageValue')
    assertOnlyFields(minimum, ['value', 'valueDecimals'], 'reputation policy minimumAverageValue')
    policy.minimumAverageValue = {
      value: normalizeInt128(minimum.value, 'minimumAverageValue.value').toString(10),
      valueDecimals: requireBoundedInteger(minimum.valueDecimals, 'minimumAverageValue.valueDecimals', 0, 18),
    }
  }
  return policy
}

function normalizeERC8004ValidationPolicy(value: unknown): ERC8004ValidationPolicy {
  const input = requireRecord(value, 'ERC-8004 validation policy')
  assertOnlyFields(input, ['trustedValidators', 'minimumResponse', 'requiredTag', 'maxAgeSeconds'], 'ERC-8004 validation policy')
  if (!Array.isArray(input.trustedValidators)) throw new TypeError('validation policy trustedValidators must be an array')
  return {
    trustedValidators: normalizeAddressList(input.trustedValidators, 'validation policy trustedValidators', MAX_TRUSTED_REVIEWERS),
    minimumResponse: requireBoundedInteger(input.minimumResponse, 'validation policy minimumResponse', 1, 100),
    ...(input.requiredTag === undefined ? {} : { requiredTag: validateBoundedString(input.requiredTag, 'validation policy requiredTag', 128) }),
    ...(input.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: requireBoundedInteger(input.maxAgeSeconds, 'validation policy maxAgeSeconds', 1, 31536000) }),
  }
}

function requiredRegistryOptions(
  value: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] } | undefined,
  field: string,
): { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[] } {
  if (!value) throw new TypeError(`${field} trust configuration is required`)
  return value
}

function parseERC8004TrustEvaluation(value: unknown, field: string): ERC8004TrustEvaluation {
  const input = requireRecord(value, field)
  assertOnlyFields(input, ['result', 'policyResult', 'sourceState', 'reasonCodes', 'evidenceCount', 'distinctReviewerCount', 'averageValue', 'truncatedReviewers'], field)
  if (input.result !== 'PASS' || input.policyResult !== 'PASS' || input.sourceState !== 'VERIFIED') throw new TypeError(`${field} must contain a verified passing policy result`)
  if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length !== 0 || !Array.isArray(input.truncatedReviewers) || input.truncatedReviewers.length !== 0) throw new TypeError(`${field} has a non-passing reason or truncated evidence`)
  const averageValue = input.averageValue === null ? null : requireRecord(input.averageValue, `${field}.averageValue`)
  if (averageValue && (normalizeInt256(averageValue.value, `${field}.averageValue.value`).toString(10) !== averageValue.value || averageValue.valueDecimals !== 18)) throw new TypeError(`${field}.averageValue is invalid`)
  return {
    result: 'PASS',
    policyResult: 'PASS',
    sourceState: 'VERIFIED',
    reasonCodes: [],
    evidenceCount: requireBoundedInteger(input.evidenceCount, `${field}.evidenceCount`, 0, 10000000),
    distinctReviewerCount: requireBoundedInteger(input.distinctReviewerCount, `${field}.distinctReviewerCount`, 0, 10000000),
    averageValue: averageValue ? { value: String(averageValue.value), valueDecimals: 18 } : null,
    truncatedReviewers: [],
  }
}

function parseERC8004TrustDecisionBundle(value: unknown): ERC8004TrustDecisionBundle {
  const input = requireRecord(value, 'ERC-8004 trust decision bundle')
  assertOnlyFields(input, ['schema', 'agentRef', 'executor', 'assessedAt', 'identitySnapshot', 'reputation', 'validations', 'result', 'commitment'], 'ERC-8004 trust decision bundle')
  if (input.schema !== 'priorseal.erc8004.trust-decision.v1' || input.result !== 'PASS') throw new TypeError('ERC-8004 trust decision bundle schema or result is invalid')
  if (input.reputation === undefined && input.validations === undefined) throw new TypeError('trust decision bundle requires reputation or validation evidence')
  const identitySnapshot = parseERC8004IdentitySnapshot(input.identitySnapshot)
  const agentRef = parseERC8004AgentRef(input.agentRef)
  const normalizedAgentRef = formatERC8004AgentRef(agentRef)
  if (normalizedAgentRef !== identitySnapshot.agentRef) throw new TypeError('trust decision agent reference does not match its identity snapshot')
  const executor = normalizeAddress(input.executor, 'trust decision executor')
  const assessedAt = requireBoundedInteger(input.assessedAt, 'trust decision assessedAt', 1, Number.MAX_SAFE_INTEGER)
  if (identitySnapshot.executor !== executor || identitySnapshot.bindingStatus !== 'MATCH') throw new TypeError('trust decision executor does not match identity snapshot')
  if (BigInt(identitySnapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('trust decision identity snapshot is later than assessedAt')
  const commitmentInput = requireRecord(input.commitment, 'trust decision commitment')
  assertOnlyFields(commitmentInput, ['namespace', 'algorithm', 'digest'], 'trust decision commitment')
  const commitment = {
    namespace: validateBoundedString(commitmentInput.namespace, 'trust decision commitment namespace', 128),
    algorithm: commitmentInput.algorithm,
    digest: normalizeHash(commitmentInput.digest, 'trust decision commitment digest'),
  }
  if (commitment.namespace !== ERC8004_TRUST_DECISION_NAMESPACE || commitment.algorithm !== 'keccak256') throw new TypeError('trust decision commitment profile is unsupported')
  const normalizedCommitment: ContextCommitment = { ...commitment, algorithm: 'keccak256' }
  let reputation: ERC8004TrustDecisionBundle['reputation']
  if (input.reputation !== undefined) {
    const source = requireRecord(input.reputation, 'trust decision reputation')
    assertOnlyFields(source, ['snapshot', 'policy', 'evaluation'], 'trust decision reputation')
    reputation = {
      snapshot: parseERC8004ReputationSnapshot(source.snapshot),
      policy: normalizeERC8004ReputationPolicy(source.policy),
      evaluation: parseERC8004TrustEvaluation(source.evaluation, 'trust decision reputation evaluation'),
    }
    if (reputation.snapshot.agentRef !== normalizedAgentRef) throw new TypeError('trust decision reputation references a different agent')
    if (BigInt(reputation.snapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('trust decision reputation snapshot is later than assessedAt')
  }
  let validations: ERC8004TrustDecisionBundle['validations']
  if (input.validations !== undefined) {
    const source = requireRecord(input.validations, 'trust decision validations')
    assertOnlyFields(source, ['snapshot', 'policy', 'evaluation'], 'trust decision validations')
    validations = {
      snapshot: parseERC8004ValidationSnapshot(source.snapshot),
      policy: normalizeERC8004ValidationPolicy(source.policy),
      evaluation: parseERC8004TrustEvaluation(source.evaluation, 'trust decision validation evaluation'),
    }
    if (validations.snapshot.agentRef !== normalizedAgentRef) throw new TypeError('trust decision validation references a different agent')
    if (BigInt(validations.snapshot.blockTimestamp) > BigInt(assessedAt)) throw new TypeError('trust decision validation snapshot is later than assessedAt')
  }
  return {
    schema: 'priorseal.erc8004.trust-decision.v1',
    agentRef: normalizedAgentRef,
    executor,
    assessedAt,
    identitySnapshot,
    ...(reputation ? { reputation } : {}),
    ...(validations ? { validations } : {}),
    result: 'PASS',
    commitment: normalizedCommitment,
  }
}

function parseERC8004ValidationSnapshot(value: unknown): ERC8004ValidationSnapshot {
  const input = requireRecord(value, 'ERC-8004 validation snapshot')
  assertOnlyFields(input, ['schema', 'agentRef', 'validationRegistry', 'validationRegistryCodeHash', 'blockNumber', 'blockHash', 'blockTimestamp', 'validations'], 'ERC-8004 validation snapshot')
  if (input.schema !== 'priorseal.erc8004.validation-snapshot.v1') throw new TypeError('ERC-8004 validation snapshot schema is unsupported')
  const ref = parseERC8004AgentRef(input.agentRef)
  if (!Array.isArray(input.validations) || input.validations.length > 128) throw new TypeError('snapshot validations must contain at most 128 entries')
  const validations = input.validations.map((item, index) => {
    const entry = requireRecord(item, `snapshot validations[${index}]`)
    assertOnlyFields(entry, ['requestHash', 'validatorAddress', 'agentId', 'response', 'responseHash', 'tag', 'lastUpdate'], `snapshot validations[${index}]`)
    const response = requireBoundedInteger(entry.response, 'validation.response', 0, 100)
    if (normalizeUint(entry.agentId, 'validation.agentId') !== ref.agentId) throw new TypeError('validation snapshot contains a different agent ID')
    return {
      requestHash: normalizeHash(entry.requestHash, 'validation.requestHash'),
      validatorAddress: normalizeAddress(entry.validatorAddress, 'validation.validatorAddress'),
      agentId: ref.agentId,
      response,
      responseHash: normalizeHash(entry.responseHash, 'validation.responseHash'),
      tag: validateBoundedString(entry.tag, 'validation.tag', 128),
      lastUpdate: normalizeUint(entry.lastUpdate, 'validation.lastUpdate'),
    }
  })
  return {
    schema: 'priorseal.erc8004.validation-snapshot.v1',
    agentRef: formatERC8004AgentRef(ref),
    validationRegistry: normalizeAddress(input.validationRegistry, 'snapshot validationRegistry'),
    validationRegistryCodeHash: normalizeHash(input.validationRegistryCodeHash, 'snapshot validationRegistryCodeHash'),
    blockNumber: normalizeUint(input.blockNumber, 'snapshot blockNumber'),
    blockHash: normalizeHash(input.blockHash, 'snapshot blockHash'),
    blockTimestamp: normalizeUint(input.blockTimestamp, 'snapshot blockTimestamp'),
    validations,
  }
}

async function assertTrustedRegistry(
  client: Pick<PublicClient, 'getChainId' | 'getCode'>,
  expectedChainId: number,
  address: Address,
  options: { trustedRegistryAddresses: readonly string[]; trustedRegistryCodeHashes?: readonly string[]; blockNumber?: bigint },
): Promise<ERC8004RegistryTrust> {
  if (!Array.isArray(options.trustedRegistryAddresses) || options.trustedRegistryAddresses.length < 1) throw new TypeError('at least one trusted ERC-8004 registry address must be configured')
  const trustedAddresses = normalizeAddressList(options.trustedRegistryAddresses, 'trusted registry addresses', 128)
  const chainId = await client.getChainId()
  if (chainId !== expectedChainId) throw new TypeError('public client chain does not match the registry chain')
  if (!trustedAddresses.includes(address)) throw new TypeError('ERC-8004 registry address is not allowlisted')
  const code = await client.getCode({ address, ...(options.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }) })
  if (!code || code === '0x') throw new TypeError('ERC-8004 registry address has no contract code')
  const codeHash = keccak256(code)
  if (options.trustedRegistryCodeHashes?.length) {
    const hashes = normalizeHashList(options.trustedRegistryCodeHashes, 'trusted registry code hashes', 128)
    if (!hashes.includes(codeHash)) throw new TypeError('ERC-8004 registry runtime code hash is not allowlisted')
  }
  return { address, codeHash, chainId, status: 'ALLOWLISTED' }
}

function parseAuthorizationForERC8004(value: Authorization | unknown): Authorization {
  const authorization = requireRecord(value, 'PriorSeal authorization')
  if (!['priorseal.authorization.v1', 'priorseal.authorization.v2'].includes(String(authorization.schema))) throw new TypeError('PriorSeal authorization schema is unsupported')
  const delegate = requireRecord(authorization.delegate, 'authorization.delegate')
  const intent = requireRecord(authorization.intent, 'authorization.intent')
  const agentId = validateBoundedString(delegate.agentId, 'authorization.delegate.agentId', 128)
  const executor = normalizeAddress(delegate.executor, 'authorization.delegate.executor')
  const issuedAt = requireBoundedInteger(authorization.issuedAt, 'authorization.issuedAt', 1, Number.MAX_SAFE_INTEGER)
  return { ...authorization, issuedAt, delegate: { agentId, executor }, intent } as unknown as Authorization
}

function normalizeERC8004AgentReference(input: unknown): ERC8004AgentReference {
  const value = requireRecord(input, 'ERC-8004 agent reference')
  assertOnlyFields(value, ['chainId', 'identityRegistry', 'agentId'], 'ERC-8004 agent reference')
  const chainId = requireBoundedInteger(value.chainId, 'chainId', 1, Number.MAX_SAFE_INTEGER)
  const identityRegistry = normalizeAddress(value.identityRegistry, 'identity registry')
  const agentId = normalizeUint(value.agentId, 'agent ID')
  if (BigInt(agentId) > UINT256_MAX) throw new TypeError('agent ID exceeds uint256')
  return { chainId, identityRegistry, agentId }
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) throw new TypeError(`${field} must be a valid EVM address`)
  return getAddress(value).toLowerCase() as Address
}

function normalizeAddressList(values: readonly unknown[], field: string, maximum: number): Address[] {
  if (!Array.isArray(values) || values.length > maximum) throw new TypeError(`${field} must contain at most ${maximum} addresses`)
  const normalized = values.map((value) => normalizeAddress(value, field))
  if (normalized.includes(ZERO_ADDRESS)) throw new TypeError(`${field} must not contain the zero address`)
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must not contain duplicates`)
  return normalized
}

function normalizeHash(value: unknown, field: string): Hash {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`${field} must be a 32-byte hex value`)
  return value.toLowerCase() as Hash
}

function normalizeHashList(values: readonly unknown[], field: string, maximum: number): Hash[] {
  if (!Array.isArray(values) || values.length > maximum) throw new TypeError(`${field} must contain at most ${maximum} hashes`)
  const normalized = values.map((value) => normalizeHash(value, field))
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${field} must not contain duplicates`)
  return normalized
}

function normalizeUint(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError(`${field} must be an unsigned integer`)
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`${field} must be an unsigned safe integer or decimal string`)
  const text = String(value)
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new TypeError(`${field} must be a canonical unsigned decimal string`)
  return BigInt(text).toString(10)
}

function normalizeInt128(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError(`${field} must be an integer`)
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError(`${field} must be a safe integer or decimal string`)
  const text = String(value)
  if (!/^(0|-?[1-9][0-9]*)$/.test(text)) throw new TypeError(`${field} must be a canonical signed decimal integer`)
  const parsed = BigInt(text)
  if (parsed < INT128_MIN || parsed > INT128_MAX) throw new TypeError(`${field} exceeds int128`)
  return parsed
}

function normalizeInt256(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new TypeError(`${field} must be an integer`)
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError(`${field} must be a safe integer or decimal string`)
  const text = String(value)
  if (!/^(0|-?[1-9][0-9]*)$/.test(text)) throw new TypeError(`${field} must be a canonical signed decimal integer`)
  const parsed = BigInt(text)
  if (parsed < INT256_MIN || parsed > INT256_MAX) throw new TypeError(`${field} exceeds int256`)
  return parsed
}

function toBlockNumber(value: string | bigint): bigint {
  const normalized = normalizeUint(value, 'blockNumber')
  return BigInt(normalized)
}

const ZERO_HASH = `0x${'0'.repeat(64)}` as Hash

function validateBoundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) throw new TypeError(`${field} must be a string of at most ${maximum} characters`)
  return value
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError(`${field} must be a plain object`)
  return value as Record<string, unknown>
}

function assertOnlyFields(value: Record<string, unknown>, allowed: readonly string[], field: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new TypeError(`${field} contains unsupported fields`)
}

function requireBoundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} must be an integer from ${minimum} to ${maximum}`)
  return value
}

function scaleTo18(value: unknown, decimals: unknown): bigint {
  const parsedValue = normalizeInt128(value, 'feedback value')
  const parsedDecimals = requireBoundedInteger(decimals, 'feedback valueDecimals', 0, 18)
  return parsedValue * (10n ** BigInt(18 - parsedDecimals))
}

function walletAddress(client: WalletClient): Address {
  const account = client.account
  if (!account) throw new TypeError('wallet client must have an explicitly selected account')
  return normalizeAddress(typeof account === 'string' ? account : account.address, 'wallet account')
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new TypeError('registration file exceeds canonical JSON depth')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value) ?? 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('registration file contains a non-finite number')
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`
  const record = requireRecord(value, 'registration JSON value')
  const keys = Object.keys(record).sort()
  if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new TypeError('registration file contains an unsafe key')
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`
}
