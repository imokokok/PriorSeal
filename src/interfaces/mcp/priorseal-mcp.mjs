// Generated from priorseal-mcp.mts by npm run core:build. Do not edit directly.
import { errorCode, errorMessage } from "../../shared/error-code.mjs";
const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_STATELESS_PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_PROTOCOL_VERSIONS = /* @__PURE__ */ new Set([MCP_PROTOCOL_VERSION, "2025-06-18", "2025-03-26"]);
const TOOLS = Object.freeze([
  tool("priorseal_get_capabilities", "Read the live PriorSeal deployment capabilities before constructing a workflow.", { type: "object", additionalProperties: false }, { readOnlyHint: true }),
  tool("priorseal_prepare_authorization", "Canonicalize a bounded authorization and return the exact EIP-712 typed data or Solana message for the principal to sign. This never signs, submits, or executes a transaction.", inputSchema("The complete PriorSeal authorization preparation request."), { readOnlyHint: true }),
  tool("priorseal_accept_authorization", "Verify and accept a principal-signed authorization. Supply an idempotency key in the MCP HTTP request when the deployment meters this operation. Acceptance is not transaction execution.", inputSchema("The complete signed PriorSeal authorization request."), { destructiveHint: false }),
  tool("priorseal_get_authorization", "Read an accepted authorization by its identifier.", identifierSchema("authorizationId", "PriorSeal authorization identifier."), { readOnlyHint: true }),
  tool("priorseal_observe_execution", "Observe a submitted EVM or Solana transaction against an accepted authorization and issue evidence when the configured observer can do so. This never broadcasts a transaction.", inputSchema("The complete PriorSeal execution-observation request."), { destructiveHint: false }),
  tool("priorseal_get_observation_job", "Read the durable status of an automatic finality-observation job.", identifierSchema("jobId", "PriorSeal observation job identifier."), { readOnlyHint: true }),
  tool("priorseal_get_receipt", "Read a signed execution receipt by its identifier.", identifierSchema("receiptId", "PriorSeal receipt identifier."), { readOnlyHint: true }),
  tool("priorseal_get_evidence_bundle", "Export the portable receipt evidence bundle and issuer key-discovery metadata.", identifierSchema("receiptId", "PriorSeal receipt identifier."), { readOnlyHint: true }),
  tool("priorseal_verify_receipt", "Convenience-verify a PriorSeal receipt with the deployment key registry. Independent local verification remains required for trust decisions.", {
    type: "object",
    properties: { receipt: { type: "object", description: "Receipt object to verify." } },
    required: ["receipt"],
    additionalProperties: false
  }, { readOnlyHint: true })
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
    return success(id, modern ? modernResult(toolResult(result), version) : toolResult(result), headers);
  } catch (error) {
    const code = errorCode(error) || "INTERNAL_ERROR";
    const message = code === "INTERNAL_ERROR" ? "Internal server error" : errorMessage(error);
    const result = { content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }], isError: true };
    return success(id, modern ? modernResult(result, version) : result, headers);
  }
}
function tool(name, description, inputSchema2, annotations) {
  return { name, description, inputSchema: inputSchema2, annotations };
}
function inputSchema(description) {
  return { type: "object", properties: { input: { type: "object", description } }, required: ["input"], additionalProperties: false };
}
function identifierSchema(name, description) {
  return { type: "object", properties: { [name]: { type: "string", minLength: 1, description } }, required: [name], additionalProperties: false };
}
function toolResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
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
