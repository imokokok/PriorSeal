// Generated from capabilities.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../domain/hashing.mjs";
import { SUPPORTED_CHAINS } from "../infrastructure/blockchain/evm/chains.mjs";
async function deploymentCapabilities({ issuer, audience, keyConfigured, policy, proofMode, timestampConfigured, witnessConfigured, anchorConfigured, rpcChainIds, erc4337EntryPoints = [], safe4337Trust = [], eip7702Delegates = [], store, archiveEnabled, contractSignatureConfigured = false, now }) {
  let storage = "available";
  try {
    if (store.health) await store.health();
  } catch {
    storage = "unavailable";
  }
  const chains = Object.keys(SUPPORTED_CHAINS).map(Number).filter((id) => !policy?.allowedChainIds || policy.allowedChainIds.map(Number).includes(id));
  const actions = policy?.allowedActions === void 0 ? null : Array.isArray(policy.allowedActions) ? policy.allowedActions.map((action) => String(action).toUpperCase()) : [];
  const exactCall = policy?.allowedAssets === void 0 && policy?.allowedRecipients === void 0 && policy?.maxAmount === void 0 && (!actions || actions.includes("CONTRACT_CALL"));
  const erc4337 = policy?.allowedAssets === void 0 && policy?.allowedRecipients === void 0 && policy?.maxAmount === void 0 && (!actions || actions.includes("ERC4337_USER_OPERATION")) && erc4337EntryPoints.some((entry) => chains.includes(entry.chainId));
  const transfer = !actions || actions.includes("TRANSFER");
  const proofConfigured = proofMode === "issuer" || (proofMode === "rfc3161" ? timestampConfigured : proofMode === "witness-quorum" ? witnessConfigured : anchorConfigured);
  const rpc = rpcChainIds === void 0 ? "unknown" : chains.some((id) => rpcChainIds.includes(id)) ? "configured" : "unavailable";
  return {
    schema: "priorseal.capabilities.v1",
    issuer,
    audience,
    executionProfiles: [...transfer ? ["priorseal.intent.v1"] : [], ...exactCall ? ["priorseal.execution-profile.exact-call.v1"] : [], ...erc4337 ? ["priorseal.execution-profile.erc4337-user-operation.v1"] : []],
    erc4337EntryPoints: erc4337EntryPoints.filter((entry) => chains.includes(entry.chainId)),
    safe4337Trust: safe4337Trust.filter((entry) => chains.includes(entry.chainId)),
    eip7702Delegates: eip7702Delegates.filter((entry) => chains.includes(entry.chainId)),
    chains,
    authorizers: ["eip712", ...contractSignatureConfigured ? ["eip1271"] : []],
    proofMode,
    policyHash: policy ? `0x${hashJson(policy)}` : `0x${"0".repeat(64)}`,
    minConfirmations: policy?.minConfirmations ?? 0,
    maxToleratedReorgDepth: policy?.maxToleratedReorgDepth ?? null,
    finalityRequirement: policy?.finalityRequirement ?? "CONFIRMATIONS",
    dependencies: { issuer: keyConfigured ? "configured" : "unavailable", timestamp: proofMode === "issuer" ? "not_required" : proofConfigured ? "configured" : "unavailable", rpc, storage },
    workflowReady: Boolean(keyConfigured && proofConfigured && rpc === "configured" && storage === "available" && chains.length && (transfer || exactCall || erc4337)),
    chainReadiness: chains.map((chainId) => ({ chainId, rpc: rpcChainIds === void 0 ? "unknown" : rpcChainIds.includes(chainId) ? "configured" : "unavailable" })),
    readinessScope: "Configuration and storage check only; prepare evaluates the actual request policy. RPC/TSA reachability is not probed.",
    checkedAt: Math.floor(now / 1e3),
    archive: { enabled: archiveEnabled, retention: store.archiveRetention ?? "operator_defined", scope: "project_uploaded_evidence" }
  };
}
export {
  deploymentCapabilities
};
