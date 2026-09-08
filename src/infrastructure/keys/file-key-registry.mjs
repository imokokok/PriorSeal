import { readFileSync } from 'node:fs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';

/** Loads public historical verification keys. Private key fields are rejected. */
export function readFileKeyRegistry(file) {
  if (!file) return [];
  return parseKeyRegistryDocument(JSON.parse(readFileSync(file, 'utf8')));
}

export function parseKeyRegistryDocument(document) {
  if (document == null) return [];
  assertSafeJson(document);
  assertOnlyFields(document, ['schema', 'keys'], 'key registry file');
  if (document.schema !== 'priorseal.keys.v1' || !Array.isArray(document.keys)) throw new TypeError('Key registry file must use schema priorseal.keys.v1 and contain a keys array');
  for (const entry of document.keys) assertOnlyFields(entry, ['issuer', 'keyId', 'algorithm', 'publicKey', 'status', 'validFrom', 'validUntil'], 'key registry entry');
  return document.keys;
}
