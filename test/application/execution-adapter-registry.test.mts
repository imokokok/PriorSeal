import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionAdapterRegistry } from "../../src/application/execution-adapters/registry.mjs";
import { PriorSealError } from "../../src/domain/errors.mjs";
import { createHyperliquidExecutionAdapter } from "../../src/infrastructure/blockchain/hyperliquid/execution-adapter.mjs";
import type {
	ExecutionObservationAdapter,
	ExecutionObservationRequest,
} from "../../src/domain/execution-adapter.mjs";

const evmRequest: ExecutionObservationRequest = {
	kind: "evm-transaction",
	reference: {
		kind: "evm-transaction",
		chainId: 8453,
		txHash: `0x${"1".repeat(64)}`,
	},
	chainId: 8453,
	txHash: `0x${"1".repeat(64)}`,
	confirmations: 2,
	finalityRequirement: "CONFIRMATIONS",
	maxToleratedReorgDepth: null,
};

test("execution adapter registry resolves exactly one typed protocol adapter", async () => {
	const calls: string[] = [];
	const adapter: ExecutionObservationAdapter = {
		id: "priorseal.test-evm-observer.v1",
		kinds: ["evm-transaction"],
		supports: (request) => request.kind === "evm-transaction",
		async observe(request) {
			calls.push(request.kind);
			return {
				chainId: request.chainId,
				txHash: request.txHash,
				status: "PENDING",
				observedAt: 1,
			};
		},
	};
	const registry = createExecutionAdapterRegistry([adapter]);

	const observed = await registry.observe(evmRequest);
	assert.deepEqual(calls, ["evm-transaction"]);
	assert.equal(observed.txHash, evmRequest.txHash);
	assert.deepEqual(registry.list(), [
		{ id: adapter.id, kinds: ["evm-transaction"] },
	]);
});

test("execution adapter registry fails closed when no adapter owns a request", async () => {
	const registry = createExecutionAdapterRegistry([]);
	await assert.rejects(
		() => registry.observe(evmRequest),
		(error: unknown) =>
			error instanceof PriorSealError &&
			error.code === "UNSUPPORTED_EXECUTION_ADAPTER",
	);
});

test("execution adapter registry treats declared kinds as an enforcement boundary", async () => {
	const registry = createExecutionAdapterRegistry([
		{
			id: "priorseal.test-misdeclared-observer.v1",
			kinds: ["solana-signature"],
			supports: () => true,
			async observe(request) {
				return {
					chainId: request.chainId,
					txHash: request.txHash,
					status: "PENDING",
					observedAt: 1,
				};
			},
		},
	]);
	await assert.rejects(
		() => registry.observe(evmRequest),
		(error: unknown) =>
			error instanceof PriorSealError &&
			error.code === "UNSUPPORTED_EXECUTION_ADAPTER",
	);
});

test("Hyperliquid adapter refuses to observe when its public Info API is not configured", async () => {
	const adapter = createHyperliquidExecutionAdapter({});
	const request = {
		kind: "venue-order",
		reference: {
			kind: "venue-order",
			venue: "hyperliquid",
			account: "0x1111111111111111111111111111111111111111",
			clientOrderId: "0x1234",
		},
		chainId: 998,
		txHash: "0x1234",
		confirmations: 0,
		finalityRequirement: "CONFIRMATIONS",
		maxToleratedReorgDepth: null,
		hyperliquidOrder: {} as never,
		hyperliquidNonce: "1",
		hyperliquidUser: "0x1111111111111111111111111111111111111111",
	} as const satisfies ExecutionObservationRequest;
	await assert.rejects(
		() => adapter.observe(request),
		(error: unknown) =>
			error instanceof PriorSealError && error.code === "RPC_NOT_CONFIGURED",
	);
});
