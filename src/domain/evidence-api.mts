import { hashJson } from './hashing.mjs';
import { SOLANA_MAINNET_CAIP2 } from './solana.mjs';
import { HYPERLIQUID_MAINNET_CHAIN_REF } from './hyperliquid.mjs';
import { VERIFICATION_BUNDLE_SCHEMA } from './verification-bundle.mjs';

/**
 * A portable API view of existing PriorSeal evidence. It does not re-observe a
 * chain or verify a signature: consumers must verify the embedded bundle with
 * an independently trusted issuer key before relying on any claim.
 */
export const EVIDENCE_API_SCHEMA = 'priorseal.evidence.v1';
export const EVIDENCE_PROFILE_SCHEMA = 'priorseal.evidence-profile.v1';

type JsonRecord = Record<string, unknown>;
type EvidenceBundle = JsonRecord & { schema: typeof VERIFICATION_BUNDLE_SCHEMA; receipt: JsonRecord; bundleHash: string };

export type EvidenceProfile = {
  schema: typeof EVIDENCE_PROFILE_SCHEMA;
  id: 'priorseal.evidence-profile.evm.v1' | 'priorseal.evidence-profile.solana-transaction.v1' | 'priorseal.evidence-profile.hyperliquid-spot-ioc.v1' | 'priorseal.evidence-profile.unsupported.v1';
  family: 'evm' | 'svm' | 'hypercore' | 'unsupported';
  network: string | null;
  chainId: number | null;
  capabilities: string[];
  limitations: string[];
};

export type EvidenceEnvelope = {
  schema: typeof EVIDENCE_API_SCHEMA;
  evidenceId: string;
  evidenceHash: string;
  kind: 'AUTHORIZATION_BOUND_EXECUTION' | 'EXECUTION';
  subject: { receiptId: string | null; authorizationId: string | null; executionHash: string | null; txHash: string | null };
  profile: EvidenceProfile;
  claims: {
    authorizationBinding: { status: 'ASSERTED_BY_RECEIPT' | 'NOT_INCLUDED_IN_RECEIPT'; authorizationHash: string | null };
    execution: { status: string | null; finalityState: string | null; confirmations: number | null; observationSource: string | null };
    receiptSignature: { status: 'PRESENT_NOT_VERIFIED' | 'MISSING'; issuer: string | null; keyId: string | null };
  };
  verification: { method: 'verification_bundle'; bundleHash: string; trust: 'PIN_ISSUER_KEY_OUT_OF_BAND'; required: 'VERIFY_LOCALLY_WITH_INDEPENDENT_ISSUER_KEY_TRUST' };
  bundle: EvidenceBundle;
};

/** Build a deterministic Evidence API response from an already-created bundle. */
export function buildEvidenceEnvelope(bundleValue: unknown): EvidenceEnvelope {
  const bundle = evidenceBundle(bundleValue);
  const receipt = bundle.receipt;
  const execution = record(receipt.execution);
  const authorizationEvidence = record(receipt.authorizationEvidence);
  const authorization = record(authorizationEvidence?.authorization);
  const profile = evidenceProfileForExecution(execution);
  const receiptId = stringOrNull(receipt.receiptId);
  const subject = {
    receiptId,
    authorizationId: stringOrNull(authorization?.authorizationId),
    executionHash: stringOrNull(receipt.executionHash),
    txHash: stringOrNull(execution?.txHash),
  };
  const unsigned = {
    schema: EVIDENCE_API_SCHEMA as typeof EVIDENCE_API_SCHEMA,
    evidenceId: `pse_${hashJson({ receiptId, bundleHash: bundle.bundleHash }).slice(0, 32)}`,
    kind: (authorization ? 'AUTHORIZATION_BOUND_EXECUTION' : 'EXECUTION') as 'AUTHORIZATION_BOUND_EXECUTION' | 'EXECUTION',
    subject,
    profile,
    claims: {
      authorizationBinding: authorization
        ? { status: 'ASSERTED_BY_RECEIPT' as const, authorizationHash: stringOrNull(receipt.authorizationHash) }
        : { status: 'NOT_INCLUDED_IN_RECEIPT' as const, authorizationHash: null },
      execution: {
        status: stringOrNull(receipt.executionStatus) ?? stringOrNull(execution?.status),
        finalityState: stringOrNull(execution?.finalityState),
        confirmations: safeIntegerOrNull(execution?.confirmations),
        observationSource: stringOrNull(execution?.observationSource),
      },
      receiptSignature: {
        status: typeof receipt.signature === 'string' && receipt.signature.length > 0 ? 'PRESENT_NOT_VERIFIED' as const : 'MISSING' as const,
        issuer: stringOrNull(receipt.issuer),
        keyId: stringOrNull(receipt.keyId),
      },
    },
    verification: {
      method: 'verification_bundle' as const,
      bundleHash: bundle.bundleHash,
      trust: 'PIN_ISSUER_KEY_OUT_OF_BAND' as const,
      required: 'VERIFY_LOCALLY_WITH_INDEPENDENT_ISSUER_KEY_TRUST' as const,
    },
    bundle,
  };
  return { ...unsigned, evidenceHash: hashJson(unsigned) };
}

/** Profiles advertised by a deployment; a profile never claims that an RPC is configured. */
export function evidenceProfilesForChains(chainIds: readonly (number | string)[], nonEvmNetworks: readonly string[] = []): EvidenceProfile[] {
  const evmAndSolana = [...new Set(chainIds.map(Number).filter(Number.isSafeInteger))]
    .sort((left, right) => left - right)
    .map(chainId => evidenceProfileForChain(chainId, chainId === 0 ? SOLANA_MAINNET_CAIP2 : `eip155:${chainId}`));
  const nonEvm = [...new Set(nonEvmNetworks)]
    .map(network => evidenceProfileForChain(0, network));
  return [...evmAndSolana, ...nonEvm.filter(profile => profile.id !== 'priorseal.evidence-profile.unsupported.v1')];
}

export function evidenceProfileForExecution(execution: JsonRecord | null): EvidenceProfile {
  const chainId = safeIntegerOrNull(execution?.chainId);
  return evidenceProfileForChain(chainId, stringOrNull(execution?.chainRef) ?? (chainId != null && chainId > 0 ? `eip155:${chainId}` : null));
}

function evidenceProfileForChain(chainId: number | null, chainRef: string | null): EvidenceProfile {
  const common: Pick<EvidenceProfile, 'schema' | 'capabilities' | 'limitations'> = {
    schema: EVIDENCE_PROFILE_SCHEMA,
    capabilities: ['authorization_binding', 'execution_observation', 'finality_metadata', 'signed_receipt', 'portable_verification_bundle'],
    limitations: ['PriorSeal does not submit transactions or custody keys.', 'Signature validity is not asserted by this envelope; verify the embedded bundle locally with independent issuer-key trust.'],
  };
  if (chainId === 0 && chainRef === SOLANA_MAINNET_CAIP2) {
    return { ...common, id: 'priorseal.evidence-profile.solana-transaction.v1', family: 'svm', network: SOLANA_MAINNET_CAIP2, chainId };
  }
  if (chainId === 0 && chainRef === HYPERLIQUID_MAINNET_CHAIN_REF) {
    return {
      ...common,
      id: 'priorseal.evidence-profile.hyperliquid-spot-ioc.v1',
      family: 'hypercore',
      network: HYPERLIQUID_MAINNET_CHAIN_REF,
      chainId,
      capabilities: [...common.capabilities, 'cloid_order_status', 'fill_aggregation'],
      limitations: [...common.limitations, 'The execution reference is a Hyperliquid client order id (cloid), not an EVM transaction hash.', 'Only HyperCore spot IOC limit orders are profile-bound.'],
    };
  }
  if (chainId != null && chainId > 0) {
    return { ...common, id: 'priorseal.evidence-profile.evm.v1', family: 'evm', network: chainRef ?? `eip155:${chainId}`, chainId };
  }
  return {
    schema: EVIDENCE_PROFILE_SCHEMA,
    id: 'priorseal.evidence-profile.unsupported.v1',
    family: 'unsupported',
    network: chainRef,
    chainId,
    capabilities: [],
    limitations: ['No chain-specific evidence profile is available for this execution.', 'Verify the embedded receipt and bundle before relying on any claim.'],
  };
}

function evidenceBundle(value: unknown): EvidenceBundle {
  const candidate = record(value);
  if (!candidate || candidate.schema !== VERIFICATION_BUNDLE_SCHEMA || !record(candidate.receipt) || typeof candidate.bundleHash !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.bundleHash)) {
    throw new TypeError('bundle must be a PriorSeal verification bundle');
  }
  return candidate as EvidenceBundle;
}
function record(value: unknown): JsonRecord | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null; }
function stringOrNull(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function safeIntegerOrNull(value: unknown): number | null { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
