// Generated from generate-thoughtproof-sentinel-paired-vectors.mts by npm run core:build. Do not edit directly.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const output = new URL("../examples/thoughtproof-sentinel-paired-v1/", import.meta.url);
const issuer = "priorseal.thoughtproof-fixture";
const keyId = "priorseal-thoughtproof-fixture-ed25519-1";
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const executor = `0x${"a".repeat(40)}`;
const target = `0x${"c".repeat(40)}`;
const calldata = "0x38ed17390000000000000000000000000000000000000000000000000000000000000001";
const calldataHash = keccak256(calldata);
const amount = "100000000000000000";
const fixtureSeed = Buffer.from("33".repeat(32), "hex");
const issuerPrivateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), fixtureSeed]),
  format: "der",
  type: "pkcs8"
});
const issuerPublicKey = createPublicKey(issuerPrivateKey);
const privateKeyPem = issuerPrivateKey.export({ type: "pkcs8", format: "pem" });
const publicKeyPem = issuerPublicKey.export({ type: "spki", format: "pem" });
const publicKeyFingerprint = createHash("sha256").update(issuerPublicKey.export({ type: "spki", format: "der" })).digest("hex");
async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, output), "utf8"));
}
async function makeReceipt({ name, digest, issuedAt, expiresAt, nonceByte, commitments }) {
  const intent = {
    schema: "priorseal.intent.v2",
    executionProfile: "priorseal.execution-profile.exact-call.v1",
    intentId: `thoughtproof-${name}`,
    chainId: 8453,
    action: "CONTRACT_CALL",
    asset: "eip155:8453/native",
    amount,
    sender: executor,
    recipient: target,
    validUntil: expiresAt,
    nonce: String(1e3 + Number.parseInt(nonceByte, 16)),
    callTarget: target,
    calldataHash,
    transactionValue: amount,
    contextCommitments: commitments ?? [
      {
        namespace: "thoughtproof.sentinel-decision.v1",
        algorithm: "sha256",
        digest
      }
    ],
    constraints: { minConfirmations: 12 }
  };
  const draft = buildAuthorization({
    intent,
    principal: { type: "user", id: "thoughtproof-paired-fixture-user", account: account.address },
    authorizer: { type: "eip712", address: account.address },
    delegate: { agentId: "thoughtproof-paired-fixture-agent", executor },
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
    authorizationNonce: `0x${nonceByte.repeat(64)}`,
    maxUses: "1",
    audience: "priorseal",
    policyHash: `0x${"0".repeat(64)}`
  });
  const authorization = buildAuthorization({
    ...draft,
    signature: await account.signTypedData(authorizationTypedData(draft))
  });
  const acceptedAt = issuedAt + 1;
  const acceptance = signAuthorizationReceipt(
    buildAuthorizationReceipt({ authorization, issuer, keyId, acceptedAt }),
    privateKeyPem
  );
  const executedAt = issuedAt + 60;
  const execution = {
    schema: "priorseal.execution-observation.v1",
    chainId: 8453,
    txHash: `0x${nonceByte.repeat(64)}`,
    status: "CONFIRMED",
    blockNumber: 331e5 + Number.parseInt(nonceByte, 16),
    blockHash: `0x${"e".repeat(64)}`,
    executedAt,
    observedAt: executedAt + 5,
    action: "CONTRACT_CALL",
    nonce: intent.nonce,
    sender: executor,
    recipient: target,
    target,
    calldataHash,
    asset: intent.asset,
    amount,
    transfers: [],
    transferMatchUnique: false,
    nativeValue: amount,
    tokenValue: null,
    gasUsed: "180000",
    fee: null,
    executionDataAvailable: true,
    observationSource: "fixture",
    finalityState: "CONFIRMED",
    confirmations: 12
  };
  const receipt = signReceipt(
    buildAuthorizedReceipt({
      authorization,
      acceptance,
      execution,
      issuer,
      keyId,
      issuedAt: execution.observedAt
    }),
    privateKeyPem
  );
  await writeFile(new URL(`priorseal-receipt-${name}.json`, output), `${JSON.stringify(receipt, null, 2)}
`);
  return receipt;
}
await mkdir(output, { recursive: true });
const productionExport = await readJson("export-prod-live.json");
const vectorExport = await readJson("export-valid.json");
const vectorIssuedAt = vectorExport.signedAt + 60;
const vectorExpiresAt = vectorExport.validUntil - 60;
await makeReceipt({
  name: "production",
  digest: productionExport.digest,
  issuedAt: productionExport.signedAt + 60,
  expiresAt: productionExport.validUntil - 60,
  nonceByte: "2"
});
const vectorReceipt = await makeReceipt({
  name: "vector",
  digest: vectorExport.digest,
  issuedAt: vectorIssuedAt,
  expiresAt: vectorExpiresAt,
  nonceByte: "3"
});
await makeReceipt({
  name: "wrong-digest",
  digest: `0x${"f".repeat(64)}`,
  issuedAt: vectorIssuedAt,
  expiresAt: vectorExpiresAt,
  nonceByte: "4"
});
await makeReceipt({
  name: "missing-commitment",
  digest: vectorExport.digest,
  issuedAt: vectorIssuedAt,
  expiresAt: vectorExpiresAt,
  nonceByte: "5",
  commitments: [
    { namespace: "fixture.unrelated.v1", algorithm: "sha256", digest: vectorExport.digest }
  ]
});
await makeReceipt({
  name: "ambiguous-commitment",
  digest: vectorExport.digest,
  issuedAt: vectorIssuedAt,
  expiresAt: vectorExpiresAt,
  nonceByte: "6",
  commitments: [
    {
      namespace: "thoughtproof.sentinel-decision.v1",
      algorithm: "sha256",
      digest: vectorExport.digest
    },
    {
      namespace: "thoughtproof.sentinel-decision.v1",
      algorithm: "sha256",
      digest: `0x${"e".repeat(64)}`
    }
  ]
});
await makeReceipt({
  name: "decision-expires-first",
  digest: vectorExport.digest,
  issuedAt: vectorIssuedAt,
  expiresAt: vectorExport.validUntil + 600,
  nonceByte: "7"
});
const tamperedReceipt = structuredClone(vectorReceipt);
tamperedReceipt.signature = `${tamperedReceipt.signature[0] === "A" ? "B" : "A"}${tamperedReceipt.signature.slice(1)}`;
await writeFile(
  new URL("priorseal-receipt-tampered-signature.json", output),
  `${JSON.stringify(tamperedReceipt, null, 2)}
`
);
const trustedKeys = {
  schema: "priorseal.keys.v1",
  issuer,
  keys: [
    {
      issuer,
      keyId,
      algorithm: "Ed25519",
      publicKey: publicKeyPem,
      status: "active",
      validFrom: null,
      validUntil: null
    }
  ]
};
await writeFile(
  new URL("priorseal-trusted-issuer-keys.json", output),
  `${JSON.stringify(trustedKeys, null, 2)}
`
);
const expected = {
  schema: "priorseal.thoughtproof-sentinel-paired-fixture.v1",
  exportSchema: "thoughtproof.sentinel.export.v1",
  artifactSchema: "sentinel.verdict.canonical.v1",
  exportDomain: "thoughtproof.sentinel.export.v1",
  namespace: "thoughtproof.sentinel-decision.v1",
  algorithm: "sha256",
  trustedThoughtProofKeys: [
    {
      kid: "tp-sentinel-export-ed25519-2026-09",
      x: "rKfORFLuIi74fCI9DZEpefBXcKFU4e_0CuYuSH7Fh98",
      use: "production"
    },
    {
      kid: "tp-sentinel-export-ed25519-2026-09-vector",
      x: "IuMSTQMowwaP3yaOmlf9unkZAVjvc9MwOOqluXCjFDs",
      use: "vector-only"
    }
  ],
  priorSeal: {
    issuer,
    keyId,
    publicKeySpkiSha256: publicKeyFingerprint,
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
      name: "production matching pair",
      export: "export-prod-live.json",
      receipt: "priorseal-receipt-production.json",
      allowVectorOnly: false,
      expectedCode: "DECISION_COMMITMENT_VERIFIED",
      expectedSubjectBindingCode: "DECISION_SUBJECT_UNBOUND",
      expectedEffect: "REVIEW_REQUIRED"
    },
    {
      name: "vector matching pair",
      export: "export-valid.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_COMMITMENT_VERIFIED",
      expectedSubjectBindingCode: "DECISION_SUBJECT_UNBOUND",
      expectedEffect: "RECOMMEND"
    },
    {
      name: "vector kid rejected without explicit allowance",
      export: "export-valid.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: false,
      expectedCode: "DECISION_SIGNER_UNTRUSTED"
    },
    {
      name: "missing signed export",
      export: null,
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_EXPORT_MISSING"
    },
    {
      name: "tampered transported canonical string",
      export: "export-tampered-canonical.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_SIGNATURE_INVALID"
    },
    {
      name: "tampered signed validUntil",
      export: "export-tampered-validUntil.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_SIGNATURE_INVALID"
    },
    {
      name: "known kid with wrong signature key",
      export: "export-wrong-key.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_SIGNATURE_INVALID"
    },
    {
      name: "unknown ThoughtProof kid",
      export: "export-unknown-keyId.json",
      receipt: "priorseal-receipt-vector.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_SIGNER_UNTRUSTED"
    },
    {
      name: "valid PriorSeal receipt with wrong commitment digest",
      export: "export-valid.json",
      receipt: "priorseal-receipt-wrong-digest.json",
      allowVectorOnly: true,
      expectedCode: "CONTEXT_COMMITMENT_DIGEST_MISMATCH"
    },
    {
      name: "ThoughtProof commitment namespace missing",
      export: "export-valid.json",
      receipt: "priorseal-receipt-missing-commitment.json",
      allowVectorOnly: true,
      expectedCode: "CONTEXT_COMMITMENT_MISSING"
    },
    {
      name: "ThoughtProof commitment namespace ambiguous",
      export: "export-valid.json",
      receipt: "priorseal-receipt-ambiguous-commitment.json",
      allowVectorOnly: true,
      expectedCode: "CONTEXT_COMMITMENT_AMBIGUOUS"
    },
    {
      name: "decision expires before PriorSeal authorization",
      export: "export-valid.json",
      receipt: "priorseal-receipt-decision-expires-first.json",
      allowVectorOnly: true,
      expectedCode: "DECISION_EXPIRES_BEFORE_AUTHORIZATION"
    },
    {
      name: "tampered PriorSeal receipt signature",
      export: "export-valid.json",
      receipt: "priorseal-receipt-tampered-signature.json",
      allowVectorOnly: true,
      expectedCode: "PRIORSEAL_INVALID_SIGNATURE"
    }
  ]
};
await writeFile(new URL("expected.json", output), `${JSON.stringify(expected, null, 2)}
`);
console.log(`Generated ${expected.cases.length} ThoughtProof + PriorSeal paired-vector cases.`);
console.log(`PriorSeal fixture issuer key fingerprint: ${publicKeyFingerprint}`);
