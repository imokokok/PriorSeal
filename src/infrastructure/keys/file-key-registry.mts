import { readFileSync } from 'node:fs';
import { assertOnlyFields, assertSafeJson } from '../../shared/safe-json.mjs';
import type { KeyEntry } from '../../domain/key-registry.mjs';

/** Loads public historical verification keys. Private key fields are rejected. */
export function readFileKeyRegistry(file: string | null | undefined): KeyEntry[] {
  if (!file) return [];
  return parseKeyRegistryDocument(JSON.parse(readFileSync(file, 'utf8')));
}

export function parseKeyRegistryDocument(document: unknown): KeyEntry[] {
  if (document == null) return [];
  assertSafeJson(document);
  const registry = assertOnlyFields(document, ['schema', 'keys'], 'key registry file');
  if (registry.schema !== 'priorseal.keys.v1' || !Array.isArray(registry.keys)) throw new TypeError('Key registry file must use schema priorseal.keys.v1 and contain a keys array');
  return registry.keys.map((entry: unknown) => {
    const key = assertOnlyFields(entry, ['issuer', 'keyId', 'algorithm', 'publicKey', 'status', 'validFrom', 'validUntil'], 'key registry entry');
    if (typeof key.issuer !== 'string' || typeof key.keyId !== 'string' || typeof key.algorithm !== 'string' || typeof key.publicKey !== 'string') throw new TypeError('Key registry entry requires issuer, keyId, algorithm, and publicKey strings');
    if (key.status !== undefined && typeof key.status !== 'string') throw new TypeError('Key registry entry status must be a string');
    for (const field of ['validFrom', 'validUntil'] as const) if (key[field] != null && typeof key[field] !== 'number') throw new TypeError(`Key registry entry ${field} must be a number or null`);
    return key as KeyEntry;
  });
}
