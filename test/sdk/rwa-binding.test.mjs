// Generated from rwa-binding.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import * as sdk from "../../sdk/dist/index.js";
import { rwaFixture, signRwaFixture } from "../../examples/rwa-v1/fixture.mjs";
const key = privateKeyToAccount(`0x${"12".repeat(32)}`);
async function setup() {
  const f = rwaFixture(sdk), authority = await signRwaFixture(sdk, key, f);
  const intent = await sdk.buildRwaBoundIntent({ transaction: f.transaction, intentId: "rwa-test", asset: "eip155:8453/erc20:" + f.input.instrument.tokenAddress, amount: f.input.request.amount, validUntil: f.now + 100, contextCommitments: [{ namespace: "example.other.v1", algorithm: "keccak256", digest: "0x" + "aa".repeat(32) }] }, authority, f.now);
  const later = rwaFixture(sdk, f.now + 2), execution = await signRwaFixture(sdk, key, later);
  execution.trust = structuredClone(authority.trust);
  return { f, intent, authority, execution, authorityTime: f.now };
}
const commitments = (value) => {
  if (!value.intent.contextCommitments) throw new TypeError("Expected RWA context commitments");
  return value.intent.contextCommitments;
};
const rwaCommitment = (value) => {
  const commitment = commitments(value).find((candidate) => candidate.namespace === sdk.RWA_COMMITMENT_NAMESPACE);
  if (!commitment) throw new TypeError("Expected RWA context commitment");
  return commitment;
};
test("opt-in binding preserves other commitments, caps expiry, and executes exact call", async () => {
  const x = await setup();
  assert.equal(commitments(x).length, 2);
  assert.equal(x.intent.validUntil, x.f.now + 30);
  let call;
  await sdk.withRwaBoundIntent(x.intent, x.authority, x.f.transaction, async (tx) => {
    call = tx;
  }, () => x.f.now);
  assert.deepEqual(call, x.f.transaction);
  assert.equal((await sdk.verifyRwaExecutionPair({ ...x, executionTime: x.f.now + 2 })).valid, true);
});
const changes = {
  "missing commitment": (x) => {
    x.intent.contextCommitments = [];
  },
  "duplicate commitment": (x) => {
    commitments(x).push(structuredClone(rwaCommitment(x)));
  },
  "changed commitment": (x) => {
    rwaCommitment(x).digest = `0x${"00".repeat(32)}`;
  },
  "extended deadline": (x) => x.intent.validUntil++,
  "different asset": (x) => x.intent.asset = "eip155:8453/native",
  "different amount": (x) => x.intent.amount = "2",
  "different data": (x) => x.f.transaction.data = "0xabcd",
  "different nonce": (x) => x.f.transaction.nonce = "8",
  "different sender": (x) => x.f.transaction.from = "0x" + "99".repeat(20),
  "different target": (x) => x.f.transaction.to = "0x" + "99".repeat(20),
  "different value": (x) => x.f.transaction.value = "1",
  "different chain": (x) => x.f.transaction.chainId = 1,
  "untrusted proof": (x) => {
    const trustKey = x.authority.trust.keys[0];
    if (!trustKey) throw new TypeError("Expected trust key");
    trustKey.revoked = true;
  }
};
for (const [name, change] of Object.entries(changes)) test("callback never entered: " + name, async () => {
  const x = await setup();
  change(x);
  let called = false;
  await assert.rejects(sdk.withRwaBoundIntent(x.intent, x.authority, x.f.transaction, async () => called = true, () => x.f.now));
  assert.equal(called, false);
});
test("snapshot prevents caller mutation during async verification", async () => {
  const x = await setup();
  let data;
  const task = sdk.withRwaBoundIntent(x.intent, x.authority, x.f.transaction, async (tx) => {
    data = tx.data;
  }, () => x.f.now);
  x.f.transaction.data = "0xffff";
  await task;
  assert.equal(data, "0x1234");
});
test("signature verification crossing expiry cannot enter callback", async () => {
  const x = await setup();
  let reads = 0, called = false;
  await assert.rejects(sdk.withRwaBoundIntent(x.intent, x.authority, x.f.transaction, async () => called = true, () => ++reads === 1 ? x.f.now : x.f.now + 30));
  assert.equal(called, false);
});
for (const mode of ["same-report", "halt", "stale", "wrong-pins", "changed-transaction", "expiry-during-verification"]) test("fresh execution guard rejects " + mode, async () => {
  const x = await setup();
  if (mode === "same-report") x.execution = x.authority;
  if (mode === "halt") {
    const f = rwaFixture(sdk, x.f.now + 2);
    if (!f.input.market) throw new TypeError("Expected market state");
    f.input.market.halt = "HALTED";
    x.execution = await signRwaFixture(sdk, key, f);
    x.execution.trust = x.authority.trust;
  }
  if (mode === "wrong-pins") x.execution.trust.request.call.nonce = "8";
  if (mode === "changed-transaction") x.f.transaction.data = "0xffff";
  let called = false, reads = 0;
  const clock = () => {
    reads++;
    return mode === "stale" || mode === "expiry-during-verification" && reads > 1 ? x.f.now + 32 : x.f.now + 2;
  };
  await assert.rejects(sdk.withRwaExecutionPair(x, x.f.transaction, async () => called = true, clock));
  assert.equal(called, false);
});
