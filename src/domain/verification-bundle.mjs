import { hashJson } from './hashing.mjs';

export const VERIFICATION_BUNDLE_SCHEMA = 'priorseal.verification-bundle.v1';
export const VERIFICATION_BUNDLE_TRUST = Object.freeze({
  model: 'PIN_ISSUER_KEY_OUT_OF_BAND',
  notice: 'Bundled keys are discovery metadata, not an independent trust anchor.',
});

export function buildVerificationBundle({ receipt, keyRegistry, assembledAt = Math.floor(Date.now() / 1000) }) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new TypeError('receipt must be an object');
  if (!keyRegistry || keyRegistry.schema !== 'priorseal.keys.v1' || !Array.isArray(keyRegistry.keys)) throw new TypeError('keyRegistry must be a PriorSeal key registry');
  if (!Number.isSafeInteger(assembledAt) || assembledAt < 0) throw new TypeError('assembledAt must be a non-negative integer');
  const unsigned = {
    schema: VERIFICATION_BUNDLE_SCHEMA,
    receipt,
    keyRegistry,
    assembledAt,
    trust: VERIFICATION_BUNDLE_TRUST,
  };
  return { ...unsigned, bundleHash: hashJson(unsigned) };
}
