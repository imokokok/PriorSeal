// Generated from file-key-registry.mts by npm run core:build. Do not edit directly.
import { readFileSync } from "node:fs";
import { assertOnlyFields, assertSafeJson } from "../../shared/safe-json.mjs";
function readFileKeyRegistry(file) {
  if (!file) return [];
  return parseKeyRegistryDocument(JSON.parse(readFileSync(file, "utf8")));
}
function parseKeyRegistryDocument(document) {
  if (document == null) return [];
  assertSafeJson(document);
  const registry = assertOnlyFields(document, ["schema", "keys"], "key registry file");
  if (registry.schema !== "priorseal.keys.v1" || !Array.isArray(registry.keys)) throw new TypeError("Key registry file must use schema priorseal.keys.v1 and contain a keys array");
  return registry.keys.map((entry) => {
    const key = assertOnlyFields(entry, ["issuer", "keyId", "algorithm", "publicKey", "status", "validFrom", "validUntil"], "key registry entry");
    if (typeof key.issuer !== "string" || typeof key.keyId !== "string" || typeof key.algorithm !== "string" || typeof key.publicKey !== "string") throw new TypeError("Key registry entry requires issuer, keyId, algorithm, and publicKey strings");
    if (key.status !== void 0 && typeof key.status !== "string") throw new TypeError("Key registry entry status must be a string");
    for (const field of ["validFrom", "validUntil"]) if (key[field] != null && typeof key[field] !== "number") throw new TypeError(`Key registry entry ${field} must be a number or null`);
    return key;
  });
}
export {
  parseKeyRegistryDocument,
  readFileKeyRegistry
};
