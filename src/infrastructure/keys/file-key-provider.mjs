// Generated from file-key-provider.mts by npm run core:build. Do not edit directly.
import { readFileSync } from "node:fs";
function readPem(file) {
  const value = readFileSync(file, "utf8");
  return value.includes("\\n") && !value.includes("\n") ? value.replaceAll("\\n", "\n") : value;
}
function createFileKeyProvider({ privateKeyFile, publicKeyFile } = {}) {
  let privateKey;
  let publicKey;
  return {
    getPrivateKey() {
      if (!privateKeyFile) return void 0;
      privateKey ??= readPem(privateKeyFile);
      return privateKey;
    },
    getPublicKey() {
      if (!publicKeyFile) return void 0;
      publicKey ??= readPem(publicKeyFile);
      return publicKey;
    }
  };
}
export {
  createFileKeyProvider
};
