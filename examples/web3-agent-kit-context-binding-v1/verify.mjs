// Generated from verify.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  matchWeb3AgentKitCallEnvelope,
  web3AgentKitContextCommitments
} from "../../sdk/dist/index.js";
const vector = JSON.parse(await readFile(new URL("./vector.json", import.meta.url), "utf8"));
const canonicalPayload = JSON.stringify(
  vector.callEnvelope.payload,
  Object.keys(vector.callEnvelope.payload).sort()
);
const recomputed = `0x${createHash("sha256").update(`${vector.callEnvelope.domain}\0${canonicalPayload}`, "utf8").digest("hex")}`;
assert.equal(recomputed, vector.callEnvelope.digest, "WAK CallEnvelopeV1 digest mismatch");
const commitments = web3AgentKitContextCommitments({
  callEnvelopeDigest: vector.callEnvelope.digest,
  policyDecisionDigest: vector.policyDecision.digest
});
assert.deepEqual(commitments, vector.priorSeal.contextCommitments);
const binding = matchWeb3AgentKitCallEnvelope(
  { contextCommitments: commitments },
  vector.callEnvelope.digest
);
assert.deepEqual(binding, {
  matched: true,
  code: "OK",
  commitment: vector.priorSeal.contextCommitments[0]
});
process.stdout.write(
  `${JSON.stringify(
    {
      status: "PASS",
      callEnvelopeDigest: recomputed,
      priorSealBinding: binding.code,
      secondNormalization: false,
      secondHash: false,
      policyDecisionDomainSeparated: commitments[1].namespace !== commitments[0].namespace
    },
    null,
    2
  )}
`
);
