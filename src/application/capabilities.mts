import { hashJson } from '../domain/hashing.mjs';
import { SUPPORTED_CHAINS } from '../infrastructure/blockchain/evm/chains.mjs';

type CapabilityPolicy = { allowedChainIds?: number[]; allowedActions?: unknown; allowedAssets?: string[]; allowedRecipients?: string[]; maxAmount?: string; minConfirmations?: number; maxToleratedReorgDepth?: number; finalityRequirement?: 'CONFIRMATIONS' | 'RPC_FINALIZED' };
type CapabilityStore = { health?: () => Promise<unknown> | unknown; archiveRetention?: string };
export async function deploymentCapabilities({ issuer, audience, keyConfigured, policy, proofMode, timestampConfigured, witnessConfigured, anchorConfigured, rpcChainIds, erc4337EntryPoints = [], safe4337Trust = [], store, archiveEnabled, contractSignatureConfigured = false, now }: { issuer: string; audience: string; keyConfigured: boolean; policy?: CapabilityPolicy | null; proofMode: string; timestampConfigured: boolean; witnessConfigured: boolean; anchorConfigured: boolean; rpcChainIds?: number[]; erc4337EntryPoints?: { chainId: number; version: '0.6' | '0.7' | '0.8' | '0.9'; address: string; codeHash: string }[]; safe4337Trust?: { chainId: number; version: '0.6' | '0.7' | '0.8' | '0.9'; entryPointAddress: string; moduleAddress: string; moduleCodeHash: string; safeProxyCodeHash: string; safeSingletonCodeHash: string }[]; store: CapabilityStore; archiveEnabled: boolean; contractSignatureConfigured?: boolean; now: number }) {
  let storage = 'available';
  try { if (store.health) await store.health(); } catch { storage = 'unavailable'; }
  const chains = Object.keys(SUPPORTED_CHAINS).map(Number).filter(id => !policy?.allowedChainIds || policy.allowedChainIds.map(Number).includes(id));
  // Runtime policy matching is case-insensitive; capability discovery must use the same semantics.
  const actions = policy?.allowedActions === undefined ? null : Array.isArray(policy.allowedActions) ? policy.allowedActions.map((action) => String(action).toUpperCase()) : [];
  const exactCall = policy?.allowedAssets === undefined && policy?.allowedRecipients === undefined && policy?.maxAmount === undefined && (!actions || actions.includes('CONTRACT_CALL'));
  const erc4337 = policy?.allowedAssets === undefined && policy?.allowedRecipients === undefined && policy?.maxAmount === undefined && (!actions || actions.includes('ERC4337_USER_OPERATION')) && erc4337EntryPoints.some(entry => chains.includes(entry.chainId));
  const transfer = !actions || actions.includes('TRANSFER');
  const proofConfigured = proofMode === 'issuer' || (proofMode === 'rfc3161' ? timestampConfigured : proofMode === 'witness-quorum' ? witnessConfigured : anchorConfigured);
  const rpc = rpcChainIds === undefined ? 'unknown' : chains.some(id => rpcChainIds.includes(id)) ? 'configured' : 'unavailable';
  return {
    schema: 'priorseal.capabilities.v1', issuer, audience,
    executionProfiles: [...(transfer ? ['priorseal.intent.v1'] : []), ...(exactCall ? ['priorseal.execution-profile.exact-call.v1'] : []), ...(erc4337 ? ['priorseal.execution-profile.erc4337-user-operation.v1'] : [])],
    erc4337EntryPoints: erc4337EntryPoints.filter(entry => chains.includes(entry.chainId)),
    safe4337Trust: safe4337Trust.filter(entry => chains.includes(entry.chainId)),
    chains, authorizers: ['eip712', ...(contractSignatureConfigured ? ['eip1271'] : [])], proofMode,
    policyHash: policy ? `0x${hashJson(policy)}` : `0x${'0'.repeat(64)}`,
    minConfirmations: policy?.minConfirmations ?? 0,
    maxToleratedReorgDepth: policy?.maxToleratedReorgDepth ?? null,
    finalityRequirement: policy?.finalityRequirement ?? 'CONFIRMATIONS',
    dependencies: { issuer: keyConfigured ? 'configured' : 'unavailable', timestamp: proofMode === 'issuer' ? 'not_required' : proofConfigured ? 'configured' : 'unavailable', rpc, storage },
    workflowReady: Boolean(keyConfigured && proofConfigured && rpc === 'configured' && storage === 'available' && chains.length && (transfer || exactCall || erc4337)),
    chainReadiness: chains.map(chainId => ({ chainId, rpc: rpcChainIds === undefined ? 'unknown' : rpcChainIds.includes(chainId) ? 'configured' : 'unavailable' })),
    readinessScope: 'Configuration and storage check only; prepare evaluates the actual request policy. RPC/TSA reachability is not probed.',
    checkedAt: Math.floor(now / 1000),
    archive: { enabled: archiveEnabled, retention: store.archiveRetention ?? 'operator_defined', scope: 'project_uploaded_evidence' },
  };
}
