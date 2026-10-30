import { PriorSealError } from "../../../domain/errors.mjs";
import { observeHyperliquidSpotIoc } from "./observer.mjs";
import type {
	ExecutionObservationAdapter,
	ExecutionObservationRequest,
	HyperliquidExecutionObservationRequest,
} from "../../../domain/execution-adapter.mjs";

function isHyperliquidRequest(
	request: ExecutionObservationRequest,
): request is HyperliquidExecutionObservationRequest {
	return (
		request.kind === "venue-order" && request.reference.venue === "hyperliquid"
	);
}

/** Adapts a cloid-bound Hyperliquid order to the public Info API. */
export function createHyperliquidExecutionAdapter(options: {
	infoUrl?: string;
	metrics?: {
		count?: (metric: string, tags: Record<string, string>) => void;
		timing?: (
			metric: string,
			durationMs: number,
			tags: Record<string, string>,
		) => void;
	} | null;
}): ExecutionObservationAdapter {
	return {
		id: "priorseal.hyperliquid-observation.v1",
		kinds: ["venue-order"],
		supports: isHyperliquidRequest,
		async observe(request) {
			if (!isHyperliquidRequest(request)) {
				throw new PriorSealError(
					"UNSUPPORTED_EXECUTION_ADAPTER",
					"Hyperliquid adapter received a non-Hyperliquid request",
				);
			}
			if (!options.infoUrl) {
				throw new PriorSealError(
					"RPC_NOT_CONFIGURED",
					"Set PRIORSEAL_HYPERLIQUID_INFO_URL before observing Hyperliquid orders",
				);
			}
			return observeHyperliquidSpotIoc({
				txHash: request.txHash,
				order: request.hyperliquidOrder,
				nonce: request.hyperliquidNonce,
				user: request.hyperliquidUser,
				infoUrl: options.infoUrl,
				signal: request.signal,
				metrics: options.metrics ?? null,
			});
		},
	};
}
