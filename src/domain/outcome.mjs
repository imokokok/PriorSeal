import { bindIntentExecution } from './binding.mjs';
export const OUTCOMES = ['PENDING', 'COMPLETED', 'FAILED', 'UNDETERMINED', 'EXPIRED', 'REORGED'];
export function classifyOutcome(intent, execution) {
  if (execution.status === 'REORGED' || execution.finalityState === 'REORGED') return 'REORGED';
  if (execution.status === 'PENDING') return 'PENDING';
  if (execution.status === 'REVERTED') return 'FAILED';
  if (['NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(execution.status)) return 'UNDETERMINED';
  if (execution.status !== 'CONFIRMED') return 'UNDETERMINED';
  if ((execution.executedAt ?? execution.observedAt) > intent.validUntil) return 'EXPIRED';
  if (!bindIntentExecution(intent, execution).bound) return 'UNDETERMINED';
  return 'COMPLETED';
}
