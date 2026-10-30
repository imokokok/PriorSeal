import { PriorSealError } from "../../../domain/errors.mjs";
import { observeSolana } from "./observer.mjs";
import type {
	ExecutionObservationAdapter,
	ExecutionObservationRequest,
	SolanaExecutionObservationRequest,
} from "../../../domain/execution-adapter.mjs";
import type { RpcMetrics } from "../evm/rpc-client.mjs";

function isSolanaRequest(
	request: ExecutionObservationRequest,
): request is SolanaExecutionObservationRequest {
	return request.kind === "solana-signature";
}

/** Adapts a resolved Solana message to its signature-observation transport. */
export function createSolanaExecutionAdapter(options: {
	rpcUrls: (chainId: number) => string[];
	metrics?: RpcMetrics | null;
}): ExecutionObservationAdapter {
	return {
		id: "priorseal.solana-observation.v1",
		kinds: ["solana-signature"],
		supports: isSolanaRequest,
		async observe(request) {
			if (!isSolanaRequest(request)) {
				throw new PriorSealError(
					"UNSUPPORTED_EXECUTION_ADAPTER",
					"Solana adapter received a non-Solana request",
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
				metrics: options.metrics ?? null,
			});
		},
	};
}
