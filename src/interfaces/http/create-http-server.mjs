// Generated from create-http-server.mts by npm run core:build. Do not edit directly.
import { errorCode, errorMessage } from "../../shared/error-code.mjs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { verifyReceipt } from "../../domain/receipt-verifier.mjs";
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
import { createStaticAssetHandler } from "./static-assets.mjs";
import { buildVerificationBundle } from "../../domain/verification-bundle.mjs";
import { assertIssuableIntentInput } from "../../domain/intent.mjs";
import { evaluateAuthorizationPolicy, evaluateNewIntentPolicyCompatibility } from "../../domain/intent-policy.mjs";
import { assertEd25519KeyPair } from "../../domain/ed25519.mjs";
import { createArchiveAccess, archiveEntry, archiveQuery } from "../../application/archive/evidence-archive.mjs";
import { deploymentCapabilities } from "../../application/capabilities.mjs";
import { createRequestDeadline } from "./request-deadline.mjs";
const ERROR_STATUS = Object.freeze({ ARCHIVE_UNAUTHORIZED: 401, ARCHIVE_FORBIDDEN: 403, ARCHIVE_CONFLICT: 409, INVALID_JSON: 400, INVALID_REQUEST: 400, UNKNOWN_FIELD: 400, DANGEROUS_JSON_KEY: 400, JSON_TOO_DEEP: 400, INVALID_INTENT: 400, INVALID_AUTHORIZATION: 400, MISSING_AUTHORIZATION_SIGNATURE: 400, INVALID_AUTHORIZATION_SIGNATURE: 400, AUTHORIZATION_AUDIENCE_MISMATCH: 400, AUTHORIZATION_NOT_YET_VALID: 400, AUTHORIZATION_ISSUED_IN_FUTURE: 400, AUTHORIZATION_POLICY_MISMATCH: 409, AUTHORIZATION_EXPIRED: 410, AUTHORIZATION_ALREADY_USED: 409, AUTHORIZATION_NONCE_REUSED: 409, INVALID_TIMESTAMP_EVIDENCE: 400, INVALID_TIMESTAMP_PROFILE: 400, TIMESTAMP_POLICY_MISMATCH: 409, TIMESTAMP_AUTHORIZATION_MISMATCH: 409, TIMESTAMP_RESPONSE_HASH_MISMATCH: 409, TIMESTAMP_METADATA_MISMATCH: 409, INVALID_TIMESTAMP_POLICY: 400, TIMESTAMP_CLOCK_SKEW: 409, TIMESTAMP_AFTER_EXECUTION: 409, INVALID_TIMESTAMP_SIGNATURE: 409, INVALID_TIMESTAMP_CERTIFICATE_USAGE: 409, UNTRUSTED_TIMESTAMP_ROOT: 409, TIMESTAMP_SERVICE_UNAVAILABLE: 503, TIMESTAMP_NOT_CONFIGURED: 503, INVALID_TIMESTAMP_RESPONSE: 502, INVALID_WITNESS_POLICY: 400, INVALID_WITNESS_EVIDENCE: 400, WITNESS_POLICY_MISMATCH: 409, WITNESS_AUTHORIZATION_MISMATCH: 409, WITNESS_ACCEPTANCE_MISMATCH: 409, WITNESS_QUORUM_NOT_MET: 409, WITNESS_QUORUM_UNAVAILABLE: 503, WITNESS_NOT_CONFIGURED: 503, TRANSPARENCY_ANCHOR_REQUIRED: 409, TRANSPARENCY_AFTER_EXECUTION: 409, INVALID_CHAIN_ID: 400, INVALID_TX_HASH: 400, INVALID_ADDRESS: 400, INVALID_ASSET: 400, INVALID_UINT: 400, INVALID_TIME: 400, INVALID_IDENTIFIER: 400, INVALID_CONSTRAINT: 400, INVALID_IDEMPOTENCY_KEY: 400, UNSUPPORTED_MEDIA_TYPE: 415, REQUEST_TOO_LARGE: 413, IDEMPOTENCY_CONFLICT: 409, POLICY_REJECTED: 403, INTENT_NOT_FOUND: 404, AUTHORIZATION_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 404, NOT_FOUND: 404, REQUEST_TIMEOUT: 504, ISSUER_NOT_CONFIGURED: 503, AUTHORIZATION_VERIFIER_UNAVAILABLE: 503, RATE_LIMITER_UNAVAILABLE: 503, RPC_NOT_CONFIGURED: 503, RPC_TIMEOUT: 503, RPC_FAILURE: 503 });
function requester(req, trustProxy) {
  return trustProxy ? String(req.headers["cf-connecting-ip"] ?? "").trim() || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown" : req.socket.remoteAddress || "unknown";
}
function createHttpServer({ archiveCredentials = null, rpcChainIds, proofMode, store = createMemoryStore(), issuer = "priorseal-local", privateKeyPem, publicKeyPem, keyId = "default", keyRegistry = createKeyRegistry(publicKeyPem ? [{ issuer, keyId, algorithm: "Ed25519", publicKey: publicKeyPem, status: "active", validFrom: null, validUntil: null }] : []), policy = null, authorizationAudience = "priorseal", verifyContractSignature, timestampProvider = null, requireTimestamp = false, witnessProvider = null, requireWitnessQuorum = false, transparencyProvider = null, observationWorker = null, maxBodyBytes = 64 * 1024, rateLimit = 60, rateLimiter = createMemoryRateLimiter({ limit: rateLimit }), requestTimeoutMs = 15e3, observer = observeEvm, corsOrigins = [], trustProxy = false, version = process.env.PRIORSEAL_BUILD_VERSION ?? "dev", staticDir, logger = null, now = () => Date.now() } = {}) {
  if (privateKeyPem || publicKeyPem) {
    if (!privateKeyPem || !publicKeyPem) throw new TypeError("Issuer private and public keys must be configured together");
    assertEd25519KeyPair(privateKeyPem, publicKeyPem);
  }
  const archiveAccess = createArchiveAccess(archiveCredentials);
  const serveStaticAsset = staticDir ? createStaticAssetHandler(staticDir) : null;
  return createServer({ requestTimeout: requestTimeoutMs }, async (req, res) => {
    const requestId = typeof req.headers["x-request-id"] === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(req.headers["x-request-id"]) ? req.headers["x-request-id"] : randomUUID();
    const deadline = createRequestDeadline(req, requestTimeoutMs);
    const cleanup = () => deadline.cleanup();
    res.once("close", cleanup);
    res.once("finish", cleanup);
    const path = requestPath(req);
    const origin = req.headers.origin;
    const cors = origin && corsOrigins.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type,idempotency-key,x-request-id,authorization", "access-control-allow-methods": "GET,POST,OPTIONS" } : {};
    const respond = (status, body, headers = {}) => sendJson(res, status, body, requestId, { ...cors, ...path.startsWith("/v1/archive") ? { "cache-control": "private, no-store", vary: "Authorization, Origin" } : {}, ...headers });
    const dispatch = async () => {
      if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
      if (!["GET", "POST"].includes(req.method ?? "")) return respond(405, errorBody("METHOD_NOT_ALLOWED", "Method not allowed", requestId), { allow: "GET, POST, OPTIONS" });
      if (req.method === "GET" && path === "/health/live") return respond(200, { status: "ok", requestId });
      if (req.method === "GET" && path === "/health/ready") return respond(200, { status: "ready", storage: "health" in store ? await store.health() : "unknown", requestId });
      if (req.method === "GET" && serveStaticAsset && await serveStaticAsset({ pathname: path, req, res })) return;
      if (!await rateLimiter.allow(requester(req, trustProxy), now())) return respond(429, errorBody("RATE_LIMITED", "Too many requests", requestId), { "retry-after": "60" });
      const body = req.method === "POST" ? await readJsonBody(req, path === "/v1/archive" ? Math.max(maxBodyBytes, 1024 * 1024) : maxBodyBytes, deadline.signal) : {};
      if (req.method === "GET" && path === "/v1/capabilities") return respond(200, await deploymentCapabilities({ issuer, audience: authorizationAudience, keyConfigured: Boolean(privateKeyPem && publicKeyPem), policy, proofMode: proofMode ?? (requireTimestamp ? "rfc3161" : requireWitnessQuorum ? "witness-quorum" : "issuer"), timestampConfigured: Boolean(timestampProvider), witnessConfigured: Boolean(witnessProvider), anchorConfigured: Boolean(transparencyProvider), rpcChainIds, store, archiveEnabled: Boolean(archiveAccess), contractSignatureConfigured: typeof verifyContractSignature === "function", now: now() }), { "cache-control": "no-store" });
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
      if (req.method === "GET" && path === "/v1/version") return respond(200, { service: "priorseal", version, protocol: ["priorseal.intent.v1", "priorseal.intent.v2", "priorseal.execution-profile.exact-call.v1", "priorseal.context-commitment.v1", "priorseal.authorization.v1", "priorseal.authorization.v2", "priorseal.rfc3161-evidence.v1", "priorseal.witness-attestation.v1", "priorseal.execution-receipt.v1", "priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3", "priorseal.compliance-assessment.v1", "priorseal.verification-bundle.v1"], requestId });
      if (req.method === "GET" && path === "/openapi/v1.json") return respond(200, OPENAPI, { "cache-control": "public, max-age=300" });
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
        const typedData = jsonSafe(authorizationTypedData(authorization));
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
        const observationJob = observationWorker && ["PENDING", "NOT_FOUND", "RPC_ERROR", "RPC_TIMEOUT"].includes(response.observation.status) ? await observationWorker.enqueuePersistent({ ...body, idempotencyKey: `observation:${hashJson(body)}:${observationCycle}` }) : null;
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
        const entry = keyRegistry.get(body.receipt?.keyId);
        const result = !entry ? { valid: false, code: "UNKNOWN_KEY" } : ["priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3"].includes(body.receipt?.schema) ? await verifyAuthorizedReceipt(body.receipt, entry.publicKey, { audience: authorizationAudience, verifyContractSignature, key: entry, now: Math.floor(now() / 1e3) }) : verifyReceipt(body.receipt, entry.publicKey, { keyId: entry.keyId, now: Math.floor(now() / 1e3), key: entry });
        return respond(200, { convenienceEndpoint: true, independentVerification: "Use the local verifier; do not trust this API response alone.", result, requestId });
      }
      if (req.method === "GET" && path === "/.well-known/priorseal-keys.json") return respond(200, { ...keyRegistryDocument(issuer, keyRegistry), requestId }, { "cache-control": "public, max-age=300" });
      throw new PriorSealError("NOT_FOUND", "Route not found");
    };
    try {
      return await deadline.run(dispatch);
    } catch (error) {
      const code = error instanceof PriorSealError ? error.code : errorCode(error) || "INTERNAL_ERROR";
      const status = ERROR_STATUS[code] ?? 500;
      if (code === "REQUEST_TIMEOUT") deadline.closeAfterResponse(res);
      logger?.error?.({ event: "http.request_failed", requestId, method: req.method, path, code, status });
      return respond(status, errorBody(code, status === 500 ? "Internal server error" : errorMessage(error), requestId, status < 500 ? error instanceof PriorSealError ? error.details : void 0 : void 0));
    } finally {
      cleanup();
    }
  });
}
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}
function keyRegistryDocument(issuer, keyRegistry) {
  return { schema: "priorseal.keys.v1", issuer, keys: keyRegistry.list(), verifierVersion: "3.0.0", schemaVersions: ["priorseal.intent.v1", "priorseal.intent.v2", "priorseal.execution-profile.exact-call.v1", "priorseal.context-commitment.v1", "priorseal.authorization.v1", "priorseal.authorization.v2", "priorseal.rfc3161-evidence.v1", "priorseal.execution-receipt.v1", "priorseal.execution-receipt.v2", "priorseal.execution-receipt.v3", "priorseal.compliance-assessment.v1", "priorseal.verification-bundle.v1"] };
}
const OPENAPI = { openapi: "3.1.0", info: { title: "PriorSeal API", version: "2.0.0", description: "Signed authorization and independently verifiable execution evidence." }, paths: { "/v1/capabilities": { get: { summary: "Deployment configuration and workflow capabilities" } }, "/v1/archive": { get: { summary: "List private uploaded evidence with a project bearer credential" }, post: { summary: "Archive immutable evidence with a writer credential" } }, "/v1/archive/export": { get: { summary: "Export a private snapshot page including raw artifacts" } }, "/v1/archive/{entryId}": { get: { summary: "Read private project evidence" } }, "/v1/intents": { post: { summary: "Create a legacy unsigned intent draft", deprecated: true, responses: { "201": { description: "Created" } } } }, "/v1/authorizations/prepare": { post: { summary: "Canonicalize an authorization and return EIP-712 typed data" } }, "/v1/authorizations": { post: { summary: "Verify and accept a signed authorization" } }, "/v1/authorizations/{authorizationId}": { get: { summary: "Read authorization state" } }, "/v1/authorizations/{authorizationId}/transparency": { get: { summary: "Read signed transparency evidence and any verified external anchor" } }, "/v1/executions/observe": { post: { summary: "Observe EVM execution against an authorization" } }, "/v1/observation-jobs/{jobId}": { get: { summary: "Read automatic finality observation job" } }, "/v1/receipts/{receiptId}": { get: { summary: "Read receipt" } }, "/v1/receipts/{receiptId}/bundle": { get: { summary: "Export portable receipt evidence and key-discovery metadata" } }, "/v1/receipts/verify": { post: { summary: "Convenience verification, not authority" } }, "/.well-known/priorseal-keys.json": { get: { summary: "Read the issuer public-key registry" } }, "/v1/version": { get: { summary: "Read service and protocol versions" } }, "/health/live": { get: { summary: "Liveness" } }, "/health/ready": { get: { summary: "Readiness" } } } };
export {
  createHttpServer
};
