// Generated from execute-defi.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
import { executeAuthorizedExactCall, reconcileAuthorizedExactCall } from "../execution/authorized-exact-call.mjs";
async function executeDefiAuthorized(input, deps) {
  const p = structuredClone(input);
  if (p.adapter?.kind !== "uniswap-v3-single") throw new Error("DEFI_ADAPTER_UNSUPPORTED");
  const { parseV3SwapApproval, assertV3SwapAuthorization } = await import("../../../sdk/dist/index.js");
  const approval = parseV3SwapApproval(p.adapter.approval);
  const executionDigest = `0x${hashJson({ schema: "priorseal.defi-execution.v1", adapter: p.adapter.kind, approval })}`;
  return executeAuthorizedExactCall({
    audience: p.audience,
    authorizationId: p.authorizationId,
    intent: p.intent,
    transaction: p.transaction,
    acceptanceKey: p.acceptanceKey,
    executionDigest
  }, {
    ...deps,
    checkProfile: async (transaction, now) => {
      const rpcChain = await deps.chainReader.getChainId();
      if (rpcChain !== approval.chainId) throw new Error("DEFI_RPC_CHAIN_MISMATCH");
      const bytecode = await deps.chainReader.getBytecode({ address: approval.router });
      assertV3SwapAuthorization({ approval, transaction, intent: p.intent, routerBytecode: bytecode, now });
    }
  });
}
async function getDefiAttempt(authorizationId, attempts) {
  return attempts.get(authorizationId);
}
async function reconcileDefiAttempt(authorizationId, deps) {
  return reconcileAuthorizedExactCall(authorizationId, deps);
}
function createDefiExecutionGateway(client, deps) {
  if (!client || typeof client.prepareAuthorization !== "function" || typeof client.acceptAuthorization !== "function") throw new TypeError("DEFI_AUTHORIZATION_CLIENT_REQUIRED");
  return {
    async prepare(input) {
      const { parseV3SwapApproval, assertV3SwapRouterCode, buildV3SwapIntent } = await import("../../../sdk/dist/index.js");
      const approval = parseV3SwapApproval(input.approval);
      if (await deps.chainReader.getChainId() !== approval.chainId) throw new Error("DEFI_RPC_CHAIN_MISMATCH");
      assertV3SwapRouterCode(approval, await deps.chainReader.getBytecode({ address: approval.router }));
      const intent = buildV3SwapIntent({ approval, transaction: input.transaction, intentId: input.intentId, validUntil: input.validUntil, constraints: input.constraints, contextCommitments: input.contextCommitments, now: (deps.clock ?? (() => Math.floor(Date.now() / 1e3)))() });
      return client.prepareAuthorization({ ...input.authorization, intent });
    },
    authorize(signed) {
      return client.acceptAuthorization(signed);
    },
    execute(input) {
      return executeDefiAuthorized(input, deps);
    },
    status(authorizationId) {
      return getDefiAttempt(authorizationId, deps.attempts);
    },
    recover(authorizationId, observe) {
      return reconcileDefiAttempt(authorizationId, { attempts: deps.attempts, authorizationStore: deps.authorizationStore, observe, clock: deps.clock });
    }
  };
}
export {
  createDefiExecutionGateway,
  executeDefiAuthorized,
  getDefiAttempt,
  reconcileDefiAttempt
};
