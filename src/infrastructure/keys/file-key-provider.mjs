import { readFileSync } from 'node:fs';

function readPem(file) {
  const value = readFileSync(file, 'utf8');
  // Some secret stores preserve pasted line breaks as the two characters "\\n".
  // Normalize that representation before handing the PEM to Node's crypto APIs.
  return value.includes('\\n') && !value.includes('\n') ? value.replaceAll('\\n', '\n') : value;
}

/** Development-only provider. It returns key material only to the signing composition root. */
export function createFileKeyProvider({ privateKeyFile, publicKeyFile } = {}) {
  let privateKey; let publicKey;
  return {
    getPrivateKey() { if (!privateKeyFile) return undefined; privateKey ??= readPem(privateKeyFile); return privateKey; },
    getPublicKey() { if (!publicKeyFile) return undefined; publicKey ??= readPem(publicKeyFile); return publicKey; },
  };
}
