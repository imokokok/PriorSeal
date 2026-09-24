// Generated from adapter.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  verifyAuthorityDelegationChain,
  verifyReceiptV1Serialized,
  verifyReceiptWithDecisionV1
} from "agent-passport-system";
import {
  buildExactCallIntent,
  matchUniqueContextCommitment
} from "priorseal-sdk";
import { verifyReceiptLocally } from "priorseal-sdk/verifier";
import { keccak256 } from "viem";
import { APS_KEYS, MANIFEST_SHA256, PRIORSEAL_KEY, REFERENCE_TIME, resolveApsKey } from "./trust.mjs";
const NAMESPACE = "aps.decision-ref.v1";
const inputs = new URL("./aps-inputs/", import.meta.url);
const read = (name) => readFileSync(new URL(name, inputs), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function failed(code, detail) {
  return { ok: false, code, ...detail ?? {} };
}
function parseEvidence(bytes) {
  const value = JSON.parse(bytes);
  if (!isRecord(value) || !isRecord(value.authority_state) || !isRecord(value.policy_input) || !isRecord(value.decision_output) || !isRecord(value.decision_context)) {
    throw new TypeError("APS_DECISION_EVIDENCE_INVALID");
  }
  return value;
}
function parseReceipt(bytes) {
  const value = JSON.parse(bytes);
  if (!isRecord(value) || !Array.isArray(value.signatures)) throw new TypeError("APS_RECEIPT_INVALID");
  return value;
}
function verifySourceIntegrity() {
  const manifest = read("MANIFEST.sha256");
  if (sha256(manifest) !== MANIFEST_SHA256) throw new Error("APS_MANIFEST_CHANGED");
  const entries = manifest.trim().split("\n");
  if (entries.length !== 17) throw new Error("APS_MANIFEST_MEMBERSHIP_CHANGED");
  for (const line of entries) {
    const [digest, name] = line.split(/\s+/);
    if (sha256(read(name)) !== digest) throw new Error(`APS_SOURCE_CHANGED:${name}`);
  }
  return { files: entries.length, manifestSha256: MANIFEST_SHA256 };
}
function loadApsCase(name) {
  if (!["permit", "narrow", "deny", "expired"].includes(name)) throw new Error("UNKNOWN_CASE");
  const caseName = name;
  verifySourceIntegrity();
  return {
    intentBytes: read(`cases/${caseName}/action-intent-receipt.json`),
    decisionBytes: read(`cases/${caseName}/policy-decision-receipt.json`),
    evidence: parseEvidence(read(`cases/${caseName}/decision-evidence.json`))
  };
}
function evaluateConstraints(constraints, call) {
  if (!Array.isArray(constraints) || constraints.length === 0) return failed("NARROW_CONSTRAINTS_MISSING");
  for (const constraint of constraints) {
    if (typeof constraint !== "string") return failed("NARROW_CONSTRAINT_UNMAPPED");
    const target = /^fixture:evm\.to=(0x[0-9a-f]{40})$/.exec(constraint);
    const value = /^fixture:evm\.value_wei<=(0|[1-9][0-9]*)$/.exec(constraint);
    if (!target && !value) return failed("NARROW_CONSTRAINT_UNMAPPED");
    if (target && call.to !== target[1]) return failed("NARROW_TARGET_REJECTED");
    if (value && (!/^(0|[1-9][0-9]*)$/.test(call.value_wei) || BigInt(call.value_wei) > BigInt(value[1]))) {
      return failed("NARROW_VALUE_REJECTED");
    }
  }
  return { ok: true, code: "NARROW_PREDICATES_PASSED" };
}
function validCall(call) {
  return isRecord(call) && Object.keys(call).sort().join(",") === "chain_id,data,to,value_wei" && typeof call.chain_id === "string" && /^(0|[1-9][0-9]*)$/.test(call.chain_id) && Number.isSafeInteger(Number(call.chain_id)) && Number(call.chain_id) > 0 && typeof call.to === "string" && /^0x[0-9a-f]{40}$/.test(call.to) && typeof call.value_wei === "string" && /^(0|[1-9][0-9]*)$/.test(call.value_wei) && typeof call.data === "string" && /^0x(?:[0-9a-f]{2})*$/.test(call.data);
}
function typeRules(intent, decision, evidence) {
  const chain = evidence.authority_state?.selected_chain;
  const leaf = chain?.at(-1);
  return intent.receipt_type === "aps:action-intent:v1" && intent.issuer === "did:example:agent" && intent.subject_agent === intent.issuer && !("prev" in intent) && !("decision_ref" in intent) && isDeepStrictEqual(intent.result, { profile: "aps-action-intent-result-v1", status: "declared" }) && intent.signatures.some((s) => s.signer === intent.issuer) && decision.receipt_type === "aps:policy-decision:v1" && decision.issuer === "did:example:boundary" && decision.signatures.some((s) => s.signer === decision.issuer) && decision.prev === intent.receipt_id && decision.subject_agent === intent.subject_agent && decision.action_ref === intent.action_ref && decision.delegation_ref === intent.delegation_ref && Date.parse(decision.issued_at) > Date.parse(intent.issued_at) && isDeepStrictEqual(decision.result, evidence.decision_output) && Object.keys(evidence.authority_state).sort().join(",") === "authority_basis,revocation_observations,selected_chain,spend_state" && leaf?.delegation_id === decision.delegation_ref && leaf?.subject === decision.subject_agent;
}
function verifyAps(input, {
  referenceTime = REFERENCE_TIME,
  resolveKey = resolveApsKey,
  principalKey = APS_KEYS.principal
} = {}) {
  let detail = {};
  try {
    const actionSignature = verifyReceiptV1Serialized(input.intentBytes, resolveKey);
    const decisionSignature = verifyReceiptV1Serialized(input.decisionBytes, resolveKey);
    detail = { actionSignature, decisionSignature };
    if (!actionSignature.valid || !decisionSignature.valid) return failed("APS_RECEIPT_INVALID", detail);
    const intent = parseReceipt(input.intentBytes);
    const decision = parseReceipt(input.decisionBytes);
    const evidence = input.evidence;
    const composite = verifyReceiptWithDecisionV1(decision, evidence, resolveKey);
    detail = {
      ...detail,
      composite,
      ...typeof decision.decision_ref === "string" ? { decisionRef: decision.decision_ref } : {},
      verdict: evidence.decision_output?.verdict
    };
    if (!typeRules(intent, decision, evidence)) return failed("APS_RECEIPT_TYPE_RULES", detail);
    if (!(composite.valid && composite.decision_ref_present && composite.decision_ref_bound && composite.temporal_relation_valid)) {
      return failed("APS_GATE_REJECTED", detail);
    }
    const reference = Date.parse(referenceTime);
    if (!Number.isFinite(reference) || typeof referenceTime !== "string" || new Date(reference).toISOString() !== referenceTime) return failed("REFERENCE_TIME_INVALID", detail);
    if (Date.parse(decision.issued_at) > reference) return failed("APS_NOT_YET_ISSUED", detail);
    const expiry = Date.parse(evidence.decision_output.valid_until);
    if (!Number.isFinite(expiry) || expiry <= reference) return failed("APS_EXPIRED_AT_REFERENCE", detail);
    const chain = evidence.authority_state.selected_chain;
    const observations = evidence.authority_state.revocation_observations;
    const delegation = verifyAuthorityDelegationChain(chain, {
      now: referenceTime,
      resolveVerificationKey: (issuer, method) => issuer === "did:example:principal" && method === "did:example:principal#key-1" ? principalKey : null,
      trustRoot: (candidate) => candidate.issuer === "did:example:principal",
      resolveRevocation: (record) => {
        const matches = observations.filter((entry) => entry.delegation_id === record.delegation_id);
        return matches.length === 1 && Date.parse(matches[0].observed_at) <= reference && matches[0].state === "active" ? "active" : "unknown";
      }
    });
    detail = { ...detail, delegation };
    if (!delegation.valid) return failed("APS_DELEGATION_INVALID", detail);
    const output = evidence.decision_output;
    if (!["permit", "narrow"].includes(output.verdict)) return failed("APS_VERDICT_REJECTED", detail);
    const call = evidence.policy_input?.requested_call;
    if (evidence.policy_input?.policy_id !== "fixture:evm-call-policy" || evidence.policy_input?.policy_version !== "1" || !validCall(call)) return failed("APS_CALL_UNMAPPED", detail);
    if (output.verdict === "narrow") {
      const constraints = evaluateConstraints(output.constraints, call);
      if (!constraints.ok) return failed(constraints.code, detail);
    } else if (!Array.isArray(output.constraints) || output.constraints.length !== 0) {
      return failed("PERMIT_CONSTRAINT_UNMAPPED", detail);
    }
    if (!detail.actionSignature || !detail.decisionSignature || !detail.composite || !detail.decisionRef || !detail.delegation) return failed("APS_INPUT_INVALID", detail);
    return {
      ok: true,
      code: "APS_VERIFIED_AT_REFERENCE",
      ...detail,
      actionSignature: detail.actionSignature,
      decisionSignature: detail.decisionSignature,
      composite: detail.composite,
      decisionRef: detail.decisionRef,
      delegation: detail.delegation,
      call,
      validUntil: expiry / 1e3,
      referenceTime,
      actionRefRecomputed: false,
      liveRevocationEstablished: false,
      singleUseEstablished: false
    };
  } catch {
    return failed("APS_INPUT_INVALID", detail);
  }
}
function checkIntent(aps, intent) {
  if (!aps.ok) return failed(aps.code);
  try {
    const contextCommitments = intent.contextCommitments?.map((entry) => {
      if (entry.algorithm !== "sha256" && entry.algorithm !== "keccak256") {
        throw new TypeError("invalid context commitment algorithm");
      }
      return { namespace: entry.namespace, algorithm: entry.algorithm, digest: entry.digest };
    });
    const commitment = matchUniqueContextCommitment({ contextCommitments }, {
      namespace: NAMESPACE,
      algorithm: "sha256",
      digest: `0x${aps.decisionRef}`
    });
    if (!commitment.matched) return failed(commitment.code);
    if (!Number.isSafeInteger(intent.validUntil) || intent.validUntil > aps.validUntil || intent.validUntil * 1e3 <= Date.parse(aps.referenceTime)) return failed("PRIORSEAL_WINDOW_REJECTED");
    if (intent.schema !== "priorseal.intent.v2" || intent.executionProfile !== "priorseal.execution-profile.exact-call.v1" || intent.chainId !== Number(aps.call.chain_id) || intent.callTarget !== aps.call.to || intent.calldataHash !== keccak256(aps.call.data) || intent.transactionValue !== aps.call.value_wei) {
      return failed("EXACT_CALL_MISMATCH");
    }
    return { ok: true, code: "APS_INTENT_BOUND" };
  } catch {
    return failed("PRIORSEAL_INTENT_INVALID");
  }
}
async function authorizeFromAps(input, {
  executor,
  nonce,
  intentId,
  validUntil,
  onAuthorize,
  ...verificationOptions
}) {
  const aps = verifyAps(input, verificationOptions);
  if (!aps.ok) return { ok: false, code: aps.code, aps, authorizationCreated: false };
  const intent = buildExactCallIntent({
    intentId,
    validUntil: validUntil ?? aps.validUntil,
    transaction: {
      chainId: Number(aps.call.chain_id),
      from: executor,
      to: aps.call.to,
      data: aps.call.data,
      value: aps.call.value_wei,
      nonce
    },
    asset: `eip155:${aps.call.chain_id}/native`,
    amount: aps.call.value_wei,
    contextCommitments: [{ namespace: NAMESPACE, algorithm: "sha256", digest: `0x${aps.decisionRef}` }],
    constraints: { minConfirmations: 1 }
  });
  const binding = checkIntent(aps, intent);
  if (!binding.ok) return { ...binding, aps, authorizationCreated: false };
  const authorization = await onAuthorize(intent);
  return { ok: true, code: "AUTHORIZATION_CREATED", aps, intent, authorization, authorizationCreated: true };
}
async function verifyPair(input, receiptValue, { priorSealKey = PRIORSEAL_KEY, ...options } = {}) {
  const aps = verifyAps(input, options);
  const receipt = isRecord(receiptValue) ? receiptValue : void 0;
  let priorSeal;
  try {
    priorSeal = receipt ? await verifyReceiptLocally(receipt, {
      trustedKeys: priorSealKey,
      now: Date.parse(options.referenceTime ?? REFERENCE_TIME) / 1e3
    }) : { valid: false, code: "INVALID_RECEIPT", verificationScope: "LOCAL_COMPLETE", requiredExternalChecks: [] };
  } catch {
    priorSeal = { valid: false, code: "INVALID_RECEIPT", verificationScope: "LOCAL_COMPLETE", requiredExternalChecks: [] };
  }
  const result = { aps, priorSeal, singleUseEstablished: false, chainTimeApsCurrencyEstablished: false };
  if (!aps.ok) return { ...result, composition: failed(aps.code) };
  if (!priorSeal.valid || priorSeal.verificationScope !== "LOCAL_COMPLETE") {
    return { ...result, composition: failed("PRIORSEAL_VERIFICATION_FAILED") };
  }
  if (!receipt?.authorizationEvidence) {
    return { ...result, composition: failed("PRIORSEAL_VERIFICATION_FAILED") };
  }
  const authorization = receipt.authorizationEvidence.authorization;
  const binding = checkIntent(aps, authorization.intent);
  if (!binding.ok) return { ...result, composition: binding };
  if (authorization.issuedAt * 1e3 < Date.parse(JSON.parse(input.decisionBytes).issued_at) || authorization.expiresAt > aps.validUntil) {
    return { ...result, composition: failed("AUTHORIZATION_WINDOW_REJECTED") };
  }
  if (priorSeal.executionStatus !== "CONFIRMED" || !["COMPLIANT", "NON_COMPLIANT"].includes(priorSeal.complianceStatus ?? "")) {
    return { ...result, composition: failed("EXECUTION_NOT_ASSESSABLE") };
  }
  return { ...result, composition: {
    ok: true,
    code: "DECISION_AUTHORIZATION_CORRELATED",
    decisionRef: aps.decisionRef,
    authorizationId: authorization.authorizationId,
    description: "execution correlated to the principal-signed authorization and the APS decision"
  } };
}
export {
  NAMESPACE,
  authorizeFromAps,
  checkIntent,
  evaluateConstraints,
  loadApsCase,
  verifyAps,
  verifyPair,
  verifySourceIntegrity
};
