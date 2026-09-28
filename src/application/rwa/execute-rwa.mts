import { executeAuthorizedExactCall, reconcileAuthorizedExactCall, type AuthorizationStore, type ContractSignatureVerifier, type RecoveryObservation } from '../execution/authorized-exact-call.mjs';
import type { RwaAttemptStore } from '../../infrastructure/persistence/rwa-attempt-model.mjs';
import type { RwaAttempt } from '../../infrastructure/persistence/rwa-attempt-store.mjs';
import type { withRwaExecutionPair } from '../../../sdk/dist/index.js';

type Pair = Parameters<typeof withRwaExecutionPair>[0];
type ExactTransaction = Parameters<typeof withRwaExecutionPair>[1];
type RwaInput = Pair & { audience: string; authorizationId: string; transaction: ExactTransaction; acceptanceKey: Parameters<typeof executeAuthorizedExactCall>[0]['acceptanceKey'] };

/** RWA profile on the shared durable exact-call engine. No RWA signer nonce can
 * be reused through a general DeFi entry when both share the same attempt store.
 */
export async function executeRwaAuthorized(input: RwaInput, { authorizationStore, attempts, submit, clock = () => Math.floor(Date.now() / 1000), verifyContractSignature }: { authorizationStore: AuthorizationStore; attempts: RwaAttemptStore; submit: (transaction: ExactTransaction, assertBeforeBroadcast: () => Promise<void>) => Promise<string>; clock?: () => number; verifyContractSignature?: ContractSignatureVerifier }) {
  const p = structuredClone(input);
  if (p.authority.proof.report.schema !== 'insight.rwa-report.v2' || p.execution.proof.report.schema !== 'insight.rwa-report.v2') throw new Error('RWA_V2_REQUIRED');
  const { withRwaExecutionPair } = await import('../../../sdk/dist/index.js');
  const pair = { intent: p.intent, authority: p.authority, execution: p.execution, authorityTime: p.authorityTime };
  return executeAuthorizedExactCall({
    audience: p.audience, authorizationId: p.authorizationId, intent: p.intent,
    transaction: p.transaction, acceptanceKey: p.acceptanceKey,
    executionDigest: p.execution.proof.digest, authorityTime: p.authorityTime,
  }, {
    authorizationStore, attempts, submit, clock, verifyContractSignature, replayErrorPrefix: 'RWA',
    checkProfile: async (transaction, now) => {
      await withRwaExecutionPair(pair, transaction, async () => undefined, () => now);
    },
  });
}

/** Trusted observer recovery only, using the shared exact-call journal. */
export async function reconcileRwaAttempt(authorizationId: string, deps: { attempts: RwaAttemptStore; authorizationStore: AuthorizationStore; observe: (attempt: RwaAttempt) => Promise<RecoveryObservation | null>; clock?: () => number }) {
  return reconcileAuthorizedExactCall(authorizationId, deps);
}
