import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRetailReadiness } from '../../scripts/agent-retail-readiness.mjs';

const origin = 'https://priorseal.example';
const version = 'a'.repeat(40);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function capabilities() {
  return {
    schema: 'priorseal.capabilities.v1', workflowReady: true,
    dependencies: { issuer: 'configured', storage: 'available' },
    payments: {
      publicPaidCommerce: { enabled: false, mode: 'PILOT_OPERATOR_MANAGED' },
      agentCredits: { configured: true }, selfserveClaim: { configured: false },
      x402: { configured: false, routes: [] },
    },
  };
}

function discovery() {
  return {
    schema: 'priorseal.agent-integration.v1', service: 'PriorSeal', version,
    safety: { executionMode: 'PROPOSAL_AND_PRINCIPAL_CONFIRMATION', principalSignature: 'REQUIRED_FOR_EVERY_EXACT_ACTION', transactionSigningKey: 'NEVER_REQUESTED_BY_PRIORSEAL' },
  };
}

test('public Agent-and-retail readiness checks only public GET surfaces while paid commerce is locked', async () => {
  const requests: Request[] = [];
  const result = await runAgentRetailReadiness({
    env: { ...process.env, PRIORSEAL_BASE_URL: origin },
    log: () => {},
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === '/health/live') return json({ status: 'ok' });
      if (url.pathname === '/health/ready') return json({ status: 'ready', storage: 'd1' });
      if (url.pathname === '/v1/version') return json({ service: 'priorseal', version });
      if (url.pathname === '/v1/capabilities') return json(capabilities());
      if (url.pathname === '/.well-known/priorseal-agent.json') return json(discovery());
      throw new Error(`Unexpected request ${request.url}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.getRequests, 5);
  assert.equal(result.writesPerformed, 0);
  assert.ok(requests.every((request) => request.method === 'GET' && !request.headers.has('payment-signature')));
});
