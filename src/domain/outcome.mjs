// Generated from outcome.mts by npm run core:build. Do not edit directly.
import { bindIntentExecution } from "./binding.mjs";
const OUTCOMES = ["PENDING", "COMPLETED", "FAILED", "UNDETERMINED", "EXPIRED", "REORGED"];
function classifyOutcome(intent, execution) {
  if (execution.status === "REORGED" || execution.finalityState === "REORGED") return "REORGED";
  if (execution.finalityState === "INSUFFICIENT_FINALITY") return "PENDING";
  if (execution.status === "PENDING") return "PENDING";
  if (execution.status === "REVERTED") return "FAILED";
  if (["NOT_FOUND", "RPC_ERROR", "UNSUPPORTED_CHAIN"].includes(execution.status ?? "")) return "UNDETERMINED";
  if (execution.status !== "CONFIRMED") return "UNDETERMINED";
  const executedAt = execution.executedAt ?? execution.observedAt;
  if (executedAt != null && executedAt > intent.validUntil) return "EXPIRED";
  if (!bindIntentExecution(intent, execution).bound) return "UNDETERMINED";
  return "COMPLETED";
}
export {
  OUTCOMES,
  classifyOutcome
};
