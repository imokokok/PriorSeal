// Generated from contract-signature-verifier.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../../domain/errors.mjs";
import { erc1271CallData } from "../../../domain/authorization.mjs";
const ERC1271_MAGIC_VALUE = "0x1626ba7e";
function createContractSignatureVerifier({ rpcClient, rpcUrls }) {
  if (!rpcClient?.call || typeof rpcUrls !== "function") throw new TypeError("ERC-1271 verification requires an RPC client and URL resolver");
  return async ({ authorization, digest, signature }) => {
    const chain = Number(authorization.intent.chainId);
    const urls = rpcUrls(chain) ?? [];
    let completedContractChecks = 0;
    for (const url of urls) {
      try {
        const reportedChain = Number(BigInt(String(await rpcClient.call(url, "eth_chainId", []))));
        if (reportedChain !== chain) continue;
        const result = await rpcClient.call(url, "eth_call", [{ to: authorization.authorizer.address, data: erc1271CallData(digest, signature) }, "latest"]);
        completedContractChecks += 1;
        if (String(result).slice(0, 10).toLowerCase() === ERC1271_MAGIC_VALUE) return true;
      } catch {
      }
    }
    if (completedContractChecks === 0) throw new PriorSealError("AUTHORIZATION_VERIFIER_UNAVAILABLE", "No correctly identified RPC endpoint could verify the contract signature");
    return false;
  };
}
export {
  createContractSignatureVerifier
};
