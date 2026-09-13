import { createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';
import { canonicalize } from './hashing.mjs';

const ED25519_SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;

export function signEd25519Statement(statement, privateKeyPem) {
  const { signature: _existingSignature, ...unsigned } = statement ?? {};
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Signing key must be Ed25519');
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalize(unsigned)), key).toString('base64url') };
}

export function verifyEd25519Statement(statement, publicKeyPem) {
  const { signature, ...unsigned } = statement ?? {};
  if (typeof signature !== 'string' || !ED25519_SIGNATURE_RE.test(signature)) return false;
  try {
    const signatureBytes = Buffer.from(signature, 'base64url');
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64url') !== signature) return false;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(canonicalize(unsigned)), key, signatureBytes);
  } catch {
    return false;
  }
}

export function assertEd25519KeyPair(privateKeyPem, publicKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(publicKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Issuer keys must be Ed25519');
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const configured = publicKey.export({ type: 'spki', format: 'der' });
  if (derived.length !== configured.length || !timingSafeEqual(derived, configured)) throw new TypeError('Issuer private and public keys do not match');
  return true;
}
