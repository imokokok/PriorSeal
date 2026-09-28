// Generated from execute-rwa.mts by npm run core:build. Do not edit directly.
import { executeAuthorizedExactCall, reconcileAuthorizedExactCall } from "../execution/authorized-exact-call.mjs";
async function executeRwaAuthorized(input, { authorizationStore, attempts, submit, clock = () => Math.floor(Date.now() / 1e3), verifyContractSignature }) {
  const p = structuredClone(input);
  if (p.authority.proof.report.schema !== "insight.rwa-report.v2" || p.execution.proof.report.schema !== "insight.rwa-report.v2") throw new Error("RWA_V2_REQUIRED");
  const { withRwaExecutionPair } = await import("../../../sdk/dist/index.js");
  const pair = { intent: p.intent, authority: p.authority, execution: p.execution, authorityTime: p.authorityTime };
  return executeAuthorizedExactCall({
    audience: p.audience,
    authorizationId: p.authorizationId,
    intent: p.intent,
    transaction: p.transaction,
    acceptanceKey: p.acceptanceKey,
    executionDigest: p.execution.proof.digest,
    authorityTime: p.authorityTime
  }, {
    authorizationStore,
    attempts,
    submit,
    clock,
    verifyContractSignature,
    replayErrorPrefix: "RWA",
    checkProfile: async (transaction, now) => {
      await withRwaExecutionPair(pair, transaction, async () => void 0, () => now);
    }
  });
}
async function reconcileRwaAttempt(authorizationId, deps) {
  return reconcileAuthorizedExactCall(authorizationId, deps);
}
export {
  executeRwaAuthorized,
  reconcileRwaAttempt
};
