import { canonicalize, hashJson, sha256Hex } from './canonical-json.mjs';
export { canonicalize, hashJson, sha256Hex };
export const INTENT_DOMAIN = 'runproof/intent/v1';
export const RECEIPT_DOMAIN = 'runproof/execution-receipt/v1';
export const domainHash = (domain, value) => sha256Hex(`${domain}:` + canonicalize(value));
