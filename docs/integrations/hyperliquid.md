# Hyperliquid HyperCore spot IOC integration

PriorSeal supports a deliberately narrow Hyperliquid HyperCore profile:
one **mainnet spot** IOC limit order, authorized before submission and later
observed through Hyperliquid's public Info API. It is an order-book profile,
not a Uniswap-style AMM adapter and not a HyperEVM transaction integration.

The profile is observation-only. It never receives an API wallet secret,
creates an API wallet, signs a Hyperliquid exchange action, submits an order,
or authorizes withdrawals. The trading system retains every exchange key and
is solely responsible for deciding whether to send the independently approved
order.

## Supported boundary

`priorseal.execution-profile.hyperliquid-spot-ioc.v1` binds:

- a HyperCore mainnet spot `assetId` (at least `10000`);
- side, limit price, exact base size, IOC time-in-force, expiry, and 16-byte
  client order id (`cloid`);
- the account, which is both the intent sender and recipient;
- a millisecond action nonce that must precede the exchange expiry.

The expiry must be no more than five minutes after the signed nonce. This is
an IOC safety boundary, not a session duration: create a new authorization and
new cloid when the user needs to try again.

The PriorSeal policy amount is an unsigned accounting value. It is not a
substitute for `size`: the exact base quantity is the signed
`hyperliquidOrder.size` field.

This initial profile does not cover perpetuals, non-IOC/resting orders,
TWAPs, outcomes, subaccount or vault delegation, API-wallet approval, HyperEVM,
deposits, withdrawals, or route selection. Those are new execution profiles,
not flags to add to this one.

## Optional builder-fee commerce

An integration can opt into a Hyperliquid builder fee without giving PriorSeal
or Insight signing authority. The commercial term uses the portable
`execution.commerce.v1` context-commitment namespace, so the same receipt
binding works for other venue adapters. It records the beneficiary, exact
per-order rate, user-approved maximum and the requirement for venue-side
reconciliation.

For a spot order, create a fee policy, add its commitment to the intent, then
ask the **main account** to sign the separate `approveBuilderFee` action. Only
after that can the same policy be added to the unsigned order action. The SDK
refuses to add the fee to an order whose signed intent does not already commit
to exactly those terms.

```ts
import {
  buildHyperliquidBuilderFeeApproval,
  buildHyperliquidSpotIocBuilderFeeSubmission,
  buildHyperliquidSpotIocIntent,
  executionCommerceCommitment,
  hyperliquidSpotBuilderFeeTerms,
} from 'priorseal-sdk'

const builderFee = {
  builder: '0xYourBuilderAddress',
  feeTenthsOfBasisPoint: 10, // 1 bp
  maximumFeeTenthsOfBasisPoint: 10,
}

const intent = buildHyperliquidSpotIocIntent({
  // ordinary IOC fields omitted
  contextCommitments: [
    executionCommerceCommitment(hyperliquidSpotBuilderFeeTerms(builderFee)),
  ],
})

// Sign with the user-controlled Hyperliquid main account. The SDK never signs
// or submits either action.
const approval = buildHyperliquidBuilderFeeApproval(builderFee)
const order = buildHyperliquidSpotIocBuilderFeeSubmission(intent, builderFee)
```

The SDK reports terms and an estimate-ready order record; it does **not** claim
that a venue has accrued or paid a builder fee. Reconcile revenue against the
venue's builder-fill export before recognizing it. API/x402 charges remain
separate payments for Insight/PriorSeal services, never authority to trade.

## Configure a deployment

Set a public HTTPS Info endpoint explicitly. The runtime refuses Hyperliquid
observations if it is absent, so a deployment cannot advertise an integration
that it cannot observe.

```sh
PRIORSEAL_HYPERLIQUID_INFO_URL=https://api.hyperliquid.xyz/info
# Set false to immediately remove this profile from capability discovery and
# reject observations without changing exchange credentials.
PRIORSEAL_HYPERLIQUID_ENABLED=true
```

The authorization policy must name the non-EVM network reference and action.
Do not combine this first exact-order profile with `allowedAssets`,
`allowedRecipients`, or `maxAmount`; those fields would imply semantics that
the profile intentionally does not infer. Use the signed order fields and a
reviewed policy document instead.

```json
{
  "allowedChainIds": ["hyperliquid:mainnet"],
  "allowedActions": ["HYPERLIQUID_SPOT_IOC_ORDER"],
  "minConfirmations": 1,
  "maxToleratedReorgDepth": 0
}
```

`GET /v1/capabilities` reports the profile and `networks` entry only when the
Info endpoint and this policy are compatible. HyperCore has no EIP-155 chain
id here: the profile uses `chainId: 0` plus the required
`chainRef: "hyperliquid:mainnet"`. The network reference is authoritative.

## Build and authorize an order intent

Use the SDK to build the deterministic intent before the user signs the usual
EIP-712 authorization.

```ts
import { buildHyperliquidSpotIocIntent } from 'priorseal-sdk'

const intent = buildHyperliquidSpotIocIntent({
  intentId: 'spot-ioc-2026-10-25-001',
  account: '0xYourHyperliquidMainAccount',
  amount: '1250000', // your reviewed policy/accounting quantity
  assetId: 10001, // resolve this from Hyperliquid metadata in your app
  isBuy: true,
  limitPrice: '125.50',
  size: '10',
  clientOrderId: '0x0123456789abcdef0123456789abcdef',
  nonce: '1792886400000',
  expiresAfter: 1792886460000,
  validUntil: 1792886460,
})
```

Resolve `assetId` from a freshly fetched Hyperliquid `spotMeta` response in
your trading application, and retain that metadata snapshot with the review
record. Bind the numeric ID, not a UI ticker: HyperCore spot uses `@<index>`
in order/fill data and a displayed pair can differ from the Core token name.
Validate `size` against the market's current `szDecimals` before requesting a
signature.

The `clientOrderId` must be the exact cloid included in the subsequent
Hyperliquid action. Do not generate another cloid while submitting. Likewise,
the exchange action must use the signed nonce, expiry, asset id, side, price,
size, and `Ioc` time-in-force.

PriorSeal durably reserves `(hyperliquid:mainnet, account, cloid)` when it
accepts an authorization. A second authorization for the same tuple is
rejected. Apply PostgreSQL migration `018_hyperliquid_cloid_uniqueness.sql` or
D1 migration `0009_hyperliquid_cloid_uniqueness.sql` before enabling this
profile.

For this first profile the authorization delegate executor must equal the
Hyperliquid account. HyperCore's public order data identifies the account, not
an API-agent signing key, so PriorSeal does not claim delegated-executor
correlation for a distinct API wallet.

## Submit outside PriorSeal, then observe

Your own reviewed Hyperliquid client signs and posts the exchange action. Use
the SDK to serialize the already-authorized action; it deliberately does not
produce an exchange signature, access an API wallet, or send a request.

```ts
import { buildHyperliquidSpotIocSubmission } from 'priorseal-sdk'

const submission = buildHyperliquidSpotIocSubmission(intent)
// Sign `submission.action` with Hyperliquid's official SDK using the
// user-controlled trading client, then submit with submission.nonce and
// submission.expiresAfter. Do not add a vaultAddress or alter any field.
```

Afterward, observe with the same cloid. The existing `txHash` request field is
used as a generic execution reference for API compatibility; in this profile
it is a cloid, **not** an EVM transaction hash.

```ts
const result = await priorseal.observeExecution({
  authorizationId,
  chainId: 0,
  txHash: intent.hyperliquidOrder!.clientOrderId,
})
```

The observer queries `orderStatus` by cloid and then paginates
`userFillsByTime` for the authorized account. It validates every included fill
against the signed market, side, order ID and time window; deduplicates by
Hyperliquid fill ID; and requires the complete aggregated quantity for a
`filled` state. All documented terminal statuses, including IOC and balance
rejections, are preserved in the receipt. A rejected/canceled zero-fill result
is `REVERTED`; a canceled result with matching partial fills is `CONFIRMED` as
an actual partial execution. An unknown cloid, nonterminal status, a
non-advancing full page, or incomplete full-fill evidence remains
`PENDING`/not assessable rather than being guessed.

The evidence reference is the cloid, and the receipt describes Info-API
observation, not independent HyperCore consensus verification. The receipt
contains canonical request/response digests and pagination counts, not bulky
raw exchange payloads. Archive the exact raw Info API responses, their
retrieval timestamps, and the PriorSeal verification bundle in your protected
evidence store; Info API retention and response availability constrain later
reconstruction. Monitor `hyperliquid_info_request` and
`hyperliquid_observation` metrics, and set `PRIORSEAL_HYPERLIQUID_ENABLED=false`
as the operational kill switch on endpoint/schema anomalies.
