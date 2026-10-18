// Generated from create-http-server.mts by npm run core:build. Do not edit directly.
import { errorCode, errorMessage } from "../../shared/error-code.mjs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { verifyReceipt } from "../../domain/receipt-verifier.mjs";
import { solanaAuthorizationMessage } from "../../domain/solana.mjs";
import { observeEvm } from "../../infrastructure/blockchain/evm/observer.mjs";
import { createMemoryStore } from "../../infrastructure/persistence/memory-store.mjs";
import { createKeyRegistry } from "../../domain/key-registry.mjs";
import { PriorSealError } from "../../domain/errors.mjs";
import { assertOnlyFields } from "../../shared/safe-json.mjs";
import { createIntent } from "../../application/intents/create-intent.mjs";
import { authorizeIntent } from "../../application/authorizations/authorize-intent.mjs";
import { AUTHORIZATION_SCHEMA, assertIssuableAuthorization, authorizationTypedData, buildAuthorization, verifyAuthorizedReceipt } from "../../domain/authorization.mjs";
import { observeExecution } from "../../application/observations/observe-execution.mjs";
import { createMemoryRateLimiter } from "./rate-limiter.mjs";
import { readJsonBody, requestPath } from "./request-parser.mjs";
import { errorBody, sendJson } from "./response-writer.mjs";
import { hashJson } from "../../domain/hashing.mjs";
import { buildX402PaymentEvidence, signX402PaymentEvidence } from "../../domain/x402-payment-evidence.mjs";
import { buildX402PaymentLedgerEvent } from "../../domain/x402-payment-ledger.mjs";
import { createStaticAssetHandler } from "./static-assets.mjs";
import { buildVerificationBundle } from "../../domain/verification-bundle.mjs";
import { assertIssuableIntentInput } from "../../domain/intent.mjs";
import { evaluateAuthorizationPolicy, evaluateNewIntentPolicyCompatibility } from "../../domain/intent-policy.mjs";
import { assertEd25519KeyPair } from "../../domain/ed25519.mjs";
import { createArchiveAccess, archiveEntry, archiveQuery } from "../../application/archive/evidence-archive.mjs";
import { deploymentCapabilities } from "../../application/capabilities.mjs";
import { createRequestDeadline } from "./request-deadline.mjs";
import { createX402PaymentService, matchX402Route } from "../../infrastructure/payments/x402-exact-evm.mjs";
import { handlePriorSealMcpRequest } from "../mcp/priorseal-mcp.mjs";
const ERROR_STATUS = Object.freeze({ ARCHIVE_UNAUTHORIZED: 401, ARCHIVE_FORBIDDEN: 403, ARCHIVE_CONFLICT: 409, AGENT_CREDENTIAL_REQUIRED: 401, AGENT_CREDENTIAL_INVALID: 403, AGENT_CREDITS_EXHAUSTED: 402, INVALID_JSON: 400, INVALID_REQUEST: 400, UNKNOWN_FIELD: 400, DANGEROUS_JSON_KEY: 400, JSON_TOO_DEEP: 400, INVALID_INTENT: 400, INVALID_AUTHORIZATION: 400, MISSING_AUTHORIZATION_SIGNATURE: 400, INVALID_AUTHORIZATION_SIGNATURE: 400, AUTHORIZATION_AUDIENCE_MISMATCH: 400, AUTHORIZATION_NOT_YET_VALID: 400, AUTHORIZATION_ISSUED_IN_FUTURE: 400, AUTHORIZATION_POLICY_MISMATCH: 409, AUTHORIZATION_EXPIRED: 410, AUTHORIZATION_ALREADY_USED: 409, AUTHORIZATION_NONCE_REUSED: 409, INVALID_TIMESTAMP_EVIDENCE: 400, INVALID_TIMESTAMP_PROFILE: 400, TIMESTAMP_POLICY_MISMATCH: 409, TIMESTAMP_AUTHORIZATION_MISMATCH: 409, TIMESTAMP_RESPONSE_HASH_MISMATCH: 409, TIMESTAMP_METADATA_MISMATCH: 409, INVALID_TIMESTAMP_POLICY: 400, TIMESTAMP_CLOCK_SKEW: 409, TIMESTAMP_AFTER_EXECUTION: 409, INVALID_TIMESTAMP_SIGNATURE: 409, INVALID_TIMESTAMP_CERTIFICATE_USAGE: 409, UNTRUSTED_TIMESTAMP_ROOT: 409, TIMESTAMP_SERVICE_UNAVAILABLE: 503, TIMESTAMP_NOT_CONFIGURED: 503, INVALID_TIMESTAMP_RESPONSE: 502, INVALID_WITNESS_POLICY: 400, INVALID_WITNESS_EVIDENCE: 400, WITNESS_POLICY_MISMATCH: 409, WITNESS_AUTHORIZATION_MISMATCH: 409, WITNESS_ACCEPTANCE_MISMATCH: 409, WITNESS_QUORUM_NOT_MET: 409, WITNESS_QUORUM_UNAVAILABLE: 503, WITNESS_NOT_CONFIGURED: 503, TRANSPARENCY_ANCHOR_REQUIRED: 409, TRANSPARENCY_AFTER_EXECUTION: 409, INVALID_CHAIN_ID: 400, INVALID_TX_HASH: 400, INVALID_ADDRESS: 400, INVALID_ASSET: 400, INVALID_UINT: 400, INVALID_TIME: 400, INVALID_IDENTIFIER: 400, INVALID_CONSTRAINT: 400, ERC4337_ENTRY_POINT_NOT_TRUSTED: 403, ERC4337_ENTRY_POINT_MISMATCH: 409, ERC4337_CODE_HASH_MISMATCH: 409, ERC4337_ACCOUNT_CALL_UNSUPPORTED: 409, ERC4337_ACCOUNT_CALL_MISMATCH: 409, ERC4337_SAFE_ACCOUNT_UNTRUSTED: 409, ERC4337_EVENT_MISMATCH: 409, ERC4337_EIP7702_UNTRUSTED: 403, ERC4337_EIP7702_AUTH_MISMATCH: 409, ERC4337_EIP7702_OPERATION_MISMATCH: 409, ERC4337_EIP7702_TRACE_UNAVAILABLE: 503, INVALID_IDEMPOTENCY_KEY: 400, UNSUPPORTED_MEDIA_TYPE: 415, REQUEST_TOO_LARGE: 413, IDEMPOTENCY_CONFLICT: 409, POLICY_REJECTED: 403, INTENT_NOT_FOUND: 404, AUTHORIZATION_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 404, NOT_FOUND: 404, REQUEST_TIMEOUT: 504, ISSUER_NOT_CONFIGURED: 503, AUTHORIZATION_VERIFIER_UNAVAILABLE: 503, RATE_LIMITER_UNAVAILABLE: 503, RPC_NOT_CONFIGURED: 503, RPC_TIMEOUT: 503, RPC_FAILURE: 503 });
const AGENT_ACCOUNT_ERROR_STATUS = Object.freeze({ AGENT_OPERATOR_CREDENTIAL_INVALID: 403, AGENT_ACCOUNT_INVALID: 400, AGENT_ACCOUNT_NOT_FOUND: 404, AGENT_ACCOUNT_EXISTS: 409, AGENT_IDEMPOTENCY_REQUIRED: 400 });
function requester(req, trustProxy) {
  return trustProxy ? String(req.headers["cf-connecting-ip"] ?? "").trim() || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown" : req.socket.remoteAddress || "unknown";
}
function createHttpServer({ archiveCredentials = null, rpcChainIds, erc4337EntryPoints = [], safe4337Trust = [], eip7702Delegates = [], proofMode, store = createMemoryStore(), agentMeter = null, issuer = "priorseal-local", privateKeyPem, publicKeyPem, keyId = "default", keyRegistry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: "Ed25519", publicKey: publicKeyPem, status: "active", validFrom: null, validUntil: null }] : []), policy = null, authorizationAudience = "priorseal", verifyContractSignature, timestampProvider = null, requireTimestamp = false, witnessProvider = null, requireWitnessQuorum = false, transparencyProvider = null, observationWorker = null, maxBodyBytes = 64 * 1024, rateLimit = 60, rateLimiter = createMemoryRateLimiter({ limit: rateLimit }), requestTimeoutMs = 15e3, observer = observeEvm, corsOrigins = [], trustProxy = false, x402, guardedJupiter, version = process.env.PRIORSEAL_BUILD_VERSION ?? "dev", staticDir, logger = null, now = () => Date.now() } = {}) {
  if (privateKeyPem || publicKeyPem) {
    if (!privateKeyPem || !publicKeyPem) throw new TypeError("Issuer private and public keys must be configured together");
    assertEd25519KeyPair(privateKeyPem, publicKeyPem);
  }
  const archiveAccess = createArchiveAccess(archiveCredentials);
  const serveStaticAsset = staticDir ? createStaticAssetHandler(staticDir) : null;
  const x402Payments = x402 ? createX402PaymentService(x402) : null;
  return createServer({ requestTimeout: requestTimeoutMs }, async (req, res) => {
    const requestId = typeof req.headers["x-request-id"] === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(req.headers["x-request-id"]) ? req.headers["x-request-id"] : randomUUID();
    const deadline = createRequestDeadline(req, requestTimeoutMs);
    const cleanup = () => deadline.cleanup();
    res.once("close", cleanup);
    res.once("finish", cleanup);
    const path = requestPath(req);
    const paidRoute = matchX402Route(x402, req.method, path);
    const origin = req.headers.origin;
    const cors = origin && corsOrigins.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type,idempotency-key,x-request-id,authorization,payment-signature,x-priorseal-agent-key,x-priorseal-operator-key", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-expose-headers": "payment-required,payment-response,x-priorseal-usage-id" } : {};
    let captureResponse = false;
    let capturedResponse;
    let meterReservation;
    let meterResponseStatus;
    let meterOutcome;
    const respond = (status, body, headers = {}) => {
      meterResponseStatus = status;
      const responseHeaders = { ...cors, ...meterReservation ? { "x-priorseal-usage-id": meterReservation.usageId } : {}, ...path.startsWith("/v1/archive") ? { "cache-control": "private, no-store", vary: "Authorization, Origin" } : {}, ...headers };
      if (captureResponse) {
        capturedResponse = { status, body, headers: responseHeaders };
        return;
      }
      return sendJson(res, status, body, requestId, responseHeaders);
    };
    const dispatch = async () => {
      if (path === "/mcp" && typeof req.headers.origin === "string" && !mcpOriginAllowed(req.headers.origin, corsOrigins)) return respond(403, errorBody("ORIGIN_FORBIDDEN", "MCP browser origin is not allowed", requestId));
      if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
      if (!["GET", "POST"].includes(req.method ?? "")) return respond(405, errorBody("METHOD_NOT_ALLOWED", "Method not allowed", requestId), { allow: "GET, POST, OPTIONS" });
      if (path === "/mcp" && req.method !== "POST") return respond(405, errorBody("METHOD_NOT_ALLOWED", "PriorSeal MCP accepts POST requests", requestId), { allow: "POST, OPTIONS" });
      if (req.method === "GET" && path === "/health/live") return respond(200, { status: "ok", requestId });
      if (req.method === "GET" && path === "/health/ready") return respond(200, { status: "ready", storage: "health" in store ? await store.health() : "unknown", requestId });
      if (!paidRoute && req.method === "GET" && serveStaticAsset && await serveStaticAsset({ pathname: path, req, res })) return;
      if (!paidRoute && !await rateLimiter.allow(requester(req, trustProxy), now())) return respond(429, errorBody("RATE_LIMITED", "Too many requests", requestId), { "retry-after": "60" });
      const body = req.method === "POST" ? await readJsonBody(req, path === "/v1/archive" ? Math.max(maxBodyBytes, 1024 * 1024) : maxBodyBytes, deadline.signal) : {};
      if (req.method === "POST" && path === "/mcp") {
        const response = await handlePriorSealMcpRequest(body, {
          version,
          requestHeaders: {
            protocolVersion: typeof req.headers["mcp-protocol-version"] === "string" ? req.headers["mcp-protocol-version"] : void 0,
            method: typeof req.headers["mcp-method"] === "string" ? req.headers["mcp-method"] : void 0,
            name: typeof req.headers["mcp-name"] === "string" ? req.headers["mcp-name"] : void 0,
            accept: typeof req.headers.accept === "string" ? req.headers.accept : void 0
          },
          execute: async ({ name, arguments: toolArguments }) => {
            const metered = async (meteredPath, operation) => {
              if (agentMeter) {
                const credential = typeof req.headers["x-priorseal-agent-key"] === "string" ? req.headers["x-priorseal-agent-key"] : void 0;
                const requestKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0;
                const authorized = await agentMeter.authorize({ method: "POST", pathname: meteredPath, credential, requestKey, now: now() });
                meterReservation = authorized?.reservation;
                meterOutcome = false;
              }
              const result = await operation();
              meterOutcome = true;
              return result;
            };
            if (name === "priorseal_get_capabilities") {
              assertOnlyFields(toolArguments, [], "PriorSeal MCP capabilities arguments");
              return deploymentCapabilities({ issuer, audience: authorizationAudience, keyConfigured: Boolean(privateKeyPem && publicKeyPem), policy, proofMode: proofMode ?? (requireTimestamp ? "rfc3161" : requireWitnessQuorum ? "witness-quorum" : "issuer"), timestampConfigured: Boolean(timestampProvider), witnessConfigured: Boolean(witnessProvider), anchorConfigured: Boolean(transparencyProvider), rpcChainIds, erc4337EntryPoints, safe4337Trust, eip7702Delegates, store, archiveEnabled: Boolean(archiveAccess), contractSignatureConfigured: typeof verifyContractSignature === "function", x402, agentMeter, now: now() });
            }
            if (name === "priorseal_prepare_authorization" || name === "priorseal_prepare_controlled_execution") {
              const input = mcpInput(toolArguments, name === "priorseal_prepare_controlled_execution" ? "controlled-execution preparation" : "authorization preparation");
              assertIssuableIntentInput(input.intent);
              const preparedAt = Math.floor(now() / 1e3);
              const authorization = assertIssuableAuthorization(buildAuthorization({ ...input, audience: authorizationAudience, policyHash: policy ? `0x${hashJson(policy)}` : `0x${"0".repeat(64)}` }));
              if (authorization.schema !== AUTHORIZATION_SCHEMA) throw new PriorSealError("INVALID_AUTHORIZATION", "Legacy authorization schemas are verification-only");
              if (authorization.issuedAt > preparedAt) throw new PriorSealError("AUTHORIZATION_ISSUED_IN_FUTURE", "Authorization issuedAt cannot be in the future");
              if (preparedAt > authorization.expiresAt) throw new PriorSealError("AUTHORIZATION_EXPIRED", "Authorization has already expired");
              const compatibility = evaluateNewIntentPolicyCompatibility(authorization.intent, policy ?? {});
              if (!compatibility.allowed) throw new PriorSealError("POLICY_REJECTED", "Authorization policy cannot enforce descriptive exact-call semantics", compatibility);
              const policyResult = policy ? evaluateAuthorizationPolicy(authorization, policy, preparedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: preparedAt };
              if (!policyResult.allowed) throw new PriorSealError("POLICY_REJECTED", "Authorization rejected by policy before signing", policyResult);
              const typedData = jsonSafe(authorization.authorizer.type === "solana-ed25519" ? { profile: "solana-ed25519", message: solanaAuthorizationMessage(authorization) } : authorizationTypedData(authorization));
              if (name === "priorseal_prepare_controlled_execution") {
                const capabilities = await deploymentCapabilities({ issuer, audience: authorizationAudience, keyConfigured: Boolean(privateKeyPem && publicKeyPem), policy, proofMode: proofMode ?? (requireTimestamp ? "rfc3161" : requireWitnessQuorum ? "witness-quorum" : "issuer"), timestampConfigured: Boolean(timestampProvider), witnessConfigured: Boolean(witnessProvider), anchorConfigured: Boolean(transparencyProvider), rpcChainIds, erc4337EntryPoints, safe4337Trust, eip7702Delegates, store, archiveEnabled: Boolean(archiveAccess), contractSignatureConfigured: typeof verifyContractSignature === "function", x402, agentMeter, now: now() });
                return { authorization, typedData, capabilities, controlledExecution: controlledExecutionWorkflow() };
              }
              return { authorization, typedData };
            }
            if (name === "priorseal_accept_authorization") {
              const input = mcpInput(toolArguments, "authorization acceptance");
              return metered("/v1/authorizations", async () => {
                const result = await authorizeIntent({ input, idempotencyKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, store, privateKeyPem, issuer, keyId, policy, audience: authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp, witnessProvider, requireWitnessQuorum, now });
                return result.response;
              });
            }
            if (name === "priorseal_get_authorization") {
              const authorizationId = mcpIdentifier(toolArguments, "authorizationId", "authorization");
              const record = await store.getAuthorization?.(authorizationId);
              if (!record) throw new PriorSealError("AUTHORIZATION_NOT_FOUND", "Authorization not found");
              return record;
            }
            if (name === "priorseal_observe_execution") {
              const input = mcpInput(toolArguments, "execution observation");
              return metered("/v1/executions/observe", async () => {
                const result = await observeExecution({ input, store, observer, signal: deadline.signal, privateKeyPem, issuer, keyId, publicKeyPem, idempotencyKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, transparencyProvider, authorizationAudience, verifyContractSignature, now });
                const response2 = result.response;
                let observationJob = null;
                if (observationWorker && ["PENDING", "NOT_FOUND", "RPC_ERROR", "RPC_TIMEOUT"].includes(response2.observation.status)) {
                  if (typeof input.txHash !== "string") throw new PriorSealError("INVALID_REQUEST", "Observation transaction hash is required");
                  const observationCycle = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : requestId;
                  observationJob = await observationWorker.enqueuePersistent({ ...input, txHash: input.txHash, idempotencyKey: `observation:${hashJson(input)}:${observationCycle}` });
                }
                return { ...response2, ...observationJob ? { observationJob } : {} };
              });
            }
            if (name === "priorseal_get_observation_job") {
              const jobId = mcpIdentifier(toolArguments, "jobId", "observation job");
              if (!observationWorker) throw new PriorSealError("NOT_FOUND", "Observation jobs are not enabled");
              const job = await observationWorker.get(jobId);
              if (!job) throw new PriorSealError("NOT_FOUND", "Observation job not found");
              return job;
            }
            if (name === "priorseal_get_receipt" || name === "priorseal_get_evidence_bundle") {
              const receiptId = mcpIdentifier(toolArguments, "receiptId", "receipt");
              const receipt = await store.getReceipt(receiptId);
              if (!receipt) throw new PriorSealError("RECEIPT_NOT_FOUND", "Receipt not found");
              return name === "priorseal_get_evidence_bundle" ? buildVerificationBundle({ receipt, keyRegistry: keyRegistryDocument(issuer, keyRegistry), assembledAt: Math.floor(now() / 1e3) }) : receipt;
            }
            if (name === "priorseal_verify_receipt") {
              assertOnlyFields(toolArguments, ["receipt"], "PriorSeal MCP receipt verification arguments");
              const receipt = isRecord(toolArguments.receipt) ? toolArguments.receipt : null;
              if (!receipt) throw new PriorSealError("INVALID_REQUEST", "Receipt verification requires a receipt object");
              const entry = keyRegistry.get(typeof receipt.keyId === "string" ? receipt.keyId : "");
              const verificationOptions = { key: entry, now: Math.floor(now() / 1e3) };
              const result = !entry ? { valid: false, code: "UNKNOWN_KEY" } : ["priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3"].includes(String(receipt.schema)) ? await verifyAuthorizedReceipt(receipt, entry.publicKey, { ...verificationOptions, audience: authorizationAudience, verifyContractSignature }) : verifyReceipt(receipt, entry.publicKey, { ...verificationOptions, keyId: entry.keyId });
              return { convenienceEndpoint: true, independentVerification: "Use the local verifier; do not trust this API response alone.", result };
            }
            throw new PriorSealError("INVALID_REQUEST", "Unknown PriorSeal MCP tool");
          }
        });
        return respond(response.status, response.body, response.headers);
      }
      if (req.method === "GET" && path === "/v1/capabilities") return respond(200, await deploymentCapabilities({ issuer, audience: authorizationAudience, keyConfigured: Boolean(privateKeyPem && publicKeyPem), policy, proofMode: proofMode ?? (requireTimestamp ? "rfc3161" : requireWitnessQuorum ? "witness-quorum" : "issuer"), timestampConfigured: Boolean(timestampProvider), witnessConfigured: Boolean(witnessProvider), anchorConfigured: Boolean(transparencyProvider), rpcChainIds, erc4337EntryPoints, safe4337Trust, eip7702Delegates, store, archiveEnabled: Boolean(archiveAccess), contractSignatureConfigured: typeof verifyContractSignature === "function", x402, agentMeter, now: now() }), { "cache-control": "no-store" });
      if (agentMeter && req.method === "GET" && path === "/v1/agent-accounts/self/usage") {
        const limit = agentUsageLimit(new URL(req.url ?? "/", "http://priorseal.local").searchParams.get("limit"));
        return respond(200, { items: await agentMeter.usage(typeof req.headers["x-priorseal-agent-key"] === "string" ? req.headers["x-priorseal-agent-key"] : void 0, limit), requestId }, { "cache-control": "private, no-store" });
      }
      if (agentMeter && req.method === "GET" && path === "/v1/agent-accounts/self") return respond(200, { account: await agentMeter.inspect(typeof req.headers["x-priorseal-agent-key"] === "string" ? req.headers["x-priorseal-agent-key"] : void 0), requestId }, { "cache-control": "private, no-store" });
      if (agentMeter && req.method === "POST" && path === "/v1/agent-accounts") {
        assertOnlyFields(body, ["accountId", "provisionedCredits"], "agent account create");
        const result = await agentMeter.operator.issue({ operatorCredential: typeof req.headers["x-priorseal-operator-key"] === "string" ? req.headers["x-priorseal-operator-key"] : void 0, accountId: String(body.accountId ?? ""), provisionedCredits: String(body.provisionedCredits ?? "") });
        return respond(201, { ...result, requestId }, { "cache-control": "no-store" });
      }
      const creditAccountMatch = agentMeter && req.method === "POST" && path.match(/^\/v1\/agent-accounts\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/credits$/);
      if (creditAccountMatch) {
        assertOnlyFields(body, ["credits", "reference"], "agent account credit");
        if (body.reference !== void 0 && body.reference !== null && typeof body.reference !== "string") throw new PriorSealError("INVALID_REQUEST", "Agent credit reference must be a string or null");
        const result = await agentMeter.operator.credit({ operatorCredential: typeof req.headers["x-priorseal-operator-key"] === "string" ? req.headers["x-priorseal-operator-key"] : void 0, accountId: creditAccountMatch[1], credits: String(body.credits ?? ""), requestKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, reference: typeof body.reference === "string" ? body.reference : null, now: now() });
        return respond(result.replay ? 200 : 201, { account: result.account, operation: result.operation, requestId }, { "cache-control": "no-store", ...result.replay ? { "idempotency-replayed": "true" } : {} });
      }
      const revokeAccountMatch = agentMeter && req.method === "POST" && path.match(/^\/v1\/agent-accounts\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/revoke$/);
      if (revokeAccountMatch) {
        assertOnlyFields(body, [], "agent account revoke");
        const account = await agentMeter.operator.revoke({ operatorCredential: typeof req.headers["x-priorseal-operator-key"] === "string" ? req.headers["x-priorseal-operator-key"] : void 0, accountId: revokeAccountMatch[1] });
        return respond(200, { account, requestId }, { "cache-control": "no-store" });
      }
      if (path === "/v1/archive" || path.startsWith("/v1/archive/")) {
        if (!archiveAccess) throw new PriorSealError("NOT_FOUND", "Project archive is not enabled");
        const access = archiveAccess.authenticate(typeof req.headers.authorization === "string" ? req.headers.authorization : void 0);
        if (req.method === "GET" && path === "/v1/archive") return respond(200, await store.listArchiveEntries(archiveQuery(new URL(req.url ?? "/", "http://priorseal.local"), access)));
        if (req.method === "GET" && path === "/v1/archive/export") {
          const url = new URL(req.url ?? "/", "http://priorseal.local");
          if (!url.searchParams.has("limit")) url.searchParams.set("limit", "10");
          const query = archiveQuery(url, access);
          if (query.limit > 25) throw new PriorSealError("INVALID_REQUEST", "Archive exports contain at most 25 artifacts per page");
          return respond(200, await store.listArchiveEntries({ ...query, includeArtifacts: true }));
        }
        if (req.method === "POST" && path === "/v1/archive") {
          if (access.role !== "writer") throw new PriorSealError("ARCHIVE_FORBIDDEN", "This project credential is read-only");
          assertOnlyFields(body, ["artifact", "supersedesId"], "archive upload");
          if (body.supersedesId !== void 0 && body.supersedesId !== null && typeof body.supersedesId !== "string") throw new PriorSealError("INVALID_REQUEST", "Invalid superseded archive identifier");
          const entry = archiveEntry(body.artifact, access, { supersedesId: body.supersedesId, now: now() });
          if (entry.supersedesId && !await store.getArchiveEntry(access, entry.supersedesId)) throw new PriorSealError("NOT_FOUND", "Superseded entry is not in this project");
          return respond(201, await store.saveArchiveEntry(entry));
        }
        const entryMatch = req.method === "GET" && path.match(/^\/v1\/archive\/([0-9a-f]{64})$/);
        if (entryMatch) {
          const entry = await store.getArchiveEntry(access, entryMatch[1]);
          if (!entry) throw new PriorSealError("NOT_FOUND", "Archive entry not found");
          return respond(200, entry);
        }
        throw new PriorSealError("NOT_FOUND", "Archive route not found");
      }
      if (req.method === "GET" && path === "/v1/version") return respond(200, { service: "priorseal", version, protocol: ["priorseal.intent.v1", "priorseal.intent.v2", "priorseal.execution-profile.exact-call.v1", "priorseal.execution-profile.erc4337-user-operation.v1", "priorseal.execution-profile.solana-transaction.v2", "priorseal.context-commitment.v1", "priorseal.authorization.v1", "priorseal.authorization.v2", "priorseal.rfc3161-evidence.v1", "priorseal.witness-attestation.v1", "priorseal.execution-receipt.v1", "priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3", "priorseal.temporal-evidence.v1", "priorseal.compliance-assessment.v1", "priorseal.x402-payment-evidence.v1", "priorseal.verification-bundle.v1"], requestId });
      if (req.method === "GET" && path === "/openapi/v1.json") return respond(200, openApiSpec(), { "cache-control": "public, max-age=300" });
      if (req.method === "POST" && path === "/v1/jupiter/guarded-swaps/prepare") {
        if (!guardedJupiter) throw new PriorSealError("NOT_FOUND", "Guarded Jupiter preparation is not enabled on this deployment");
        assertOnlyFields(body, ["intentId", "inputMint", "outputMint", "amount", "taker", "slippageBps", "maxAccounts", "mode", "minimumOutputAmountAtomic", "sourceAssetId", "contextCommitments"], "guarded Jupiter preparation");
        const result = await guardedJupiter.prepare(body, { signal: deadline.signal });
        return respond(201, { ...result, requestId }, { "cache-control": "no-store" });
      }
      if (req.method === "POST" && path === "/v1/jupiter/guarded-swaps/submit") {
        if (!guardedJupiter) throw new PriorSealError("NOT_FOUND", "Guarded Jupiter submission is not enabled on this deployment");
        assertOnlyFields(body, ["prepared", "signedTransactionBase64"], "guarded Jupiter submission");
        if (!isRecord(body) || !isRecord(body.prepared) || typeof body.signedTransactionBase64 !== "string") throw new PriorSealError("INVALID_REQUEST", "Guarded Jupiter submission requires prepared and signedTransactionBase64");
        const result = await guardedJupiter.submit({ prepared: body.prepared, signedTransactionBase64: body.signedTransactionBase64 }, { signal: deadline.signal });
        return respond(200, { ...result, requestId }, { "cache-control": "no-store" });
      }
      if (req.method === "POST" && path === "/v1/intents") {
        const result = await createIntent({ input: body, idempotencyKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, store, policy, now });
        return respond(result.replay ? 200 : 201, { ...result.response, requestId }, result.replay ? { "idempotency-replayed": "true" } : {});
      }
      if (req.method === "POST" && path === "/v1/authorizations/prepare") {
        assertIssuableIntentInput(body?.intent);
        const preparedAt = Math.floor(now() / 1e3);
        const authorization = assertIssuableAuthorization(buildAuthorization({ ...body, audience: authorizationAudience, policyHash: policy ? `0x${hashJson(policy)}` : `0x${"0".repeat(64)}` }));
        if (authorization.schema !== AUTHORIZATION_SCHEMA) throw new PriorSealError("INVALID_AUTHORIZATION", "Legacy authorization schemas are verification-only");
        if (authorization.issuedAt > preparedAt) throw new PriorSealError("AUTHORIZATION_ISSUED_IN_FUTURE", "Authorization issuedAt cannot be in the future");
        if (preparedAt > authorization.expiresAt) throw new PriorSealError("AUTHORIZATION_EXPIRED", "Authorization has already expired");
        const compatibility = evaluateNewIntentPolicyCompatibility(authorization.intent, policy ?? {});
        if (!compatibility.allowed) throw new PriorSealError("POLICY_REJECTED", "Authorization policy cannot enforce descriptive exact-call semantics", compatibility);
        const policyResult = policy ? evaluateAuthorizationPolicy(authorization, policy, preparedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: preparedAt };
        if (!policyResult.allowed) throw new PriorSealError("POLICY_REJECTED", "Authorization rejected by policy before signing", policyResult);
        const typedData = jsonSafe(authorization.authorizer.type === "solana-ed25519" ? { profile: "solana-ed25519", message: solanaAuthorizationMessage(authorization) } : authorizationTypedData(authorization));
        return respond(200, { authorization, typedData, requestId });
      }
      if (req.method === "POST" && path === "/v1/authorizations") {
        const result = await authorizeIntent({ input: body, idempotencyKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, store, privateKeyPem, issuer, keyId, policy, audience: authorizationAudience, verifyContractSignature, timestampProvider, requireTimestamp, witnessProvider, requireWitnessQuorum, now });
        return respond(result.replay ? 200 : 201, { ...result.response, requestId }, result.replay ? { "idempotency-replayed": "true" } : {});
      }
      const authorizationMatch = req.method === "GET" && path.match(/^\/v1\/authorizations\/([^/]+)$/);
      if (authorizationMatch) {
        const record = await store.getAuthorization?.(decodeURIComponent(authorizationMatch[1]));
        if (!record) throw new PriorSealError("AUTHORIZATION_NOT_FOUND", "Authorization not found");
        return respond(200, record);
      }
      if (req.method === "POST" && path === "/v1/executions/observe") {
        const result = await observeExecution({ input: body, store, observer, signal: deadline.signal, privateKeyPem, issuer, keyId, publicKeyPem, idempotencyKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0, transparencyProvider, authorizationAudience, verifyContractSignature, now });
        const observationCycle = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : requestId;
        const response = result.response;
        let observationJob = null;
        if (observationWorker && ["PENDING", "NOT_FOUND", "RPC_ERROR", "RPC_TIMEOUT"].includes(response.observation.status)) {
          if (typeof body.txHash !== "string") throw new PriorSealError("INVALID_REQUEST", "Observation transaction hash is required");
          observationJob = await observationWorker.enqueuePersistent({ ...body, txHash: body.txHash, idempotencyKey: `observation:${hashJson(body)}:${observationCycle}` });
        }
        return respond(200, { ...response, ...observationJob ? { observationJob } : {}, requestId }, result.replay ? { "idempotency-replayed": "true" } : {});
      }
      const transparencyMatch = req.method === "GET" && path.match(/^\/v1\/authorizations\/([^/]+)\/transparency$/);
      if (transparencyMatch) {
        const record = await store.getAuthorization?.(decodeURIComponent(transparencyMatch[1]));
        if (!record) throw new PriorSealError("AUTHORIZATION_NOT_FOUND", "Authorization not found");
        if (!transparencyProvider) throw new PriorSealError("ISSUER_NOT_CONFIGURED", "Transparency checkpoint signing is unavailable");
        return respond(200, await transparencyProvider(record.acceptance));
      }
      const jobMatch = req.method === "GET" && path.match(/^\/v1\/observation-jobs\/([^/]+)$/);
      if (jobMatch && observationWorker) {
        const job = await observationWorker.get(decodeURIComponent(jobMatch[1]));
        if (!job) throw new PriorSealError("NOT_FOUND", "Observation job not found");
        return respond(200, job);
      }
      const bundleMatch = req.method === "GET" && path.match(/^\/v1\/receipts\/([^/]+)\/bundle$/);
      if (bundleMatch) {
        const receipt = await store.getReceipt(decodeURIComponent(bundleMatch[1]));
        if (!receipt) throw new PriorSealError("RECEIPT_NOT_FOUND", "Receipt not found");
        return respond(200, buildVerificationBundle({ receipt, keyRegistry: keyRegistryDocument(issuer, keyRegistry), assembledAt: Math.floor(now() / 1e3) }));
      }
      const match = req.method === "GET" && path.match(/^\/v1\/receipts\/([^/]+)$/);
      if (match) {
        const receipt = await store.getReceipt(decodeURIComponent(match[1]));
        if (!receipt) throw new PriorSealError("RECEIPT_NOT_FOUND", "Receipt not found");
        return respond(200, receipt);
      }
      if (req.method === "POST" && path === "/v1/receipts/verify") {
        assertOnlyFields(body, ["receipt"], "verification request");
        const receipt = body.receipt && typeof body.receipt === "object" && !Array.isArray(body.receipt) ? body.receipt : null;
        const entry = keyRegistry.get(typeof receipt?.keyId === "string" ? receipt.keyId : "");
        const verificationOptions = { key: entry, now: Math.floor(now() / 1e3) };
        const result = !entry ? { valid: false, code: "UNKNOWN_KEY" } : ["priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3"].includes(String(receipt?.schema)) ? await verifyAuthorizedReceipt(receipt, entry.publicKey, { ...verificationOptions, audience: authorizationAudience, verifyContractSignature }) : verifyReceipt(receipt, entry.publicKey, { ...verificationOptions, keyId: entry.keyId });
        return respond(200, { convenienceEndpoint: true, independentVerification: "Use the local verifier; do not trust this API response alone.", result, requestId });
      }
      if (req.method === "GET" && path === "/.well-known/priorseal-keys.json") return respond(200, { ...keyRegistryDocument(issuer, keyRegistry), requestId }, { "cache-control": "public, max-age=300" });
      throw new PriorSealError("NOT_FOUND", "Route not found");
    };
    let paymentContext;
    let paymentResourceUrl;
    const runDispatch = async () => {
      try {
        await deadline.run(dispatch);
      } catch (error) {
        const code = error instanceof PriorSealError ? error.code : errorCode(error) || "INTERNAL_ERROR";
        const status = ERROR_STATUS[code] ?? AGENT_ACCOUNT_ERROR_STATUS[code] ?? 500;
        if (code === "REQUEST_TIMEOUT") deadline.closeAfterResponse(res);
        logger?.error?.({ event: "http.request_failed", requestId, method: req.method, path, code, status });
        respond(status, errorBody(code, status === 500 ? "Internal server error" : errorMessage(error), requestId, status < 500 ? error instanceof PriorSealError ? error.details : void 0 : void 0));
      }
    };
    try {
      if (agentMeter && path !== "/mcp") {
        try {
          const credential = typeof req.headers["x-priorseal-agent-key"] === "string" ? req.headers["x-priorseal-agent-key"] : void 0;
          const requestKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : void 0;
          const metered = await agentMeter.authorize({ method: req.method, pathname: path, credential, requestKey, now: now() });
          meterReservation = metered?.reservation;
        } catch (error) {
          const code = errorCode(error) || "INTERNAL_ERROR";
          const status = ERROR_STATUS[code] ?? AGENT_ACCOUNT_ERROR_STATUS[code] ?? 500;
          logger?.error?.({ event: "agent_meter.authorization_failed", requestId, method: req.method, path, code, status });
          respond(status, errorBody(code, status === 500 ? "Internal server error" : errorMessage(error), requestId));
          return;
        }
      }
      if (paidRoute && x402Payments && x402) {
        let allowed;
        try {
          allowed = await rateLimiter.allow(requester(req, trustProxy), now());
        } catch {
          respond(503, errorBody("RATE_LIMITER_UNAVAILABLE", "Rate limiting is temporarily unavailable", requestId));
          return;
        }
        if (!allowed) {
          respond(429, errorBody("RATE_LIMITED", "Too many requests", requestId), { "retry-after": "60" });
          return;
        }
        let prepared;
        try {
          const requestUrl = new URL(req.url ?? path, x402.resourceOrigin);
          const resourceUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, x402.resourceOrigin).toString();
          paymentResourceUrl = resourceUrl;
          const rawPaymentHeader = req.headers["payment-signature"];
          prepared = await x402Payments.prepare(paidRoute, resourceUrl, typeof rawPaymentHeader === "string" ? rawPaymentHeader : rawPaymentHeader ? "invalid" : void 0, deadline.signal);
        } catch (error) {
          logger?.error?.({ event: "x402.facilitator_unavailable", requestId, method: req.method, path, code: errorCode(error) || "INTERNAL_ERROR", message: errorMessage(error) });
          respond(503, errorBody("PAYMENT_UNAVAILABLE", "Payment verification is temporarily unavailable", requestId));
          return;
        }
        if (prepared.kind !== "authorized") {
          if (prepared.kind === "invalid" && prepared.status === 400) {
            respond(400, errorBody("INVALID_PAYMENT", "The payment payload is malformed or does not match the advertised requirements", requestId));
            return;
          }
          respond(402, prepared.response, { "payment-required": prepared.header, "cache-control": "no-store" });
          return;
        }
        paymentContext = prepared.context;
        try {
          await store.appendX402PaymentLedgerEvent(buildX402PaymentLedgerEvent({ type: "PAYMENT_AUTHORIZED", context: paymentContext, resourceUrl: paymentResourceUrl, occurredAt: now() }));
        } catch (error) {
          logger?.error?.({ event: "x402.payment_ledger_unavailable", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
          respond(503, errorBody("PAYMENT_UNAVAILABLE", "Payment delivery records are temporarily unavailable", requestId));
          return;
        }
        captureResponse = true;
        await runDispatch();
        captureResponse = false;
        const completedResponse = capturedResponse;
        if (!completedResponse) {
          respond(500, errorBody("INTERNAL_ERROR", "Internal server error", requestId));
          return;
        }
        if (completedResponse.status < 200 || completedResponse.status >= 300) {
          try {
            await store.appendX402PaymentLedgerEvent(buildX402PaymentLedgerEvent({ type: "RESOURCE_WITHHELD", context: paymentContext, resourceUrl: paymentResourceUrl, occurredAt: now(), responseStatus: completedResponse.status, responseBody: completedResponse.body }));
          } catch (error) {
            logger?.error?.({ event: "x402.payment_ledger_write_failed", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
          }
          sendJson(res, completedResponse.status, completedResponse.body, requestId, completedResponse.headers);
          return;
        }
        try {
          const settlement = await x402Payments.settle(paymentContext, deadline.signal);
          if (!settlement.success) {
            try {
              await store.appendX402PaymentLedgerEvent(buildX402PaymentLedgerEvent({ type: "SETTLEMENT_FAILED", context: paymentContext, resourceUrl: paymentResourceUrl, occurredAt: now(), responseStatus: completedResponse.status, responseBody: completedResponse.body, settlement: settlement.settlement, settlementAttempts: settlement.attempts }));
            } catch (error) {
              logger?.error?.({ event: "x402.payment_ledger_write_failed", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
            }
            respond(402, errorBody("PAYMENT_FAILED", "Payment settlement failed", requestId), { "payment-response": settlement.header, "cache-control": "no-store" });
            return;
          }
          let paymentBoundBody = completedResponse.body;
          if (privateKeyPem && paymentResourceUrl) {
            try {
              paymentBoundBody = bindX402PaymentEvidenceToBundle({ body: completedResponse.body, resourceUrl: paymentResourceUrl, status: completedResponse.status, context: paymentContext, settlement: settlement.settlement, issuer, keyId, privateKeyPem, issuedAt: Math.floor(now() / 1e3) });
            } catch (error) {
              logger?.error?.({ event: "x402.payment_evidence_write_failed", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
            }
          }
          try {
            await store.appendX402PaymentLedgerEvent(buildX402PaymentLedgerEvent({ type: "DELIVERED", context: paymentContext, resourceUrl: paymentResourceUrl, occurredAt: now(), responseStatus: completedResponse.status, responseBody: paymentBoundBody, settlement: settlement.settlement, settlementAttempts: settlement.attempts, paymentEvidenceId: paymentEvidenceId(paymentBoundBody) }));
          } catch (error) {
            logger?.error?.({ event: "x402.payment_ledger_write_failed", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
          }
          sendJson(res, completedResponse.status, paymentBoundBody, requestId, {
            ...completedResponse.headers,
            "payment-response": settlement.header,
            "cache-control": "private, no-store"
          });
        } catch (error) {
          try {
            await store.appendX402PaymentLedgerEvent(buildX402PaymentLedgerEvent({ type: "SETTLEMENT_UNKNOWN", context: paymentContext, resourceUrl: paymentResourceUrl, occurredAt: now(), responseStatus: completedResponse.status, responseBody: completedResponse.body }));
          } catch (ledgerError) {
            logger?.error?.({ event: "x402.payment_ledger_write_failed", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(ledgerError) || "INTERNAL_ERROR" });
          }
          logger?.error?.({ event: "x402.settlement_unavailable", requestId, method: req.method, path, network: paymentContext.requirement.network, code: errorCode(error) || "INTERNAL_ERROR" });
          respond(503, errorBody("PAYMENT_UNAVAILABLE", "Payment settlement is temporarily unavailable", requestId));
        }
        return;
      }
      await runDispatch();
    } finally {
      if (meterReservation) {
        try {
          await agentMeter?.settle(meterReservation, meterOutcome ?? Boolean(meterResponseStatus && meterResponseStatus >= 200 && meterResponseStatus < 300) ? "CONSUMED" : "RELEASED");
        } catch (error) {
          logger?.error?.({ event: "agent_meter.settlement_failed", requestId, method: req.method, path, usageId: meterReservation.usageId, code: errorCode(error) || "INTERNAL_ERROR" });
        }
      }
      captureResponse = false;
      cleanup();
    }
  });
}
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}
function agentUsageLimit(value) {
  if (value === null) return 25;
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100) throw new PriorSealError("INVALID_REQUEST", "Agent usage limit must be an integer from 1 through 100");
  return Number(value);
}
function bindX402PaymentEvidenceToBundle({ body, resourceUrl, status, context, settlement, issuer, keyId, privateKeyPem, issuedAt }) {
  if (!isRecord(body) || body.schema !== "priorseal.verification-bundle.v1" || typeof body.bundleHash !== "string" || !/^[0-9a-f]{64}$/.test(body.bundleHash) || !isRecord(body.receipt) || !isRecord(body.keyRegistry) || !Number.isSafeInteger(body.assembledAt)) return body;
  const evidence = signX402PaymentEvidence(buildX402PaymentEvidence({
    paymentPayload: context.payload,
    requirement: context.requirement,
    settlement,
    service: { resourceUrl, responseStatus: status, responseHash: body.bundleHash },
    issuer,
    keyId,
    issuedAt
  }), privateKeyPem);
  return buildVerificationBundle({ receipt: body.receipt, keyRegistry: body.keyRegistry, assembledAt: body.assembledAt, paymentEvidence: evidence });
}
function paymentEvidenceId(body) {
  const value = isRecord(body) && isRecord(body.paymentEvidence) ? body.paymentEvidence.paymentEvidenceId : void 0;
  return typeof value === "string" && /^psp_[0-9a-f]{32}$/.test(value) ? value : void 0;
}
function keyRegistryDocument(issuer, keyRegistry) {
  return { schema: "priorseal.keys.v1", issuer, keys: keyRegistry.list(), verifierVersion: "3.0.0", schemaVersions: ["priorseal.intent.v1", "priorseal.intent.v2", "priorseal.execution-profile.exact-call.v1", "priorseal.execution-profile.erc4337-user-operation.v1", "priorseal.execution-profile.solana-transaction.v2", "priorseal.context-commitment.v1", "priorseal.authorization.v1", "priorseal.authorization.v2", "priorseal.rfc3161-evidence.v1", "priorseal.execution-receipt.v1", "priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3", "priorseal.temporal-evidence.v1", "priorseal.compliance-assessment.v1", "priorseal.x402-payment-evidence.v1", "priorseal.verification-bundle.v1"] };
}
const OPENAPI = { openapi: "3.1.0", info: { title: "PriorSeal API", version: "2.0.0", description: "Explicit, pre-execution authorization linked to observed EVM or Solana execution through independently verifiable receipts." }, paths: { "/v1/capabilities": { get: { summary: "Deployment configuration and workflow capabilities" } }, "/v1/archive": { get: { summary: "List private uploaded evidence with a project bearer credential" }, post: { summary: "Archive immutable evidence with a writer credential" } }, "/v1/archive/export": { get: { summary: "Export a private snapshot page including raw artifacts" } }, "/v1/archive/{entryId}": { get: { summary: "Read private project evidence" } }, "/v1/intents": { post: { summary: "Create a legacy unsigned intent draft", deprecated: true, responses: { "201": { description: "Created" } } } }, "/v1/authorizations/prepare": { post: { summary: "Canonicalize an authorization and return EIP-712 typed data or a Solana message" } }, "/v1/authorizations": { post: { summary: "Verify and accept a signed authorization" } }, "/v1/authorizations/{authorizationId}": { get: { summary: "Read authorization state" } }, "/v1/authorizations/{authorizationId}/transparency": { get: { summary: "Read signed transparency evidence and any verified external anchor" } }, "/v1/executions/observe": { post: { summary: "Observe EVM or Solana execution against an authorization" } }, "/v1/observation-jobs/{jobId}": { get: { summary: "Read automatic finality observation job" } }, "/v1/receipts/{receiptId}": { get: { summary: "Read receipt" } }, "/v1/receipts/{receiptId}/bundle": { get: { summary: "Export portable receipt evidence and key-discovery metadata" } }, "/v1/receipts/verify": { post: { summary: "Convenience verification, not authority" } }, "/.well-known/priorseal-keys.json": { get: { summary: "Read the issuer public-key registry" } }, "/v1/version": { get: { summary: "Read service and protocol versions" } }, "/health/live": { get: { summary: "Liveness" } }, "/health/ready": { get: { summary: "Readiness" } } } };
function openApiSpec() {
  return {
    ...OPENAPI,
    paths: {
      ...OPENAPI.paths,
      "/v1/jupiter/guarded-swaps/prepare": { post: { summary: "Prepare a policy-guarded Jupiter Router swap through the protected integration service" } },
      "/v1/jupiter/guarded-swaps/submit": { post: { summary: "Verify and relay wallet-signed bytes for a prepared guarded Jupiter swap" } }
    }
  };
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mcpInput(argumentsValue, context) {
  assertOnlyFields(argumentsValue, ["input"], `PriorSeal MCP ${context} arguments`);
  if (!isRecord(argumentsValue.input)) throw new PriorSealError("INVALID_REQUEST", `PriorSeal MCP ${context} requires an input object`);
  return argumentsValue.input;
}
function mcpIdentifier(argumentsValue, field, context) {
  assertOnlyFields(argumentsValue, [field], `PriorSeal MCP ${context} arguments`);
  const value = argumentsValue[field];
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new PriorSealError("INVALID_REQUEST", `PriorSeal MCP ${context} requires a valid ${field}`);
  return value;
}
function controlledExecutionWorkflow() {
  return {
    schema: "priorseal.controlled-execution-workflow.v1",
    state: "AWAITING_PRINCIPAL_SIGNATURE",
    mayBroadcastTransaction: false,
    steps: [
      { order: 1, action: "review_prepared_authorization", status: "COMPLETE", requiredActor: "agent_or_principal", safeguard: "Review the exact bounded intent, expiry, principal and executor before requesting a signature." },
      { order: 2, action: "request_principal_signature", status: "REQUIRED", requiredActor: "human_controlled_principal", safeguard: "Only the principal-controlled signer may produce the EIP-712 or Solana signature." },
      { order: 3, tool: "priorseal_accept_authorization", status: "REQUIRED", requiredActor: "agent", requiredHeaders: ["idempotency-key"], conditionalHeaders: { "x-priorseal-agent-key": "Required only when the deployment meters this route." }, safeguard: "Acceptance persists service evidence but never signs or broadcasts a transaction." },
      { order: 4, action: "submit_exact_authorized_action", status: "EXTERNAL", requiredActor: "separate_executor", safeguard: "Only submit the exact, still-valid action that matches the signed authorization. PriorSeal does not submit it." },
      { order: 5, tool: "priorseal_observe_execution", status: "REQUIRED", requiredActor: "agent", requiredHeaders: ["idempotency-key"], conditionalHeaders: { "x-priorseal-agent-key": "Required only when the deployment meters this route." }, safeguard: "Observation can persist a job or issue evidence, but never broadcasts a transaction." },
      { order: 6, tool: "priorseal_get_evidence_bundle", status: "REQUIRED", requiredActor: "agent_or_reviewer", safeguard: "Verify the exported evidence bundle using independently established issuer-key trust." }
    ]
  };
}
function mcpOriginAllowed(origin, corsOrigins) {
  return corsOrigins.includes(origin) || origin === "https://priorseal.xyz" || origin === "https://www.priorseal.xyz";
}
export {
  createHttpServer
};
