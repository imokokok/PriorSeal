// Generated from execution-adapter.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../../domain/errors.mjs";
import { observeEvm } from "./observer.mjs";
function isEvmRequest(request) {
  return request.kind === "evm-transaction";
}
function createEvmExecutionAdapter(options) {
  return {
    id: "priorseal.evm-observation.v1",
    kinds: ["evm-transaction"],
    supports: isEvmRequest,
    async observe(request) {
      if (!isEvmRequest(request)) {
        throw new PriorSealError(
          "UNSUPPORTED_EXECUTION_ADAPTER",
          "EVM adapter received a non-EVM request"
        );
      }
      return observeEvm({
        chainId: request.chainId,
        txHash: request.txHash,
        confirmations: request.confirmations,
        finalityRequirement: request.finalityRequirement,
        maxToleratedReorgDepth: request.maxToleratedReorgDepth,
        erc4337: request.erc4337,
        erc4337EntryPoints: options.erc4337EntryPoints,
        safe4337Trust: options.safe4337Trust,
        eip7702Delegates: options.eip7702Delegates,
        rpcUrls: options.rpcUrls(request.chainId),
        rpcClient: options.rpcClient,
        signal: request.signal
      });
    }
  };
}
export {
  createEvmExecutionAdapter
};
