// Generated from summarize-health-diagnostic.mts by npm run core:build:operations. Do not edit directly.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function safeText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\r\n]/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 120) : fallback;
}
function path(value) {
  const candidate = safeText(value, "unknown-path");
  return candidate.startsWith("/") ? candidate : "unknown-path";
}
function status(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
function duration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
function summarizeHealthDiagnostic(value) {
  const diagnostic = record(value);
  if (!diagnostic || !Array.isArray(diagnostic.checks)) return [{ path: "diagnostic", status: null, durationMs: null, error: "DIAGNOSTIC_UNAVAILABLE" }];
  const failures = diagnostic.checks.flatMap((candidate) => {
    const check = record(candidate);
    if (!check || check.ok === true) return [];
    return [{
      path: path(check.path),
      status: status(check.status),
      durationMs: duration(check.durationMs),
      error: safeText(check.error, "UNHEALTHY_RESPONSE")
    }];
  });
  return failures.length > 0 ? failures : [{ path: "diagnostic", status: null, durationMs: null, error: "NO_FAILED_CHECK_REPORTED" }];
}
function formatHealthFailureSummary(label, value) {
  const failures = summarizeHealthDiagnostic(value);
  const summary = failures.map((failure) => [
    failure.path,
    failure.status === null ? "status=unavailable" : `status=${failure.status}`,
    failure.durationMs === null ? "duration=unavailable" : `duration=${failure.durationMs}ms`,
    `reason=${failure.error ?? "UNHEALTHY_RESPONSE"}`
  ].join(" ")).join("; ");
  return `::error title=${safeText(label, "public-service-health")}::${summary}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, label = "public-service-health"] = process.argv.slice(2);
  if (!filePath) {
    console.log(formatHealthFailureSummary(label, null));
    process.exitCode = 1;
  } else {
    try {
      console.log(formatHealthFailureSummary(label, JSON.parse(readFileSync(filePath, "utf8"))));
    } catch {
      console.log(formatHealthFailureSummary(label, null));
      process.exitCode = 1;
    }
  }
}
export {
  formatHealthFailureSummary,
  summarizeHealthDiagnostic
};
