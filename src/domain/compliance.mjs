// Generated from compliance.mts by npm run core:build. Do not edit directly.
const COMPLIANCE_STATUSES = Object.freeze(["COMPLIANT", "NON_COMPLIANT", "NOT_ASSESSABLE"]);
const FINAL_EXECUTION_STATUSES = /* @__PURE__ */ new Set(["CONFIRMED", "REVERTED"]);
function assessCompliance({ authorization, execution, binding }) {
  const unavailableReason = assessmentUnavailableReason(execution);
  if (unavailableReason) return assessment("NOT_ASSESSABLE", [unavailableReason]);
  const unavailableBindingReasons = binding.reasonCodes.filter((code) => ["EXECUTION_UNAVAILABLE", "INSUFFICIENT_FINALITY"].includes(code));
  if (unavailableBindingReasons.length) return assessment("NOT_ASSESSABLE", unavailableBindingReasons);
  const correlationReasons = [];
  if (Number(execution.chainId) !== Number(authorization.intent.chainId)) correlationReasons.push("CHAIN_MISMATCH");
  if (String(execution.sender ?? "").toLowerCase() !== authorization.delegate.executor) correlationReasons.push("EXECUTOR_MISMATCH");
  if (String(execution.nonce ?? "") !== String(authorization.intent.nonce)) correlationReasons.push("NONCE_MISMATCH");
  if (correlationReasons.length) return assessment("NOT_ASSESSABLE", correlationReasons);
  return binding.bound ? assessment("COMPLIANT", []) : assessment("NON_COMPLIANT", binding.reasonCodes);
}
function classifyExecutionOutcome(execution) {
  if (execution?.status === "REORGED" || execution?.finalityState === "REORGED") return "REORGED";
  if (execution?.finalityState === "INSUFFICIENT_FINALITY") return "PENDING";
  if (execution?.status === "PENDING") return "PENDING";
  if (execution?.status === "REVERTED") return "FAILED";
  if (execution?.status === "CONFIRMED") return "COMPLETED";
  return "UNDETERMINED";
}
function assessmentUnavailableReason(execution) {
  if (!execution || execution.executionDataAvailable === false) return "EXECUTION_UNAVAILABLE";
  if (execution.status === "REORGED" || execution.finalityState === "REORGED") return "EXECUTION_REORGED";
  if (execution.finalityState === "INSUFFICIENT_FINALITY") return "EXECUTION_PENDING";
  if (execution.status === "PENDING") return "EXECUTION_PENDING";
  if (execution.status === "NOT_FOUND") return "EXECUTION_NOT_FOUND";
  if (["RPC_ERROR", "UNSUPPORTED_CHAIN"].includes(execution.status)) return "EXECUTION_UNAVAILABLE";
  if (!FINAL_EXECUTION_STATUSES.has(execution.status)) return "EXECUTION_UNAVAILABLE";
  return null;
}
function assessment(status, reasonCodes) {
  return { schema: "priorseal.compliance-assessment.v1", status, reasonCodes: [...reasonCodes] };
}
export {
  COMPLIANCE_STATUSES,
  assessCompliance,
  classifyExecutionOutcome
};
