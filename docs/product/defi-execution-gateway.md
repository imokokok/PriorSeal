# General DeFi execution gateway

The Node entry `createDefiExecutionGateway()` exposes five stages:

| Stage | Method | Result |
| --- | --- | --- |
| Prepare | `prepare()` | Reviewed adapter intent and unsigned PriorSeal EIP-712 authorization payload |
| Authorize | `authorize(signedAuthorization)` | PriorSeal acceptance evidence; the principal signs in its own wallet |
| Execute | `execute()` | One durable authorization and signer-nonce claim, guarded local-account submission |
| Query | `status(authorizationId)` | Persisted attempt state, including `UNCERTAIN` |
| Recover | `recover(authorizationId, observe)` | Finalized chain observation and authorization binding; no resubmission |

The first reviewed adapter is `uniswap-v3-single`, for the original Uniswap V3
SwapRouter `exactInputSingle` selector with a tuple deadline, one ERC-20 pool hop
and zero native value. `prepare()` validates the exact swap and verifies the
router runtime code against an independently reviewed deployment hash before
returning an intent. `execute()` rechecks the signed authorization, accepted
issuer evidence, policy, chain, router code, approved token/amount/recipient,
deadline and exact calldata before the claim and immediately before broadcast.
Unknown adapters are rejected. SwapRouter02, Universal Router, multicall, native
swaps and arbitrary selectors need separate reviewed adapters.

The gateway reuses the **same** durable attempt store and signer-nonce key as
`executeRwaAuthorized()`. The PostgreSQL implementation is exported as
`createPostgresDefiAttemptStore()` and still uses the historical
`rwa_execution_attempts` table from migration 011. All workers and product
routes sharing a signer must use one primary database and this same table. A
separate local journal directory or separate database would not coordinate
nonce claims. `createDefiAttemptStore()` is a single-host local journal only.
Claims are permanent: a lost DB or RPC response does not permit retrying the
same authorization or nonce. An `UNCERTAIN` attempt needs independent chain
reconciliation. `recover()` accepts a trusted observer's finalized result; it
does not assert finality from a caller's unverified statement.

Use `createDefiViemSubmitter()` with a local viem account and one non-retrying
transport. It calls the gateway's guard before signing and before the one raw
broadcast, then verifies the signed chain, sender, nonce, target, value and
calldata. The submission callback is a privileged signer integration point;
custom callbacks must enforce the same `assertBeforeBroadcast` check and route
**every** signing path through the gateway. The Cloudflare PriorSeal service
does not hold funds, sign or broadcast. The adapter runs in the integrator's
Node environment.

Insight remains optional. Insight can independently sell two-sided oracle risk
assessment, and its new transaction review can append its two context
commitments to this gateway's `prepare()` call. The gateway binds those
commitments through the signed PriorSeal intent; it does not independently
verify an unsigned Insight simulation report or claim to have proved a future
fill. For a combined flow, run Insight's fresh transaction review before the
principal signs, then pass the exact reviewed call and commitments into
`prepare()`. Changing the call or route requires a new review and signature.

`npm run swap:execution:check` exercises prepare, wallet authorization,
execution, query, recovery, a mined test-token swap, an independently verified
PriorSeal receipt, and changed-recipient rejection on an isolated local EVM.
It requires `GANACHE_MODULE` pointing at an installed Ganache 7 runtime. The
test environment and tokens are valueless and do not establish production
router trust, liquidity, fees, public-chain finality or wallet deployment
readiness.
