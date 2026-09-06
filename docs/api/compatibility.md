# API and protocol compatibility

`/v1` remains the API namespace. Successful existing response shapes remain readable; `requestId` is additive. Error responses consistently use `{ error: { code, message, requestId, details? } }`; internals are never returned for 5xx errors.

`POST /v1/intents` remains available for legacy unsigned v1 evidence and is deprecated. New clients use `POST /v1/authorizations/prepare`, sign the returned EIP-712 typed data, submit it to `POST /v1/authorizations`, and pass `authorizationId` to `POST /v1/executions/observe`. This produces `runproof.execution-receipt.v2`. V2 authorization evidence includes `runproof.policy-evidence.v1`, containing the policy snapshot and result used at acceptance. RFC 3161 deployments add `runproof.rfc3161-evidence.v1`; witness-quorum deployments add `runproof.witness-evidence.v1`. Verifiers must enforce the corresponding evidence whenever the signed policy contains `timestampPolicy` or `witnessQuorum`. V1 and v2 receipts have different domains and remain independently verifiable.

Standalone witnesses expose `POST /v1/witness/attest`, public liveness/readiness endpoints, and `GET /.well-known/runproof-witness-key.json`. A successful attestation response is idempotent for the canonical request hash. Clients must trust the witness public key from the principal-signed authorization policy, not a key learned only from the same HTTP response.

`Idempotency-Key` is optional for compatibility and strongly recommended for writes. Reuse with the same request body returns the original result; reuse with different content returns `IDEMPOTENCY_CONFLICT`. Records expire after 24 hours.

OpenAPI is published at `/openapi/v1.json`. The source of truth for the signature protocol is the golden-vector and authorization tests plus canonical JSON. Do not reorder, omit, or normalize signed JSON fields. V1 receipts remain accepted; v2 receipt IDs bind authorization and execution evidence.
