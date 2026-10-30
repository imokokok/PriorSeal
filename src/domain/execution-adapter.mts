/**
 * Typed, protocol-neutral boundary for observing an already user-submitted
 * execution.  The reference is common; the signed payload and finality rules
 * stay specific to EVM, Solana, or a venue.
 */
import type { ExecutionInput } from "./execution.mjs";
import type { HyperliquidSpotIocOrder } from "./hyperliquid.mjs";
import type { SolanaTransactionMessage } from "./solana.mjs";

export const EXECUTION_ADAPTER_SCHEMA = "priorseal.execution-adapter.v1";

export type ExecutionReference =
	| { kind: "evm-transaction"; chainId: number; txHash: string }
	| { kind: "solana-signature"; chainRef: string; signature: string }
	| {
			kind: "venue-order";
			venue: string;
			account: string;
			clientOrderId: string;
	  };

export type Erc4337ObservationContext = {
	entryPoint: string;
	entryPointCodeHash: string;
	entryPointVersion: "0.6" | "0.7" | "0.8" | "0.9";
	userOperationHash: string;
	accountCallProfile?: "safe-4337.v1";
	accountCallTarget?: string;
	accountCallValue?: string;
	accountCallDataHash?: string;
	eip7702?: {
		delegateAddress: string;
		delegateCodeHash: string;
		authorizationTupleHash?: string;
	};
};

type ObservationRequestBase = {
	chainId: number;
	txHash: string;
	confirmations: number;
	finalityRequirement: "CONFIRMATIONS" | "RPC_FINALIZED";
	maxToleratedReorgDepth: number | null;
	signal?: AbortSignal;
};

export type EvmExecutionObservationRequest = ObservationRequestBase & {
	kind: "evm-transaction";
	reference: Extract<ExecutionReference, { kind: "evm-transaction" }>;
	erc4337?: Erc4337ObservationContext;
};

export type SolanaExecutionObservationRequest = ObservationRequestBase & {
	kind: "solana-signature";
	reference: Extract<ExecutionReference, { kind: "solana-signature" }>;
	solanaTransaction: SolanaTransactionMessage;
};

export type HyperliquidExecutionObservationRequest = ObservationRequestBase & {
	kind: "venue-order";
	reference: Extract<ExecutionReference, { kind: "venue-order" }>;
	hyperliquidOrder: HyperliquidSpotIocOrder;
	hyperliquidNonce: string;
	hyperliquidUser: string;
};

export type ExecutionObservationRequest =
	| EvmExecutionObservationRequest
	| SolanaExecutionObservationRequest
	| HyperliquidExecutionObservationRequest;

export interface ExecutionObservationAdapter {
	readonly id: string;
	readonly kinds: readonly ExecutionObservationRequest["kind"][];
	supports(request: ExecutionObservationRequest): boolean;
	observe(request: ExecutionObservationRequest): Promise<ExecutionInput>;
}
