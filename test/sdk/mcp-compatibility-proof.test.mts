import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpCompatibilityProof } from '../../scripts/mcp-compatibility-proof.mjs';

const toolNames = [
  'priorseal_get_capabilities', 'priorseal_prepare_authorization', 'priorseal_prepare_controlled_execution', 'priorseal_accept_authorization', 'priorseal_get_authorization',
  'priorseal_observe_execution', 'priorseal_get_observation_job', 'priorseal_get_receipt', 'priorseal_get_evidence_bundle', 'priorseal_get_evidence', 'priorseal_verify_receipt',
];

test('MCP compatibility proof checks both protocol forms without a business write', async () => {
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ method: String(init?.method), body });
    const response = body.method === 'server/discover'
      ? { result: { resultType: 'complete', supportedVersions: ['2026-07-28'] } }
      : body.method === 'tools/list'
        ? { result: { tools: toolNames.map((name) => ({ name, annotations: name === 'priorseal_get_receipt' ? { readOnlyHint: true, idempotentHint: true } : name === 'priorseal_accept_authorization' ? { readOnlyHint: false, destructiveHint: false, openWorldHint: true } : {} })) } }
        : body.method === 'initialize'
          ? { result: { protocolVersion: '2025-11-25' } }
          : { result: { structuredContent: { schema: 'priorseal.mcp.tool-result.v1', status: 'capabilities_loaded', mayBroadcastTransaction: false } } };
    const protocolVersion = body.method === 'initialize' ? '2025-11-25' : '2026-07-28';
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...response }), { status: 200, headers: { 'mcp-protocol-version': protocolVersion } });
  };

  const result = await runMcpCompatibilityProof({ env: { ...process.env, PRIORSEAL_BASE_URL: 'https://proof.example' }, fetcher, log: () => {} });
  assert.deepEqual(requests.map((request) => request.method), ['POST', 'POST', 'POST', 'POST']);
  assert.deepEqual(requests.map((request) => request.body.method), ['server/discover', 'tools/list', 'tools/call', 'initialize']);
  assert.equal(result.requestCount, 4);
  assert.equal(result.businessWritesPerformed, 0);
  assert.equal(result.broadcastTransactions, 0);
});
