// Generated from rwa-hardening.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sdk from "../../sdk/dist/index.js";
import { inspectRwaReceiptBundle as browserInspect } from "../../sdk/dist/verifier.js";
import { createRwaAttemptStore, executeRwaAuthorized, reconcileRwaAttempt } from "../../src/index.mjs";
import { workflowFixture } from "../../examples/rwa-v2/workflow-fixture.mjs";
import { signRwaV2Fixture } from "../../examples/rwa-v2/fixture.mjs";
import { rwaFixture, signRwaFixture } from "../../examples/rwa-v1/fixture.mjs";
async function setup(t) {
  const x = await workflowFixture(sdk), directory = await mkdtemp(join(tmpdir(), "priorseal-rwa-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  x.directory = directory;
  x.attempts = createRwaAttemptStore({ directory });
  x.calls = 0;
  x.deps = { authorizationStore: x.store, attempts: x.attempts, clock: () => x.f.now, submit: async (tx) => {
    assert.deepEqual(tx, x.f.transaction);
    x.calls++;
    return x.txHash;
  } };
  return x;
}
test("independent OS processes atomically reserve a signer nonce only once", async (t) => {
  const x = await setup(t), run = promisify(execFile);
  const source = `import {createRwaAttemptStore} from ${JSON.stringify(new URL("../../src/infrastructure/persistence/rwa-attempt-store.mjs", import.meta.url).href)}; const s=createRwaAttemptStore({directory:process.argv[1]});try{console.log(JSON.stringify(await s.reserve(JSON.parse(process.argv[2]))))}catch(e){console.log(JSON.stringify({code:e.message}))}`;
  const args = JSON.stringify({ authorizationId: x.input.authorizationId, transaction: x.f.transaction, executionDigest: x.input.execution.proof.digest, now: x.f.now });
  const results = await Promise.all(Array.from({ length: 6 }, () => run(process.execPath, ["--input-type=module", "-e", source, x.directory, args])));
  assert.equal(results.map((r) => JSON.parse(r.stdout)).filter((r) => r.claimed === true).length, 1);
  assert.equal((await x.attempts.get(x.input.authorizationId)).status, "RESERVED");
});
for (const content of ["{broken", JSON.stringify({ schema: "priorseal.rwa-attempt-journal.v1", attempts: [], nonces: [] }), JSON.stringify({ schema: "priorseal.rwa-attempt-journal.v1", attempts: {}, nonces: { orphan: "missing" } })]) test("corrupt journal never becomes a fresh writable store: " + content.slice(0, 20), async (t) => {
  const x = await setup(t);
  await writeFile(join(x.directory, "journal.json"), content);
  await assert.rejects(executeRwaAuthorized(x.input, x.deps));
  assert.equal(x.calls, 0);
});
test("v1 key order is representation-only; old signatures and strict temporal semantics remain", async (t) => {
  const x = await setup(t), f = rwaFixture(sdk), authority = await signRwaFixture(sdk, x.signer, f), execution = await signRwaFixture(sdk, x.signer, rwaFixture(sdk, f.now + 2));
  execution.trust = structuredClone(authority.trust);
  const extra = { address: "0x" + "77".repeat(20), validFrom: f.now - 10, validUntil: f.now + 100, revoked: false };
  authority.trust.keys.push(extra);
  execution.trust.keys.unshift(extra);
  const intent = await sdk.buildRwaBoundIntent({ transaction: f.transaction, intentId: "v1-permutations", asset: "eip155:8453/erc20:" + f.input.instrument.tokenAddress, amount: f.input.request.amount, validUntil: f.now + 30 }, authority, f.now);
  assert.equal((await sdk.verifyRwaExecutionPair({ intent, authority, execution, authorityTime: f.now, executionTime: f.now + 2 })).valid, true);
  const blocked = rwaFixture(sdk);
  blocked.input.market.halt = "HALTED";
  const signed = await signRwaFixture(sdk, x.signer, blocked);
  const inspected = await sdk.inspectRwaReport(signed.proof, signed.trust, f.now);
  assert.equal(inspected.integrity, "PASS");
  assert.equal(inspected.trust, "PASS");
  assert.equal(inspected.decision, "BLOCK");
  assert.equal(inspected.admissible, false);
});
test("full v2 flow: same-second linked assessments, principal, persisted submit, receipt and browser verification", async (t) => {
  const x = await setup(t), result = await executeRwaAuthorized(x.input, x.deps);
  assert.equal(result.attempt.status, "SUBMITTED");
  assert.equal(x.calls, 1);
  const pair = { receipt: x.receipt(), authority: x.input.authority.proof, execution: x.input.execution.proof };
  for (const inspect of [sdk.inspectRwaReceiptBundle, browserInspect]) {
    const r = await inspect(pair, x.input.authority.trust, x.options);
    assert.equal(r.admissible, true, JSON.stringify(r));
    assert.equal(r.execution, "SATISFIED");
  }
  const replay = await executeRwaAuthorized(x.input, { ...x.deps, attempts: createRwaAttemptStore({ directory: x.directory }) });
  assert.equal(replay.replay, true);
  assert.equal(x.calls, 1);
});
test("completed replay rejects a different execution digest without resubmitting", async (t) => {
  const x = await setup(t);
  await executeRwaAuthorized(x.input, x.deps);
  const changed = structuredClone(x.input);
  changed.execution.proof.digest = "0x" + "00".repeat(32);
  await assert.rejects(executeRwaAuthorized(changed, x.deps), /RWA_REPLAY_EVIDENCE_MISMATCH/);
  assert.equal(x.calls, 1);
});
test("reserve race rejects a different execution digest without submitting", async (t) => {
  const x = await setup(t), stored = { authorizationId: x.input.authorizationId, transaction: x.f.transaction, executionDigest: "0x" + "00".repeat(32), nonceKey: "test", status: "RESERVED", txHash: null, updatedAt: x.f.now };
  const attempts = { ...x.attempts, get: async () => null, reserve: async () => ({ claimed: false, attempt: stored }) };
  await assert.rejects(executeRwaAuthorized(x.input, { ...x.deps, attempts }), /RWA_REPLAY_EVIDENCE_MISMATCH/);
  assert.equal(x.calls, 0);
});
test("two simultaneous callers with independent store handles cannot broadcast twice", async (t) => {
  const x = await setup(t);
  const results = await Promise.allSettled([executeRwaAuthorized(x.input, x.deps), executeRwaAuthorized(x.input, { ...x.deps, attempts: createRwaAttemptStore({ directory: x.directory }) })]);
  assert.equal(x.calls, 1, JSON.stringify(results));
  assert.ok(results.some((r) => r.status === "fulfilled"));
});
test("lost RPC response remains uncertain after restart; observer reconciles without resend", async (t) => {
  const x = await setup(t);
  await assert.rejects(executeRwaAuthorized(x.input, { ...x.deps, submit: async () => {
    x.calls++;
    throw Error("response lost");
  } }), /response lost/);
  const restarted = createRwaAttemptStore({ directory: x.directory });
  assert.equal((await restarted.get(x.input.authorizationId)).status, "UNCERTAIN");
  assert.equal((await executeRwaAuthorized(x.input, { ...x.deps, attempts: restarted })).replay, true);
  assert.equal(x.calls, 1);
  const result = await reconcileRwaAttempt(x.input.authorizationId, { ...x.deps, attempts: restarted, observe: async () => ({ transaction: x.f.transaction, txHash: x.txHash, status: "CONFIRMED", finalized: true }) });
  assert.equal(result.status, "CONFIRMED");
  assert.equal(x.calls, 1);
});
test("new authorization cannot reuse claimed chain/sender/nonce", async (t) => {
  const x = await setup(t);
  await executeRwaAuthorized(x.input, x.deps);
  const claim = await x.attempts.reserve({ authorizationId: "auth_" + "77".repeat(16), transaction: x.f.transaction, executionDigest: x.input.execution.proof.digest, now: x.f.now });
  assert.equal(claim.claimed, false);
  assert.equal(claim.code, "RWA_NONCE_ALREADY_RESERVED");
});
for (const mode of ["bad-signature", "wrong-intent", "wrong-audience", "revoked-issuer", "changed-call", "wrong-predecessor", "wrong-sequence", "expired", "locked-store"]) test("no submit on " + mode, async (t) => {
  const x = await setup(t);
  if (mode === "bad-signature") {
    const real = x.store.getAuthorization;
    x.deps.authorizationStore = { ...x.store, getAuthorization: async (id) => {
      const r = await real(id);
      r.authorization.signature = "0x" + "00".repeat(65);
      return r;
    } };
  }
  if (mode === "wrong-intent") x.input.intent.intentId = "changed";
  if (mode === "wrong-audience") x.input.audience = "different";
  if (mode === "revoked-issuer") x.input.acceptanceKey.status = "revoked";
  if (mode === "changed-call") x.input.transaction.data = "0x1234";
  if (mode === "wrong-predecessor") x.input.execution = await signRwaV2Fixture(sdk, x.signer, x.f, "1", "0x" + "00".repeat(32));
  if (mode === "wrong-sequence") x.input.execution = await signRwaV2Fixture(sdk, x.signer, x.f, "2", x.input.authority.proof.digest);
  if (mode === "expired") x.deps.clock = () => x.f.now + 30;
  if (mode === "locked-store") await mkdir(join(x.directory, "journal.lock"));
  await assert.rejects(executeRwaAuthorized(x.input, x.deps));
  assert.equal(x.calls, 0);
});
test("clock crossing expiry during persistent claim never enters signer", async (t) => {
  const x = await setup(t);
  let now = x.f.now;
  x.deps.clock = () => now;
  x.deps.attempts = { ...x.attempts, reserve: async (args) => {
    const r = await x.attempts.reserve(args);
    now += 30;
    return r;
  } };
  await assert.rejects(executeRwaAuthorized(x.input, x.deps));
  assert.equal(x.calls, 0);
  assert.equal((await x.attempts.get(x.input.authorizationId)).status, "REJECTED");
});
test("persistence failure before SUBMITTING never enters signer", async (t) => {
  const x = await setup(t);
  x.deps.attempts = { ...x.attempts, transition: async () => {
    throw Error("disk failed");
  } };
  await assert.rejects(executeRwaAuthorized(x.input, x.deps), /disk failed/);
  assert.equal(x.calls, 0);
  assert.equal((await x.attempts.get(x.input.authorizationId)).status, "RESERVED");
});
test("persistence failure after broadcast retains claim and cannot submit again", async (t) => {
  const x = await setup(t), transition = x.attempts.transition;
  x.deps.attempts = { ...x.attempts, transition: async (id, expected, patch) => {
    if (patch.status === "SUBMITTED") throw Error("disk failed");
    return transition(id, expected, patch);
  } };
  await assert.rejects(executeRwaAuthorized(x.input, x.deps), /disk failed/);
  assert.equal(x.calls, 1);
  assert.equal((await executeRwaAuthorized(x.input, x.deps)).replay, true);
  assert.equal(x.calls, 1);
});
test("reconciliation rejects a different actual call and non-final observation", async (t) => {
  const x = await setup(t);
  await executeRwaAuthorized(x.input, x.deps);
  for (const observed of [{ transaction: { ...x.f.transaction, nonce: "8" }, txHash: x.txHash, status: "CONFIRMED", finalized: true }, { transaction: x.f.transaction, txHash: x.txHash, status: "CONFIRMED", finalized: false }])
    await assert.rejects(reconcileRwaAttempt(x.input.authorizationId, { ...x.deps, observe: async () => observed }), /MISMATCH/);
});
test("trust-key permutations and casing do not change v2 pair admission", async (t) => {
  const x = await setup(t), extra = { address: "0x" + "77".repeat(20), validFrom: x.f.now - 10, validUntil: x.f.now + 100, revoked: false };
  x.input.authority.trust.keys.push(extra);
  x.input.execution.trust.keys.unshift(extra);
  x.input.execution.trust.keys[1].address = x.input.execution.trust.keys[1].address.toLowerCase();
  await executeRwaAuthorized(x.input, x.deps);
  assert.equal(x.calls, 1);
});
for (const mode of ["reverted", "under-output", "wrong-receiver", "missing-transfers", "tamper", "missing-key"]) test("detailed receipt distinguishes " + mode, async (t) => {
  const x = await setup(t), observed = structuredClone(x.observed);
  if (mode === "reverted") observed.status = "REVERTED";
  const transfers = observed.transfers;
  if (mode === "under-output") transfers[1].amount = "1";
  if (mode === "wrong-receiver") transfers[1].recipient = x.f.transaction.from;
  if (mode === "missing-transfers") delete observed.transfers;
  const receipt = x.receipt(observed);
  if (mode === "tamper") receipt.execution.nonce = "8";
  if (mode === "missing-key") delete x.options.trustedKeys;
  const r = await sdk.inspectRwaReceiptBundle({ receipt, authority: x.input.authority.proof, execution: x.input.execution.proof }, x.input.authority.trust, x.options);
  assert.equal(r.admissible, false);
  assert.equal(r.integrity, mode === "tamper" ? "FAIL" : mode === "missing-key" ? "NOT_CHECKED" : "PASS", JSON.stringify(r));
  if (["reverted", "under-output", "wrong-receiver"].includes(mode)) {
    assert.equal(r.claims, "PASS");
    assert.equal(r.execution, "FAILED");
  }
  if (mode === "missing-transfers") assert.equal(r.execution, "NOT_CHECKED");
});
