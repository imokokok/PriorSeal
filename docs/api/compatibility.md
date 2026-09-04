# API and protocol compatibility

`/v1` remains the API namespace. Successful existing response shapes remain readable; `requestId` is additive. Error responses consistently use `{ error: { code, message, requestId, details? } }`; internals are never returned for 5xx errors.

`Idempotency-Key` is optional for compatibility and strongly recommended for writes. Reuse with the same request body returns the original result; reuse with different content returns `IDEMPOTENCY_CONFLICT`. Records expire after 24 hours.

OpenAPI is published at `/openapi/v1.json`. The source of truth for the signature protocol is the golden-vector test plus `canonical.mjs`. Do not reorder, omit, or normalize signed JSON fields. V1 receipts remain accepted; new receipt IDs include execution evidence to prevent cross-observation overwrite.
