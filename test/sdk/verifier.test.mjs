// Generated from verifier.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildIntent, buildReceipt, buildMerkleTransparencyEvidence, buildTransparencyEvidence, buildVerificationBundle, canonicalize, createMemoryStore, hashJson } from "../../src/index.mjs";
import { signReceipt } from "../../src/domain/receipt.mjs";
import { verifyReceiptLocally, verifyVerificationBundleLocally } from "../../sdk/dist/verifier.js";
function issuerKeys() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" })
  };
}
function trustedKey(publicKey) {
  return { issuer: "test", keyId: "key-1", algorithm: "Ed25519", publicKey, status: "active", validFrom: null, validUntil: null };
}
test("SDK verifier validates a v1 receipt locally and detects mutations", async () => {
  assert.equal((await verifyReceiptLocally(null)).code, "INVALID_RECEIPT");
  assert.equal((await verifyVerificationBundleLocally([])).code, "INVALID_VERIFICATION_BUNDLE");
  const keys = issuerKeys();
  const sender = `0x${"a".repeat(40)}`;
  const recipient = `0x${"b".repeat(40)}`;
  const intent = buildIntent({ intentId: "sdk-v1", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender, recipient, validUntil: 2e3, nonce: "1" });
  const execution = { chainId: 8453, txHash: `0x${"1".repeat(64)}`, status: "CONFIRMED", action: "TRANSFER", executedAt: 1100, observedAt: 1101, sender, recipient, asset: intent.asset, amount: intent.amount, finalityState: "CONFIRMED" };
  const receipt = signReceipt(buildReceipt({ intent, execution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  const verified = await verifyReceiptLocally(receipt, { trustedKeys: { schema: "priorseal.keys.v1", issuer: "test", keys: [trustedKey(keys.publicKey)] }, now: 1200 });
  assert.equal(verified.valid, true);
  assert.equal(verified.verificationScope, "LOCAL_COMPLETE");
  assert.deepEqual(verified.requiredExternalChecks, []);
  assert.equal((await verifyReceiptLocally(signReceipt({ ...receipt, executionHash: "changed" }, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "EXECUTION_HASH_MISMATCH");
  assert.equal((await verifyReceiptLocally({ ...receipt, signature: `${receipt.signature}!` }, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "INVALID_SIGNATURE");
  assert.equal((await verifyReceiptLocally(receipt, { trustedKeys: [trustedKey(keys.publicKey), trustedKey(keys.publicKey)], now: 1200 })).code, "AMBIGUOUS_KEY");
  assert.equal((await verifyReceiptLocally(receipt, { trustedKeys: { ...trustedKey(keys.publicKey), status: "unknown" }, now: 1200 })).code, "INVALID_KEY");
  assert.equal((await verifyReceiptLocally(receipt, { trustedKeys: { schema: "priorseal.keys.v1", issuer: "lookalike", keys: [trustedKey(keys.publicKey)] }, now: 1200 })).code, "INVALID_KEY_REGISTRY");
  const bundle = buildVerificationBundle({ receipt, keyRegistry: { schema: "priorseal.keys.v1", issuer: "test", keys: [trustedKey(keys.publicKey)] }, assembledAt: 1101 });
  assert.equal((await verifyVerificationBundleLocally(bundle, { now: 1200 })).code, "UNKNOWN_KEY");
  assert.equal((await verifyVerificationBundleLocally(bundle, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).valid, true);
  const tampered = structuredClone(bundle);
  const tamperedExecution = tampered.receipt.execution;
  tamperedExecution.status = "REVERTED";
  assert.equal((await verifyVerificationBundleLocally(tampered, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "BUNDLE_HASH_MISMATCH");
});
test("SDK verifier independently validates authorization-bound receipt v3, policy, compliance and signatures", async () => {
  const keys = issuerKeys();
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const executor = `0x${"a".repeat(40)}`;
  const intent = { intentId: "sdk-v2", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender: executor, recipient: `0x${"b".repeat(40)}`, validUntil: 2e3, nonce: "7" };
  const policy = { policyId: "separated-authority-v1", requireDistinctAuthorizerAndExecutor: true };
  const draft = buildAuthorization({ intent, principal: { type: "user", id: "user-1", account: account.address }, authorizer: { type: "eip712", address: account.address }, delegate: { agentId: "agent-1", executor }, issuedAt: 1e3, notBefore: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"2".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${hashJson(policy)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const store = createMemoryStore({ clock: () => 1001e3 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem: keys.privateKey, issuer: "test", keyId: "key-1", policy, now: () => 1001e3 });
  const execution = { chainId: 8453, txHash: `0x${"3".repeat(64)}`, status: "CONFIRMED", action: "TRANSFER", sender: executor, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, executedAt: 1100, observedAt: 1101, confirmations: 12, gasUsed: "21000", transfers: [], finalityState: "CONFIRMED" };
  const entries = await store.listAuthorizationLog();
  const anchor = { type: "eip155", chainId: 8453, contract: `0x${"c".repeat(40)}`, txHash: `0x${"d".repeat(64)}`, blockNumber: 10, anchoredAt: 1099, size: 1, headEntryHash: entries[0].entryHash };
  const transparency = buildTransparencyEvidence({ entries, acceptance: accepted.response.acceptance, issuer: "test", keyId: "key-1", privateKeyPem: keys.privateKey, issuedAt: 1099, anchor, before: execution.executedAt });
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, transparency, execution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  const verified = await verifyReceiptLocally(receipt, { trustedKeys: [trustedKey(keys.publicKey)], now: 1200 });
  assert.equal(verified.valid, true);
  assert.equal(verified.code, "OK");
  assert.equal(verified.executionStatus, "CONFIRMED");
  assert.equal(verified.complianceStatus, "COMPLIANT");
  assert.equal(verified.authorizationId, authorization.authorizationId);
  assert.ok(receipt.authorizationEvidence.policy.document);
  assert.equal(receipt.authorizationEvidence.policy.document.requireDistinctAuthorizerAndExecutor, true);
  assert.equal(verified.verificationScope, "EXTERNAL_CHECK_REQUIRED");
  for (let sequence = 2; sequence <= 1024; sequence += 1) await store.appendAuthorizationLog({ authorizationHash: sequence.toString(16).padStart(64, "0"), acceptedAt: 1002 });
  const snapshot = await store.getAuthorizationMerkleSnapshot(accepted.response.acceptance);
  const compactTransparency = buildMerkleTransparencyEvidence({ acceptance: accepted.response.acceptance, snapshot, issuer: "test", keyId: "key-1", privateKeyPem: keys.privateKey, issuedAt: 1099 });
  const compactReceipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, transparency: compactTransparency, execution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  assert.ok(Buffer.byteLength(JSON.stringify(compactReceipt)) < 64 * 1024);
  assert.equal(compactTransparency.proof.length, 10);
  assert.equal((await verifyReceiptLocally(compactReceipt, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).valid, true);
  const tamperedCompact = structuredClone(compactReceipt);
  assert.ok(tamperedCompact.authorizationEvidence.transparency?.proof?.[0]);
  tamperedCompact.authorizationEvidence.transparency.proof[0].hash = "f".repeat(64);
  assert.equal((await verifyReceiptLocally(signReceipt(tamperedCompact, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "INVALID_TRANSPARENCY_PROOF");
  const lateAnchorReceipt = structuredClone(receipt);
  assert.ok(lateAnchorReceipt.authorizationEvidence.transparency?.checkpoint?.anchor);
  lateAnchorReceipt.authorizationEvidence.transparency.checkpoint.anchor.anchoredAt = 1101;
  const checkpoint = lateAnchorReceipt.authorizationEvidence.transparency.checkpoint;
  const { signature: _checkpointSignature, ...unsignedCheckpoint } = checkpoint;
  checkpoint.signature = sign(null, Buffer.from(canonicalize(unsignedCheckpoint)), keys.privateKey).toString("base64url");
  const { signature: _receiptSignature, ...unsignedReceipt } = lateAnchorReceipt;
  const resignedLateAnchorReceipt = signReceipt(unsignedReceipt, keys.privateKey);
  assert.equal((await verifyReceiptLocally(resignedLateAnchorReceipt, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "INVALID_TRANSPARENCY_PROOF");
  const mutated = structuredClone(receipt);
  mutated.authorizationEvidence.authorization.delegate.agentId = "agent-impersonated";
  assert.equal((await verifyReceiptLocally(signReceipt(mutated, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "AUTHORIZATION_ID_MISMATCH");
  const extendedAuthorization = structuredClone(receipt);
  const extendedAuthorizationValue = extendedAuthorization.authorizationEvidence.authorization;
  extendedAuthorizationValue.unsignedPrivilege = true;
  assert.equal((await verifyReceiptLocally(signReceipt(extendedAuthorization, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "INVALID_AUTHORIZATION");
  assert.equal((await verifyReceiptLocally(signReceipt({ ...receipt, validUntil: 1999 }, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "VALID_UNTIL_MISMATCH");
});
test("SDK verifier enforces the expected authorization audience", async () => {
  const keys = issuerKeys();
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const executor = `0x${"a".repeat(40)}`;
  const intent = { intentId: "sdk-audience", chainId: 8453, action: "TRANSFER", asset: "eip155:8453/native", amount: "10", sender: executor, recipient: `0x${"b".repeat(40)}`, validUntil: 2e3, nonce: "7", constraints: { minConfirmations: 12, maxGasUsed: "21000" } };
  const draft = buildAuthorization({ intent, principal: { type: "user", id: "user-1", account: account.address }, authorizer: { type: "eip712", address: account.address }, delegate: { agentId: "agent-1", executor }, issuedAt: 1e3, notBefore: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"7".repeat(64)}`, maxUses: "1", audience: "partner-deployment", policyHash: `0x${"0".repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const accepted = await authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => 1001e3 }), privateKeyPem: keys.privateKey, issuer: "test", keyId: "key-1", audience: "partner-deployment", now: () => 1001e3 });
  const execution = { chainId: 8453, txHash: `0x${"7".repeat(64)}`, status: "CONFIRMED", action: "TRANSFER", sender: executor, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, executedAt: 1100, observedAt: 1101, confirmations: 12, gasUsed: "21000", transfers: [], finalityState: "CONFIRMED" };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  assert.equal((await verifyReceiptLocally(receipt, { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "AUTHORIZATION_AUDIENCE_MISMATCH");
  assert.equal((await verifyReceiptLocally(receipt, { trustedKeys: trustedKey(keys.publicKey), expectedAudience: "partner-deployment", now: 1200 })).valid, true);
  const pendingExecution = { ...execution, confirmations: 1, finalityState: "INSUFFICIENT_FINALITY" };
  const pendingReceipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution: pendingExecution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  assert.equal(pendingReceipt.outcome, "PENDING");
  assert.equal((await verifyReceiptLocally(pendingReceipt, { trustedKeys: trustedKey(keys.publicKey), expectedAudience: "partner-deployment", now: 1200 })).valid, true);
  const { gasUsed: _gasUsed, ...missingGasExecution } = execution;
  const missingGasReceipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, execution: missingGasExecution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  assert.ok(missingGasReceipt.compliance);
  assert.equal(missingGasReceipt.compliance.status, "NOT_ASSESSABLE");
  assert.equal((await verifyReceiptLocally(missingGasReceipt, { trustedKeys: trustedKey(keys.publicKey), expectedAudience: "partner-deployment", now: 1200 })).valid, true);
});
test("SDK verifier independently validates exact-call receipts with multi-transfer execution", async () => {
  const keys = issuerKeys();
  const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
  const executor = `0x${"a".repeat(40)}`;
  const router = `0x${"c".repeat(40)}`;
  const calldataHash = `0x${"4".repeat(64)}`;
  const intent = {
    schema: "priorseal.intent.v2",
    executionProfile: "priorseal.execution-profile.exact-call.v1",
    intentId: "sdk-exact-call",
    chainId: 8453,
    action: "CONTRACT_CALL",
    asset: "eip155:8453/erc20:0x1111111111111111111111111111111111111111",
    amount: "1000000",
    sender: executor,
    recipient: router,
    validUntil: 2e3,
    nonce: "7",
    callTarget: router,
    calldataHash,
    transactionValue: "0",
    contextCommitments: [{ namespace: "insight.pretrade-pair.v1", algorithm: "keccak256", digest: `0x${"8".repeat(64)}` }]
  };
  const draft = buildAuthorization({ intent, principal: { type: "user", id: "user-1", account: account.address }, authorizer: { type: "eip712", address: account.address }, delegate: { agentId: "insight:swap-agent", executor }, issuedAt: 1e3, notBefore: 1e3, expiresAt: 2e3, authorizationNonce: `0x${"9".repeat(64)}`, maxUses: "1", audience: "priorseal", policyHash: `0x${"0".repeat(64)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const accepted = await authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => 1001e3 }), privateKeyPem: keys.privateKey, issuer: "test", keyId: "key-1", now: () => 1001e3 });
  const execution = { chainId: 8453, txHash: `0x${"6".repeat(64)}`, status: "CONFIRMED", action: "CONTRACT_CALL", sender: executor, recipient: `0x${"d".repeat(40)}`, target: router, calldataHash, nativeValue: "0", asset: "eip155:8453/erc20:0x2222222222222222222222222222222222222222", amount: "999", nonce: "7", executedAt: 1100, observedAt: 1101, confirmations: 12, gasUsed: "180000", transfers: [{}, {}], finalityState: "CONFIRMED" };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, execution, issuer: "test", keyId: "key-1", issuedAt: 1101 }), keys.privateKey);
  const verified = await verifyReceiptLocally(receipt, { trustedKeys: trustedKey(keys.publicKey), now: 1200 });
  assert.equal(verified.valid, true);
  assert.equal(verified.code, "OK");
  assert.equal(receipt.outcome, "COMPLETED");
  assert.ok(receipt.compliance);
  assert.equal(receipt.compliance.status, "COMPLIANT");
  const contextMutated = structuredClone(receipt);
  assert.ok(contextMutated.authorizationEvidence.authorization.intent.contextCommitments?.[0]);
  contextMutated.authorizationEvidence.authorization.intent.contextCommitments[0].digest = `0x${"7".repeat(64)}`;
  assert.equal((await verifyReceiptLocally(signReceipt(contextMutated, keys.privateKey), { trustedKeys: trustedKey(keys.publicKey), now: 1200 })).code, "INTENT_HASH_MISMATCH");
});
test("SDK verifier reports chain-state requirements without making network calls", async () => {
  const receipt = { issuer: "test", keyId: "key-1", outcome: "UNDETERMINED", receiptId: "psr_external", authorizationEvidence: { authorization: { authorizer: { type: "eip1271", address: `0x${"c".repeat(40)}` }, intent: { chainId: 8453 } }, transparency: { checkpoint: { anchor: { type: "eip155", chainId: 1, contract: `0x${"d".repeat(40)}`, txHash: `0x${"e".repeat(64)}`, blockNumber: 10 } } } } };
  const result = await verifyReceiptLocally(receipt, { trustedKeys: [] });
  assert.equal(result.verificationScope, "EXTERNAL_CHECK_REQUIRED");
  assert.deepEqual(result.requiredExternalChecks.map((check) => check.type), ["ERC1271", "EVM_ANCHOR"]);
});
