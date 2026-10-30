// Generated from execution-adapter.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../../domain/errors.mjs";
import { observeHyperliquidSpotIoc } from "./observer.mjs";
function isHyperliquidRequest(request) {
  return request.kind === "venue-order" && request.reference.venue === "hyperliquid";
}
function createHyperliquidExecutionAdapter(options) {
  return {
    id: "priorseal.hyperliquid-observation.v1",
    kinds: ["venue-order"],
    supports: isHyperliquidRequest,
    async observe(request) {
      if (!isHyperliquidRequest(request)) {
        throw new PriorSealError(
          "UNSUPPORTED_EXECUTION_ADAPTER",
          "Hyperliquid adapter received a non-Hyperliquid request"
        );
      }
      if (!options.infoUrl) {
        throw new PriorSealError(
          "RPC_NOT_CONFIGURED",
          "Set PRIORSEAL_HYPERLIQUID_INFO_URL before observing Hyperliquid orders"
        );
      }
      return observeHyperliquidSpotIoc({
        txHash: request.txHash,
        order: request.hyperliquidOrder,
        nonce: request.hyperliquidNonce,
        user: request.hyperliquidUser,
        infoUrl: options.infoUrl,
        signal: request.signal,
        metrics: options.metrics ?? null
      });
    }
  };
}
export {
  createHyperliquidExecutionAdapter
};
