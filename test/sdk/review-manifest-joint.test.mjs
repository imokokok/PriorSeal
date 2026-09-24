// Generated from review-manifest-joint.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { hashJson } from "../../src/index.mjs";
import {
  buildReviewManifest,
  verifyReviewManifestLocally
} from "../../sdk/dist/verifier.js";
import { createJointReviewFixture, zeroHash, router } from "../helpers/joint-review-fixture.mjs";
const fixture = async (options) => {
  const f = await createJointReviewFixture(options);
  return {
    ...f,
    // The helper constructs valid values; tests below mutate them after construction.
    bundle: f.bundle,
    options: f.options
  };
};
test("joint review verifies real Insight v5 pair, immutable protocol policy and exact-call authorization locally", async () => {
  const f = await fixture();
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.verificationOrigin, "local");
  assert(result.artifacts.every((row) => row.signatureValid && row.trusted));
  assert.equal(result.relations.insightPair, true);
  assert.equal(result.relations.insightAuthorizationBinding, true);
  assert.equal(result.relations.insightProtocol, true);
  assert.equal(result.artifacts[2].protocol.scope, "signed-profile");
  assert.equal(result.artifacts[2].protocol.code, "SIGNED_PROFILE_VERIFIED");
});
test("joint review rejects a rehashed payload mutation without a corresponding signature", async () => {
  const f = await fixture();
  const source = JSON.parse(f.attachments[0].rawJson);
  source.data.tradeAmountUsd++;
  f.attachments[0].rawJson = JSON.stringify(source);
  const changed = await buildReviewManifest({ bundle: f.bundle, attachments: f.attachments });
  const result = await verifyReviewManifestLocally(changed, f.options);
  assert.equal(result.valid, false);
  assert.equal(result.artifacts[0].code, "uid_mismatch");
});
for (const scenario of [
  { name: "cross-chain transaction hash collision", options: { priorChain: 42161 } },
  { name: "different execution time for the same transaction", options: { c4Overrides: { executedAt: 1200 } } },
  { name: "different executor for the same transaction", options: { c4Overrides: { taker: router, subject: router } } },
  { name: "legacy C4 v2 without a signed destination binding", options: { c4Version: 2 } },
  { name: "C4 v5 with zero destination UID and source-only UID hash", options: { c4Overrides: (source) => ({ destinationPreTradeUid: zeroHash, preTradeUidsHash: keccak256(source.uid) }) } },
  { name: "destination assessed after authorization", options: { destinationOverrides: { checkedAt: 1050 } } },
  { name: "authorization outliving a decision", options: { sourceOverrides: { validUntil: 1400 } } },
  { name: "incorrect pair commitment", options: { commitmentOverride: zeroHash } },
  { name: "incorrect declared pre-trade signing time", options: { c4Overrides: { preTradeSignedAt: 901, attestationAgeAtExecSeconds: 199 } } },
  { name: "incorrect declared attestation age", options: { c4Overrides: { attestationAgeAtExecSeconds: 0 } } },
  { name: "different destination scope", options: { destinationOverrides: { tradeAmountUsd: 2e11 } } },
  { name: "execution after its own signed validity window", options: { c4Overrides: { validUntil: 1099 } } },
  { name: "nonproduction C4", options: { c4Overrides: { environment: "nonproduction" } } },
  { name: "unknown signed semantic profile", options: { c4Overrides: { profileId: zeroHash } } }
]) {
  test(`joint review cannot report complete for ${scenario.name}`, async () => {
    const f = await fixture(scenario.options);
    const result = await verifyReviewManifestLocally(f.manifest, f.options);
    assert.equal(result.valid, false, JSON.stringify(result));
  });
}
test("missing attachments and independent Insight trust prevent complete verification", async () => {
  const f = await fixture();
  for (const attachments of [[], f.attachments.slice(0, 2)]) {
    const manifest = await buildReviewManifest({ bundle: f.bundle, attachments });
    const result = await verifyReviewManifestLocally(manifest, f.options);
    assert.equal(result.valid, false);
    assert(result.unverified.includes("insight.complete_pair"));
  }
  const untrusted = await verifyReviewManifestLocally(f.manifest, { ...f.options, insightKeyRegistry: void 0 });
  assert.equal(untrusted.valid, false);
  assert(untrusted.artifacts.every((row) => row.trusted === false));
  const sample = structuredClone(f.options);
  sample.insightKeyRegistry.keys[0].role = "sample";
  assert.equal((await verifyReviewManifestLocally(f.manifest, sample)).valid, false);
});
test("a valid local anchor proof still requires the external chain check", async () => {
  const f = await fixture({ withAnchor: true });
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.priorSeal.valid, true, JSON.stringify(result));
  assert.equal(result.valid, false);
  assert.deepEqual(result.requiredExternalChecks.map((check) => check.type), ["EVM_ANCHOR"]);
});
test("omitting the expected transaction hint never disables cross-artifact checks", async () => {
  const f = await fixture({ priorChain: 42161 });
  f.manifest.expectedTxHash = null;
  const { manifestHash: _hash, ...content } = f.manifest;
  f.manifest.manifestHash = hashJson(content);
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.valid, false, JSON.stringify(result));
});
test("joint timing uses the later of both signed pre-trade checkedAt values", async () => {
  const f = await fixture({ destinationOverrides: { checkedAt: 950 }, c4Overrides: { preTradeSignedAt: 950, attestationAgeAtExecSeconds: 150 } });
  assert.equal((await verifyReviewManifestLocally(f.manifest, f.options)).valid, true);
});
test("v5 protocol trust is independently supplied and cannot be granted by a manifest", async () => {
  const f = await fixture();
  f.manifest.insightProtocolTrust = f.options.insightProtocolTrust;
  const { manifestHash: _hash, ...content } = f.manifest;
  f.manifest.manifestHash = hashJson(content);
  const result = await verifyReviewManifestLocally(f.manifest, { ...f.options, insightProtocolTrust: void 0 });
  assert.equal(result.valid, false);
  assert.equal(result.artifacts[2].signatureValid, true);
  assert.equal(result.artifacts[2].trusted, true);
  assert.equal(result.artifacts[2].protocol.code, "INSIGHT_PROTOCOL_TRUST_REQUIRED");
});
test("legacy v4 review requires exact snapshot pins and reports only snapshot-relative semantics", async () => {
  const f = await fixture({ c4Version: 4 });
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.artifacts[2].protocol.scope, "legacy-snapshot");
  assert.equal(result.artifacts[2].protocol.registrySnapshotSha256, f.options.insightProtocolTrust.registrySnapshot.sha256);
  assert.equal((await verifyReviewManifestLocally(f.manifest, { ...f.options, insightProtocolTrust: void 0 })).valid, false);
  f.options.insightProtocolTrust.registrySnapshot.rawJson += "\n";
  const mismatch = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.artifacts[2].protocol.code, "REGISTRY_SNAPSHOT_MISMATCH");
});
for (const [name, mutate] of [
  ["registry raw bytes", (trust) => {
    trust.registrySnapshot.rawJson += " ";
  }],
  ["registry byte length", (trust) => {
    trust.registrySnapshot.byteLength++;
  }],
  ["missing lineage body", (trust) => {
    trust.registryReleases.pop();
  }],
  ["changed immutable profile", (trust) => {
    trust.executionProfiles[0].rawJson = "{}";
  }],
  ["unadmitted execution schema", (trust) => {
    trust.consumerPolicy.allowedSchemaVersions = [4];
  }],
  ["mismatched immutable policy pins", (trust) => {
    trust.consumerPolicy.allowedProfileIds = [zeroHash];
  }]
]) {
  test(`v5 combined review rejects ${name}`, async () => {
    const f = await fixture();
    mutate(f.options.insightProtocolTrust);
    const result = await verifyReviewManifestLocally(f.manifest, f.options);
    assert.equal(result.valid, false);
    assert.equal(result.artifacts[2].signatureValid, true);
    assert.equal(result.relations.insightProtocol, false);
  });
}
test("unsupported future schemas and conflicting envelope versions are never verified as v5", async () => {
  for (const version of [6, "5"]) {
    const f = await fixture();
    const proof = JSON.parse(f.attachments[2].rawJson);
    proof.data.schemaVersion = version;
    f.attachments[2].rawJson = JSON.stringify(proof);
    f.attachments[2].profile = `insight.execution.v${version}`;
    const manifest = await buildReviewManifest({ bundle: f.bundle, attachments: f.attachments });
    const result = await verifyReviewManifestLocally(manifest, f.options);
    assert.equal(result.valid, false);
    assert.equal(result.artifacts[2].signatureValid, null);
    assert(result.unverified.includes("execution"));
  }
});
test("formatted raw signed attachment bytes survive a complete v5 review unchanged", async () => {
  const f = await fixture();
  f.attachments[2].rawJson = JSON.stringify(JSON.parse(f.attachments[2].rawJson), null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const manifest = await buildReviewManifest({ bundle: f.bundle, attachments: f.attachments });
  assert.equal(manifest.attachments[2].rawJson, f.attachments[2].rawJson);
  assert.equal((await verifyReviewManifestLocally(manifest, f.options)).valid, true);
});
