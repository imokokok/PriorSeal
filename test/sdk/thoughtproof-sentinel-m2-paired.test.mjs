// Generated from thoughtproof-sentinel-m2-paired.test.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runFixtureChecks,
  verifyCalldataFixtures,
  verifyExactCallDecisionSubject
} from "../../examples/thoughtproof-sentinel-paired-v2/verify.reference.mjs";
import { buildIntent } from "../../src/index.mjs";
import { buildExactCallIntent } from "../../sdk/dist/index.js";
const fixtureUrl = new URL("../../examples/thoughtproof-sentinel-paired-v2/", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, fixtureUrl), "utf8"));
test("ThoughtProof Sentinel M2 proposal vectors bind the signed decision subject to the PriorSeal exact call", async () => {
  const results = await runFixtureChecks({ log: () => {
  } });
  assert.equal(results.length, 30);
  assert.deepEqual(
    results.filter((result) => result.code === "DECISION_COMMITMENT_VERIFIED").map((result) => result.name),
    ["M2 exact-call matching pair", "intent amount is outside M2 subject binding"]
  );
});
test("M2 subject whitelist rejects authorization-only fields", () => {
  const expected = readJson("expected.json");
  const artifact = readJson("export-valid.json");
  const canonical = JSON.parse(artifact.canonical);
  const receipt = readJson("priorseal-receipt-matching.json");
  const intent = receipt.authorizationEvidence.authorization.intent;
  canonical.decisionSubject.principal = receipt.authorizationEvidence.authorization.principal.account;
  assert.equal(
    verifyExactCallDecisionSubject(canonical, intent, expected).code,
    "DECISION_SUBJECT_INVALID"
  );
});
test("M2 subject requires canonical lowercase addresses and bytes32 values", () => {
  const expected = readJson("expected.json");
  const artifact = readJson("export-valid.json");
  const canonical = JSON.parse(artifact.canonical);
  const receipt = readJson("priorseal-receipt-matching.json");
  const intent = receipt.authorizationEvidence.authorization.intent;
  canonical.decisionSubject.executor = canonical.decisionSubject.executor.toUpperCase().replace("0X", "0x");
  assert.equal(
    verifyExactCallDecisionSubject(canonical, intent, expected).code,
    "DECISION_SUBJECT_INVALID"
  );
});
test("M2 verifies raw calldata derivation including empty bytes", () => {
  const fixtures = readJson("calldata-fixtures.json");
  const results = verifyCalldataFixtures(fixtures);
  assert.deepEqual(results.map((result) => result.name), [
    "non-empty calldata derivation",
    "empty calldata derivation"
  ]);
  assert.equal(
    fixtures.cases.find((fixture) => fixture.data === "0x").expectedCalldataHash,
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
});
test("M2 refuses string chain IDs instead of coercing them", () => {
  const expected = readJson("expected.json");
  const artifact = readJson("export-valid.json");
  const canonical = JSON.parse(artifact.canonical);
  const receipt = readJson("priorseal-receipt-matching.json");
  const intent = { ...receipt.authorizationEvidence.authorization.intent, chainId: "8453" };
  const { intentHash: _intentHash, ...intentInput } = intent;
  assert.equal(
    verifyExactCallDecisionSubject(canonical, intent, expected).code,
    "PRIORSEAL_EXACT_CALL_REQUIRED"
  );
  assert.throws(
    () => buildIntent(intentInput),
    (error) => typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_CHAIN_ID"
  );
  assert.throws(
    () => buildExactCallIntent({
      transaction: {
        chainId: "8453",
        from: intent.sender,
        to: intent.callTarget,
        data: "0x",
        nonce: 1n
      },
      intentId: "strict-chain-id",
      asset: "eip155:8453/native",
      amount: "0",
      validUntil: 2e9
    }),
    /positive JSON integer/
  );
});
test("M2 excludes contract creation and separates transaction nonce from authorization replay", () => {
  const receipt = readJson("priorseal-receipt-matching.json");
  const authorization = receipt.authorizationEvidence.authorization;
  const artifact = readJson("export-valid.json");
  const subject = JSON.parse(artifact.canonical).decisionSubject;
  assert.equal(subject.transactionNonce, authorization.intent.nonce);
  assert.notEqual(subject.transactionNonce, authorization.authorizationNonce);
  assert.throws(
    () => buildExactCallIntent({
      transaction: {
        chainId: 8453,
        from: authorization.intent.sender,
        to: null,
        data: "0x",
        nonce: 1n
      },
      intentId: "contract-creation-excluded",
      asset: "eip155:8453/native",
      amount: "0",
      validUntil: 2e9
    }),
    /transaction.to must be a 20-byte EVM address/
  );
});
test("M2 treats amount as signed PriorSeal context outside subject equality", () => {
  const receipt = readJson("priorseal-receipt-amount-outside-m2-binding.json");
  const subject = JSON.parse(readJson("export-valid.json").canonical).decisionSubject;
  const authorization = receipt.authorizationEvidence.authorization;
  assert.equal(authorization.intent.amount, "42000000");
  assert.equal(authorization.intent.transactionValue, subject.transactionValue);
  assert.notEqual(authorization.intent.amount, subject.transactionValue);
});
