export const KEY_REGISTRY_SCHEMA = 'runproof.keys.v1';

export function createKeyRegistry(entries = []) {
  const keys = new Map(entries.map((entry) => [entry.keyId, { ...entry }]));
  return {
    get(keyId) { return keys.get(keyId); },
    list() { return [...keys.values()].map(({ privateKeyPem, ...publicEntry }) => publicEntry); },
    add(entry) {
      if (!entry?.keyId || entry.algorithm !== 'Ed25519' || !entry.publicKey) throw new TypeError('A key requires keyId, algorithm Ed25519, and publicKey');
      keys.set(entry.keyId, { ...entry });
    },
  };
}
