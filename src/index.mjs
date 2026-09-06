/** Public, stable library surface. Internal modules are intentionally not re-exported. */
export { createHttpServer } from './interfaces/http/create-http-server.mjs';
export { createObservationWorker } from './application/observations/observation-worker.mjs';
export { createMemoryStore } from './infrastructure/persistence/memory-store.mjs';
export { createPostgresStore } from './infrastructure/persistence/postgres-store.mjs';
export { buildIntent } from './domain/intent.mjs';
export { buildReceipt, signReceipt, verifySignature } from './domain/receipt.mjs';
export { verifyReceipt } from './domain/receipt-verifier.mjs';
export { createKeyRegistry } from './domain/key-registry.mjs';
export { buildAuthorization, authorizationTypedData, verifyAuthorization, buildAuthorizationReceipt, verifyAuthorizationReceipt, buildAuthorizedReceipt, validateAuthorizedReceiptClaims, verifyAuthorizedReceipt } from './domain/authorization.mjs';
export { authorizeIntent } from './application/authorizations/authorize-intent.mjs';
export { canonicalize, hashJson, sha256Hex } from './domain/canonical-json.mjs';
export { buildTransparencyEvidence, verifyTransparencyEvidence } from './domain/transparency.mjs';
export { buildWitnessPolicy, buildWitnessRequest, witnessRequestForAuthorization, buildWitnessAttestation, signWitnessAttestation, verifyWitnessAttestation, buildWitnessEvidence, verifyWitnessEvidence } from './domain/witness.mjs';
export { createHttpWitnessProvider, readWitnessEndpoints } from './infrastructure/witness/http-witness-client.mjs';
export { createWitnessHttpServer } from './interfaces/http/create-witness-http-server.mjs';
export { buildTimestampPolicy, createTimestampRequest, buildTimestampEvidence, validateTimestampEvidenceClaims, verifyTimestampEvidence, DIGICERT_RFC3161_PROFILE, DIGICERT_RFC3161_URL } from './domain/rfc3161.mjs';
export { createDigiCertTimestampProvider } from './infrastructure/timestamp/digicert-rfc3161-client.mjs';
