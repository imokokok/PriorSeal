import { errorCode, errorMessage } from '../../shared/error-code.mjs';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_STATELESS_PROTOCOL_VERSION = '2026-07-28';

type JsonRecord = Record<string, unknown>;

export type PriorSealMcpToolCall = { name: string; arguments: JsonRecord };
export type PriorSealMcpResponse = { status: number; body: JsonRecord; headers?: Record<string, string> };

export type PriorSealMcpOptions = {
  version: string;
  execute: (call: PriorSealMcpToolCall) => Promise<unknown>;
  requestHeaders?: { protocolVersion?: string; method?: string; name?: string; accept?: string };
};

const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, '2025-06-18', '2025-03-26']);

const READ_ONLY_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const PREPARATION_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const STATE_CHANGE_ANNOTATIONS = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

const TOOLS = Object.freeze([
  tool('priorseal_get_capabilities', 'Read the live PriorSeal deployment capabilities before constructing a workflow.', { type: 'object', additionalProperties: false }, READ_ONLY_ANNOTATIONS),
  tool('priorseal_prepare_authorization', 'Canonicalize a bounded authorization and return the exact EIP-712 typed data or Solana message for a human-controlled principal to sign. This is read-only and never signs, submits, or executes a transaction.', inputSchema('The complete PriorSeal authorization preparation request.'), PREPARATION_ANNOTATIONS),
  tool('priorseal_accept_authorization', 'Verify and persist a principal-signed authorization. This can consume configured Agent credits and changes service state; send an idempotency key. It never signs, submits, or executes a transaction.', inputSchema('The complete signed PriorSeal authorization request.'), STATE_CHANGE_ANNOTATIONS),
  tool('priorseal_get_authorization', 'Read an accepted authorization by its identifier.', identifierSchema('authorizationId', 'PriorSeal authorization identifier.'), READ_ONLY_ANNOTATIONS),
  tool('priorseal_observe_execution', 'Persist an observation request for an already-submitted EVM or Solana transaction, then issue evidence when configured observation completes. This can consume configured Agent credits; send an idempotency key. It never broadcasts a transaction.', inputSchema('The complete PriorSeal execution-observation request.'), STATE_CHANGE_ANNOTATIONS),
  tool('priorseal_get_observation_job', 'Read the durable status of an automatic finality-observation job.', identifierSchema('jobId', 'PriorSeal observation job identifier.'), READ_ONLY_ANNOTATIONS),
  tool('priorseal_get_receipt', 'Read a signed execution receipt by its identifier.', identifierSchema('receiptId', 'PriorSeal receipt identifier.'), READ_ONLY_ANNOTATIONS),
  tool('priorseal_get_evidence_bundle', 'Export the portable receipt evidence bundle and issuer key-discovery metadata.', identifierSchema('receiptId', 'PriorSeal receipt identifier.'), READ_ONLY_ANNOTATIONS),
  tool('priorseal_verify_receipt', 'Convenience-verify a PriorSeal receipt with the deployment key registry. Independent local verification remains required for trust decisions.', {
    type: 'object', properties: { receipt: { type: 'object', description: 'Receipt object to verify.' } }, required: ['receipt'], additionalProperties: false,
  }, READ_ONLY_ANNOTATIONS),
]);

export async function handlePriorSealMcpRequest(body: unknown, { version, execute, requestHeaders = {} }: PriorSealMcpOptions): Promise<PriorSealMcpResponse> {
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return protocolError(null, -32600, 'Invalid JSON-RPC request');
  const id = validId(body.id) ? body.id : null;
  const params = body.params === undefined ? {} : body.params;
  if (!isRecord(params)) return protocolError(id, -32602, 'Invalid request parameters');
  const modern = isModernRequest(params, requestHeaders);
  if (modern && !validModernHeaders(body, requestHeaders)) return protocolError(id, -32600, 'MCP request headers do not match the JSON-RPC request', true);
  const headers = { 'mcp-protocol-version': modern ? MCP_STATELESS_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION };

  if (modern && body.method === 'server/discover') {
    return success(id, modernResult({
      supportedVersions: [MCP_STATELESS_PROTOCOL_VERSION],
      capabilities: { tools: { listChanged: false } },
      instructions: instructions(),
      ttlMs: 300_000,
      cacheScope: 'public',
    }, version), headers);
  }
  if (modern && body.method === 'initialize') return protocolError(id, -32601, 'Method not found', true);

  if (body.method === 'initialize') {
    const requested = params.protocolVersion;
    if (typeof requested !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.has(requested)) return protocolError(id, -32602, 'Unsupported MCP protocol version');
    return success(id, {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'priorseal', version },
      instructions: instructions(),
    }, headers);
  }
  if (body.method === 'notifications/initialized') return { status: 202, body: {}, headers };
  if (body.method === 'ping') return success(id, modern ? modernResult({}, version) : {}, headers);
  if (body.method === 'tools/list') return success(id, modern ? modernResult({ tools: TOOLS, ttlMs: 300_000, cacheScope: 'public' }, version) : { tools: TOOLS }, headers);
  if (body.method !== 'tools/call') return protocolError(id, -32601, 'Method not found', modern);

  const name = params.name;
  const argumentsValue = params.arguments === undefined ? {} : params.arguments;
  if (typeof name !== 'string' || !TOOLS.some(toolDefinition => toolDefinition.name === name) || !isRecord(argumentsValue)) return protocolError(id, -32602, 'Invalid tool call parameters');
  try {
    const result = await execute({ name, arguments: argumentsValue });
    return success(id, modern ? modernResult(toolResult(name, result), version) : toolResult(name, result), headers);
  } catch (error) {
    const code = errorCode(error) || 'INTERNAL_ERROR';
    const message = code === 'INTERNAL_ERROR' ? 'Internal server error' : errorMessage(error);
    const result = toolErrorResult(name, code, message);
    return success(id, modern ? modernResult(result, version) : result, headers);
  }
}

function tool(name: string, description: string, inputSchema: JsonRecord, annotations: JsonRecord) { return { name, description, inputSchema, outputSchema: toolOutputSchema(name), annotations }; }
function inputSchema(description: string) { return { type: 'object', properties: { input: { type: 'object', description } }, required: ['input'], additionalProperties: false }; }
function identifierSchema(name: string, description: string) { return { type: 'object', properties: { [name]: { type: 'string', minLength: 1, description } }, required: [name], additionalProperties: false }; }
function toolOutputSchema(name: string) {
  return {
    type: 'object',
    properties: {
      schema: { const: 'priorseal.mcp.tool-result.v1' },
      tool: { const: name },
      status: { type: 'string' },
      nextAction: { type: 'string' },
      requiresHumanSignature: { type: 'boolean' },
      mayBroadcastTransaction: { const: false },
      risk: {
        type: 'object',
        properties: { level: { enum: ['read_only', 'human_signature_required', 'service_state_change', 'verification_only', 'input_or_service_error'] }, reasonCode: { type: 'string' } },
        required: ['level', 'reasonCode'],
        additionalProperties: false,
      },
      data: {},
    },
    required: ['schema', 'tool', 'status', 'nextAction', 'requiresHumanSignature', 'mayBroadcastTransaction', 'risk', 'data'],
    additionalProperties: false,
  };
}
function toolResult(name: string, result: unknown) {
  const structuredContent = structuredToolResult(name, result);
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
}
function toolErrorResult(name: string, code: string, message: string) {
  const structuredContent = {
    schema: 'priorseal.mcp.tool-result.v1', tool: name, status: 'error', nextAction: errorNextAction(code), requiresHumanSignature: false, mayBroadcastTransaction: false,
    risk: { level: 'input_or_service_error', reasonCode: code }, data: { error: { code, message } },
  };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: true };
}
function structuredToolResult(name: string, result: unknown) {
  const record = isRecord(result) ? result : {};
  const response = workflowResponse(name, record);
  return { schema: 'priorseal.mcp.tool-result.v1', tool: name, ...response, mayBroadcastTransaction: false, data: result };
}
function workflowResponse(name: string, result: JsonRecord) {
  if (name === 'priorseal_get_capabilities') return { status: 'capabilities_loaded', nextAction: 'select_supported_workflow', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: 'CAPABILITIES_READ' } };
  if (name === 'priorseal_prepare_authorization') return { status: 'authorization_prepared', nextAction: 'request_principal_signature', requiresHumanSignature: true, risk: { level: 'human_signature_required', reasonCode: 'PRINCIPAL_SIGNATURE_REQUIRED' } };
  if (name === 'priorseal_accept_authorization') return { status: 'authorization_accepted', nextAction: 'handoff_exact_authorized_action', requiresHumanSignature: false, risk: { level: 'service_state_change', reasonCode: 'AUTHORIZATION_PERSISTED' } };
  if (name === 'priorseal_get_authorization') return { status: 'authorization_loaded', nextAction: 'review_authorization', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: 'AUTHORIZATION_READ' } };
  if (name === 'priorseal_observe_execution') {
    const observation = isRecord(result.observation) ? result.observation : {};
    if (isRecord(result.observationJob)) return { status: 'observation_queued', nextAction: 'get_observation_job', requiresHumanSignature: false, risk: { level: 'service_state_change', reasonCode: 'OBSERVATION_JOB_QUEUED' } };
    if (isRecord(result.receipt)) return { status: 'execution_observed', nextAction: 'review_receipt', requiresHumanSignature: false, risk: { level: 'service_state_change', reasonCode: 'EXECUTION_EVIDENCE_ISSUED' } };
    return { status: 'observation_pending', nextAction: 'get_observation_job', requiresHumanSignature: false, risk: { level: 'service_state_change', reasonCode: typeof observation.status === 'string' ? observation.status : 'OBSERVATION_PENDING' } };
  }
  if (name === 'priorseal_get_observation_job') {
    const state = typeof result.state === 'string' ? result.state : 'UNKNOWN';
    if (state === 'COMPLETED') return { status: 'observation_completed', nextAction: 'review_receipt', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: state } };
    if (state === 'FAILED') return { status: 'observation_failed', nextAction: 'review_observation_error', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: state } };
    return { status: 'observation_pending', nextAction: 'get_observation_job', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: state } };
  }
  if (name === 'priorseal_get_receipt') return { status: 'receipt_loaded', nextAction: 'verify_receipt_independently', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: 'RECEIPT_READ' } };
  if (name === 'priorseal_get_evidence_bundle') return { status: 'evidence_bundle_loaded', nextAction: 'verify_evidence_bundle_locally', requiresHumanSignature: false, risk: { level: 'read_only', reasonCode: 'EVIDENCE_BUNDLE_READ' } };
  const verification = isRecord(result.result) ? result.result : {};
  const valid = verification.valid === true;
  return { status: valid ? 'receipt_verified' : 'receipt_not_verified', nextAction: 'verify_receipt_independently', requiresHumanSignature: false, risk: { level: 'verification_only', reasonCode: valid ? 'VERIFIED' : typeof verification.code === 'string' ? verification.code : 'NOT_VERIFIED' } };
}
function errorNextAction(code: string) {
  if (code === 'AUTHORIZATION_EXPIRED') return 'prepare_new_authorization';
  if (code === 'AUTHORIZATION_NOT_FOUND') return 'check_authorization_id';
  if (code === 'RECEIPT_NOT_FOUND') return 'check_receipt_id';
  if (code === 'AGENT_CREDITS_EXHAUSTED') return 'fund_agent_account';
  if (code === 'AGENT_CREDENTIAL_REQUIRED') return 'configure_agent_credential';
  if (code.startsWith('INVALID_')) return 'correct_input';
  return 'review_error';
}
function modernResult(result: JsonRecord, version: string) { return { resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'priorseal', version } } }; }
function instructions() { return 'PriorSeal prepares and verifies bounded authorization and execution evidence. It never holds wallet keys, signs for a principal, or broadcasts a transaction. A signed authorization is not permission to execute a changed, expired, or unmatched transaction.'; }
function isModernRequest(params: JsonRecord, headers: NonNullable<PriorSealMcpOptions['requestHeaders']>) { return headers.protocolVersion === MCP_STATELESS_PROTOCOL_VERSION || (isRecord(params._meta) && params._meta['io.modelcontextprotocol/protocolVersion'] === MCP_STATELESS_PROTOCOL_VERSION); }
function validModernHeaders(body: JsonRecord, headers: NonNullable<PriorSealMcpOptions['requestHeaders']>) { return headers.protocolVersion === MCP_STATELESS_PROTOCOL_VERSION && headers.method === body.method && Boolean(headers.accept?.includes('application/json')) && Boolean(headers.accept?.includes('text/event-stream')) && (body.method !== 'tools/call' || (isRecord(body.params) && typeof body.params.name === 'string' && headers.name === body.params.name)); }
function success(id: string | number | null, result: unknown, headers: Record<string, string>): PriorSealMcpResponse { return { status: 200, body: { jsonrpc: '2.0', id, result }, headers }; }
function protocolError(id: string | number | null, code: number, message: string, modern = false): PriorSealMcpResponse { return { status: 200, body: { jsonrpc: '2.0', id, error: { code, message } }, headers: { 'mcp-protocol-version': modern ? MCP_STATELESS_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION } }; }
function validId(value: unknown): value is string | number | null { return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }
function isRecord(value: unknown): value is JsonRecord { return value !== null && typeof value === 'object' && !Array.isArray(value); }
