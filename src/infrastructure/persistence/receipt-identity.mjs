// Generated from receipt-identity.mts by npm run core:build. Do not edit directly.
import { hashJson } from "../../domain/hashing.mjs";
function assertReceiptIdentity(existing, candidate) {
  if (!existing || !candidate || hashJson(existing) === hashJson(candidate)) return;
  const error = new Error("Receipt ID is already associated with different signed evidence");
  error.code = "RECEIPT_ID_CONFLICT";
  throw error;
}
export {
  assertReceiptIdentity
};
