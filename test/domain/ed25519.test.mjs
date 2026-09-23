// Generated from ed25519.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { assertEd25519KeyPair, signEd25519Statement, verifyEd25519Statement } from "../../src/domain/ed25519.mjs";
function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" })
  };
}
test("Ed25519 statements can be safely re-signed and require canonical signatures", () => {
  const keys = keyPair();
  const signed = signEd25519Statement({ domain: "test", value: 1 }, keys.privateKey);
  const resigned = signEd25519Statement(signed, keys.privateKey);
  assert.deepEqual(resigned, signed);
  assert.equal(verifyEd25519Statement(resigned, keys.publicKey), true);
  assert.equal(verifyEd25519Statement({ ...resigned, signature: `${resigned.signature}!` }, keys.publicKey), false);
  assert.equal(verifyEd25519Statement({ ...resigned, signature: `${resigned.signature}=` }, keys.publicKey), false);
});
test("issuer startup validation rejects mismatched and non-Ed25519 key material", () => {
  const first = keyPair();
  const second = keyPair();
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.equal(assertEd25519KeyPair(first.privateKey, first.publicKey), true);
  assert.throws(() => assertEd25519KeyPair(first.privateKey, second.publicKey), /do not match/);
  assert.throws(() => assertEd25519KeyPair(rsa.privateKey.export({ type: "pkcs8", format: "pem" }), rsa.publicKey.export({ type: "spki", format: "pem" })), /must be Ed25519/);
});
