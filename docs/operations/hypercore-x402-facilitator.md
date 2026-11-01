# HyperCore x402 facilitator beta

This Worker is intentionally a separate deployment from `priorseal`. Its
default configuration has `HYPERCORE_X402_ENABLED=false`; deploying that
default is safe but it cannot quote, verify, or settle payments.

Use `wrangler.hypercore-x402.testnet.jsonc` for a rehearsal. It names a
separate Worker and D1 database and fixes the network and Exchange endpoint to
Hyperliquid testnet. Do not repurpose the mainnet configuration for a testnet
run.

## Activation gate

Before changing the flag, create a dedicated D1 database and replace the
placeholder database id in the selected Wrangler configuration. Apply its
migration, then configure these Worker secrets out of band:

- `HYPERCORE_X402_PAY_TO`: the dedicated, verified HyperCore merchant address.
- `HYPERCORE_X402_MERCHANTS_JSON`: a JSON object mapping the enrolled merchant
  identifiers (`insight`, `priorseal`) to separate random server-only HMAC
  secrets.

Set `HYPERCORE_X402_ENABLED=true` only for a testnet rehearsal or an approved,
bounded mainnet release. Never put a merchant secret in browser code, a git
tracked env file, x402 discovery data, or a client request parameter.

For a PriorSeal HyperCore-only production rollout, set
`PRIORSEAL_X402_STANDARD_RAILS_ENABLED=false`. This prevents existing
third-party EVM and Solana facilitators from being advertised or called while
the native Core rail is being released.

## Protocol boundary

The beta uses `hyperliquid:mainnet` (or `hyperliquid:testnet`) as an
application-defined x402 network identifier and accepts only `usdSend` Core
USDC actions. It does not advertise `spotSend`, arbitrary assets, bridge
transfers, or arbitrary destination addresses.

`POST /v1/quotes`, `/verify`, and `/settle` require a merchant HMAC over the
exact JSON request body and a timestamp. A quote is bound to merchant,
resource, amount, configured payee, and a 60-second lifetime. The central
Durable Object serializes quote consumption and `(payer,time)` replay checks.

## Incident rule

If `/exchange` times out after the action becomes `SUBMITTING`, the record is
changed to `SUBMIT_UNKNOWN`. No endpoint retries that action. Reconcile the
Hyperliquid ledger first; then record an operator decision. Do not clear the
Durable Object state or issue a second settlement for the same signature.
