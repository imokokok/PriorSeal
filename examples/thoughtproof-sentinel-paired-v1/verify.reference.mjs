#!/usr/bin/env node
// Generated from verify.reference.mts by npm run core:build. Do not edit directly.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchUniqueContextCommitment } from "../../sdk/dist/index.js";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
const directory = dirname(fileURLToPath(import.meta.url));
function readJson(name) {
  return JSON.parse(readFileSync(resolve(directory, name), "utf8"));
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jcsFlat(value) {
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === void 0) continue;
    if (typeof item === "string" || typeof item === "boolean") {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(item)}`);
    } else if (typeof item === "number" && Number.isFinite(item)) {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(item)}`);
    } else {
      throw new TypeError(`unsupported signed field: ${key}`);
    }
  }
  return `{${parts.join(",")}}`;
}
function signedInput(artifact, domain) {
  const fields = {
    artifactSchema: artifact.artifactSchema,
    verificationId: artifact.verificationId,
    canonical: artifact.canonical,
    digest: artifact.digest,
    keyId: artifact.keyId,
    alg: artifact.alg,
    signedAt: artifact.signedAt
  };
  if (artifact.validUntil !== void 0) fields.validUntil = artifact.validUntil;
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(jcsFlat(fields), "utf8")
  ]);
}
function fail(code, detail) {
  return { ok: false, code, ...detail ? { detail } : {} };
}
function resolveThoughtProofKey(artifact, keyDocument, expected, allowVectorOnly) {
  if (keyDocument?.schema !== "thoughtproof.keys.v1" || !Array.isArray(keyDocument.keys)) {
    return fail("DECISION_SIGNER_UNTRUSTED", "invalid ThoughtProof key document");
  }
  const entry = keyDocument.keys.find((candidate) => candidate.kid === artifact.keyId);
  const pin = expected.trustedThoughtProofKeys.find((candidate) => candidate.kid === artifact.keyId);
  if (!entry || !pin || entry.x !== pin.x || entry.kty !== "OKP" || entry.crv !== "Ed25519") {
    return fail("DECISION_SIGNER_UNTRUSTED", "kid is missing or does not match the out-of-band pin");
  }
  if (entry.alg !== "EdDSA") {
    return fail("DECISION_SIGNER_UNTRUSTED", "ThoughtProof key algorithm is unsupported");
  }
  const status = entry.status ?? "active";
  if (pin.use === "vector-only" && (status !== "vector-only" || !allowVectorOnly)) {
    return fail("DECISION_SIGNER_UNTRUSTED", "vector-only kid requires explicit allowance");
  }
  if (pin.use === "production" && !["active", "retired"].includes(status)) {
    return fail("DECISION_SIGNER_UNTRUSTED", `production kid has unusable status: ${status}`);
  }
  if (!["production", "vector-only"].includes(pin.use)) {
    return fail("DECISION_SIGNER_UNTRUSTED", "out-of-band key purpose is invalid");
  }
  if (!["active", "retired", "vector-only"].includes(status)) {
    return fail("DECISION_SIGNER_UNTRUSTED", `unusable key status: ${status}`);
  }
  const signedAt = artifact.signedAt;
  if (!Number.isSafeInteger(signedAt) || signedAt < 0) {
    return fail("DECISION_SIGNER_UNTRUSTED", "signedAt must be Unix seconds");
  }
  if (entry.notBefore) {
    const notBefore = Date.parse(entry.notBefore) / 1e3;
    if (!Number.isSafeInteger(notBefore) || signedAt < notBefore) {
      return fail("DECISION_SIGNER_UNTRUSTED", "kid was not valid at signedAt");
    }
  }
  if (entry.notAfter) {
    const notAfter = Date.parse(entry.notAfter) / 1e3;
    if (!Number.isSafeInteger(notAfter) || signedAt > notAfter) {
      return fail("DECISION_SIGNER_UNTRUSTED", "kid was expired at signedAt");
    }
  }
  return { ok: true, entry };
}
function verifyThoughtProofExport(artifact, keyDocument, expected, { allowVectorOnly = false } = {}) {
  if (!artifact) return fail("DECISION_EXPORT_MISSING");
  if (!isRecord(artifact) || artifact.exportSchema !== expected.exportSchema) {
    return fail("DECISION_EXPORT_INVALID", "unsupported export schema");
  }
  const required = [
    "artifactSchema",
    "verificationId",
    "canonical",
    "digest",
    "keyId",
    "alg",
    "signedAt",
    "signature"
  ];
  if (required.some((field) => artifact[field] == null)) {
    return fail("DECISION_EXPORT_INVALID", "required export field is missing");
  }
  if (artifact.artifactSchema !== expected.artifactSchema || artifact.alg !== "Ed25519") {
    return fail("DECISION_EXPORT_INVALID", "artifact schema or algorithm is unsupported");
  }
  if (!/^0x[0-9a-f]{64}$/.test(artifact.digest)) {
    return fail("DECISION_EXPORT_INVALID", "digest encoding is invalid");
  }
  if (!/^0x[0-9a-f]{128}$/.test(artifact.signature)) {
    return fail("DECISION_SIGNATURE_INVALID", "signature encoding is invalid");
  }
  if (artifact.validUntil !== void 0 && (!Number.isSafeInteger(artifact.validUntil) || artifact.validUntil < artifact.signedAt)) {
    return fail("DECISION_EXPORT_INVALID", "validUntil is not a valid signed freshness window");
  }
  const resolved = resolveThoughtProofKey(artifact, keyDocument, expected, allowVectorOnly);
  if (!resolved.ok) return resolved;
  try {
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: resolved.entry.x },
      format: "jwk"
    });
    const signature = Buffer.from(String(artifact.signature).replace(/^0x/i, ""), "hex");
    if (!verify(null, signedInput(artifact, expected.exportDomain), publicKey, signature)) {
      return fail("DECISION_SIGNATURE_INVALID");
    }
  } catch {
    return fail("DECISION_SIGNATURE_INVALID");
  }
  const digest = `0x${createHash("sha256").update(artifact.canonical, "utf8").digest("hex")}`;
  if (digest !== artifact.digest) return fail("DECISION_COMMITMENT_DIGEST_MISMATCH");
  let canonical;
  try {
    canonical = JSON.parse(artifact.canonical);
  } catch {
    return fail("DECISION_EXPORT_INVALID", "transported canonical string is not JSON");
  }
  if (!isRecord(canonical) || typeof canonical.verdict !== "string" || canonical.artifactSchema !== artifact.artifactSchema || canonical.verificationId !== artifact.verificationId) {
    return fail("DECISION_EXPORT_INVALID", "outer and canonical identifiers disagree");
  }
  return { ok: true, code: "OK", artifact, canonical, keyStatus: resolved.entry.status };
}
function priorSealPublicKeyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}
async function verifyPair({ artifact, priorSealReceipt, keyDocument, trustedIssuerKeys, expected, allowVectorOnly = false }) {
  const decision = verifyThoughtProofExport(artifact, keyDocument, expected, { allowVectorOnly });
  if (!decision.ok) return decision;
  if (!artifact) return fail("DECISION_EXPORT_MISSING");
  if (!isRecord(priorSealReceipt)) return fail("PRIORSEAL_RECEIPT_MISSING");
  const trustedKey = trustedIssuerKeys?.keys?.find(
    (entry) => entry.issuer === expected.priorSeal.issuer && entry.keyId === expected.priorSeal.keyId
  );
  if (!trustedKey || trustedIssuerKeys.issuer !== expected.priorSeal.issuer || !["active", "retired"].includes(trustedKey.status) || priorSealPublicKeyFingerprint(trustedKey.publicKey) !== expected.priorSeal.publicKeySpkiSha256) {
    return fail("PRIORSEAL_UNKNOWN_KEY");
  }
  const priorSeal = await verifyReceiptLocally(priorSealReceipt, {
    trustedKeys: trustedKey,
    now: priorSealReceipt.issuedAt
  });
  if (!priorSeal.valid) return fail(`PRIORSEAL_${priorSeal.code}`);
  if (priorSeal.verificationScope !== "LOCAL_COMPLETE") {
    return fail("PRIORSEAL_EXTERNAL_CHECK_REQUIRED");
  }
  if (priorSealReceipt.schema !== expected.priorSeal.receiptSchema || priorSeal.executionStatus !== "CONFIRMED" || priorSeal.complianceStatus !== "COMPLIANT") {
    return fail("PRIORSEAL_RECEIPT_NOT_COMPLIANT");
  }
  if (!priorSealReceipt.authorizationEvidence) return fail("PRIORSEAL_AUTHORIZATION_MISSING");
  const authorization = priorSealReceipt.authorizationEvidence.authorization;
  const intent = authorization.intent;
  if (intent.schema !== expected.priorSeal.intentSchema || intent.executionProfile !== expected.priorSeal.executionProfile) {
    return fail("PRIORSEAL_EXACT_CALL_REQUIRED");
  }
  if (expected.algorithm !== "sha256" && expected.algorithm !== "keccak256") return fail("DECISION_COMMITMENT_ALGORITHM_INVALID");
  const commitment = matchUniqueContextCommitment(intent, {
    namespace: expected.namespace,
    algorithm: expected.algorithm,
    digest: artifact.digest
  });
  if (!commitment.matched) return fail(commitment.code);
  if (artifact.validUntil !== void 0 && authorization.expiresAt > artifact.validUntil) {
    return fail("DECISION_EXPIRES_BEFORE_AUTHORIZATION");
  }
  const effect = expected.effectMap[decision.canonical.verdict];
  if (!effect) return fail("DECISION_EFFECT_UNMAPPED");
  return {
    ok: true,
    code: "DECISION_COMMITMENT_VERIFIED",
    subjectBindingCode: "DECISION_SUBJECT_UNBOUND",
    decisionEffect: effect,
    verificationId: artifact.verificationId,
    decisionDigest: artifact.digest,
    thoughtProofKeyId: artifact.keyId,
    priorSealReceiptId: priorSealReceipt.receiptId,
    authorizationId: authorization.authorizationId,
    executionStatus: priorSeal.executionStatus,
    complianceStatus: priorSeal.complianceStatus
  };
}
async function runFixtureChecks({ log = console.log } = {}) {
  const expected = readJson("expected.json");
  const keyDocument = readJson("thoughtproof-keys.json");
  const trustedIssuerKeys = readJson("priorseal-trusted-issuer-keys.json");
  const results = [];
  for (const vector of expected.cases) {
    const artifact = vector.export ? readJson(vector.export) : null;
    const priorSealReceipt = vector.receipt ? readJson(vector.receipt) : null;
    const result = await verifyPair({
      artifact,
      priorSealReceipt,
      keyDocument,
      trustedIssuerKeys,
      expected,
      allowVectorOnly: vector.allowVectorOnly
    });
    if (result.code !== vector.expectedCode) {
      throw new Error(`${vector.name}: expected ${vector.expectedCode}, received ${result.code}`);
    }
    if (vector.expectedSubjectBindingCode && ("subjectBindingCode" in result ? result.subjectBindingCode : void 0) !== vector.expectedSubjectBindingCode) {
      throw new Error(
        `${vector.name}: expected subject ${vector.expectedSubjectBindingCode}, received ${"subjectBindingCode" in result ? result.subjectBindingCode : void 0}`
      );
    }
    if (vector.expectedEffect && ("decisionEffect" in result ? result.decisionEffect : void 0) !== vector.expectedEffect) {
      throw new Error(
        `${vector.name}: expected effect ${vector.expectedEffect}, received ${"decisionEffect" in result ? result.decisionEffect : void 0}`
      );
    }
    results.push({ name: vector.name, code: result.code });
    log(`PASS ${vector.name}: ${result.code}`);
  }
  log(
    "LIMIT M1 proves signed decision-artifact commitment, not exact-call subject binding; DECISION_SUBJECT_UNBOUND remains expected until M2."
  );
  return results;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runFixtureChecks();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
export {
  runFixtureChecks,
  verifyPair,
  verifyThoughtProofExport
};
