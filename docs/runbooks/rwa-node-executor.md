# RWA Node executor with shared PostgreSQL claims

The optional Node executor combines `executeRwaAuthorized`, `createPostgresRwaAttemptStore` and `createRwaViemSubmitter`. It is a caller-owned transaction signer. Cloudflare Workers/D1 hosting remains unchanged; this adapter is for the supported Node deployment/executor path.

## Configuration

1. Use Node 22 or newer. Run `npm run sdk:build` and `npm run core:build`.
2. Apply migrations with `npm run db:migrate` and the existing direct `DATABASE_URL_UNPOOLED` configuration. Migration `011_rwa_execution_attempts.sql` adds permanent authorization and signer nonce claims. Historical migrations are unchanged.
3. Connect authorization storage and attempts to the same durable primary PostgreSQL deployment. Every instance sharing a delegate signer must share the attempt table. Require durable commits, primary reads and backups; replicas and per-instance databases cannot arbitrate these claims.
4. Supply a Viem wallet client with an explicit chain and a local account from the executor's secret manager. Use `http(url, { retryCount: 0, batch: false })` or `custom(provider, { retryCount: 0 })`; the custom provider must not retry broadcasts internally. Fallback transports are rejected because they can rebroadcast despite a request-level retry limit. Admit deployment code, instrument, policy and issuer pins independently before using a production RWA profile.

```ts
import {
  createPostgresStore,
  createPostgresRwaAttemptStore,
  createRwaViemSubmitter,
  executeRwaAuthorized,
} from '../../src/index.mjs';

// pool, walletClient and input are supplied by the composition root.
// input contains the principal authorization, linked signed assessments,
// exact transaction, audience and independently admitted acceptance key.
const result = await executeRwaAuthorized(input, {
  authorizationStore: createPostgresStore(pool),
  attempts: createPostgresRwaAttemptStore(pool),
  submit: createRwaViemSubmitter(walletClient),
});
// A replay is for observation only; never submit that attempt again.
```

The submitter validates RPC chain, delegate and nonce, prepares gas/fees, rechecks the authorization and reports, signs, then decodes the signed bytes. Sender, chain, target, calldata, value and nonce must equal the admitted transaction. It rechecks the gate after signing and broadcasts with request retries disabled. The response must equal the locally computed transaction hash.

Custom submitters receive `(transaction, assertBeforeBroadcast)`. Call the guard after asynchronous preparation and immediately before broadcast, send only the supplied exact call, and disable broadcast retries. One-argument callbacks remain structurally compatible; callbacks that ignore the guard cannot claim protection against preparation-time expiry/revocation.

## Recovery

Claims never expire or release, including `REJECTED`, `UNCERTAIN` and reverted attempts. A response loss may leave a permanent claim without a known hash. Replay cannot authorize a resend. `SUBMITTED` preserves the known hash; confirmed/reverted states are terminal. Recovery patches cannot clear or replace that hash.

Use `reconcileRwaAttempt` with a trusted observer returning the exact transaction and a finalized confirmed/reverted hash. It compares the committed call and repairs authorization binding without broadcasting. Observer finality is an assertion, not a cryptographic chain proof. Corrupt storage and mismatched indexed identities fail closed.

Never delete/truncate the table while the signer may have submitted transactions. Restoring an old backup can lose later claims: quiesce every signer instance and reconcile chain nonce/history before resuming. Direct signing outside the shared entry is outside its guarantee.

## Validation

```bash
npm run core:build
npm run core:build:tests
node --test test/infrastructure/postgres-rwa-attempt-store.test.mjs test/sdk/rwa-viem-submitter.test.mjs
GANACHE_MODULE=/path/to/ganache/dist/node/core.js node scripts/rwa-local-execution-drill.mjs
```

CI supplies PostgreSQL 17 through `RWA_TEST_DATABASE_URL`; otherwise the same SQL runs in embedded PostgreSQL (PGlite). The EVM drill deploys valueless test ERC-20 tokens and a simulation router, consumes the linked signed RWA reports, sends one signed call, observes two local token transfers and checks the receiver balance. It verifies the authorized receipt through both SDK entry points, restores the database and verifies replay cannot broadcast again.

Accounts, issuer facts, tokens, router and reports in the drill are synthetic. It validates execution/verification wiring. Production RWA eligibility, reserves, legal rights and venue correctness require separate admitted evidence.
