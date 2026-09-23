// Generated from values.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { PriorSealError } from "../../src/domain/errors.mjs";
import { domainHash, canonicalize, sha256Hex } from "../../src/domain/hashing.mjs";
import { chainId, evmAddress, txHash, uintString, protocolId, unixSeconds } from "../../src/domain/values.mjs";
test("migrated hashing facade preserves domain-separated bytes", () => {
  const value = { b: 2, a: 1 };
  assert.equal(domainHash("example/v1", value), sha256Hex(`example/v1:${canonicalize(value)}`));
});
test("migrated value validators preserve normalization and error codes", () => {
  assert.equal(chainId("eip155:8453"), 8453);
  assert.equal(evmAddress(`0x${"A".repeat(40)}`), `0x${"a".repeat(40)}`);
  assert.equal(txHash(`0x${"B".repeat(64)}`), `0x${"b".repeat(64)}`);
  assert.equal(uintString("0", "amount"), "0");
  assert.equal(protocolId("agent:one", "agentId"), "agent:one");
  assert.equal(unixSeconds("100", "issuedAt"), 100);
  const cases = [
    [() => chainId(0), "INVALID_CHAIN_ID"],
    [() => evmAddress("bad"), "INVALID_ADDRESS"],
    [() => txHash("bad"), "INVALID_TX_HASH"],
    [() => uintString("-1", "amount"), "INVALID_UINT"],
    [() => protocolId("bad id", "agentId"), "INVALID_IDENTIFIER"],
    [() => unixSeconds(0, "issuedAt"), "INVALID_TIME"]
  ];
  for (const [validate, code] of cases) {
    assert.throws(validate, (error) => error instanceof PriorSealError && error.code === code);
  }
});
