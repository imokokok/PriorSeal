// Generated from observe-execution.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationTypedData, authorizeIntent, buildAuthorization, buildAuthorizationReceipt, buildIntent, createMemoryStore } from "../../src/index.mjs";
import { classifyExecutionCorrelation, observeExecution } from "../../src/application/observations/observe-execution.mjs";
const sender = `0x${"a".repeat(40)}`;
const recipient = `0x${"b".repeat(40)}`;
const txHash = `0x${"1".repeat(64)}`;
const authorizer = privateKeyToAccount(`0x${"1".repeat(64)}`);
function hasCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function acceptAuthorization({ intentId, nonce, store, privateKeyPem, keyId = "key-1" }) {
  const draft = buildAuthorization({ intent: { intentId, chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender, recipient, validUntil: 2e3, nonce }, principal: { type: "user", id: "user-1", account: authorizer.address }, authorizer: { type: "eip712", address: authorizer.address }, delegate: { agentId: "agent-1", executor: sender }, issuedAt: 1e3, expiresAt: 2e3, authorizationNonce: `0x${nonce.repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await authorizer.signTypedData(authorizationTypedData(draft)) });
  await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: "test", keyId, now: () => 1001e3 });
  return authorization;
}
test("observation is idempotent, linked to its intent, signed, and reorg-aware", async () => {
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
  const store = createMemoryStore({ clock: () => 1e6 });
  const intent = buildIntent({ intentId: "observe-1", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender, recipient, validUntil: 2e3, nonce: "0" });
  await store.saveIntent(intent);
  let calls = 0;
  const observer = async () => ({ schema: "priorseal.execution-observation.v1", chainId: 8453, txHash, status: "CONFIRMED", action: "TRANSFER", executedAt: 900, observedAt: 1e3 + calls, sender, recipient, asset: intent.asset, amount: intent.amount, nonce: "0", confirmations: 12, gasUsed: "21000", transfers: [], finalityState: "CONFIRMED", blockNumber: 10, blockHash: `0x${(++calls === 1 ? "c" : "d").repeat(64)}`, observationSource: "evm-json-rpc:eip155:8453:configured-1" });
  const options = { input: { intentId: intent.intentId, chainId: 8453, txHash, confirmations: 12 }, store, observer, privateKeyPem, publicKeyPem, issuer: "test", keyId: "key-1", now: () => 1e6 };
  const first = await observeExecution({ ...options, idempotencyKey: "observation-1" });
  const replay = await observeExecution({ ...options, idempotencyKey: "observation-1" });
  assert.equal(first.replay, false);
  assert.equal(replay.replay, true);
  assert.equal(calls, 1);
  assert.ok(first.response.receipt && first.response.verification);
  assert.equal(first.response.observation.intentHash, intent.intentHash);
  assert.equal(first.response.verification.valid, true);
  assert.equal(first.response.receipt.outcome, "COMPLETED");
  const reorg = await observeExecution({ ...options, idempotencyKey: "observation-2" });
  assert.ok(reorg.response.receipt);
  assert.equal(reorg.response.observation.status, "REORGED");
  assert.equal(reorg.response.observation.previousBlockHash, first.response.observation.blockHash);
  assert.equal(reorg.response.receipt.outcome, "REORGED");
  assert.notEqual(reorg.response.receipt.receiptId, first.response.receipt.receiptId);
  assert.equal((await store.getReceipt(first.response.receipt.receiptId))?.receiptId, first.response.receipt.receiptId);
});
test("pending transactions remain candidates and only final correlated execution claims authorization", async () => {
  const store = createMemoryStore();
  const authorization = buildAuthorization({ intent: { intentId: "claim-safe", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender, recipient, validUntil: 2e3, nonce: "4" }, principal: { type: "user", id: "user-1", account: `0x${"c".repeat(40)}` }, authorizer: { type: "eip712", address: `0x${"c".repeat(40)}` }, delegate: { agentId: "agent-1", executor: sender }, issuedAt: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"8".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}`, signature: "0x01" });
  await store.saveIntent(authorization.intent);
  const acceptance = buildAuthorizationReceipt({ authorization, issuer: "test", acceptedAt: 1001 });
  await store.saveAuthorization({ authorization, acceptance, policyEvidence: { schema: "priorseal.policy-evidence.v1", policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: 1001 } }, status: "ACCEPTED", boundTxHash: null, uses: 0 });
  const hostileHash = `0x${"9".repeat(64)}`;
  await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: hostileHash }, store, observer: async () => ({ chainId: 8453, txHash: hostileHash, status: "PENDING", executionDataAvailable: true, sender: `0x${"d".repeat(40)}`, nonce: "4", observedAt: 1002 }) });
  assert.equal((await store.getAuthorization(authorization.authorizationId))?.status, "ACCEPTED");
  const expectedHash = `0x${"7".repeat(64)}`;
  await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: expectedHash }, store, observer: async () => ({ chainId: 8453, txHash: expectedHash, status: "PENDING", executionDataAvailable: true, action: "TRANSFER", sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: "4", observedAt: 1003 }) });
  const candidate = await store.getAuthorization(authorization.authorizationId);
  assert.ok(candidate);
  assert.equal(candidate.status, "ACCEPTED");
  assert.equal(candidate.boundTxHash, null);
  const replacementHash = `0x${"6".repeat(64)}`;
  const final = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: replacementHash }, store, observer: async () => ({ chainId: 8453, txHash: replacementHash, status: "CONFIRMED", executionDataAvailable: true, action: "TRANSFER", sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: "4", executedAt: 1004, observedAt: 1005, confirmations: 12, gasUsed: "21000", transfers: [], finalityState: "CONFIRMED" }) });
  assert.equal(final.response.authorizationAssociation, "FINAL");
  const claimed = await store.getAuthorization(authorization.authorizationId);
  assert.ok(claimed);
  assert.equal(claimed.status, "BOUND");
  assert.equal(claimed.boundTxHash, replacementHash);
});
test("complete exact-call correlation is reported without reopening a final mismatched attempt", async () => {
  const store = createMemoryStore();
  const callTarget = `0x${"d".repeat(40)}`;
  const calldataHash = `0x${"2".repeat(64)}`;
  const authorization = buildAuthorization({ intent: { schema: "priorseal.intent.v2", executionProfile: "priorseal.execution-profile.exact-call.v1", intentId: "exact-correlation", chainId: 8453, action: "CONTRACT_CALL", asset: "eip155:8453/native", amount: "0", sender, recipient: callTarget, validUntil: 2e3, nonce: "9", callTarget, calldataHash, transactionValue: "3" }, principal: { type: "user", id: "user-1", account: `0x${"c".repeat(40)}` }, authorizer: { type: "eip712", address: `0x${"c".repeat(40)}` }, delegate: { agentId: "agent-1", executor: sender }, issuedAt: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"3".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}`, signature: "0x01" });
  await store.saveIntent(authorization.intent);
  const acceptance = buildAuthorizationReceipt({ authorization, issuer: "test", acceptedAt: 1001 });
  await store.saveAuthorization({ authorization, acceptance, policyEvidence: { schema: "priorseal.policy-evidence.v1", policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: 1001 } }, status: "ACCEPTED", boundTxHash: null, uses: 0 });
  const finalObservation = (hash, overrides = {}) => ({ chainId: 8453, txHash: hash, intentHash: authorization.intentHash, status: "CONFIRMED", executionDataAvailable: true, action: "CONTRACT_CALL", sender, recipient: callTarget, target: callTarget, calldataHash, nativeValue: "3", nonce: "9", executedAt: 1100, observedAt: 1101, confirmations: 12, finalityState: "CONFIRMED", ...overrides });
  const matchingHash = `0x${"f".repeat(64)}`;
  assert.equal(classifyExecutionCorrelation(authorization, finalObservation(matchingHash)), "MATCH");
  const mismatches = [
    { target: recipient },
    { calldataHash: `0x${"4".repeat(64)}` },
    { nativeValue: "4" },
    { action: "TRANSFER" },
    { sender: recipient },
    { nonce: "10" }
  ];
  for (const [index, mismatch] of mismatches.entries()) {
    const hash = `0x${String(index + 2).repeat(64)}`;
    assert.equal(classifyExecutionCorrelation(authorization, finalObservation(hash, mismatch)), "MISMATCH");
  }
  const mutatedHash = `0x${"e".repeat(64)}`;
  const mutated = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: mutatedHash }, store, observer: async () => finalObservation(mutatedHash, { calldataHash: `0x${"4".repeat(64)}` }) });
  assert.equal(mutated.response.authorizationAssociation, "FINAL");
  assert.equal(mutated.response.executionCorrelation, "MISMATCH");
  assert.equal((await store.getAuthorization(authorization.authorizationId))?.boundTxHash, mutatedHash);
});
test("observer responses cannot substitute another transaction or chain", async () => {
  const store = createMemoryStore();
  const intent = buildIntent({ intentId: "observer-identity", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender, recipient, validUntil: 2e3, nonce: "0" });
  await store.saveIntent(intent);
  await assert.rejects(
    () => observeExecution({ input: { intentId: intent.intentId, txHash }, store, observer: async () => ({ chainId: 8453, txHash: `0x${"2".repeat(64)}`, status: "PENDING" }) }),
    (error) => hasCode(error, "OBSERVATION_TX_HASH_MISMATCH")
  );
  await assert.rejects(
    () => observeExecution({ input: { intentId: intent.intentId, txHash }, store, observer: async () => ({ chainId: 1, txHash, status: "PENDING" }) }),
    (error) => hasCode(error, "OBSERVATION_CHAIN_MISMATCH")
  );
});
test("pending candidate reports non-assessable compliance without consuming authorization", async () => {
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
  const store = createMemoryStore();
  const authorization = await acceptAuthorization({ intentId: "pending-candidate", nonce: "5", store, privateKeyPem });
  const pendingHash = `0x${"5".repeat(64)}`;
  const result = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: pendingHash }, store, observer: async () => ({ chainId: 8453, txHash: pendingHash, status: "PENDING", executionDataAvailable: true, action: "TRANSFER", sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: "5", observedAt: 1002, finalityState: "PENDING" }), privateKeyPem, publicKeyPem, issuer: "test", keyId: "key-1", now: () => 1002e3 });
  assert.equal(result.response.authorizationAssociation, "CANDIDATE");
  assert.ok(result.response.receipt && isRecord(result.response.receipt.compliance));
  assert.equal(result.response.receipt.compliance.status, "NOT_ASSESSABLE");
  assert.deepEqual(result.response.receipt.compliance.reasonCodes, ["EXECUTION_PENDING"]);
  assert.equal((await store.getAuthorization(authorization.authorizationId))?.boundTxHash, null);
});
test("a receipt that fails self-verification cannot consume an authorization during key rotation", async () => {
  const oldKeys = generateKeyPairSync("ed25519");
  const newKeys = generateKeyPairSync("ed25519");
  const oldPrivateKeyPem = oldKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  const newPrivateKeyPem = newKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  const newPublicKeyPem = newKeys.publicKey.export({ type: "spki", format: "pem" });
  const store = createMemoryStore();
  const authorization = await acceptAuthorization({ intentId: "rotation-safe", nonce: "7", store, privateKeyPem: oldPrivateKeyPem, keyId: "old" });
  const rotatedHash = `0x${"7".repeat(64)}`;
  const observer = async () => ({ chainId: 8453, txHash: rotatedHash, status: "CONFIRMED", executionDataAvailable: true, action: "TRANSFER", sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: "7", executedAt: 1100, observedAt: 1101, confirmations: 12, gasUsed: "21000", transfers: [], finalityState: "CONFIRMED" });
  await assert.rejects(
    () => observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: rotatedHash }, store, observer, privateKeyPem: newPrivateKeyPem, publicKeyPem: newPublicKeyPem, issuer: "test", keyId: "new", now: () => 1101e3 }),
    (error) => hasCode(error, "INVALID_AUTHORIZATION_RECEIPT")
  );
  const record = await store.getAuthorization(authorization.authorizationId);
  assert.ok(record);
  assert.equal(record.status, "ACCEPTED");
  assert.equal(record.boundTxHash, null);
});
test("signed confirmation constraints cannot be relaxed by the observer request", async () => {
  const store = createMemoryStore();
  let confirmations;
  const intent = buildIntent({ intentId: "finality-floor", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender, recipient, validUntil: 2e3, constraints: { minConfirmations: 12 } });
  await store.saveIntent(intent);
  await observeExecution({ input: { intentId: intent.intentId, txHash, confirmations: 0 }, store, observer: async (input) => {
    confirmations = input.confirmations;
    return { chainId: 8453, txHash, status: "PENDING", executionDataAvailable: true, sender, nonce: "0", observedAt: 1001 };
  } });
  assert.equal(confirmations, 12);
  await assert.rejects(() => observeExecution({ input: { intentId: intent.intentId, txHash, confirmations: -1 }, store, observer: async () => ({ chainId: 8453, txHash, status: "PENDING" }) }), (error) => hasCode(error, "INVALID_REQUEST"));
});
test("an adapter cannot claim authorization with an under-finalized reverted observation", async () => {
  const store = createMemoryStore();
  const authorization = buildAuthorization({ intent: { intentId: "revert-finality-safe", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender, recipient, validUntil: 2e3, nonce: "6", constraints: { minConfirmations: 12 } }, principal: { type: "user", id: "user-1", account: `0x${"c".repeat(40)}` }, authorizer: { type: "eip712", address: `0x${"c".repeat(40)}` }, delegate: { agentId: "agent-1", executor: sender }, issuedAt: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"6".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}`, signature: "0x01" });
  await store.saveIntent(authorization.intent);
  const acceptance = buildAuthorizationReceipt({ authorization, issuer: "test", acceptedAt: 1001 });
  await store.saveAuthorization({ authorization, acceptance, policyEvidence: { schema: "priorseal.policy-evidence.v1", policyHash: authorization.policyHash, document: null, result: { allowed: true, reasonCodes: [], policyId: null, evaluatedAt: 1001 } }, status: "ACCEPTED", boundTxHash: null, uses: 0 });
  const revertedHash = `0x${"4".repeat(64)}`;
  const result = await observeExecution({ input: { authorizationId: authorization.authorizationId, txHash: revertedHash }, store, observer: async () => ({ chainId: 8453, txHash: revertedHash, status: "REVERTED", executionDataAvailable: true, action: "TRANSFER", sender, recipient, asset: authorization.intent.asset, amount: authorization.intent.amount, nonce: "6", executedAt: 1100, observedAt: 1101, confirmations: 1, finalityState: "INSUFFICIENT_FINALITY" }) });
  assert.equal(result.response.observation.status, "PENDING");
  assert.equal(result.response.authorizationAssociation, "CANDIDATE");
  assert.equal((await store.getAuthorization(authorization.authorizationId))?.boundTxHash, null);
});
test("observation idempotency rejects a reused key with different input", async () => {
  const store = createMemoryStore({ clock: () => 1e3 });
  const intent = buildIntent({ intentId: "observe-conflict", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender, recipient, validUntil: 2e3 });
  await store.saveIntent(intent);
  const observer = async ({ txHash: hash }) => ({ chainId: 8453, txHash: hash, status: "PENDING", action: "TRANSFER", observedAt: 1, sender, recipient, asset: intent.asset, amount: intent.amount, finalityState: "PENDING" });
  const base = { store, observer, issuer: "test", now: () => 1e3, idempotencyKey: "same" };
  await observeExecution({ ...base, input: { intentId: intent.intentId, txHash } });
  await assert.rejects(() => observeExecution({ ...base, input: { intentId: intent.intentId, txHash: `0x${"2".repeat(64)}` } }), (error) => hasCode(error, "IDEMPOTENCY_CONFLICT"));
});
test("intent rejects impossible confirmation floors and cross-chain assets", () => {
  const base = { intentId: "invalid-finality", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender, recipient, validUntil: 2e3 };
  assert.throws(() => buildIntent({ ...base, constraints: { minConfirmations: 10001 } }), (error) => hasCode(error, "INVALID_CONSTRAINT"));
  assert.throws(() => buildIntent({ ...base, asset: "eip155:1/native" }), (error) => hasCode(error, "INVALID_ASSET"));
});
test("intent rejects malformed chainIds with a protocol error", () => {
  const base = { intentId: "invalid-chain-list", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "1", sender, recipient, validUntil: 2e3 };
  assert.throws(() => buildIntent({ ...base, chainIds: "8453" }), (error) => hasCode(error, "INVALID_INTENT"));
});
