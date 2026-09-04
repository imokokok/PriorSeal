export const KEY_REGISTRY_SCHEMA = 'runproof.keys.v1';

export function createKeyRegistry(entries = []) {
  const keys = new Map();
  entries.forEach((entry) => addEntry(keys, entry));
  return {
    get(keyId) { return keys.get(keyId); },
    list() { return [...keys.values()].map(({ privateKeyPem, ...publicEntry }) => publicEntry); },
    add(entry) { addEntry(keys, entry); },
  };
}
function addEntry(keys, entry) {
  if (!entry?.keyId || !entry.issuer || entry.algorithm !== 'Ed25519' || !entry.publicKey) throw new TypeError('A key requires issuer, keyId, algorithm Ed25519, and publicKey');
  if (entry.status && !['active', 'retired', 'revoked'].includes(entry.status)) throw new TypeError('Key status must be active, retired, or revoked');
  keys.set(entry.keyId, { ...entry, status: entry.status ?? 'active' });
}
