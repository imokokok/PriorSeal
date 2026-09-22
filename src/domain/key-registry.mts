export const KEY_REGISTRY_SCHEMA = 'priorseal.keys.v1';

export type KeyEntry = {
  issuer: string;
  keyId: string;
  algorithm: string;
  publicKey: string;
  status?: string;
  validFrom?: number | null;
  validUntil?: number | null;
  privateKeyPem?: string;
};

type StoredKeyEntry = KeyEntry & { status: string; validFrom: number | null; validUntil: number | null };

export function createKeyRegistry(entries: KeyEntry[] = []) {
  const keys = new Map<string, StoredKeyEntry>();
  entries.forEach((entry) => addEntry(keys, entry));
  return {
    get(keyId: string) { return keys.get(keyId); },
    list() { return [...keys.values()].map(({ privateKeyPem, ...publicEntry }) => publicEntry); },
    add(entry: KeyEntry) { addEntry(keys, entry); },
  };
}

function addEntry(keys: Map<string, StoredKeyEntry>, entry: KeyEntry) {
  if (!entry?.keyId || !entry.issuer || entry.algorithm !== 'Ed25519' || !entry.publicKey) throw new TypeError('A key requires issuer, keyId, algorithm Ed25519, and publicKey');
  if (entry.status && !['active', 'retired', 'revoked'].includes(entry.status)) throw new TypeError('Key status must be active, retired, or revoked');
  for (const field of ['validFrom', 'validUntil'] as const) {
    const value = entry[field];
    if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(`${field} must be a positive Unix timestamp or null`);
  }
  if (entry.validFrom != null && entry.validUntil != null && entry.validFrom > entry.validUntil) throw new TypeError('Key validFrom must not be after validUntil');
  keys.set(entry.keyId, { ...entry, status: entry.status ?? 'active', validFrom: entry.validFrom ?? null, validUntil: entry.validUntil ?? null });
}
