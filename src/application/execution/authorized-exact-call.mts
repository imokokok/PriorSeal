import { hashJson } from '../../domain/hashing.mjs';
import { buildIntent } from '../../domain/intent.mjs';
import { verifyAuthorization, verifyAuthorizationReceipt } from '../../domain/authorization.mjs';
import { evaluateAuthorizationPolicy } from '../../domain/intent-policy.mjs';
import type { Authorization, AuthorizationAcceptance } from '../../domain/authorization.mjs';
import type { KeyEntry } from '../../domain/key-registry.mjs';
import type { RwaAttempt, RwaTransaction } from '../../infrastructure/persistence/rwa-attempt-store.mjs';
import type { RwaAttemptStore } from '../../infrastructure/persistence/rwa-attempt-model.mjs';
import type { withRwaExecutionPair } from '../../../sdk/dist/index.js';

type ExactTransaction = Parameters<typeof withRwaExecutionPair>[1];
type Intent = Parameters<typeof withRwaExecutionPair>[0]['intent'];
export type AuthorizationRecord = { authorization: Authorization; acceptance: AuthorizationAcceptance; policyEvidence?: { document?: Record<string, unknown> | null }; boundTxHash: string | null; uses: number; status: string };
export type AuthorizationStore = { getAuthorization: (id: string) => Promise<AuthorizationRecord | null | undefined>; bindAuthorization: (id: string, txHash: string) => Promise<{ ok: boolean; code?: string }> };
export type ContractSignatureVerifier = NonNullable<NonNullable<Parameters<typeof verifyAuthorization>[1]>['verifyContractSignature']>;
export type RecoveryObservation = { transaction: RwaTransaction; txHash: string; status: 'CONFIRMED' | 'REVERTED'; finalized: boolean };
export type ExactCallInput = { audience: string; authorizationId: string; intent: Intent; transaction: ExactTransaction; acceptanceKey: KeyEntry; executionDigest: string; authorityTime?: number };
export type ExactCallDependencies = { authorizationStore: AuthorizationStore; attempts: RwaAttemptStore; submit: (transaction: ExactTransaction, assertBeforeBroadcast: () => Promise<void>) => Promise<string>; checkProfile: (transaction: ExactTransaction, now: number) => Promise<void>; replayErrorPrefix?: 'RWA' | 'EXECUTION'; clock?: () => number; verifyContractSignature?: ContractSignatureVerifier };
function need(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }

function checkReplayAttempt(attempt: RwaAttempt, transaction: ExactTransaction, executionDigest: string, prefix: 'RWA' | 'EXECUTION') {
  need(hashJson(attempt.transaction) === hashJson(transaction), `${prefix}_REPLAY_SCOPE_MISMATCH`);
  need(attempt.executionDigest === executionDigest, `${prefix}_REPLAY_EVIDENCE_MISMATCH`);
}

function keyAdmits(k: KeyEntry | null | undefined, a: AuthorizationAcceptance) {
  return k && k.issuer === a.issuer && k.keyId === a.keyId && k.algorithm === 'Ed25519' &&
    ['active', 'retired'].includes(k.status ?? '') &&
    [k.validFrom, k.validUntil].every(v => v == null || (Number.isSafeInteger(v) && v > 0)) &&
    (k.validFrom == null || k.validUntil == null || k.validFrom <= k.validUntil) &&
    (k.validFrom == null || a.acceptedAt >= k.validFrom) && (k.validUntil == null || a.acceptedAt <= k.validUntil);
}

async function checkAuthorization(p: ExactCallInput, record: AuthorizationRecord, now: number, verifyContractSignature?: ContractSignatureVerifier) {
  need(Number.isSafeInteger(now) && now > 0, 'EXECUTION_CLOCK_INVALID');
  const { authorization: a, acceptance } = record;
  const verified = await verifyAuthorization(a, { now, audience: p.audience, verifyContractSignature });
  need(verified.valid, verified.code ?? 'AUTHORIZATION_INVALID');
  need(a.schema === 'priorseal.authorization.v2' && a.delegate.executor === p.transaction.from && now < a.expiresAt, 'EXECUTION_AUTHORIZATION_SCOPE_OR_TIME');
  const { intentHash, ...requestedIntent } = p.intent;
  need((intentHash == null || intentHash === a.intentHash) && hashJson(a.intent) === hashJson(buildIntent(requestedIntent)) && a.authorizationId === p.authorizationId, 'EXECUTION_AUTHORIZATION_INTENT_MISMATCH');
  need(keyAdmits(p.acceptanceKey, acceptance) && verifyAuthorizationReceipt(acceptance, p.acceptanceKey.publicKey), 'EXECUTION_ACCEPTANCE_UNTRUSTED');
  need(acceptance.authorizationId === a.authorizationId && acceptance.authorizationHash === hashJson(a) && acceptance.intentHash === a.intentHash && acceptance.acceptedAt >= a.notBefore && acceptance.acceptedAt < a.expiresAt && acceptance.acceptedAt <= now && (p.authorityTime == null || acceptance.acceptedAt === p.authorityTime), 'EXECUTION_ACCEPTANCE_MISMATCH');
  const policy = record.policyEvidence?.document ?? null;
  need(a.policyHash === (policy ? '0x' + hashJson(policy) : '0x' + '0'.repeat(64)), 'EXECUTION_AUTHORIZATION_POLICY_MISMATCH');
  need(!policy?.timestampPolicy && !policy?.witnessQuorum, 'EXECUTION_EXTERNAL_POLICY_VERIFIER_REQUIRED');
  if (policy) need(evaluateAuthorizationPolicy(a, policy, now).allowed, 'EXECUTION_AUTHORIZATION_POLICY_REJECTED');
}

/** One durable claim, one guarded broadcast, and no automatic retry after an
 * ambiguous response. All routes sharing an EOA must use the SAME attempt store.
 */
export async function executeAuthorizedExactCall(input: ExactCallInput, deps: ExactCallDependencies) {
  const p = structuredClone(input);
  const clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  need(typeof p.audience === 'string' && p.audience.length > 0, 'EXECUTION_AUDIENCE_REQUIRED');
  need(typeof p.executionDigest === 'string' && /^0x[0-9a-f]{64}$/.test(p.executionDigest), 'EXECUTION_DIGEST_INVALID');
  const record = structuredClone(await deps.authorizationStore.getAuthorization(p.authorizationId));
  need(record, 'AUTHORIZATION_NOT_FOUND');
  await checkAuthorization(p, record, clock(), deps.verifyContractSignature);
  const existing = await deps.attempts.get(p.authorizationId);
  if (existing) {
    checkReplayAttempt(existing, p.transaction, p.executionDigest, deps.replayErrorPrefix ?? 'EXECUTION');
    return { replay: true, attempt: existing };
  }
  await deps.checkProfile(p.transaction, clock());
  need(!record.boundTxHash && record.uses === 0 && record.status === 'ACCEPTED', 'AUTHORIZATION_ALREADY_USED');
  const claim = await deps.attempts.reserve({ authorizationId: p.authorizationId, transaction: p.transaction, executionDigest: p.executionDigest, now: clock() });
  if (!claim.claimed) {
    need(!claim.code, claim.code ?? 'EXECUTION_CLAIM_FAILED');
    checkReplayAttempt(claim.attempt, p.transaction, p.executionDigest, deps.replayErrorPrefix ?? 'EXECUTION');
    return { replay: true, attempt: claim.attempt };
  }
  let started = false;
  try {
    const fresh = structuredClone(await deps.authorizationStore.getAuthorization(p.authorizationId));
    need(fresh, 'AUTHORIZATION_NOT_FOUND');
    await checkAuthorization(p, fresh, clock(), deps.verifyContractSignature);
    need(!fresh.boundTxHash && fresh.uses === 0 && fresh.status === 'ACCEPTED', 'AUTHORIZATION_ALREADY_USED');
    await deps.checkProfile(p.transaction, clock());
    await deps.attempts.transition(p.authorizationId, ['RESERVED'], { status: 'SUBMITTING', updatedAt: clock() });
    started = true;
    const assertBeforeBroadcast = async () => {
      const current = structuredClone(await deps.authorizationStore.getAuthorization(p.authorizationId));
      need(current, 'AUTHORIZATION_NOT_FOUND');
      await checkAuthorization(p, current, clock(), deps.verifyContractSignature);
      need(!current.boundTxHash && current.uses === 0 && current.status === 'ACCEPTED', 'AUTHORIZATION_ALREADY_USED');
      await deps.checkProfile(p.transaction, clock());
    };
    const txHash = await deps.submit(p.transaction, assertBeforeBroadcast);
    need(typeof txHash === 'string' && /^0x[0-9a-f]{64}$/.test(txHash), 'EXECUTION_SUBMISSION_RESPONSE_INVALID');
    const attempt = await deps.attempts.transition(p.authorizationId, ['SUBMITTING'], { status: 'SUBMITTED', txHash, updatedAt: clock() });
    const bound = await deps.authorizationStore.bindAuthorization(p.authorizationId, txHash);
    need(bound.ok, bound.code ?? 'EXECUTION_BIND_FAILED');
    return { replay: false, attempt };
  } catch (error) {
    try { await deps.attempts.transition(p.authorizationId, [started ? 'SUBMITTING' : 'RESERVED'], { status: started ? 'UNCERTAIN' : 'REJECTED', updatedAt: clock() }); } catch { /* retain fail-closed journal state */ }
    throw error;
  }
}

/** Trusted observer recovery only. An uncertain nonce is never released. */
export async function reconcileAuthorizedExactCall(authorizationId: string, { attempts, authorizationStore, observe, clock = () => Math.floor(Date.now() / 1000) }: { attempts: RwaAttemptStore; authorizationStore: AuthorizationStore; observe: (attempt: RwaAttempt) => Promise<RecoveryObservation | null>; clock?: () => number }) {
  const a = await attempts.get(authorizationId);
  need(a, 'EXECUTION_ATTEMPT_MISSING');
  if (['CONFIRMED', 'REVERTED'].includes(a.status)) {
    need(a.txHash, 'EXECUTION_TX_HASH_REQUIRED');
    const bound = await authorizationStore.bindAuthorization(authorizationId, a.txHash);
    need(bound.ok, bound.code ?? 'EXECUTION_BIND_FAILED');
    return a;
  }
  if (['REJECTED', 'RESERVED'].includes(a.status)) return a;
  const observed = structuredClone(await observe(structuredClone(a)));
  if (!observed) return a;
  need(hashJson(observed.transaction) === hashJson(a.transaction) && /^0x[0-9a-f]{64}$/.test(observed.txHash) && ['CONFIRMED', 'REVERTED'].includes(observed.status) && observed.finalized === true && (!a.txHash || a.txHash === observed.txHash), 'EXECUTION_RECONCILIATION_MISMATCH');
  const result = await attempts.transition(authorizationId, ['SUBMITTING', 'SUBMITTED', 'UNCERTAIN'], { status: observed.status, txHash: observed.txHash, updatedAt: clock() });
  const bound = await authorizationStore.bindAuthorization(authorizationId, observed.txHash);
  need(bound.ok, bound.code ?? 'EXECUTION_BIND_FAILED');
  return result;
}
