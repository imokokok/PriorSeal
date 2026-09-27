/**
 * Compatibility entry point for the independently published offline verifier.
 * Keep this module path for existing consumers while sharing upstream semantics.
 * Protocol admission remains a separate check in insight-protocol-trust.ts.
 */
export {
  EXECUTION_DOMAIN,
  EXECUTION_PRIMARY_TYPE,
  EXECUTION_PROFILE_V1_ID,
  EXECUTION_TYPES_V1,
  EXECUTION_TYPES_V2,
  EXECUTION_TYPES_V3,
  EXECUTION_TYPES_V4,
  EXECUTION_TYPES_V5,
  executionTypesForSchemaVersion,
  verifyExecutionReceipt,
  verifyExecutionPair,
  type ExecutionReceipt,
  type ExecutionVerificationResult,
  type ExecutionPairResult,
} from 'verify-insight-receipt';
