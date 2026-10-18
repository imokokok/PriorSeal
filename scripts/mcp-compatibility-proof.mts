import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;
type ProofOptions = { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; log?: (message: string) => void };

const endpointPath = '/mcp';
const expectedTools = [
  'priorseal_get_capabilities', 'priorseal_prepare_authorization', 'priorseal_prepare_controlled_execution', 'priorseal_accept_authorization', 'priorseal_get_authorization',
  'priorseal_observe_execution', 'priorseal_get_observation_job', 'priorseal_get_receipt', 'priorseal_get_evidence_bundle', 'priorseal_verify_receipt',
];

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, label: string): JsonRecord { assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`); return value as JsonRecord; }
function array(value: unknown, label: string): unknown[] { assert(Array.isArray(value), `${label} must be an array`); return value; }
function string(value: unknown, label: string): string { assert(typeof value === 'string', `${label} must be a string`); return value; }

/**
 * Checks the public MCP transport contract with only protocol discovery,
 * initialization, list, and capabilities calls. These POST requests create no
 * PriorSeal authorization, observation, signature, or transaction.
 */
export async function runMcpCompatibilityProof({ env = process.env, fetcher = fetch, log = console.log }: ProofOptions = {}) {
  const baseUrl = new URL(env.PRIORSEAL_BASE_URL ?? 'https://priorseal.xyz');
  assert(!baseUrl.username && !baseUrl.password, 'PRIORSEAL_BASE_URL must not contain credentials');
  assert(baseUrl.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'Use HTTPS outside local development');
  const endpoint = new URL(endpointPath, baseUrl);
  let requestCount = 0;

  async function post(body: JsonRecord, headers: Record<string, string> = {}) {
    requestCount += 1;
    const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20_000) });
    assert(response.status === 200, `MCP ${String(body.method)} returned HTTP ${response.status}`);
    const parsed = record(await response.json(), `MCP ${String(body.method)} response`);
    assert(!('error' in parsed), `MCP ${String(body.method)} returned JSON-RPC error ${JSON.stringify(parsed.error)}`);
    return { headers: response.headers, body: parsed };
  }

  const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'priorseal-compatibility-proof', version: '1.0.0' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  const modernHeaders = { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28' };
  const discovery = await post({ jsonrpc: '2.0', id: 'discover', method: 'server/discover', params: { _meta: modernMeta } }, { ...modernHeaders, 'mcp-method': 'server/discover' });
  assert(discovery.headers.get('mcp-protocol-version') === '2026-07-28', 'Stateless discovery did not negotiate MCP 2026-07-28');
  const discoveryResult = record(discovery.body.result, 'Stateless discovery result');
  assert(discoveryResult.resultType === 'complete', 'Stateless discovery is not complete');
  assert(array(discoveryResult.supportedVersions, 'Stateless discovery supportedVersions').includes('2026-07-28'), 'Stateless discovery does not advertise MCP 2026-07-28');

  const listed = await post({ jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: { _meta: modernMeta } }, { ...modernHeaders, 'mcp-method': 'tools/list' });
  const tools = array(record(listed.body.result, 'MCP tools/list result').tools, 'MCP tools/list tools').map((tool) => record(tool, 'MCP tool'));
  assert(JSON.stringify(tools.map((tool) => tool.name)) === JSON.stringify(expectedTools), 'MCP tool list does not match the published PriorSeal tool surface');
  const byName = new Map(tools.map((tool) => [string(tool.name, 'MCP tool name'), tool]));
  const receiptAnnotations = record(byName.get('priorseal_get_receipt')?.annotations, 'Receipt annotations');
  assert(receiptAnnotations.readOnlyHint === true && receiptAnnotations.idempotentHint === true, 'Receipt tool is missing read-only/idempotent annotations');
  const acceptanceAnnotations = record(byName.get('priorseal_accept_authorization')?.annotations, 'Authorization acceptance annotations');
  assert(acceptanceAnnotations.readOnlyHint === false && acceptanceAnnotations.destructiveHint === false && acceptanceAnnotations.openWorldHint === true, 'Authorization acceptance annotations do not expose its service-state boundary');

  const capabilities = await post({ jsonrpc: '2.0', id: 'capabilities', method: 'tools/call', params: { name: 'priorseal_get_capabilities', arguments: {}, _meta: modernMeta } }, { ...modernHeaders, 'mcp-method': 'tools/call', 'mcp-name': 'priorseal_get_capabilities' });
  const capabilityResult = record(record(capabilities.body.result, 'MCP capabilities result').structuredContent, 'MCP structured capabilities result');
  assert(capabilityResult.schema === 'priorseal.mcp.tool-result.v1' && capabilityResult.status === 'capabilities_loaded' && capabilityResult.mayBroadcastTransaction === false, 'Capabilities call is missing the stable safe structured result envelope');

  const legacy = await post({ jsonrpc: '2.0', id: 'legacy-initialize', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'priorseal-compatibility-proof', version: '1.0.0' } } });
  assert(legacy.headers.get('mcp-protocol-version') === '2025-11-25', 'Legacy initialize did not negotiate MCP 2025-11-25');
  const legacyResult = record(legacy.body.result, 'Legacy initialize result');
  assert(legacyResult.protocolVersion === '2025-11-25', 'Legacy initialize did not return the requested compatible protocol version');

  const result = { ok: true, baseUrl: baseUrl.origin, endpoint: endpoint.href, statelessProtocol: '2026-07-28', legacyProtocol: '2025-11-25', toolCount: expectedTools.length, requestCount, businessWritesPerformed: 0, walletOrTransactionSignatures: 0, broadcastTransactions: 0 };
  log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMcpCompatibilityProof();
