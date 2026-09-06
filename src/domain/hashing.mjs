import { canonicalize, hashJson, sha256Hex } from './canonical-json.mjs';
export { canonicalize, hashJson, sha256Hex };
export const INTENT_DOMAIN = 'priorseal/intent/v1';
export const RECEIPT_DOMAIN = 'priorseal/execution-receipt/v1';
export const domainHash = (domain, value) => sha256Hex(`${domain}:` + canonicalize(value));
