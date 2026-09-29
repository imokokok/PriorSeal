import { assertOnlyFields } from '../shared/safe-json.mjs';

type TemporalExecution = {
  status?: string | null;
  finalityState?: string | null;
  blockNumber?: number | null;
  blockHash?: string | null;
  confirmations?: number | string | null;
  temporalEvidence?: unknown;
};
type TemporalIntent = { constraints?: { minConfirmations?: number | string | null; maxToleratedReorgDepth?: number | null; finalityRequirement?: string | null } | null };

const blockHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const height = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** Check replayable arithmetic and the signed intent's finality requirement.
 * The RPC's canonical/finalized assertions remain issuer observations, not
 * independent consensus proofs embedded in the receipt.
 */
export function validateTemporalEvidence(intent: TemporalIntent | null | undefined, execution: TemporalExecution | null | undefined): boolean {
  if (!execution) return false;
  const constraints = intent?.constraints;
  const criterion = constraints?.finalityRequirement ?? 'CONFIRMATIONS';
  const maxDepth = constraints?.maxToleratedReorgDepth ?? null;
  const evidence = execution.temporalEvidence;
  if (evidence == null) {
    return execution.finalityState !== 'FINALIZED' && (criterion !== 'RPC_FINALIZED' || !['CONFIRMED', 'REVERTED'].includes(execution.status ?? ''));
  }
  try {
    const item = assertOnlyFields(evidence, ['schema', 'criterion', 'requiredConfirmations', 'maxToleratedReorgDepth', 'observedHeadNumber', 'observedHeadHash', 'finalizedBlock'], 'temporal evidence');
    if (item.schema !== 'priorseal.temporal-evidence.v1' || item.criterion !== criterion || item.maxToleratedReorgDepth !== maxDepth) return false;
    if (!height(item.requiredConfirmations) || item.requiredConfirmations > 10_000 || !height(item.observedHeadNumber)) return false;
    if (criterion === 'RPC_FINALIZED' ? !blockHash(item.observedHeadHash) : item.observedHeadHash !== null) return false;
    if (item.requiredConfirmations < Math.max(Number(constraints?.minConfirmations ?? 0), maxDepth == null ? 0 : maxDepth + 1)) return false;
    if (!height(execution.blockNumber) || !blockHash(execution.blockHash) || !height(execution.confirmations) || execution.blockNumber > item.observedHeadNumber) return false;
    if (execution.confirmations !== item.observedHeadNumber - execution.blockNumber + 1) return false;
    if (item.finalizedBlock !== null) {
      const finalized = assertOnlyFields(item.finalizedBlock, ['number', 'hash'], 'finalized block');
      if (!height(finalized.number) || finalized.number > item.observedHeadNumber || !blockHash(finalized.hash)) return false;
      if (execution.status !== 'REORGED' && finalized.number === execution.blockNumber && finalized.hash !== execution.blockHash) return false;
      if (finalized.number === item.observedHeadNumber && finalized.hash !== item.observedHeadHash) return false;
    }
    const reachedDepth = execution.confirmations >= item.requiredConfirmations;
    const reachedFinalized = item.finalizedBlock !== null && (item.finalizedBlock as { number: number }).number >= execution.blockNumber;
    if (['CONFIRMED', 'REVERTED'].includes(execution.status ?? '')) {
      if (!reachedDepth) return false;
      if (criterion === 'RPC_FINALIZED') return execution.finalityState === 'FINALIZED' && reachedFinalized;
      return execution.finalityState === 'CONFIRMED';
    }
    if (execution.finalityState === 'FINALIZED' || execution.finalityState === 'CONFIRMED') return false;
    if (execution.status === 'PENDING' && execution.finalityState === 'INSUFFICIENT_FINALITY' && reachedDepth && (criterion === 'CONFIRMATIONS' || reachedFinalized)) return false;
    return true;
  } catch {
    return false;
  }
}
