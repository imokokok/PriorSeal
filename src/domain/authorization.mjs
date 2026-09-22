// Generated from authorization.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../shared/error-code.mjs";
import { encodeFunctionData, hashTypedData, verifyTypedData } from "viem";
import { bindIntentExecution } from "./binding.mjs";
import { PriorSealError } from "./errors.mjs";
import { hashJson, canonicalize } from "./hashing.mjs";
import { buildIntent } from "./intent.mjs";
import { classifyOutcome } from "./outcome.mjs";
import { evaluateAuthorizationPolicy } from "./intent-policy.mjs";
import { assertOnlyFields, assertSafeJson } from "../shared/safe-json.mjs";
import { evmAddress, protocolId, uintString, unixSeconds } from "./values.mjs";
import { verifyTransparencyEvidence } from "./transparency.mjs";
import { verifyWitnessEvidence } from "./witness.mjs";
import { validateTimestampEvidenceClaims, verifyTimestampEvidence } from "./rfc3161.mjs";
import { assessCompliance, classifyExecutionOutcome } from "./compliance.mjs";
import { signEd25519Statement, verifyEd25519Statement as verifyEd25519StatementStrict } from "./ed25519.mjs";
const LEGACY_AUTHORIZATION_SCHEMA = "priorseal.authorization.v1";
const AUTHORIZATION_SCHEMA = "priorseal.authorization.v2";
const AUTHORIZATION_RECEIPT_SCHEMA = "priorseal.authorization-receipt.v1";
const AUTHORIZATION_DOMAIN = "priorseal/authorization/v2";
const LEGACY_AUTHORIZED_RECEIPT_SCHEMA = "priorseal.execution-receipt.v2";
const AUTHORIZED_RECEIPT_SCHEMA = "priorseal.execution-receipt.v3";
const AUTHORIZED_RECEIPT_FIELDS = ["schema", "domain", "receiptId", "intentHash", "authorizationHash", "executionHash", "authorizationEvidence", "execution", "executionStatus", "compliance", "issuer", "issuedAt", "validUntil", "outcome", "reasonCodes", "binding", "algorithm", "keyId", "verifierVersion", "signature"];
const AUTHORIZATION_EVIDENCE_FIELDS = ["authorization", "acceptance", "policy", "timestamp", "witnesses", "transparency"];
const LEGACY_AUTHORIZATION_TYPES = Object.freeze({
  PriorSealAuthorization: [
    { name: "intentHash", type: "bytes32" },
    { name: "principalId", type: "string" },
    { name: "principalAccount", type: "address" },
    { name: "authorizer", type: "address" },
    { name: "executor", type: "address" },
    { name: "issuedAt", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "authorizationNonce", type: "bytes32" },
    { name: "maxUses", type: "uint256" },
    { name: "audience", type: "string" },
    { name: "policyHash", type: "bytes32" }
  ]
});
const AUTHORIZATION_TYPES = Object.freeze({
  PriorSealAuthorization: [
    { name: "intentHash", type: "bytes32" },
    { name: "principalType", type: "string" },
    { name: "principalId", type: "string" },
    { name: "principalAccount", type: "address" },
    { name: "authorizerType", type: "string" },
    { name: "authorizer", type: "address" },
    { name: "agentId", type: "string" },
    { name: "executor", type: "address" },
    { name: "issuedAt", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "authorizationNonce", type: "bytes32" },
    { name: "maxUses", type: "uint256" },
    { name: "audience", type: "string" },
    { name: "policyHash", type: "bytes32" }
  ]
});
function buildAuthorization(inputValue) {
  assertSafeJson(inputValue);
  const input = assertOnlyFields(inputValue, ["schema", "domain", "authorizationId", "intent", "intentHash", "principal", "authorizer", "delegate", "issuedAt", "notBefore", "expiresAt", "authorizationNonce", "maxUses", "audience", "policyHash", "signature"], "authorization");
  const principal = assertOnlyFields(input.principal, ["type", "id", "account"], "authorization.principal");
  const authorizer = assertOnlyFields(input.authorizer, ["type", "address"], "authorization.authorizer");
  const delegate = assertOnlyFields(input.delegate, ["agentId", "executor"], "authorization.delegate");
  if (!principal.id || !delegate.agentId) throw new PriorSealError("INVALID_AUTHORIZATION", "principal.id and delegate.agentId are required");
  const intent = buildIntent(stripIntentMetadata(input.intent));
  if (input.intentHash && input.intentHash !== intent.intentHash) throw new PriorSealError("INVALID_AUTHORIZATION", "intentHash does not match intent");
  const authorizerType = String(authorizer.type ?? "");
  if (!["eip712", "eip1271"].includes(authorizerType)) throw new PriorSealError("INVALID_AUTHORIZATION", "authorizer.type must be eip712 or eip1271");
  const principalType = String(principal.type ?? "");
  if (!["user", "organization"].includes(principalType)) throw new PriorSealError("INVALID_AUTHORIZATION", "principal.type must be user or organization");
  const issuedAt = unixSeconds(input.issuedAt, "issuedAt");
  const notBefore = unixSeconds(input.notBefore ?? input.issuedAt, "notBefore");
  const expiresAt = unixSeconds(input.expiresAt ?? intent.validUntil, "expiresAt");
  if (notBefore < issuedAt || expiresAt < notBefore || expiresAt > intent.validUntil) throw new PriorSealError("INVALID_AUTHORIZATION", "authorization time window must be ordered and cannot exceed the intent validity");
  const authorizationNonce = String(input.authorizationNonce ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(authorizationNonce)) throw new PriorSealError("INVALID_AUTHORIZATION", "authorizationNonce must be a 32-byte hex value");
  const policyHash = String(input.policyHash ?? `0x${"0".repeat(64)}`).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(policyHash)) throw new PriorSealError("INVALID_AUTHORIZATION", "policyHash must be a 32-byte hex value");
  const maxUses = uintString(input.maxUses ?? "1", "maxUses");
  if (maxUses !== "1") throw new PriorSealError("INVALID_AUTHORIZATION", "authorizations are single-use and maxUses must be 1");
  const schema = input.schema ?? AUTHORIZATION_SCHEMA;
  if (schema !== AUTHORIZATION_SCHEMA && schema !== LEGACY_AUTHORIZATION_SCHEMA) throw new PriorSealError("INVALID_AUTHORIZATION", "authorization schema is not supported");
  const domain = schema === LEGACY_AUTHORIZATION_SCHEMA ? "priorseal/authorization/v1" : AUTHORIZATION_DOMAIN;
  if (input.domain && input.domain !== domain) throw new PriorSealError("INVALID_AUTHORIZATION", "authorization domain does not match schema");
  const authorization = {
    schema,
    domain,
    intent,
    intentHash: intent.intentHash,
    principal: { type: principalType, id: protocolId(principal.id, "principal.id"), account: evmAddress(principal.account, "principal.account") },
    authorizer: { type: authorizerType, address: evmAddress(authorizer.address, "authorizer.address") },
    delegate: { agentId: protocolId(delegate.agentId, "delegate.agentId"), executor: evmAddress(delegate.executor, "delegate.executor") },
    issuedAt,
    notBefore,
    expiresAt,
    authorizationNonce,
    maxUses,
    audience: protocolId(input.audience ?? "priorseal", "audience"),
    policyHash,
    ...input.signature ? { signature: String(input.signature) } : {}
  };
  if (authorization.principal.account !== authorization.authorizer.address) throw new PriorSealError("INVALID_AUTHORIZATION", "principal.account must be the signing account");
  const { signature, ...unsigned } = authorization;
  const authorizationId = `auth_${hashJson(unsigned).slice(0, 32)}`;
  if (input.authorizationId && input.authorizationId !== authorizationId) throw new PriorSealError("INVALID_AUTHORIZATION", "authorizationId does not match authorization");
  return { ...authorization, authorizationId };
}
function authorizationTypedData(value) {
  const authorization = [AUTHORIZATION_SCHEMA, LEGACY_AUTHORIZATION_SCHEMA].includes(value.schema) ? value : buildAuthorization(value);
  const legacy = authorization.schema === LEGACY_AUTHORIZATION_SCHEMA;
  return {
    domain: { name: "PriorSeal", version: legacy ? "1" : "2", chainId: authorization.intent.chainId },
    types: legacy ? LEGACY_AUTHORIZATION_TYPES : AUTHORIZATION_TYPES,
    primaryType: "PriorSealAuthorization",
    message: {
      intentHash: `0x${authorization.intentHash}`,
      ...!legacy ? { principalType: authorization.principal.type } : {},
      principalId: authorization.principal.id,
      principalAccount: authorization.principal.account,
      ...!legacy ? { authorizerType: authorization.authorizer.type } : {},
      authorizer: authorization.authorizer.address,
      ...!legacy ? { agentId: authorization.delegate.agentId } : {},
      executor: authorization.delegate.executor,
      issuedAt: BigInt(authorization.issuedAt),
      notBefore: BigInt(authorization.notBefore),
      expiresAt: BigInt(authorization.expiresAt),
      authorizationNonce: authorization.authorizationNonce,
      maxUses: BigInt(authorization.maxUses),
      audience: authorization.audience,
      policyHash: authorization.policyHash
    }
  };
}
async function verifyAuthorization(value, { now = Math.floor(Date.now() / 1e3), audience = "priorseal", verifyContractSignature } = {}) {
  let authorization;
  try {
    authorization = buildAuthorization(value);
  } catch (error) {
    return invalid(errorCode(error) ?? "INVALID_AUTHORIZATION");
  }
  if (!authorization.signature) return invalid("MISSING_AUTHORIZATION_SIGNATURE");
  if (authorization.audience !== audience) return invalid("AUTHORIZATION_AUDIENCE_MISMATCH");
  if (authorization.issuedAt > now) return invalid("AUTHORIZATION_ISSUED_IN_FUTURE");
  if (now < authorization.notBefore) return invalid("AUTHORIZATION_NOT_YET_VALID");
  if (now > authorization.expiresAt) return invalid("AUTHORIZATION_EXPIRED");
  const typedData = authorizationTypedData(authorization);
  try {
    const valid = authorization.authorizer.type === "eip1271" ? Boolean(verifyContractSignature && await verifyContractSignature({ authorization, digest: hashTypedData(typedData), signature: authorization.signature })) : await verifyTypedData({ ...typedData, address: authorization.authorizer.address, signature: authorization.signature });
    return valid ? { valid: true, code: "OK", authorization } : invalid(authorization.authorizer.type === "eip1271" && !verifyContractSignature ? "AUTHORIZATION_VERIFIER_UNAVAILABLE" : "INVALID_AUTHORIZATION_SIGNATURE");
  } catch (error) {
    return invalid(errorCode(error) === "AUTHORIZATION_VERIFIER_UNAVAILABLE" ? "AUTHORIZATION_VERIFIER_UNAVAILABLE" : "INVALID_AUTHORIZATION_SIGNATURE");
  }
}
function assertIssuableAuthorization(authorization) {
  if (authorization.delegate.executor !== authorization.intent.sender) throw new PriorSealError("INVALID_AUTHORIZATION", "delegate.executor must match intent.sender for new authorizations");
  return authorization;
}
function erc1271CallData(digest, signature) {
  return encodeFunctionData({ abi: [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ name: "magicValue", type: "bytes4" }] }], functionName: "isValidSignature", args: [digest, signature] });
}
function buildAuthorizationReceipt({ authorization, issuer, keyId = "default", acceptedAt, sequence = 1, previousEntryHash = null }) {
  const authorizationHash = hashJson(authorization);
  const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
  return { schema: AUTHORIZATION_RECEIPT_SCHEMA, domain: "priorseal/authorization-receipt/v1", authorizationId: authorization.authorizationId, authorizationHash, intentHash: authorization.intentHash, acceptedAt, sequence, previousEntryHash, entryHash, status: "ACCEPTED", issuer, algorithm: "Ed25519", keyId };
}
function signAuthorizationReceipt(receipt, privateKeyPem) {
  return signEd25519Statement(receipt, privateKeyPem);
}
function verifyAuthorizationReceipt(receiptValue, publicKeyPem) {
  let receipt;
  try {
    assertSafeJson(receiptValue);
    receipt = assertOnlyFields(receiptValue, ["schema", "domain", "authorizationId", "authorizationHash", "intentHash", "acceptedAt", "sequence", "previousEntryHash", "entryHash", "status", "issuer", "algorithm", "keyId", "signature"], "authorization receipt");
  } catch {
    return false;
  }
  if (!receipt?.signature || receipt.schema !== AUTHORIZATION_RECEIPT_SCHEMA || receipt.domain !== "priorseal/authorization-receipt/v1" || receipt.status !== "ACCEPTED" || receipt.algorithm !== "Ed25519") return false;
  if (receipt.entryHash !== hashJson({ sequence: receipt.sequence, authorizationHash: receipt.authorizationHash, acceptedAt: receipt.acceptedAt, previousEntryHash: receipt.previousEntryHash })) return false;
  return verifyEd25519Statement(receipt, publicKeyPem);
}
function buildAuthorizedReceipt({ authorization, acceptance, policyEvidence = null, timestampEvidence = null, witnessEvidence = null, transparency = null, execution, issuer, keyId = "default", issuedAt = Math.floor(Date.now() / 1e3), verifierVersion, schema = AUTHORIZED_RECEIPT_SCHEMA }) {
  if (![AUTHORIZED_RECEIPT_SCHEMA, LEGACY_AUTHORIZED_RECEIPT_SCHEMA].includes(schema)) throw new PriorSealError("UNSUPPORTED_SCHEMA", "Authorized receipt schema is not supported");
  const intent = authorization.intent;
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw new PriorSealError("INVALID_RECEIPT_TIMELINE", "Receipt issuedAt must be a positive Unix timestamp");
  const observedAt = execution?.observedAt ?? execution?.executedAt;
  if (observedAt != null && (!Number.isSafeInteger(observedAt) || issuedAt < observedAt)) throw new PriorSealError("INVALID_RECEIPT_TIMELINE", "Receipt cannot be issued before the execution observation");
  const evidencePolicy = policyEvidence ?? defaultPolicyEvidence(authorization, acceptance.acceptedAt);
  validatePolicyEvidence(authorization, evidencePolicy, acceptance.acceptedAt);
  const baseBinding = bindIntentExecution(intent, execution, issuedAt);
  const executorMismatch = execution.sender?.toLowerCase() !== authorization.delegate.executor;
  const executedAt = execution.executedAt ?? execution.observedAt ?? 0;
  const anchoredAt = transparency?.checkpoint?.anchor?.anchoredAt;
  if (anchoredAt !== void 0 && anchoredAt > executedAt) throw new PriorSealError("TRANSPARENCY_AFTER_EXECUTION", "Transparency anchor must precede execution");
  const timestampPolicy = evidencePolicy.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = validateTimestampEvidenceClaims(timestampEvidence, timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: acceptance.acceptedAt, before: executedAt });
    if (!timestamped.valid) throw new PriorSealError(timestamped.code, "Valid pre-execution RFC 3161 evidence is required", timestamped);
  } else if (timestampEvidence) throw new PriorSealError("TIMESTAMP_POLICY_MISMATCH", "Timestamp evidence is not bound by the signed authorization policy");
  const witnessPolicy = evidencePolicy.document?.witnessQuorum;
  if (witnessPolicy) {
    const witnessed = verifyWitnessEvidence(witnessEvidence, authorization, witnessPolicy, { expectedRequestedAt: acceptance.acceptedAt, before: executedAt });
    if (!witnessed.valid) throw new PriorSealError(witnessed.code, "A valid pre-execution witness quorum is required", witnessed);
  } else if (witnessEvidence) throw new PriorSealError("WITNESS_POLICY_MISMATCH", "Witness evidence is not bound by the signed authorization policy");
  const authorizationAfterExecution = acceptance.acceptedAt > executedAt;
  const outsideAuthorizationWindow = executedAt < authorization.notBefore || executedAt > authorization.expiresAt;
  const binding = { bound: baseBinding.bound && !executorMismatch && !authorizationAfterExecution && !outsideAuthorizationWindow, reasonCodes: [.../* @__PURE__ */ new Set([...baseBinding.reasonCodes, ...executorMismatch ? ["EXECUTOR_MISMATCH"] : [], ...authorizationAfterExecution ? ["AUTHORIZATION_AFTER_EXECUTION"] : [], ...outsideAuthorizationWindow ? ["OUTSIDE_AUTHORIZATION_WINDOW"] : []])] };
  const executionHash = hashJson(execution);
  const authorizationHash = hashJson(authorization);
  const legacy = schema === LEGACY_AUTHORIZED_RECEIPT_SCHEMA;
  const outcome = legacy ? executorMismatch || authorizationAfterExecution || outsideAuthorizationWindow ? "UNDETERMINED" : classifyOutcome(intent, execution) : classifyExecutionOutcome(execution);
  const reasonCodes = binding.reasonCodes;
  const compliance = legacy ? null : assessCompliance({ authorization, execution, binding });
  const unsigned = { schema, domain: legacy ? "priorseal/execution-receipt/v2" : "priorseal/execution-receipt/v3", receiptId: "", intentHash: intent.intentHash, authorizationHash, executionHash, authorizationEvidence: { authorization, acceptance, policy: evidencePolicy, ...timestampEvidence ? { timestamp: timestampEvidence } : {}, ...witnessEvidence ? { witnesses: witnessEvidence } : {}, ...transparency ? { transparency } : {} }, execution, ...!legacy ? { executionStatus: execution.status, compliance } : {}, issuer, issuedAt, validUntil: intent.validUntil, outcome, reasonCodes, binding, algorithm: "Ed25519", keyId, verifierVersion: verifierVersion ?? (legacy ? "2.4.0" : "3.0.0") };
  unsigned.receiptId = authorizedReceiptId(unsigned);
  return unsigned;
}
function authorizedReceiptId(receipt) {
  const identity = { authorizationHash: receipt.authorizationHash, executionHash: receipt.executionHash, issuer: receipt.issuer, keyId: receipt.keyId };
  return `psr_${hashJson(receipt.schema === AUTHORIZED_RECEIPT_SCHEMA ? { schema: receipt.schema, ...identity } : identity).slice(0, 32)}`;
}
function validateAuthorizedReceiptClaims(receiptValue) {
  const receipt = receiptValue;
  try {
    if (!receipt || receipt.schema !== AUTHORIZED_RECEIPT_SCHEMA && receipt.schema !== LEGACY_AUTHORIZED_RECEIPT_SCHEMA) return invalid("UNSUPPORTED_SCHEMA");
    assertOnlyFields(receipt, AUTHORIZED_RECEIPT_FIELDS, "authorized receipt");
    assertOnlyFields(receipt.authorizationEvidence, AUTHORIZATION_EVIDENCE_FIELDS, "authorization evidence");
    const legacy = receipt.schema === LEGACY_AUTHORIZED_RECEIPT_SCHEMA;
    if (legacy && (receipt.executionStatus !== void 0 || receipt.compliance !== void 0)) return invalid("INVALID_RECEIPT");
    if (receipt.domain !== (legacy ? "priorseal/execution-receipt/v2" : "priorseal/execution-receipt/v3")) return invalid("INVALID_DOMAIN");
    const authorization = buildAuthorization(receipt.authorizationEvidence?.authorization);
    const acceptance = receipt.authorizationEvidence?.acceptance;
    if (!acceptance || acceptance.authorizationId !== authorization.authorizationId) return invalid("AUTHORIZATION_RECEIPT_MISMATCH");
    if (receipt.authorizationHash !== hashJson(authorization) || acceptance.authorizationHash !== receipt.authorizationHash) return invalid("AUTHORIZATION_HASH_MISMATCH");
    validatePolicyEvidence(authorization, receipt.authorizationEvidence?.policy, acceptance.acceptedAt);
    const timestampPolicy = receipt.authorizationEvidence?.policy?.document?.timestampPolicy;
    if (timestampPolicy) {
      const executedAt2 = receipt.execution?.executedAt ?? receipt.execution?.observedAt ?? 0;
      const timestamped = validateTimestampEvidenceClaims(receipt.authorizationEvidence?.timestamp, timestampPolicy, { authorizationHash: hashJson(authorization), requestedAt: acceptance.acceptedAt, before: executedAt2 });
      if (!timestamped.valid) return invalid(timestamped.code);
    } else if (receipt.authorizationEvidence?.timestamp) return invalid("TIMESTAMP_POLICY_MISMATCH");
    const witnessPolicy = receipt.authorizationEvidence?.policy?.document?.witnessQuorum;
    if (witnessPolicy) {
      const executedAt2 = receipt.execution?.executedAt ?? receipt.execution?.observedAt ?? 0;
      const witnessed = verifyWitnessEvidence(receipt.authorizationEvidence?.witnesses, authorization, witnessPolicy, { expectedRequestedAt: acceptance.acceptedAt, before: executedAt2 });
      if (!witnessed.valid) return invalid(witnessed.code);
    } else if (receipt.authorizationEvidence?.witnesses) return invalid("WITNESS_POLICY_MISMATCH");
    if (receipt.intentHash !== authorization.intentHash || authorization.intentHash !== hashJson(stripIntentHash(authorization.intent))) return invalid("INTENT_HASH_MISMATCH");
    if (receipt.validUntil !== authorization.intent.validUntil) return invalid("VALID_UNTIL_MISMATCH");
    if (!Number.isSafeInteger(receipt.issuedAt) || receipt.issuedAt <= 0) return invalid("INVALID_RECEIPT_TIMELINE");
    const observedAt = receipt.execution?.observedAt ?? receipt.execution?.executedAt;
    if (observedAt != null && (!Number.isSafeInteger(observedAt) || receipt.issuedAt < observedAt)) return invalid("INVALID_RECEIPT_TIMELINE");
    if (receipt.executionHash !== hashJson(receipt.execution)) return invalid("EXECUTION_HASH_MISMATCH");
    if (receipt.receiptId !== authorizedReceiptId(receipt)) return invalid("RECEIPT_ID_MISMATCH");
    const baseBinding = bindIntentExecution(authorization.intent, receipt.execution, receipt.issuedAt);
    const executorMismatch = receipt.execution.sender?.toLowerCase() !== authorization.delegate.executor;
    const executedAt = receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0;
    const authorizationAfterExecution = acceptance.acceptedAt > executedAt;
    const outsideAuthorizationWindow = executedAt < authorization.notBefore || executedAt > authorization.expiresAt;
    const binding = { bound: baseBinding.bound && !executorMismatch && !authorizationAfterExecution && !outsideAuthorizationWindow, reasonCodes: [.../* @__PURE__ */ new Set([...baseBinding.reasonCodes, ...executorMismatch ? ["EXECUTOR_MISMATCH"] : [], ...authorizationAfterExecution ? ["AUTHORIZATION_AFTER_EXECUTION"] : [], ...outsideAuthorizationWindow ? ["OUTSIDE_AUTHORIZATION_WINDOW"] : []])] };
    if (hashJson(binding) !== hashJson(receipt.binding)) return invalid("BINDING_MISMATCH");
    if (hashJson(binding.reasonCodes) !== hashJson(receipt.reasonCodes)) return invalid("REASON_CODES_MISMATCH");
    const expectedOutcome = legacy ? executorMismatch || authorizationAfterExecution || outsideAuthorizationWindow ? "UNDETERMINED" : classifyOutcome(authorization.intent, receipt.execution) : classifyExecutionOutcome(receipt.execution);
    if (expectedOutcome !== receipt.outcome) return invalid("OUTCOME_MISMATCH");
    if (!legacy) {
      if (receipt.executionStatus !== receipt.execution.status) return invalid("EXECUTION_STATUS_MISMATCH");
      const compliance = assessCompliance({ authorization, execution: receipt.execution, binding });
      if (hashJson(compliance) !== hashJson(receipt.compliance)) return invalid("COMPLIANCE_MISMATCH");
    }
    return { valid: true, code: "OK", authorization };
  } catch (error) {
    return invalid(errorCode(error) ?? "INVALID_RECEIPT");
  }
}
async function verifyAuthorizedReceipt(receiptValue, publicKeyPem, options = {}) {
  const receipt = receiptValue;
  const resultFields = () => ({ outcome: receipt?.outcome, executionStatus: receipt?.executionStatus ?? receipt?.execution?.status, complianceStatus: receipt?.compliance?.status, receiptId: receipt?.receiptId });
  const fail = (code) => ({ valid: false, code, ...resultFields() });
  try {
    assertSafeJson(receipt);
  } catch {
    return fail("INVALID_RECEIPT");
  }
  if (!receipt?.signature) return fail("MISSING_SIGNATURE");
  if (receipt.algorithm !== "Ed25519") return fail("UNSUPPORTED_ALGORITHM");
  const key = options.key;
  if (key && (key.keyId !== receipt.keyId || key.algorithm !== "Ed25519" || !["active", "retired"].includes(key.status ?? "") || key.issuer !== receipt.issuer || !validKeyWindow(key))) return fail(key.keyId !== receipt.keyId ? "UNKNOWN_KEY" : "INVALID_KEY");
  if (!verifyEd25519Statement(receipt, publicKeyPem)) return fail("INVALID_SIGNATURE");
  const claims = validateAuthorizedReceiptClaims(receipt);
  if (!claims.valid) return fail(claims.code);
  const acceptance = receipt.authorizationEvidence.acceptance;
  if (acceptance.domain !== "priorseal/authorization-receipt/v1" || acceptance.status !== "ACCEPTED" || acceptance.algorithm !== "Ed25519" || acceptance.intentHash !== claims.authorization.intentHash) return fail("INVALID_AUTHORIZATION_RECEIPT");
  if (acceptance.acceptedAt < claims.authorization.notBefore || acceptance.acceptedAt > claims.authorization.expiresAt || claims.authorization.issuedAt > acceptance.acceptedAt || receipt.issuedAt < acceptance.acceptedAt) return fail("INVALID_AUTHORIZATION_RECEIPT");
  if (key?.validFrom != null && (acceptance.acceptedAt < key.validFrom || receipt.issuedAt < key.validFrom)) return fail("KEY_NOT_YET_VALID");
  if (key?.validUntil != null && (acceptance.acceptedAt > key.validUntil || receipt.issuedAt > key.validUntil)) return fail("KEY_EXPIRED");
  if (options.now !== void 0 && receipt.issuedAt > options.now) return fail("NOT_YET_VALID");
  if (acceptance.issuer !== receipt.issuer || acceptance.keyId !== receipt.keyId || !verifyAuthorizationReceipt(acceptance, publicKeyPem)) return fail("INVALID_AUTHORIZATION_RECEIPT");
  const timestampPolicy = receipt.authorizationEvidence.policy?.document?.timestampPolicy;
  if (timestampPolicy) {
    const timestamped = await verifyTimestampEvidence(receipt.authorizationEvidence.timestamp, new TextEncoder().encode(canonicalize(claims.authorization)), timestampPolicy, { authorizationHash: receipt.authorizationHash, requestedAt: acceptance.acceptedAt, before: receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0 });
    if (!timestamped.valid) return fail(timestamped.code);
  }
  if (receipt.authorizationEvidence.transparency && !verifyTransparencyEvidence(receipt.authorizationEvidence.transparency, acceptance, publicKeyPem, { before: receipt.execution.executedAt ?? receipt.execution.observedAt ?? 0 })) return fail("INVALID_TRANSPARENCY_PROOF");
  const authorizationResult = await verifyAuthorization(claims.authorization, { now: acceptance.acceptedAt, audience: options.audience ?? "priorseal", verifyContractSignature: options.verifyContractSignature });
  if (!authorizationResult.valid) return fail(authorizationResult.code);
  return { valid: true, code: "OK", ...resultFields(), authorizationId: claims.authorization.authorizationId };
}
function verifyEd25519Statement(statement, publicKeyPem) {
  return verifyEd25519StatementStrict(statement, publicKeyPem);
}
function validKeyWindow(key) {
  for (const field of ["validFrom", "validUntil"]) if (key[field] != null && (!Number.isSafeInteger(key[field]) || key[field] <= 0)) return false;
  return key.validFrom == null || key.validUntil == null || key.validFrom <= key.validUntil;
}
function stripIntentHash(intent) {
  const { intentHash, ...unsigned } = intent;
  return unsigned;
}
function stripIntentMetadata(intent) {
  const { intentHash, ...input } = intent && typeof intent === "object" ? intent : {};
  return input;
}
function defaultPolicyEvidence(authorization, evaluatedAt) {
  if (authorization.policyHash !== `0x${"0".repeat(64)}`) throw new PriorSealError("MISSING_POLICY_EVIDENCE", "A non-default policy must be embedded in an authorized receipt");
  return { schema: "priorseal.policy-evidence.v1", policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt } };
}
function validatePolicyEvidence(authorization, evidence, evaluatedAt) {
  if (!evidence || evidence.schema !== "priorseal.policy-evidence.v1") throw new PriorSealError("INVALID_POLICY_EVIDENCE", "Policy evidence is missing or malformed");
  const expectedHash = evidence.document ? `0x${hashJson(evidence.document)}` : `0x${"0".repeat(64)}`;
  if (evidence.policyHash !== authorization.policyHash || evidence.policyHash !== expectedHash) throw new PriorSealError("INVALID_POLICY_EVIDENCE", "Policy evidence hash does not match the authorization");
  const expectedResult = evidence.document ? evaluateAuthorizationPolicy(authorization, evidence.document, evaluatedAt) : { allowed: true, reasonCodes: [], policyId: null, evaluatedAt };
  if (!expectedResult.allowed || hashJson(expectedResult) !== hashJson(evidence.result)) throw new PriorSealError("INVALID_POLICY_EVIDENCE", "Policy evaluation does not match the embedded policy");
  return true;
}
function invalid(code) {
  return { valid: false, code };
}
export {
  AUTHORIZATION_DOMAIN,
  AUTHORIZATION_RECEIPT_SCHEMA,
  AUTHORIZATION_SCHEMA,
  AUTHORIZED_RECEIPT_SCHEMA,
  LEGACY_AUTHORIZATION_SCHEMA,
  LEGACY_AUTHORIZED_RECEIPT_SCHEMA,
  assertIssuableAuthorization,
  authorizationTypedData,
  authorizedReceiptId,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  erc1271CallData,
  signAuthorizationReceipt,
  validateAuthorizedReceiptClaims,
  verifyAuthorization,
  verifyAuthorizationReceipt,
  verifyAuthorizedReceipt
};
