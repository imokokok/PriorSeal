// Generated from priorseal-mcp.mts by npm run core:build. Do not edit directly.
import { errorCode, errorMessage } from "../../shared/error-code.mjs";
const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_STATELESS_PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_PROTOCOL_VERSIONS = /* @__PURE__ */ new Set([MCP_PROTOCOL_VERSION, "2025-06-18", "2025-03-26"]);
const READ_ONLY_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const PREPARATION_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const STATE_CHANGE_ANNOTATIONS = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
const TOOLS = Object.freeze([
  tool("priorseal_get_capabilities", "Read the live PriorSeal deployment capabilities before constructing a workflow.", { type: "object", additionalProperties: false }, READ_ONLY_ANNOTATIONS),
  tool("priorseal_prepare_authorization", "Canonicalize a bounded authorization and return the exact EIP-712 typed data or Solana message for a human-controlled principal to sign. This is read-only and never signs, submits, or executes a transaction.", inputSchema("The complete PriorSeal authorization preparation request."), PREPARATION_ANNOTATIONS),
  tool("priorseal_prepare_controlled_execution", "Prepare a bounded authorization together with the deployment capabilities and a safe, explicit handoff plan. A human-controlled principal must still sign; this never accepts an authorization, signs, submits, or executes a transaction.", inputSchema("The complete controlled-execution preparation request."), PREPARATION_ANNOTATIONS),
  tool("priorseal_accept_authorization", "Verify and persist a principal-signed authorization. This can consume configured Agent credits and changes service state; send an idempotency key. It never signs, submits, or executes a transaction.", inputSchema("The complete signed PriorSeal authorization request."), STATE_CHANGE_ANNOTATIONS),
  tool("priorseal_get_authorization", "Read an accepted authorization by its identifier.", identifierSchema("authorizationId", "PriorSeal authorization identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_observe_execution", "Persist an observation request for an already-submitted EVM or Solana transaction, then issue evidence when configured observation completes. A successful metered observation includes its first portable evidence bundle. This can consume configured Agent credits; send an idempotency key. It never broadcasts a transaction.", inputSchema("The complete PriorSeal execution-observation request."), STATE_CHANGE_ANNOTATIONS),
  tool("priorseal_get_observation_job", "Read the durable status of an automatic finality-observation job.", identifierSchema("jobId", "PriorSeal observation job identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_get_receipt", "Read a signed execution receipt by its identifier.", identifierSchema("receiptId", "PriorSeal receipt identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_get_evidence_bundle", "Get a free x402 purchase handoff for the portable receipt evidence bundle. This MCP result never includes the paid bundle itself.", identifierSchema("receiptId", "PriorSeal receipt identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_get_evidence", "Get a free x402 purchase handoff for the chain-neutral Evidence API envelope. This MCP result never includes the paid envelope itself.", identifierSchema("receiptId", "PriorSeal receipt identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_get_fresh_evidence_check", "Get a free x402 purchase handoff for a newly signed, read-only chain re-observation of an authorization-bound receipt.", identifierSchema("receiptId", "PriorSeal receipt identifier."), READ_ONLY_ANNOTATIONS),
  tool("priorseal_verify_receipt", "Convenience-verify a PriorSeal receipt with the deployment key registry. Independent local verification remains required for trust decisions.", {
    type: "object",
    properties: { receipt: { type: "object", description: "Receipt object to verify." } },
    required: ["receipt"],
    additionalProperties: false
  }, READ_ONLY_ANNOTATIONS)
]);
async function handlePriorSealMcpRequest(body, { version, execute, requestHeaders = {} }) {
  if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return protocolError(null, -32600, "Invalid JSON-RPC request");
  const id = validId(body.id) ? body.id : null;
  const params = body.params === void 0 ? {} : body.params;
  if (!isRecord(params)) return protocolError(id, -32602, "Invalid request parameters");
  const modern = isModernRequest(params, requestHeaders);
  if (modern && !validModernHeaders(body, requestHeaders)) return protocolError(id, -32600, "MCP request headers do not match the JSON-RPC request", true);
  const headers = { "mcp-protocol-version": modern ? MCP_STATELESS_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION };
  if (modern && body.method === "server/discover") {
    return success(id, modernResult({
      supportedVersions: [MCP_STATELESS_PROTOCOL_VERSION],
      capabilities: { tools: { listChanged: false } },
      instructions: instructions(),
      ttlMs: 3e5,
      cacheScope: "public"
    }, version), headers);
  }
  if (modern && body.method === "initialize") return protocolError(id, -32601, "Method not found", true);
  if (body.method === "initialize") {
    const requested = params.protocolVersion;
    if (typeof requested !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.has(requested)) return protocolError(id, -32602, "Unsupported MCP protocol version");
    return success(id, {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "priorseal", version },
      instructions: instructions()
    }, headers);
  }
  if (body.method === "notifications/initialized") return { status: 202, body: {}, headers };
  if (body.method === "ping") return success(id, modern ? modernResult({}, version) : {}, headers);
  if (body.method === "tools/list") return success(id, modern ? modernResult({ tools: TOOLS, ttlMs: 3e5, cacheScope: "public" }, version) : { tools: TOOLS }, headers);
  if (body.method !== "tools/call") return protocolError(id, -32601, "Method not found", modern);
  const name = params.name;
  const argumentsValue = params.arguments === void 0 ? {} : params.arguments;
  if (typeof name !== "string" || !TOOLS.some((toolDefinition) => toolDefinition.name === name) || !isRecord(argumentsValue)) return protocolError(id, -32602, "Invalid tool call parameters");
  try {
    const result = await execute({ name, arguments: argumentsValue });
    return success(id, modern ? modernResult(toolResult(name, result), version) : toolResult(name, result), headers);
  } catch (error) {
    const code = errorCode(error) || "INTERNAL_ERROR";
    const message = code === "INTERNAL_ERROR" ? "Internal server error" : errorMessage(error);
    const result = toolErrorResult(name, code, message);
    return success(id, modern ? modernResult(result, version) : result, headers);
  }
}
function tool(name, description, inputSchema2, annotations) {
  return { name, description, inputSchema: inputSchema2, outputSchema: toolOutputSchema(name), annotations };
}
function inputSchema(description) {
  return { type: "object", properties: { input: { type: "object", description } }, required: ["input"], additionalProperties: false };
}
function identifierSchema(name, description) {
  return { type: "object", properties: { [name]: { type: "string", minLength: 1, description } }, required: [name], additionalProperties: false };
}
function toolOutputSchema(name) {
  return {
    type: "object",
    properties: {
      schema: { const: "priorseal.mcp.tool-result.v1" },
      tool: { const: name },
      status: { type: "string" },
      nextAction: { type: "string" },
      requiresHumanSignature: { type: "boolean" },
      mayBroadcastTransaction: { const: false },
      risk: {
        type: "object",
        properties: { level: { enum: ["read_only", "human_signature_required", "service_state_change", "verification_only", "input_or_service_error"] }, reasonCode: { type: "string" } },
        required: ["level", "reasonCode"],
        additionalProperties: false
      },
      data: {}
    },
    required: ["schema", "tool", "status", "nextAction", "requiresHumanSignature", "mayBroadcastTransaction", "risk", "data"],
    additionalProperties: false
  };
}
function toolResult(name, result) {
  const structuredContent = structuredToolResult(name, result);
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}
function toolErrorResult(name, code, message) {
  const structuredContent = {
    schema: "priorseal.mcp.tool-result.v1",
    tool: name,
    status: "error",
    nextAction: errorNextAction(code),
    requiresHumanSignature: false,
    mayBroadcastTransaction: false,
    risk: { level: "input_or_service_error", reasonCode: code },
    data: { error: { code, message } }
  };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: true };
}
function structuredToolResult(name, result) {
  const record = isRecord(result) ? result : {};
  const response = workflowResponse(name, record);
  return { schema: "priorseal.mcp.tool-result.v1", tool: name, ...response, mayBroadcastTransaction: false, data: result };
}
function workflowResponse(name, result) {
  if (name === "priorseal_get_capabilities") return { status: "capabilities_loaded", nextAction: "select_supported_workflow", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: "CAPABILITIES_READ" } };
  if (name === "priorseal_prepare_authorization") return { status: "authorization_prepared", nextAction: "request_principal_signature", requiresHumanSignature: true, risk: { level: "human_signature_required", reasonCode: "PRINCIPAL_SIGNATURE_REQUIRED" } };
  if (name === "priorseal_prepare_controlled_execution") return { status: "controlled_execution_prepared", nextAction: "request_principal_signature", requiresHumanSignature: true, risk: { level: "human_signature_required", reasonCode: "PRINCIPAL_SIGNATURE_REQUIRED" } };
  if (name === "priorseal_accept_authorization") return { status: "authorization_accepted", nextAction: "handoff_exact_authorized_action", requiresHumanSignature: false, risk: { level: "service_state_change", reasonCode: "AUTHORIZATION_PERSISTED" } };
  if (name === "priorseal_get_authorization") return { status: "authorization_loaded", nextAction: "review_authorization", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: "AUTHORIZATION_READ" } };
  if (name === "priorseal_observe_execution") {
    const observation = isRecord(result.observation) ? result.observation : {};
    if (isRecord(result.observationJob)) return { status: "observation_queued", nextAction: "get_observation_job", requiresHumanSignature: false, risk: { level: "service_state_change", reasonCode: "OBSERVATION_JOB_QUEUED" } };
    if (isRecord(result.receipt)) return { status: "execution_observed", nextAction: "review_receipt", requiresHumanSignature: false, risk: { level: "service_state_change", reasonCode: "EXECUTION_EVIDENCE_ISSUED" } };
    return { status: "observation_pending", nextAction: "get_observation_job", requiresHumanSignature: false, risk: { level: "service_state_change", reasonCode: typeof observation.status === "string" ? observation.status : "OBSERVATION_PENDING" } };
  }
  if (name === "priorseal_get_observation_job") {
    const state = typeof result.state === "string" ? result.state : "UNKNOWN";
    if (state === "COMPLETED") return { status: "observation_completed", nextAction: "review_receipt", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: state } };
    if (state === "FAILED") return { status: "observation_failed", nextAction: "review_observation_error", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: state } };
    return { status: "observation_pending", nextAction: "get_observation_job", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: state } };
  }
  if (name === "priorseal_get_receipt") return { status: "receipt_loaded", nextAction: "verify_receipt_independently", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: "RECEIPT_READ" } };
  if (name === "priorseal_get_evidence_bundle" || name === "priorseal_get_evidence" || name === "priorseal_get_fresh_evidence_check") return { status: "payment_handoff_ready", nextAction: "pay_x402_and_request_paid_resource", requiresHumanSignature: false, risk: { level: "read_only", reasonCode: "PAID_EVIDENCE_HANDOFF" } };
  const verification = isRecord(result.result) ? result.result : {};
  const valid = verification.valid === true;
  return { status: valid ? "receipt_verified" : "receipt_not_verified", nextAction: "verify_receipt_independently", requiresHumanSignature: false, risk: { level: "verification_only", reasonCode: valid ? "VERIFIED" : typeof verification.code === "string" ? verification.code : "NOT_VERIFIED" } };
}
function errorNextAction(code) {
  if (code === "AUTHORIZATION_EXPIRED") return "prepare_new_authorization";
  if (code === "AUTHORIZATION_NOT_FOUND") return "check_authorization_id";
  if (code === "RECEIPT_NOT_FOUND") return "check_receipt_id";
  if (code === "AGENT_CREDITS_EXHAUSTED") return "fund_agent_account";
  if (code === "AGENT_CREDENTIAL_REQUIRED") return "configure_agent_credential";
  if (code.startsWith("INVALID_")) return "correct_input";
  return "review_error";
}
function modernResult(result, version) {
  return { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": { name: "priorseal", version } } };
}
function instructions() {
  return "PriorSeal prepares and verifies bounded authorization and execution evidence. It never holds wallet keys, signs for a principal, or broadcasts a transaction. A signed authorization is not permission to execute a changed, expired, or unmatched transaction.";
}
function isModernRequest(params, headers) {
  return headers.protocolVersion === MCP_STATELESS_PROTOCOL_VERSION || isRecord(params._meta) && params._meta["io.modelcontextprotocol/protocolVersion"] === MCP_STATELESS_PROTOCOL_VERSION;
}
function validModernHeaders(body, headers) {
  return headers.protocolVersion === MCP_STATELESS_PROTOCOL_VERSION && headers.method === body.method && Boolean(headers.accept?.includes("application/json")) && Boolean(headers.accept?.includes("text/event-stream")) && (body.method !== "tools/call" || isRecord(body.params) && typeof body.params.name === "string" && headers.name === body.params.name);
}
function success(id, result, headers) {
  return { status: 200, body: { jsonrpc: "2.0", id, result }, headers };
}
function protocolError(id, code, message, modern = false) {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } }, headers: { "mcp-protocol-version": modern ? MCP_STATELESS_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION } };
}
function validId(value) {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export {
  MCP_PROTOCOL_VERSION,
  MCP_STATELESS_PROTOCOL_VERSION,
  handlePriorSealMcpRequest
};
