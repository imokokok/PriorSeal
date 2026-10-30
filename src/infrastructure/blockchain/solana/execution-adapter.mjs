// Generated from execution-adapter.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../../domain/errors.mjs";
import { observeSolana } from "./observer.mjs";
function isSolanaRequest(request) {
  return request.kind === "solana-signature";
}
function createSolanaExecutionAdapter(options) {
  return {
    id: "priorseal.solana-observation.v1",
    kinds: ["solana-signature"],
    supports: isSolanaRequest,
    async observe(request) {
      if (!isSolanaRequest(request)) {
        throw new PriorSealError(
          "UNSUPPORTED_EXECUTION_ADAPTER",
          "Solana adapter received a non-Solana request"
        );
      }
      return observeSolana({
        chainId: request.chainId,
        txHash: request.txHash,
        rpcUrls: options.rpcUrls(request.chainId),
        confirmations: request.confirmations,
        finalityRequirement: request.finalityRequirement,
        expectedTransaction: request.solanaTransaction,
        signal: request.signal,
        metrics: options.metrics ?? null
      });
    }
  };
}
export {
  createSolanaExecutionAdapter
};
