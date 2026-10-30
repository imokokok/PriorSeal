import { PriorSealError } from "../../../domain/errors.mjs";
import { observeEvm } from "./observer.mjs";
import type {
	EvmExecutionObservationRequest,
	ExecutionObservationAdapter,
	ExecutionObservationRequest,
} from "../../../domain/execution-adapter.mjs";
import type { createRpcClient } from "./rpc-client.mjs";

type EvmObserverOptions = Parameters<typeof observeEvm>[0];
type EvmAdapterOptions = {
	rpcUrls: (chainId: number) => string[];
	rpcClient: ReturnType<typeof createRpcClient>;
	erc4337EntryPoints?: EvmObserverOptions["erc4337EntryPoints"];
	safe4337Trust?: EvmObserverOptions["safe4337Trust"];
	eip7702Delegates?: EvmObserverOptions["eip7702Delegates"];
};

function isEvmRequest(
	request: ExecutionObservationRequest,
): request is EvmExecutionObservationRequest {
	return request.kind === "evm-transaction";
}

/** Adapts the generic observation request to JSON-RPC transaction evidence. */
export function createEvmExecutionAdapter(
	options: EvmAdapterOptions,
): ExecutionObservationAdapter {
	return {
		id: "priorseal.evm-observation.v1",
		kinds: ["evm-transaction"],
		supports: isEvmRequest,
		async observe(request) {
			if (!isEvmRequest(request)) {
				throw new PriorSealError(
					"UNSUPPORTED_EXECUTION_ADAPTER",
					"EVM adapter received a non-EVM request",
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
				signal: request.signal,
			});
		},
	};
}
