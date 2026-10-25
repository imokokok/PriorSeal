/**
 * Emits a concise, safe GitHub Actions error for a failed public-health
 * diagnostic. The complete diagnostic stays in the workflow artifact; this
 * reporter never prints response bodies, credentials, or capability details.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, unknown>;
type HealthCheckSummary = { path: string; status: number | null; durationMs: number | null; error: string | null };

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function safeText(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\r\n]/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 120) : fallback;
}

function path(value: unknown) {
  const candidate = safeText(value, 'unknown-path');
  return candidate.startsWith('/') ? candidate : 'unknown-path';
}

function status(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function duration(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Returns only fields suitable for a public Actions summary. */
export function summarizeHealthDiagnostic(value: unknown): HealthCheckSummary[] {
  const diagnostic = record(value);
  if (!diagnostic || !Array.isArray(diagnostic.checks)) return [{ path: 'diagnostic', status: null, durationMs: null, error: 'DIAGNOSTIC_UNAVAILABLE' }];

  const failures = diagnostic.checks.flatMap((candidate) => {
    const check = record(candidate);
    if (!check || check.ok === true) return [];
    return [{
      path: path(check.path),
      status: status(check.status),
      durationMs: duration(check.durationMs),
      error: safeText(check.error, 'UNHEALTHY_RESPONSE'),
    }];
  });

  return failures.length > 0 ? failures : [{ path: 'diagnostic', status: null, durationMs: null, error: 'NO_FAILED_CHECK_REPORTED' }];
}

export function formatHealthFailureSummary(label: string, value: unknown) {
  const failures = summarizeHealthDiagnostic(value);
  const summary = failures.map((failure) => [
    failure.path,
    failure.status === null ? 'status=unavailable' : `status=${failure.status}`,
    failure.durationMs === null ? 'duration=unavailable' : `duration=${failure.durationMs}ms`,
    `reason=${failure.error ?? 'UNHEALTHY_RESPONSE'}`,
  ].join(' ')).join('; ');
  return `::error title=${safeText(label, 'public-service-health')}::${summary}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, label = 'public-service-health'] = process.argv.slice(2);
  if (!filePath) {
    console.log(formatHealthFailureSummary(label, null));
    process.exitCode = 1;
  } else {
    try {
      console.log(formatHealthFailureSummary(label, JSON.parse(readFileSync(filePath, 'utf8')) as unknown));
    } catch {
      console.log(formatHealthFailureSummary(label, null));
      process.exitCode = 1;
    }
  }
}
