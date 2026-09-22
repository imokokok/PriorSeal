// Generated from execute-rwa.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
import { buildIntent } from "../../domain/intent.mjs";
import { verifyAuthorization, verifyAuthorizationReceipt } from "../../domain/authorization.mjs";
import { evaluateAuthorizationPolicy } from "../../domain/intent-policy.mjs";
function need(ok, code) {
  if (!ok) throw new Error(code);
}
function checkReplayAttempt(attempt, transaction, executionDigest) {
  need(hashJson(attempt.transaction) === hashJson(transaction), "RWA_REPLAY_SCOPE_MISMATCH");
  need(attempt.executionDigest === executionDigest, "RWA_REPLAY_EVIDENCE_MISMATCH");
}
function keyAdmits(k, a) {
  return k && k.issuer === a.issuer && k.keyId === a.keyId && k.algorithm === "Ed25519" && ["active", "retired"].includes(k.status ?? "") && [k.validFrom, k.validUntil].every((v) => v == null || Number.isSafeInteger(v) && v > 0) && (k.validFrom == null || k.validUntil == null || k.validFrom <= k.validUntil) && (k.validFrom == null || a.acceptedAt >= k.validFrom) && (k.validUntil == null || a.acceptedAt <= k.validUntil);
}
async function checkAuthorization(p, record, now, verifyContractSignature) {
  need(Number.isSafeInteger(now) && now > 0, "RWA_CLOCK_INVALID");
  const { authorization: a, acceptance } = record;
  const verified = await verifyAuthorization(a, { now, audience: p.audience, verifyContractSignature });
  need(verified.valid, verified.code);
  need(a.schema === "priorseal.authorization.v2" && a.delegate.executor === p.transaction.from && now < a.expiresAt, "RWA_AUTHORIZATION_SCOPE_OR_TIME");
  const { intentHash, ...requestedIntent } = p.intent;
  need((intentHash == null || intentHash === a.intentHash) && hashJson(a.intent) === hashJson(buildIntent(requestedIntent)) && a.authorizationId === p.authorizationId, "RWA_AUTHORIZATION_INTENT_MISMATCH");
  need(keyAdmits(p.acceptanceKey, acceptance) && verifyAuthorizationReceipt(acceptance, p.acceptanceKey.publicKey), "RWA_ACCEPTANCE_UNTRUSTED");
  need(acceptance.authorizationId === a.authorizationId && acceptance.authorizationHash === hashJson(a) && acceptance.intentHash === a.intentHash && acceptance.acceptedAt >= a.notBefore && acceptance.acceptedAt < a.expiresAt && acceptance.acceptedAt <= now && acceptance.acceptedAt === p.authorityTime, "RWA_ACCEPTANCE_MISMATCH");
  const policy = record.policyEvidence?.document ?? null;
  need(a.policyHash === (policy ? "0x" + hashJson(policy) : "0x" + "0".repeat(64)), "RWA_AUTHORIZATION_POLICY_MISMATCH");
  need(!policy?.timestampPolicy && !policy?.witnessQuorum, "RWA_EXTERNAL_POLICY_VERIFIER_REQUIRED");
  if (policy) need(evaluateAuthorizationPolicy(a, policy, now).allowed, "RWA_AUTHORIZATION_POLICY_REJECTED");
}
async function executeRwaAuthorized(input, { authorizationStore, attempts, submit, clock = () => Math.floor(Date.now() / 1e3), verifyContractSignature }) {
  const p = structuredClone(input);
  const { withRwaExecutionPair } = await import("../../../sdk/dist/index.js");
  need(typeof p.audience === "string" && p.audience.length > 0, "RWA_AUDIENCE_REQUIRED");
  need(p.authority.proof.report.schema === "insight.rwa-report.v2" && p.execution.proof.report.schema === "insight.rwa-report.v2", "RWA_V2_REQUIRED");
  const record = structuredClone(await authorizationStore.getAuthorization(p.authorizationId));
  need(record, "AUTHORIZATION_NOT_FOUND");
  await checkAuthorization(p, record, clock(), verifyContractSignature);
  const existing = await attempts.get(p.authorizationId);
  if (existing) {
    checkReplayAttempt(existing, p.transaction, p.execution.proof.digest);
    return { replay: true, attempt: existing };
  }
  need(!record.boundTxHash && record.uses === 0 && record.status === "ACCEPTED", "AUTHORIZATION_ALREADY_USED");
  const pair = { intent: p.intent, authority: p.authority, execution: p.execution, authorityTime: p.authorityTime };
  return withRwaExecutionPair(pair, p.transaction, async (transaction) => {
    const claim = await attempts.reserve({ authorizationId: p.authorizationId, transaction, executionDigest: p.execution.proof.digest, now: clock() });
    if (!claim.claimed) {
      need(!claim.code, claim.code);
      checkReplayAttempt(claim.attempt, transaction, p.execution.proof.digest);
      return { replay: true, attempt: claim.attempt };
    }
    let started = false;
    try {
      const fresh = structuredClone(await authorizationStore.getAuthorization(p.authorizationId));
      need(fresh, "AUTHORIZATION_NOT_FOUND");
      await checkAuthorization(p, fresh, clock(), verifyContractSignature);
      need(!fresh.boundTxHash && fresh.uses === 0, "AUTHORIZATION_ALREADY_USED");
      await attempts.transition(p.authorizationId, ["RESERVED"], { status: "SUBMITTING", updatedAt: clock() });
      started = true;
      return await withRwaExecutionPair(pair, transaction, async (exact) => {
        const now = clock();
        need(now >= fresh.authorization.notBefore && now < fresh.authorization.expiresAt, "RWA_AUTHORIZATION_EXPIRED");
        const txHash = await submit(exact);
        need(typeof txHash === "string" && /^0x[0-9a-f]{64}$/.test(txHash), "RWA_SUBMISSION_RESPONSE_INVALID");
        const attempt = await attempts.transition(p.authorizationId, ["SUBMITTING"], { status: "SUBMITTED", txHash, updatedAt: clock() });
        const bound = await authorizationStore.bindAuthorization(p.authorizationId, txHash);
        need(bound.ok, bound.code);
        return { replay: false, attempt };
      }, clock);
    } catch (error) {
      try {
        await attempts.transition(p.authorizationId, [started ? "SUBMITTING" : "RESERVED"], { status: started ? "UNCERTAIN" : "REJECTED", updatedAt: clock() });
      } catch {
      }
      throw error;
    }
  }, clock);
}
async function reconcileRwaAttempt(authorizationId, { attempts, authorizationStore, observe, clock = () => Math.floor(Date.now() / 1e3) }) {
  const a = await attempts.get(authorizationId);
  need(a, "RWA_ATTEMPT_MISSING");
  if (["CONFIRMED", "REVERTED"].includes(a.status)) {
    need(a.txHash, "RWA_TX_HASH_REQUIRED");
    const bound2 = await authorizationStore.bindAuthorization(authorizationId, a.txHash);
    need(bound2.ok, bound2.code);
    return a;
  }
  if (["REJECTED", "RESERVED"].includes(a.status)) return a;
  const observed = structuredClone(await observe(structuredClone(a)));
  if (!observed) return a;
  need(hashJson(observed.transaction) === hashJson(a.transaction) && /^0x[0-9a-f]{64}$/.test(observed.txHash) && ["CONFIRMED", "REVERTED"].includes(observed.status) && observed.finalized === true && (!a.txHash || a.txHash === observed.txHash), "RWA_RECONCILIATION_MISMATCH");
  const result = await attempts.transition(authorizationId, ["SUBMITTING", "SUBMITTED", "UNCERTAIN"], { status: observed.status, txHash: observed.txHash, updatedAt: clock() });
  const bound = await authorizationStore.bindAuthorization(authorizationId, observed.txHash);
  need(bound.ok, bound.code);
  return result;
}
export {
  executeRwaAuthorized,
  reconcileRwaAttempt
};
