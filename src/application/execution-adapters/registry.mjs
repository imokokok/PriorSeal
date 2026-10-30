// Generated from registry.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../domain/errors.mjs";
function createExecutionAdapterRegistry(adapters) {
  const ids = /* @__PURE__ */ new Set();
  for (const adapter of adapters) {
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(adapter.id)) {
      throw new TypeError("Execution adapter id is invalid");
    }
    if (!Array.isArray(adapter.kinds) || adapter.kinds.length === 0) {
      throw new TypeError(
        `Execution adapter ${adapter.id} does not declare supported kinds`
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
    async observe(request) {
      const matches = adapters.filter(
        (adapter) => adapter.kinds.includes(request.kind) && adapter.supports(request)
      );
      if (matches.length !== 1) {
        throw new PriorSealError(
          "UNSUPPORTED_EXECUTION_ADAPTER",
          `Expected one execution adapter for ${request.kind}; found ${matches.length}`
        );
      }
      return matches[0].observe(request);
    }
  };
}
export {
  createExecutionAdapterRegistry
};
