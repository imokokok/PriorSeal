// Generated from web3-agent-kit.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import {
  matchWeb3AgentKitCallEnvelope,
  web3AgentKitContextCommitments,
  WEB3_AGENT_KIT_CALL_ENVELOPE_NAMESPACE,
  WEB3_AGENT_KIT_POLICY_DECISION_NAMESPACE
} from "../../sdk/dist/index.js";
const envelopeDigest = "0x86959D3AC803B33342B9AA33AFB8DC12665A7258DF69B91F838C34620BB4FBB8";
const policyDigest = "0xd1bfd4403cd8b94fa93fae95c2459c714c83247eabcdafa4317134258d2693ad";
test("binds the WAK envelope digest directly without a second hash", () => {
  const commitments = web3AgentKitContextCommitments({
    callEnvelopeDigest: envelopeDigest,
    policyDecisionDigest: policyDigest
  });
  assert.deepEqual(commitments, [
    {
      namespace: WEB3_AGENT_KIT_CALL_ENVELOPE_NAMESPACE,
      algorithm: "sha256",
      digest: envelopeDigest.toLowerCase()
    },
    {
      namespace: WEB3_AGENT_KIT_POLICY_DECISION_NAMESPACE,
      algorithm: "sha256",
      digest: policyDigest
    }
  ]);
});
test("matches exactly one WAK envelope commitment", () => {
  const [expected] = web3AgentKitContextCommitments({ callEnvelopeDigest: envelopeDigest });
  assert.deepEqual(
    matchWeb3AgentKitCallEnvelope({ contextCommitments: [expected] }, envelopeDigest),
    { matched: true, code: "OK", commitment: expected }
  );
  assert.equal(
    matchWeb3AgentKitCallEnvelope(
      { contextCommitments: [{ ...expected, digest: `0x${"00".repeat(32)}` }] },
      envelopeDigest
    ).code,
    "CONTEXT_COMMITMENT_DIGEST_MISMATCH"
  );
});
test("rejects malformed WAK digests instead of normalizing envelope content", () => {
  assert.throws(
    () => web3AgentKitContextCommitments({ callEnvelopeDigest: "not-a-digest" }),
    /32-byte 0x-prefixed hex/
  );
});
