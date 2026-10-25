import assert from 'node:assert/strict';
import test from 'node:test';

import { auditViolations, parseAuditReport } from '../scripts/audit-gate.mjs';

test('audit gate fails closed when npm reports a registry or transport error', () => {
  assert.throws(
    () => parseAuditReport(JSON.stringify({ error: { code: 'ENETUNREACH', summary: 'offline' } })),
    /npm audit could not complete \(ENETUNREACH: offline\)/
  );
});

test('audit gate permits only the explicit production advisory allowlist', () => {
  const allowlisted = parseAuditReport(
    JSON.stringify({
      vulnerabilities: {
        zod: {
          severity: 'high',
          via: [{ url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5' }],
        },
      },
    })
  );
  assert.deepEqual(auditViolations(allowlisted), []);

  const blocked = parseAuditReport(
    JSON.stringify({
      vulnerabilities: {
        unsafe: {
          severity: 'critical',
          via: [{ url: 'https://github.com/advisories/GHSA-example' }],
        },
      },
    })
  );
  assert.deepEqual(auditViolations(blocked), ['unsafe (critical): GHSA-example']);
});
