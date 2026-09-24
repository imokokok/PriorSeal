// TEST trust configuration reviewed against APS producer commit 948f99b8.
// Resolvers never derive their trust from the artifact's adjacent keys.json.
import type { KeyEntry } from 'priorseal-sdk';

export const APS_KEYS: Readonly<Record<'agent' | 'boundary' | 'principal', string>> = Object.freeze({
  agent: 'f80727401f51c1b7e41eeda7004b29aca9c9d7a017144c31f7370725514d6260',
  boundary: '6468a72acb50bf67fc180d0a092e22d1aa44a43268c8e2dc7b6302dc9199126c',
  principal: 'd69859e9701161194f0f583a2369d287ce895bf0e96b70db753b9e1e27b2bc94',
});
export function resolveApsKey(signer: string, keyId: string): string | undefined {
  if (keyId !== 'key-1') return undefined;
  return signer === 'did:example:agent' ? APS_KEYS.agent
    : signer === 'did:example:boundary' ? APS_KEYS.boundary : undefined;
}
export const PRIORSEAL_KEY: Readonly<KeyEntry> = Object.freeze({
  issuer: 'priorseal.aps-163-fixture',
  keyId: 'aps-163-priorseal-test-key-1',
  algorithm: 'Ed25519',
  status: 'active',
  validFrom: 1789776000,
  validUntil: null,
  publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4v4qObcyZkKCfW2C1JdiLNbCl/54Jw6qQ2sB8Ia288s=\n-----END PUBLIC KEY-----\n',
});
export const REFERENCE_TIME = '2026-09-19T10:05:00.000Z';
export const MANIFEST_SHA256 = '2bf365bc9124ecfc943d5be86c34e8e0cacd51a5929b8d0c906e633a017231f9';
