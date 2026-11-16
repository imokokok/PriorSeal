import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRetailReadiness } from '../../scripts/agent-retail-readiness.mjs';

const origin = 'https://priorseal.example';
const version = 'a'.repeat(40);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function capabilities(publicPaidCommerce = false) {
  return {
    schema: 'priorseal.capabilities.v1', workflowReady: true,
    dependencies: { issuer: 'configured', storage: 'available' },
    payments: {
      publicPaidCommerce: { enabled: publicPaidCommerce, mode: publicPaidCommerce ? 'PUBLIC_PAID' : 'PILOT_OPERATOR_MANAGED' },
      agentCredits: { configured: true }, selfserveClaim: { configured: publicPaidCommerce },
      x402: publicPaidCommerce ? { configured: true, routes: [{ method: 'GET', path: '/v1/receipts/:receiptId/bundle' }] } : { configured: false, routes: [] },
    },
  };
}

function discovery() {
  return {
    schema: 'priorseal.agent-integration.v1', service: 'PriorSeal', version,
    discovery: { openapi: '/openapi/v1.json', mcp: '/mcp' },
    safety: { executionMode: 'PROPOSAL_AND_PRINCIPAL_CONFIRMATION', principalSignature: 'REQUIRED_FOR_EVERY_EXACT_ACTION', transactionSigningKey: 'NEVER_REQUESTED_BY_PRIORSEAL' },
  };
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: { version: '2.0.0' },
    paths: { '/v1/receipts/{receiptId}/bundle': { get: { summary: 'bundle' } } },
  };
}

function mcpJson(body: Record<string, unknown>, protocolVersion?: string) {
  return json(body, 200, protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {});
}

function mcpTools() {
  const names = [
    'priorseal_get_capabilities', 'priorseal_prepare_authorization', 'priorseal_prepare_controlled_execution', 'priorseal_accept_authorization', 'priorseal_get_authorization',
    'priorseal_observe_execution', 'priorseal_get_observation_job', 'priorseal_get_receipt', 'priorseal_get_evidence_bundle', 'priorseal_get_evidence', 'priorseal_get_fresh_evidence_check', 'priorseal_verify_receipt',
  ];
  return names.map((name) => ({
    name,
    annotations: name === 'priorseal_get_receipt'
      ? { readOnlyHint: true, idempotentHint: true }
      : name === 'priorseal_accept_authorization'
        ? { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
        : {},
  }));
}

async function mcpResponse(request: Request) {
  const body = (await request.json()) as { method: string };
  if (body.method === 'server/discover') {
    return mcpJson({ jsonrpc: '2.0', id: 'discover', result: { resultType: 'complete', supportedVersions: ['2026-07-28'] } }, '2026-07-28');
  }
  if (body.method === 'tools/list') return mcpJson({ jsonrpc: '2.0', id: 'tools', result: { tools: mcpTools() } }, '2026-07-28');
  if (body.method === 'tools/call') return mcpJson({ jsonrpc: '2.0', id: 'capabilities', result: { structuredContent: { schema: 'priorseal.mcp.tool-result.v1', status: 'capabilities_loaded', mayBroadcastTransaction: false } } }, '2026-07-28');
  if (body.method === 'initialize') return mcpJson({ jsonrpc: '2.0', id: 'legacy-initialize', result: { protocolVersion: '2025-11-25' } }, '2025-11-25');
  throw new Error(`Unexpected MCP method ${body.method}`);
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
      if (url.pathname === '/openapi/v1.json') return json(openApi());
      if (url.pathname === '/mcp') return mcpResponse(request);
      throw new Error(`Unexpected request ${request.url}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.getRequests, 6);
  assert.equal(result.mcpRequests, 4);
  assert.equal(result.writesPerformed, 0);
  assert.ok(requests.every((request) => !request.headers.has('payment-signature')));
  assert.ok(requests.filter((request) => new URL(request.url).pathname !== '/mcp').every((request) => request.method === 'GET'));
  assert.ok(requests.filter((request) => new URL(request.url).pathname === '/mcp').every((request) => request.method === 'POST'));
});

test('public Agent-and-retail readiness accepts the enabled self-service payment surface without spending or signing', async () => {
  const result = await runAgentRetailReadiness({
    env: { ...process.env, PRIORSEAL_BASE_URL: origin, PRIORSEAL_EXPECT_PUBLIC_PAID_COMMERCE: 'true' },
    log: () => {},
    fetcher: async (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname === '/health/live') return json({ status: 'ok' });
      if (url.pathname === '/health/ready') return json({ status: 'ready', storage: 'd1' });
      if (url.pathname === '/v1/version') return json({ service: 'priorseal', version });
      if (url.pathname === '/v1/capabilities') return json(capabilities(true));
      if (url.pathname === '/.well-known/priorseal-agent.json') return json(discovery());
      if (url.pathname === '/openapi/v1.json') return json(openApi());
      if (url.pathname === '/.well-known/x402.json') return json({ x402Version: 2, resources: [{ resource: `${origin}/v1/receipts/receipt-1/bundle`, method: 'GET', accepts: [{ network: 'eip155:8453' }] }] });
      if (url.pathname === '/mcp') return mcpResponse(new Request(url, init));
      throw new Error(`Unexpected request ${url}`);
    },
  });
  assert.equal(result.selfserveClaim, 'PUBLIC_SELF_SERVE_ENABLED');
  assert.equal(result.x402, 'PUBLIC_ENABLED');
  assert.equal(result.getRequests, 7);
  assert.equal(result.mcpRequests, 4);
  assert.deepEqual(result.x402Manifest, { resources: 1, baseResources: 1, paths: ['/v1/receipts/{receiptId}/bundle'] });
  assert.equal(result.writesPerformed, 0);
});
