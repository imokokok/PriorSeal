// Generated from verification-bundle.mts by npm run core:build. Do not edit directly.
import { hashJson } from "./hashing.mjs";
const VERIFICATION_BUNDLE_SCHEMA = "priorseal.verification-bundle.v1";
const VERIFICATION_BUNDLE_TRUST = Object.freeze({
  model: "PIN_ISSUER_KEY_OUT_OF_BAND",
  notice: "Bundled keys are discovery metadata, not an independent trust anchor."
});
function buildVerificationBundle({ receipt, keyRegistry, assembledAt = Math.floor(Date.now() / 1e3) }) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new TypeError("receipt must be an object");
  const registry = keyRegistry;
  if (!registry || registry.schema !== "priorseal.keys.v1" || !Array.isArray(registry.keys)) throw new TypeError("keyRegistry must be a PriorSeal key registry");
  if (!Number.isSafeInteger(assembledAt) || assembledAt < 0) throw new TypeError("assembledAt must be a non-negative integer");
  const unsigned = {
    schema: VERIFICATION_BUNDLE_SCHEMA,
    receipt,
    keyRegistry,
    assembledAt,
    trust: VERIFICATION_BUNDLE_TRUST
  };
  return { ...unsigned, bundleHash: hashJson(unsigned) };
}
export {
  VERIFICATION_BUNDLE_SCHEMA,
  VERIFICATION_BUNDLE_TRUST,
  buildVerificationBundle
};
