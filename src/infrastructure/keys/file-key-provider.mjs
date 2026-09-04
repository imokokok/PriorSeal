import { readFileSync } from 'node:fs';

/** Development-only provider. It returns key material only to the signing composition root. */
export function createFileKeyProvider({ privateKeyFile, publicKeyFile } = {}) {
  let privateKey; let publicKey;
  return {
    getPrivateKey() { if (!privateKeyFile) return undefined; privateKey ??= readFileSync(privateKeyFile, 'utf8'); return privateKey; },
    getPublicKey() { if (!publicKeyFile) return undefined; publicKey ??= readFileSync(publicKeyFile, 'utf8'); return publicKey; },
  };
}
