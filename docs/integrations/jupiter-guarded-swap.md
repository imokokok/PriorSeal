# Jupiter Guarded Swap

`priorseal-sdk` can compose Jupiter Router's raw Solana swap instructions with
an Insight pre-sign simulation and an exact PriorSeal authorization. The result
is a self-custodial, single-wallet workflow:

```text
Jupiter /build → application compiles final message → Insight simulation
  → PriorSeal message authorization → wallet signs and submits → observation
```

This is an integration adapter, not a Jupiter replacement, a wallet, an
execution bot, or a claim that a swap is economically safe. Jupiter produces
the route. The application owns RPC selection, address-lookup-table resolution,
the current blockhash and transaction signing. PriorSeal never receives the
transaction-signing key.

## Supported first-release scope

- Jupiter Swap API v2 **Router** (`GET /swap/v2/build`), not managed
  `/order` + `/execute` execution.
- A single `ExactIn` swap on Solana mainnet-beta.
- A self-paying, one-required-signer transaction: taker, fee payer, PriorSeal
  principal and delegated executor are the same public key.
- The SDK can validate a final legacy, v0 or v1 message from an integrator
  compiler whose every program is explicitly allowed. The bundled protected
  route service deliberately emits **v0 only**; v1 requires an integrator
  compiler plus reviewed resource-limit calibration before it can be enabled.
- Insight's `POST /api/v1/execution/solana/simulate` returns a signed,
  successful, unsigned-message simulation receipt for that exact message.
- PriorSeal observes at confirmed commitment. It does not offer Solana
  `RPC_FINALIZED` or arbitrary program-semantic decoding.

The adapter intentionally rejects sponsor / gasless fee payers, multi-party
transactions, tips unless allowed, a changed blockhash, unknown programs,
unknown lookup tables when pinned, and a changed transaction after simulation.
Those are new workflows, not fallbacks for this one.

It also requires the final compiled instruction sequence to be an exact,
ordered reproduction of the raw Jupiter instruction sequence: program id,
account address, signer/writable flags, and instruction bytes must all match.
An application cannot smuggle another call to an otherwise allowlisted program
into the transaction.

## Keep credentials and keys separate

- Store the Jupiter API key on the application server. Do not expose it to a
  browser or an agent prompt.
- Store the Insight API key separately; it pays only for Insight service usage.
- The wallet signs the PriorSeal authorization message and the Solana
  transaction. The adapter does neither.
- A paid x402 call, if configured, pays for a service endpoint. It never gives
  the payer permission to execute the subject swap.

## Deploy the protected route service

The production runtime includes an opt-in, same-origin route service. It uses
`@solana/web3.js` to resolve Jupiter's returned address lookup tables, sets one
fresh blockhash, compiles the exact v0 transaction, obtains the Insight
simulation, and relays only the transaction that the wallet signed unchanged.
The console never receives any of these values:

```bash
# Store these in the deployment secret manager, never in .env files served to Vite.
JUPITER_API_KEY=...
INSIGHT_API_KEY=...
PRIORSEAL_JUPITER_RPC_URL=https://your-solana-rpc.example
PRIORSEAL_JUPITER_POLICY_JSON='{
  "maxInputAmountAtomic":"1000000",
  "maxSlippageBps":50,
  "allowedInputMints":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  "allowedOutputMints":["So11111111111111111111111111111111111111112"],
  "allowedProgramIds":["ComputeBudget111111111111111111111111111111"],
  "maxComputeUnitLimit":600000,
  "maxComputeUnitPriceMicroLamports":"100000",
  "maxPriorityFeeLamports":"60000",
  "authorizationTtlSeconds":60
}'
```

All four required variables must be present or startup fails closed. The program
list must be extended only after reviewing the programs that a live route
actually requires; the minimal sample above is deliberately too restrictive to
swap. `PRIORSEAL_JUPITER_ROUTER_BASE_URL` and
`PRIORSEAL_JUPITER_INSIGHT_BASE_URL` are optional HTTPS-only overrides for a
reviewed staging service.

The server exposes two no-store routes only when this configuration is present:

- `POST /v1/jupiter/guarded-swaps/prepare` accepts mint addresses, atomic
  input, wallet and bounded slippage; it returns the prepared package and its
  human-review record.
- `POST /v1/jupiter/guarded-swaps/submit` accepts the `authorizationId` from
  the accepted PriorSeal authorization, that package, and wallet-signed base64
  bytes. It revalidates expiry, binds the serialized message bytes to the
  reviewed message hash, verifies the one fee-payer signature, then atomically
  reserves that authorization against the transaction signature before it
  contacts the deployment-owned RPC. It has no automatic retry.

The route returns `submission: "SUBMITTED"` only when RPC returns the exact
transaction signature. On transport failure or an inconsistent RPC response it
returns HTTP 202 with `submission: "UNKNOWN"`; the authorization remains
consumed and the caller must observe that signature before taking any further
action. Reposting the same bytes is intentionally not a recovery path.

These routes are intentionally not a policy-editor API. Treat the policy JSON
as reviewed deployment configuration: version it, apply change control, and
redeploy after changing program, mint, amount or fee limits. An unauthenticated
browser must never be able to widen a route policy or replace an RPC endpoint.

## Prepare, authorize, sign, observe

The host application supplies a compiler because only it has the approved RPC,
current blockhash and address-lookup-table resolver. The compiler must turn
Jupiter's returned instructions into the exact final, unsigned base64
transaction and the matching `SolanaTransactionMessage`. Insight cross-checks
the serialized transaction against the message hash during simulation; changing
the transaction requires running this whole flow again.

```ts
import {
  authorizeGuardedJupiterSwap,
  createInsightSolanaSimulationClient,
  createJupiterRouterClient,
  createPriorSealClient,
  observeGuardedJupiterSwap,
  prepareGuardedJupiterSwap,
  reviewGuardedJupiterSwap,
  SOLANA_COMPUTE_BUDGET_PROGRAM,
} from 'priorseal-sdk'

const priorseal = createPriorSealClient({ baseUrl: 'https://priorseal.xyz' })
const router = createJupiterRouterClient({ apiKey: process.env.JUPITER_API_KEY! })
const insight = createInsightSolanaSimulationClient({
  apiKey: process.env.INSIGHT_API_KEY!,
})

const prepared = await prepareGuardedJupiterSwap({
  intentId: crypto.randomUUID(),
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  outputMint: 'So11111111111111111111111111111111111111112', // wrapped SOL
  amount: '1000000', // 1 USDC in atomic units
  minimumOutputAmountAtomic: '990000', // independent user-visible output floor
  taker: wallet.publicKey.toBase58(),
  slippageBps: 50,
}, {
  router,
  insight,
  compiler: {
    async compile({ build, request }) {
      // Use the application's reviewed Solana SDK + RPC here to resolve the
      // returned ALTs, set one fresh blockhash, assemble Jupiter's instructions
      // without additions, and return the exact unsigned transaction bytes plus
      // PriorSeal's normalized compiled message representation.
      return applicationCompiler.compileJupiterBuild(build, request)
    },
  },
  policy: {
    feePayer: wallet.publicKey.toBase58(),
    maxInputAmountAtomic: '1000000',
    maxSlippageBps: 50,
    allowedInputMints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    allowedOutputMints: ['So11111111111111111111111111111111111111112'],
    // This is deployment-specific. Include only reviewed program IDs required
    // by the intended Jupiter route, token programs and Compute Budget.
    allowedProgramIds: [
      SOLANA_COMPUTE_BUDGET_PROGRAM,
      'JUP6LkbZbjS1jKKwapd5wXwgu2ShUUbM4n8ubpMDRuV',
      // reviewed route-specific programs...
    ],
    maxComputeUnitLimit: 600_000,
    maxComputeUnitPriceMicroLamports: '100000',
    maxPriorityFeeLamports: '60000',
    authorizationTtlSeconds: 60,
  },
})

// Persist or display this non-secret record immediately before the wallet
// signs. It revalidates all Jupiter, compiled-message and Insight bindings.
const review = await reviewGuardedJupiterSwap(prepared)
if (review.warnings.includes('PRIORITY_FEE_NOT_CAPPED')) {
  throw new Error('Deployment policy must cap priority fees before signing')
}

const authorization = await authorizeGuardedJupiterSwap({
  client: priorseal,
  prepared,
  wallet,
  principal: { type: 'user', id: 'user:42' },
  agentId: 'agent:solana-swap',
  audience: (await priorseal.capabilities()).audience,
})

// The application hands the exact prepared bytes to its wallet boundary. It
// must not rebuild, re-quote or replace the blockhash after authorization.
const signature = await applicationWallet.signAndSendExact(prepared.transactionBase64)
const result = await observeGuardedJupiterSwap({
  client: priorseal,
  authorizationId: authorization.accepted.authorization.authorizationId,
  signature,
})
```

`applicationCompiler.compileJupiterBuild()` is deliberately not hidden inside
the SDK: that boundary must be controlled and reviewed by the integrator. It
must reject an instruction sequence it cannot faithfully compile and must not
add transfers, approvals, tips, alternate recipients or a sponsor fee payer.

## Product-grade signing review and persistence

`reviewGuardedJupiterSwap()` returns a non-secret serializable record: exact
message hash, SHA-256 digest of the unsigned transaction bytes, wallet, atomic
input and minimum output, expiry, all program IDs, lookup tables,
compute-budget values, and actionable warnings. Show this to the user or keep
it with the authorization record; it contains neither an API key nor a private
key.

`authorizeGuardedJupiterSwap()` automatically calls
`assertPreparedGuardedJupiterSwap()` again. Consequently a stale, persisted or
mutated prepared object fails before PriorSeal asks a wallet to authorize it.
Applications that present a review in a separate process should call the same
function before displaying their final confirmation.

## Operational rules

1. Fetch, compile, simulate, authorize, sign and submit as one short-lived
   flow. A recent blockhash is part of the authorized message.
2. Never refresh an expired blockhash or re-quote after authorization. Start a
   new flow and obtain a fresh simulation and authorization.
3. Keep a deployment-owned allowlist of programs and, where appropriate,
   address lookup tables. Do not derive trust from a Jupiter response alone.
4. Use `allowedInputMints`, `allowedOutputMints` and per-request
   `minimumOutputAmountAtomic` for customer-facing trading limits; the Jupiter
   threshold must meet that independent minimum.
5. Make every configured amount visible in atomic units and reject a missing
   compute-unit limit or priority-fee field when the policy requires a cap.
6. Before treating an Insight receipt as trusted, verify its signed key using
   independently provisioned Insight trust configuration. Before relying on a
   PriorSeal receipt, independently provision the PriorSeal issuer key.
7. A `PENDING`, `UNDETERMINED`, failed simulation or failed observation does
   not authorize a replacement transaction.
8. If the protected relay reports `submission: "UNKNOWN"`, observe the exact
   returned signature. Do not retry, re-sign or replace the transaction: the
   one-time authorization was already reserved to make ambiguous RPC outcomes
   fail closed.

## Testing before a customer pilot

Run the SDK unit test, then use synthetic fixtures before any mainnet action:

```bash
npm run sdk:build
npm run core:build:tests
node --test test/sdk/jupiter-guarded-swap.test.mjs
```

A real mainnet rehearsal is a separately authorized operational action. Start
with a small amount and preserve the raw Jupiter response, final unsigned
transaction, Insight evidence, PriorSeal authorization and final verification
bundle. Do not present a simulation or a test transaction as production proof.

## PriorSeal console

The PriorSeal web console exposes this workflow at
`/app/jupiter-guarded-swap`. When the protected route service is enabled it can
request a route from the same origin; it can also import a prepared package
produced by an approved integration service. It never calls Jupiter or Insight
directly from the browser, keeping both upstream API keys in the protected
service.

The package may be the `PreparedGuardedJupiterSwap` JSON returned by the SDK,
or this wrapper:

```json
{
  "schema": "priorseal.jupiter-guarded-swap-package.v1",
  "prepared": { "...": "PreparedGuardedJupiterSwap" }
}
```

Before enabling its authorization button, the console repeats the adapter's
full package validation and shows the atomic input, Jupiter output threshold,
message hash, transaction-byte digest, instruction programs, compute budget
and policy warnings. It requires the connected wallet to be the bound fee
payer. It separately asks that wallet to sign the PriorSeal authorization and
then the exact transaction. The browser and protected relay both verify that
the wallet did not alter the serialized message bytes.

The relay does not retry a submission automatically. Its final evidence
download includes the prepared route, review, authorization, signature,
observation and receipt when available. No private key or upstream API key is
included. For durable organizational retention, upload that completed evidence
package to PriorSeal's existing authenticated archive from a trusted backend;
do not add an archive writer credential to browser code.
