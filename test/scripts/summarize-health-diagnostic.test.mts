import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHealthFailureSummary, summarizeHealthDiagnostic } from '../../scripts/summarize-health-diagnostic.mjs';

test('health diagnostic summaries expose only failed endpoint metadata', () => {
  const failures = summarizeHealthDiagnostic({
    checks: [
      { path: '/health/live', status: 200, durationMs: 12, ok: true, capabilities: { private: 'do-not-print' } },
      { path: '/api/v1/health/ready', status: 503, durationMs: 41.2, ok: false, error: 'UPSTREAM_UNAVAILABLE' },
      { path: '/v1/capabilities', status: null, durationMs: 30_004, ok: false, capabilities: { secret: 'do-not-print' } },
    ],
  });

  assert.deepEqual(failures, [
    { path: '/api/v1/health/ready', status: 503, durationMs: 41, error: 'UPSTREAM_UNAVAILABLE' },
    { path: '/v1/capabilities', status: null, durationMs: 30004, error: 'UNHEALTHY_RESPONSE' },
  ]);
  const summary = formatHealthFailureSummary('portfolio-readiness', { checks: [
    { path: '/api/v1/health/ready', status: 503, durationMs: 41.2, ok: false, error: 'UPSTREAM_UNAVAILABLE' },
  ] });
  assert.match(summary, /^::error title=portfolio-readiness::\/api\/v1\/health\/ready status=503 duration=41ms reason=UPSTREAM_UNAVAILABLE$/);
  assert.doesNotMatch(summary, /private|secret/);
});

test('missing and malformed diagnostic payloads are reported safely', () => {
  assert.deepEqual(summarizeHealthDiagnostic(null), [
    { path: 'diagnostic', status: null, durationMs: null, error: 'DIAGNOSTIC_UNAVAILABLE' },
  ]);
  assert.match(formatHealthFailureSummary('bad\nlabel', { checks: [] }), /^::error title=bad label::diagnostic status=unavailable duration=unavailable reason=NO_FAILED_CHECK_REPORTED$/);
});
