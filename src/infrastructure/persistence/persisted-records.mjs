// Generated from persisted-records.mts by npm run core:build. Do not edit directly.
import { assertSafeJson } from "../../shared/safe-json.mjs";
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid persisted ${label}`);
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || !value) throw new TypeError(`Invalid persisted ${label}`);
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid persisted ${label}`);
}
function persistedJson(value, label) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new TypeError(`Invalid persisted ${label} JSON`);
  }
  return assertSafeJson(parsed, { maxDepth: 64 });
}
function persistedIntent(value) {
  const item = record(persistedJson(value, "intent"), "intent");
  for (const field of ["intentId", "intentHash", "schema", "action", "sender", "recipient", "asset", "amount", "nonce"]) string(item[field], `intent.${field}`);
  if (typeof item.chainId !== "number" && typeof item.chainId !== "string" || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1) throw new TypeError("Invalid persisted intent.chainId");
  integer(item.validUntil, "intent.validUntil");
  return item;
}
function persistedObservation(value) {
  const item = record(persistedWorkerObservation(value), "observation");
  if (typeof item.chainId !== "number" && typeof item.chainId !== "string" || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1) throw new TypeError("Invalid persisted observation.chainId");
  return item;
}
function persistedWorkerObservation(value) {
  const item = record(persistedJson(value, "observation"), "observation");
  string(item.txHash, "observation.txHash");
  string(item.status, "observation.status");
  return item;
}
function persistedAuthorization(value) {
  const item = record(persistedJson(value, "authorization"), "authorization");
  for (const field of ["authorizationId", "intentHash", "authorizationNonce"]) string(item[field], `authorization.${field}`);
  persistedIntent(item.intent);
  const principal = record(item.principal, "authorization.principal");
  string(principal.id, "authorization.principal.id");
  string(principal.account, "authorization.principal.account");
  const authorizer = record(item.authorizer, "authorization.authorizer");
  string(authorizer.type, "authorization.authorizer.type");
  string(authorizer.address, "authorization.authorizer.address");
  const delegate = record(item.delegate, "authorization.delegate");
  string(delegate.executor, "authorization.delegate.executor");
  integer(item.expiresAt, "authorization.expiresAt");
  if (!Number.isSafeInteger(Number(item.maxUses)) || Number(item.maxUses) < 1) throw new TypeError("Invalid persisted authorization.maxUses");
  return item;
}
function persistedAcceptance(value) {
  const item = record(persistedJson(value, "acceptance"), "acceptance");
  integer(item.sequence, "acceptance.sequence");
  string(item.entryHash, "acceptance.entryHash");
  return item;
}
function persistedReceipt(value) {
  const item = record(persistedJson(value, "receipt"), "receipt");
  for (const field of ["receiptId", "intentHash", "schema", "issuer", "keyId", "outcome"]) string(item[field], `receipt.${field}`);
  const execution = record(item.execution, "receipt.execution");
  string(execution.txHash, "receipt.execution.txHash");
  return item;
}
function persistedArchiveEntry(value) {
  const item = record(persistedJson(value, "archive entry"), "archive entry");
  for (const field of ["id", "projectId", "environment", "kind", "artifactHash", "status"]) string(item[field], `archive entry.${field}`);
  integer(item.createdAt, "archive entry.createdAt");
  return item;
}
function persistedJobInput(value) {
  const item = record(persistedJson(value, "job input"), "job input");
  if (item.chainId !== void 0 && (typeof item.chainId !== "number" && typeof item.chainId !== "string" || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1)) throw new TypeError("Invalid persisted job input.chainId");
  string(item.txHash, "job input.txHash");
  return item;
}
function persistedJobResult(value) {
  if (value == null) return null;
  const item = record(persistedJson(value, "job result"), "job result");
  persistedWorkerObservation(item.observation);
  return item;
}
function persistedJobError(value) {
  if (value == null) return null;
  const item = record(persistedJson(value, "job error"), "job error");
  string(item.code, "job error.code");
  string(item.message, "job error.message");
  return item;
}
function persistedPolicy(value) {
  if (value == null) return null;
  const item = record(persistedJson(value, "authorization policy"), "authorization policy");
  if (item.schema === "priorseal.policy-evidence.v1") {
    string(item.policyHash, "authorization policy.policyHash");
    record(item.result, "authorization policy.result");
  }
  return item;
}
function persistedStatus(value, label) {
  string(value, label);
  return value;
}
function persistedCount(value, label) {
  const number = Number(value);
  integer(number, label);
  return number;
}
function persistedTimestamp(value, label) {
  const milliseconds = value instanceof Date || typeof value === "string" ? new Date(value).getTime() : Number(value);
  integer(milliseconds, label);
  return milliseconds;
}
export {
  persistedAcceptance,
  persistedArchiveEntry,
  persistedAuthorization,
  persistedCount,
  persistedIntent,
  persistedJobError,
  persistedJobInput,
  persistedJobResult,
  persistedJson,
  persistedObservation,
  persistedPolicy,
  persistedReceipt,
  persistedStatus,
  persistedTimestamp,
  persistedWorkerObservation
};
