// Generated from generate-thoughtproof-sentinel-m2-final-pairs.mts by npm run core:build. Do not edit directly.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  signReceipt
} from "../src/index.mjs";
import { signAuthorizationReceipt } from "../src/domain/authorization.mjs";
const output = new URL("../examples/thoughtproof-sentinel-paired-v2-final/", import.meta.url);
const namespace = "thoughtproof.sentinel-decision.v1";
const subjectSchema = "thoughtproof.sentinel-subject.evm-exact-call.v1";
const exportDomain = "thoughtproof.sentinel.export.v1";
const sourceArchiveSha256 = "e18d84a540efc3d5fc4989942393545dd0825282607599cbcf0144310bcd3810";
const rawCalldata = "0x38ed17390000000000000000000000000000000000000000000000000000000000000001";
const emptyCalldata = "0x";
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const issuer = "priorseal.thoughtproof-m2-final-vector-fixture";
const issuerKeyId = "priorseal-thoughtproof-m2-final-ed25519-1";
const issuerPrivateKey = privateKeyFromSeed("66");
const issuerPublicKey = createPublicKey(issuerPrivateKey);
const issuerPrivateKeyPem = issuerPrivateKey.export({ type: "pkcs8", format: "pem" });
const issuerPublicKeyPem = issuerPublicKey.export({ type: "spki", format: "pem" });
const issuerPublicKeyFingerprint = createHash("sha256").update(issuerPublicKey.export({ type: "spki", format: "der" })).digest("hex");
function privateKeyFromSeed(byte) {
  const seed = Buffer.from(byte.repeat(32), "hex");
  return createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8"
  });
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function readJson(name) {
  const text = await readFile(new URL(name, output), "utf8");
  return { text, value: JSON.parse(text) };
}
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value;
}
function stringField(value, field, label) {
  const result = value[field];
  if (typeof result !== "string") throw new Error(`${label}: invalid ${field}`);
  return result;
}
function signedExport(value, label) {
  const data = record(value, label);
  const signedAt = data.signedAt;
  const validUntil = data.validUntil;
  if (typeof signedAt !== "number" || !Number.isSafeInteger(signedAt) || typeof validUntil !== "number" || !Number.isSafeInteger(validUntil)) {
    throw new Error(`${label}: invalid validity window`);
  }
  return { exportSchema: stringField(data, "exportSchema", label), digest: stringField(data, "digest", label), canonical: stringField(data, "canonical", label), signedAt, validUntil };
}
async function writeJson(name, value) {
  await writeFile(new URL(name, output), `${JSON.stringify(value, null, 2)}
`);
}
const sourceExpectations = {
  "export-m2-match.json": "0acdc832f9fddc33740033e2e4184ce37e33d5c1037e94b9e30ebdd5059303b9",
  "export-m2-missing-subject.json": "ae8952c5e94354c9a441a8121a92617f457c70bcae4e10c0546b513542028353",
  "thoughtproof-keys.json": "89ee418621200c709886416ccf3bf539fae37463f8278421f8206113c6592bfc"
};
const source = {};
for (const [name, expectedHash] of Object.entries(sourceExpectations)) {
  const loaded = await readJson(name);
  const actualHash = sha256(loaded.text);
  if (actualHash !== expectedHash) {
    throw new Error(`${name} no longer matches the ThoughtProof-issued source bytes`);
  }
  source[name] = loaded.value;
}
const matchingExport = signedExport(source["export-m2-match.json"], "matching export");
const missingSubjectExport = signedExport(source["export-m2-missing-subject.json"], "missing-subject export");
const keyDocument = record(source["thoughtproof-keys.json"], "ThoughtProof keys");
if (!Array.isArray(keyDocument.keys)) throw new Error("ThoughtProof keys: invalid keys");
const thoughtProofKeys = { keys: keyDocument.keys.map((value) => {
  const key = record(value, "ThoughtProof key");
  return { kid: stringField(key, "kid", "ThoughtProof key"), status: stringField(key, "status", "ThoughtProof key"), x: stringField(key, "x", "ThoughtProof key") };
}) };
const matchingCanonical = record(JSON.parse(matchingExport.canonical), "matching canonical");
const missingCanonical = record(JSON.parse(missingSubjectExport.canonical), "missing canonical");
const rawSubject = record(matchingCanonical.decisionSubject, "decision subject");
const chainId = rawSubject.chainId;
if (typeof chainId !== "number" || !Number.isSafeInteger(chainId)) throw new Error("decision subject: invalid chainId");
const subject = {
  schema: stringField(rawSubject, "schema", "decision subject"),
  chainId,
  transactionValue: stringField(rawSubject, "transactionValue", "decision subject"),
  executor: stringField(rawSubject, "executor", "decision subject"),
  callTarget: stringField(rawSubject, "callTarget", "decision subject"),
  transactionNonce: stringField(rawSubject, "transactionNonce", "decision subject"),
  calldataHash: stringField(rawSubject, "calldataHash", "decision subject")
};
if (matchingExport.exportSchema !== exportDomain || matchingExport.digest !== "0xa5bbfe64ca3864d7cf6d5ba0f5af1992b55d15100e0d716bd9e426b5812877a9" || missingSubjectExport.digest !== "0x9a0476c3411cfdc40b59aad4e5c6ec656c662ca082e9e1ad2e28520e159de28a" || subject?.schema !== subjectSchema || missingCanonical.decisionSubject !== void 0) {
  throw new Error("ThoughtProof-issued M2 artifacts do not match the agreed final-pair inputs");
}
if (keccak256(rawCalldata) !== subject.calldataHash) {
  throw new Error("raw calldata does not derive the matching ThoughtProof calldataHash");
}
async function makeReceipt(name, artifact) {
  const issuedAt = artifact.signedAt + 60;
  const expiresAt = artifact.validUntil - 60;
  const intent = {
    schema: "priorseal.intent.v2",
    executionProfile: "priorseal.execution-profile.exact-call.v1",
    intentId: `thoughtproof-m2-final-${name}`,
    chainId: subject.chainId,
    action: "CONTRACT_CALL",
    asset: `eip155:${subject.chainId}/native`,
    amount: subject.transactionValue,
    sender: subject.executor,
    recipient: subject.callTarget,
    validUntil: expiresAt,
    nonce: subject.transactionNonce,
    callTarget: subject.callTarget,
    calldataHash: subject.calldataHash,
    transactionValue: subject.transactionValue,
    contextCommitments: [{ namespace, algorithm: "sha256", digest: artifact.digest }],
    constraints: { minConfirmations: 12 }
  };
  const draft = buildAuthorization({
    intent,
    principal: { type: "user", id: "thoughtproof-m2-final-vector-user", account: account.address },
    authorizer: { type: "eip712", address: account.address },
    delegate: { agentId: "thoughtproof-m2-final-vector-agent", executor: subject.executor },
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
    authorizationNonce: `0x${sha256(`authorization:${name}`)}`,
    maxUses: "1",
    audience: "priorseal",
    policyHash: `0x${"0".repeat(64)}`
  });
  const authorization = buildAuthorization({
    ...draft,
    signature: await account.signTypedData(authorizationTypedData(draft))
  });
  const acceptance = signAuthorizationReceipt(
    buildAuthorizationReceipt({ authorization, issuer, keyId: issuerKeyId, acceptedAt: issuedAt + 1 }),
    issuerPrivateKeyPem
  );
  const executedAt = issuedAt + 60;
  const execution = {
    schema: "priorseal.execution-observation.v1",
    chainId: subject.chainId,
    txHash: `0x${sha256(`transaction:${name}`)}`,
    status: "CONFIRMED",
    blockNumber: 333e5 + Number.parseInt(sha256(name).slice(0, 6), 16),
    blockHash: `0x${"e".repeat(64)}`,
    executedAt,
    observedAt: executedAt + 5,
    action: "CONTRACT_CALL",
    nonce: subject.transactionNonce,
    sender: subject.executor,
    recipient: subject.callTarget,
    target: subject.callTarget,
    calldataHash: subject.calldataHash,
    asset: intent.asset,
    amount: intent.amount,
    transfers: [],
    transferMatchUnique: false,
    nativeValue: subject.transactionValue,
    tokenValue: null,
    gasUsed: "180000",
    fee: null,
    executionDataAvailable: true,
    observationSource: "fixture",
    finalityState: "CONFIRMED",
    confirmations: 12
  };
  return signReceipt(
    buildAuthorizedReceipt({
      authorization,
      acceptance,
      execution,
      issuer,
      keyId: issuerKeyId,
      issuedAt: execution.observedAt
    }),
    issuerPrivateKeyPem
  );
}
await writeJson("priorseal-receipt-matching.json", await makeReceipt("matching", matchingExport));
await writeJson(
  "priorseal-receipt-missing-subject.json",
  await makeReceipt("missing-subject", missingSubjectExport)
);
await writeJson("calldata-fixtures.json", {
  schema: "thoughtproof.sentinel-subject.calldata-keccak-fixtures.v1",
  cases: [
    {
      name: "TP matching raw calldata derivation",
      data: rawCalldata,
      expectedCalldataHash: subject.calldataHash
    },
    {
      name: "normative empty calldata derivation",
      data: emptyCalldata,
      expectedCalldataHash: keccak256(emptyCalldata)
    }
  ]
});
await writeJson("priorseal-trusted-issuer-keys.json", {
  schema: "priorseal.keys.v1",
  issuer,
  keys: [
    {
      issuer,
      keyId: issuerKeyId,
      algorithm: "Ed25519",
      publicKey: issuerPublicKeyPem,
      status: "active",
      validFrom: null,
      validUntil: null
    }
  ]
});
const vectorKey = thoughtProofKeys.keys.find(
  (key) => key.kid === "tp-sentinel-export-ed25519-2026-09-vector"
);
if (!vectorKey || vectorKey.status !== "vector-only") {
  throw new Error("ThoughtProof vector key is absent or has an unexpected status");
}
await writeJson("expected.json", {
  schema: "priorseal.thoughtproof-sentinel-paired-fixture.v2.final",
  status: "FINAL_PAIR_CANDIDATE",
  sourceArchiveSha256,
  sourceFilesSha256: sourceExpectations,
  exportSchema: exportDomain,
  artifactSchema: "sentinel.verdict.canonical.v1",
  exportDomain,
  namespace,
  algorithm: "sha256",
  subjectSchema,
  calldataFixtures: "calldata-fixtures.json",
  trustedThoughtProofKeys: [{ kid: vectorKey.kid, x: vectorKey.x, use: "vector-only" }],
  priorSeal: {
    issuer,
    keyId: issuerKeyId,
    publicKeySpkiSha256: issuerPublicKeyFingerprint,
    receiptSchema: "priorseal.execution-receipt.v3",
    intentSchema: "priorseal.intent.v2",
    executionProfile: "priorseal.execution-profile.exact-call.v1"
  },
  effectMap: {
    ALLOW: "RECOMMEND",
    BLOCK: "DO_NOT_RECOMMEND",
    UNCERTAIN: "REVIEW_REQUIRED"
  },
  cases: [
    {
      name: "TP-issued M2 exact-call matching pair",
      export: "export-m2-match.json",
      receipt: "priorseal-receipt-matching.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_COMMITMENT_VERIFIED",
      expectedSubjectBindingCode: "DECISION_SUBJECT_VERIFIED"
    },
    {
      name: "TP-issued M2 missing-subject negative pair",
      export: "export-m2-missing-subject.json",
      receipt: "priorseal-receipt-missing-subject.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_SUBJECT_MISSING"
    },
    {
      name: "TP vector kid rejected without explicit allowance",
      export: "export-m2-match.json",
      receipt: "priorseal-receipt-matching.json",
      allowVectorOnly: false,
      expectedCode: "DECISION_SIGNER_UNTRUSTED"
    }
  ]
});
console.log("Generated final PriorSeal pairs against the two ThoughtProof-issued M2 vector exports.");
