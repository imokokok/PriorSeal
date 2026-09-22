// Generated from hashing.mts by npm run core:build. Do not edit directly.
import { canonicalize, hashJson, sha256Hex } from "./canonical-json.mjs";
const INTENT_DOMAIN = "priorseal/intent/v1";
const RECEIPT_DOMAIN = "priorseal/execution-receipt/v1";
const domainHash = (domain, value) => sha256Hex(`${domain}:` + canonicalize(value));
export {
  INTENT_DOMAIN,
  RECEIPT_DOMAIN,
  canonicalize,
  domainHash,
  hashJson,
  sha256Hex
};
