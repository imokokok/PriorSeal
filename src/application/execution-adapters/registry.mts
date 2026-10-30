import { PriorSealError } from "../../domain/errors.mjs";
import type {
	ExecutionObservationAdapter,
	ExecutionObservationRequest,
} from "../../domain/execution-adapter.mjs";
import type { ExecutionInput } from "../../domain/execution.mjs";

/** Resolves one typed adapter; protocol modules never dispatch to one another. */
export function createExecutionAdapterRegistry(
	adapters: readonly ExecutionObservationAdapter[],
) {
	const ids = new Set<string>();
	for (const adapter of adapters) {
		if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(adapter.id)) {
			throw new TypeError("Execution adapter id is invalid");
		}
		if (!Array.isArray(adapter.kinds) || adapter.kinds.length === 0) {
			throw new TypeError(
				`Execution adapter ${adapter.id} does not declare supported kinds`,
			);
		}
		if (ids.has(adapter.id))
			throw new TypeError(`Execution adapter ${adapter.id} is duplicated`);
		ids.add(adapter.id);
	}

	return {
		list() {
			return adapters.map(({ id, kinds }) => ({ id, kinds: [...kinds] }));
		},
		async observe(
			request: ExecutionObservationRequest,
		): Promise<ExecutionInput> {
			const matches = adapters.filter(
				(adapter) =>
					adapter.kinds.includes(request.kind) && adapter.supports(request),
			);
			if (matches.length !== 1) {
				throw new PriorSealError(
					"UNSUPPORTED_EXECUTION_ADAPTER",
					`Expected one execution adapter for ${request.kind}; found ${matches.length}`,
				);
			}
			return matches[0]!.observe(request);
		},
	};
}
