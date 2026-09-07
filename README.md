# PriorSeal

PriorSeal creates portable evidence connecting user or organization authority to an agent's observed EVM execution:

```text
Draft intent → EIP-712/ERC-1271 authorization → RFC 3161 timestamp → EVM observation → binding result → Ed25519 receipt → offline verification
```

It does not custody assets, operate wallets, or hold transaction-signing keys. A valid receipt proves only that its issuer signed the included claims; it is not an economic-safety guarantee or proof that an RPC source is infallible. Local, independent receipt verification is authoritative; the HTTP verification endpoint is a convenience.

## Quick start

Requires Node 20+. In a clean checkout:

```bash
npm ci
cp .env.example .env.local
# Set development-only PRIORSEAL_* key-file paths and a configured RPC endpoint in .env.local.
npm run start:api
npm --prefix web run dev
```

The console is served by Vite on its displayed URL and proxies API calls to port 3000. It stores browser-local session activity only; it is not a server-side evidence archive. Amounts are atomic unsigned integer strings (never floats), such as `"1000000"`.

To run the receipt example (which creates its ignored temporary artifact directory):

```bash
npm run example:receipt
npm run verify:receipt
# Or verify arbitrary files:
npm run verify:receipt -- /path/to/receipt.json /path/to/public-key.pem
```

## TypeScript SDK

The typed `priorseal-sdk` package is the supported browser and Node.js 20+ integration surface:

```bash
npm install priorseal-sdk
```

```ts
import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.example' })
const { accepted } = await priorseal.authorizeWithWallet({
  intent,
  principal: { type: 'user', id: 'user:42' },
  delegate: { agentId: 'agent:treasury', executor: intent.sender }
}, window.ethereum)

const evidence = await priorseal.observeExecution({
  authorizationId: accepted.authorization.authorizationId,
  chainId: Number(intent.chainId),
  txHash,
  confirmations: 12
})
```

The SDK handles typed API calls, exact-call intent construction, wallet authorization, durable observation polling, idempotency, timeouts and structured errors. Import `verifyReceiptLocally` or `verifyVerificationBundleLocally` from `priorseal-sdk/verifier` to verify evidence without sending receipt bytes to PriorSeal. It does not sign or submit transactions. ERC-1271 and EVM anchors are reported as explicit external chain-state requirements. See [`sdk/README.md`](sdk/README.md) and the console route `/app/sdk`.

## Quality checks

```bash
npm run check          # JS syntax lint, SDK/web typecheck, tests, SDK/web build
npm run test:coverage
npm run audit
npm run release:check  # full gate including browser E2E, coverage and production-dependency audit
```

The API contract is at `/openapi/v1.json`. Operational endpoints are `/health/live`, `/health/ready`, and `/v1/version`. The default console uses signed `priorseal.authorization.v2` authorizations; it binds the principal and authorizer types, agent ID and executor into EIP-712. Legacy authorization v1 remains verification-only, and `POST /v1/intents` remains a deprecated compatibility path for unsigned receipt v1 evidence.

## API and security boundaries

`POST /v1/authorizations/prepare` canonicalizes a draft and returns EIP-712 typed data. `POST /v1/authorizations` accepts the resulting EOA signature or an ERC-1271 contract-account signature, evaluates the configured policy, and issues a signed acceptance statement. A change-controlled `policy.principals` registry can bind reviewed user or organization IDs to specific accounts and authorizer types; its snapshot and independently recomputable evaluation are embedded in v2 receipts. Without that registry, PriorSeal proves account control but treats the human-readable principal ID as self-asserted. `POST /v1/executions/observe` accepts `authorizationId`; only a transaction matching the authorization chain, executor and transaction nonce may claim the single-use authorization, and it produces a v2 receipt containing the complete evidence chain. Use an `Idempotency-Key` for writes. The same key and request body replay a result for 24 hours; a different body produces `IDEMPOTENCY_CONFLICT`.

V2 verification recomputes the intent, authorization and execution hashes, binding reason codes, outcome and receipt ID before checking the authorizer, acceptance and issuer signatures. Browser-local verification supports EIP-712 EOAs. ERC-1271 verification is contract-state dependent: the default server checks current state through a configured EVM source, while strong historical verification requires an archive-state check, module event, or a future account-state proof profile.

For swaps, routers and other calls that emit several token transfers, use `priorseal.intent.v2` with `executionProfile: "priorseal.execution-profile.exact-call.v1"`. It requires an explicit transaction nonce, call target, calldata hash and native value. Optional `contextCommitments` bind up to 16 namespaced SHA-256 or Keccak-256 digests—such as quote proofs, policy decisions or approvals—without teaching PriorSeal their business semantics. Binding verifies the exact transaction envelope, execution time and finality without guessing from `Transfer` logs.

Pending observations return a durable `observationJob`; callers can resume by job ID or use `observeExecutionUntilFinal`. `GET /v1/receipts/{receiptId}/bundle` exports the receipt, key-discovery snapshot and an integrity hash. Bundle verification still requires a trusted issuer key pinned outside the bundle; an attacker-controlled bundle cannot establish its own trust root.

The simplest Gas-free ordering mode is `rfc3161`. PriorSeal sends only the SHA-256 imprint of the canonical authorization to DigiCert's RFC 3161 TSA, verifies the returned CMS signature, timestamping certificate usage, certificate path, pinned DigiCert roots, policy OID and nonce, then stores the complete response. The signed `timestampPolicy` makes this requirement part of the principal-approved policy hash. The final receipt carries `priorseal.rfc3161-evidence.v1`, which both server and browser verifiers reject if it was changed or timestamped after execution. No wallet, contract, witness deployment or Gas is required.

Gas-free multi-operator ordering remains available with a signed `2-of-3` (or stricter) witness policy. The policy hash signed by the principal commits to every witness ID and Ed25519 public key. PriorSeal sends only the authorization digest to separately operated witness services, validates the returned signatures before accepting the authorization, and embeds them in the final receipt. Both the server and browser verifier reject duplicate witnesses, changed keys, insufficient quorum, or attestations timestamped after execution. Start a witness with `npm run start:witness`; keep endpoint URLs and bearer tokens in `PRIORSEAL_WITNESS_ENDPOINTS_FILE`, outside the public signed policy.

Startup configuration is validated before the HTTP server listens: `PORT` must be 1–65535, `PRIORSEAL_TRUST_PROXY` must be `true` or `false`, CORS entries must be complete HTTP(S) origins, and issuer key paths must be configured as a pair.

Only configured RPC endpoints are used (`PRIORSEAL_RPC_ETHEREUM`, `PRIORSEAL_RPC_BASE`, `PRIORSEAL_RPC_ARBITRUM`). Receipts contain a non-secret configured-source identifier, never the endpoint URL. RPC timeouts, not-found states, and inconsistent/invalid responses are not treated as on-chain failure or success. Confirmed observations include the containing block timestamp and finality. A signed intent confirmation floor cannot be relaxed by the observation request, and production policies can require `minConfirmations`. Re-observing a transaction whose confirmed block hash changed—or which disappeared after prior inclusion—creates new `REORGED` evidence without overwriting the old signed receipt.

Intent `validUntil` bounds the block execution time; it does not expire a receipt. Historical receipts remain cryptographically verifiable. The console verifies pasted receipts locally with browser Web Crypto and can use either a pasted trusted public key or a key fetched from the registry; receipt bytes are not sent to the convenience verification API.

Issuer private keys are read only from a configured local file for development and must never enter HTTP requests, logs, the frontend bundle, database records, or Git. `PRIORSEAL_KEY_REGISTRY_FILE` may point to a public-only `priorseal.keys.v1` JSON document so retired keys remain published for historical verification. Production deployments should replace the signing provider with a KMS/HSM/secret-manager adapter. See [the threat model](docs/security/threat-model.md), [API compatibility](docs/api/compatibility.md), and [lifecycle](docs/architecture/lifecycle.md).

Accepted authorizations are appended to a signed hash-chain checkpoint. `PRIORSEAL_TRANSPARENCY_ANCHOR_FILE` can attach a confirmed external EVM anchor to a checkpoint without giving PriorSeal custody of an anchoring wallet; startup verifies the successful anchor call, block and timestamp against a configured RPC. See [signed authorization](docs/architecture/signed-authorization.md). The Solidity contracts under `contracts/` are unaudited reference implementations and must not be enabled on a production Safe or funded account.

Production mode is fail-closed. Set `PRIORSEAL_ENVIRONMENT=production`; startup then requires explicit database URLs, issuer keys, non-default issuer/audience values, a reviewed principal policy, production CORS, and `PRIORSEAL_PREEXECUTION_PROOF_MODE=rfc3161`, `witness-quorum`, or `evm-anchor`. The production example uses `rfc3161`. EVM mode remains available for deployments that require public-chain consensus; `npm run contracts:build`, `npm run anchor:prepare`, and `npm run anchor:record` support its custody-free workflow.

## Persistence and operations

Neon is the production persistence backend. `DATABASE_URL` is the pooled application connection and `DATABASE_URL_UNPOOLED` is used only by `npm run db:migrate`. Apply migrations through `007_observation_job_results.sql`; they establish authorization, timestamp and witness evidence storage, durable intents, observation versions, idempotency records, and recoverable at-least-once worker results. Migrations are forward-only. Read [database operations](docs/runbooks/database.md) before applying them.

For a local container environment:

```bash
docker compose up --build
```

Mount issuer key files read-only outside the image and inject production configuration through the deployment secret system. Do not use the compose database password outside local development. See [operations](docs/runbooks/operations.md) for RPC outage, reorg, backup/restore, and key-rotation procedures.

## Architecture

PriorSeal is a modular monolith with explicit dependency direction: `domain` contains pure protocol rules, `application` coordinates use cases, `infrastructure` implements persistence/blockchain/key adapters, `interfaces` exposes HTTP, and `bootstrap` wires runtime configuration. `src/index.mjs` is the stable local library surface; callers should not import internal paths. This intentionally avoids premature microservices, queues, ORM, and cloud lock-in. The Phase 0 audit, risk matrix, and target architecture are in [docs/architecture/phase-0-audit.md](docs/architecture/phase-0-audit.md). Design decisions are recorded under [docs/adr](docs/adr).

## License

MIT
