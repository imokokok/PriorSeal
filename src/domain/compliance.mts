import type { BindingExecution, BindingResult } from './binding.mjs';

export const COMPLIANCE_STATUSES = Object.freeze(['COMPLIANT', 'NON_COMPLIANT', 'NOT_ASSESSABLE'] as const);
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

const FINAL_EXECUTION_STATUSES = new Set(['CONFIRMED', 'REVERTED']);

type ComplianceAuthorization = {
  intent: { chainId: number | string; nonce?: string | null };
  delegate: { executor: string };
};

/**
 * Separates evidence availability from authorization conformance.
 *
 * A transaction is assessable only after it is included on-chain and can be
 * correlated to the delegated executor and signed transaction nonce. This
 * prevents an arbitrary transaction hash from becoming evidence of breach.
 */
export function assessCompliance({ authorization, execution, binding }: { authorization: ComplianceAuthorization; execution: BindingExecution; binding: BindingResult }) {
  const unavailableReason = assessmentUnavailableReason(execution);
  if (unavailableReason) return assessment('NOT_ASSESSABLE', [unavailableReason]);

  const unavailableBindingReasons = binding.reasonCodes.filter((code) => ['EXECUTION_UNAVAILABLE', 'INSUFFICIENT_FINALITY'].includes(code));
  if (unavailableBindingReasons.length) return assessment('NOT_ASSESSABLE', unavailableBindingReasons);

  const correlationReasons: string[] = [];
  if (Number(execution.chainId) !== Number(authorization.intent.chainId)) correlationReasons.push('CHAIN_MISMATCH');
  if (String(execution.sender ?? '').toLowerCase() !== authorization.delegate.executor) correlationReasons.push('EXECUTOR_MISMATCH');
  if (String(execution.nonce ?? '') !== String(authorization.intent.nonce)) correlationReasons.push('NONCE_MISMATCH');
  if (correlationReasons.length) return assessment('NOT_ASSESSABLE', correlationReasons);

  return binding.bound
    ? assessment('COMPLIANT', [])
    : assessment('NON_COMPLIANT', binding.reasonCodes);
}

/** Outcome describes what happened on-chain; compliance describes whether it
 * matched the authorization. Receipt v3 deliberately keeps these independent.
 */
export function classifyExecutionOutcome(execution: BindingExecution | null | undefined) {
  if (execution?.status === 'REORGED' || execution?.finalityState === 'REORGED') return 'REORGED';
  if (execution?.finalityState === 'INSUFFICIENT_FINALITY') return 'PENDING';
  if (execution?.status === 'PENDING') return 'PENDING';
  if (execution?.status === 'REVERTED') return 'FAILED';
  if (execution?.status === 'CONFIRMED') return 'COMPLETED';
  return 'UNDETERMINED';
}

function assessmentUnavailableReason(execution: BindingExecution | null | undefined): string | null {
  if (!execution || execution.executionDataAvailable === false) return 'EXECUTION_UNAVAILABLE';
  if (execution.status === 'REORGED' || execution.finalityState === 'REORGED') return 'EXECUTION_REORGED';
  if (execution.finalityState === 'INSUFFICIENT_FINALITY') return 'EXECUTION_PENDING';
  if (execution.status === 'PENDING') return 'EXECUTION_PENDING';
  if (execution.status === 'NOT_FOUND') return 'EXECUTION_NOT_FOUND';
  if (['RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(execution.status as string)) return 'EXECUTION_UNAVAILABLE';
  if (!FINAL_EXECUTION_STATUSES.has(execution.status as string)) return 'EXECUTION_UNAVAILABLE';
  return null;
}

function assessment(status: ComplianceStatus, reasonCodes: readonly string[]) {
  return { schema: 'priorseal.compliance-assessment.v1', status, reasonCodes: [...reasonCodes] };
}
