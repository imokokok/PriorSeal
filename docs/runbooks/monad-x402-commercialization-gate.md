# Monad x402 commercialisation gate — Insight + PriorSeal

This runbook is the source of execution discipline for the Monad (`eip155:143`)
commercialisation path across the two independent products:

- **Insight** sells a read-only, signed decision or risk assessment.
- **PriorSeal** sells read-only authorization/execution evidence or an
  integration-readiness report.
- The integrated offer links Insight's independently signed decision to a
  separately authorised and observed execution. It does not merge the two
  trust roots, and an x402 payment never grants authority to submit the
  subject-chain transaction.

It is deliberately a gate, not a launch announcement. A configured route, a
unit test, a published manifest, or a self-payment does not establish customer
commercial readiness on its own.

## Current evidence boundary

The repositories currently establish all of the following, but not a completed
Monad commercial launch:

| Claim | Evidence available | What it does **not** establish |
| --- | --- | --- |
| Insight can quote Monad USDC x402 | Its checked-in manifest and x402 configuration list `eip155:143`, the Circle-native Monad USDC contract, and the $0.02 C3 price. | That the live deployment still returns that quote, or that it has settled a Monad payment. |
| PriorSeal can process Monad x402 | The HTTP lifecycle test covers one Monad `exact` quote, facilitator verification, settlement, signed delivery evidence, and ledger events. | That a production facilitator, payee, and route were approved and exercised. |
| The combined product has a bounded integration path | The SDK verifies an Insight Monad Lending Guard decision before constructing a bounded PriorSeal intent. | A wallet signature, subject transaction, customer delivery, or paid commercial use. |

The last recorded Insight Monad traction record reported zero Monad settlements.
Treat that as historical evidence only; do not replace it with a claim about
the present deployment without a newly recorded check.

## Gate 0 — assign a release record

Before probing a deployment, create a private change-control record with:

- release SHA and deployed version for each product;
- exact Insight resource and exact PriorSeal resource to sell;
- selected payment network: **only** `eip155:143` for this gate;
- selected Monad USDC contract:
  `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`;
- approved merchant payee, facilitator, rollback owner, incident owner, and
  customer-support/refund owner;
- an explicit statement that this is a Monad rollout, not evidence copied from
  a Base, Polygon, Arbitrum, BNB, or testnet exercise.

Do not place signing keys, facilitator credentials, raw `PAYMENT-SIGNATURE`
headers, or wallet private keys in the record.

## Gate 1 — current no-payment proof

Run this gate after deployment and before inviting any buyer. It makes no
payment and must preserve the raw, sanitised responses and the collection time
in Asia/Shanghai.

### Insight

1. Fetch `https://www.oracleinsight.xyz/.well-known/x402` and record its
   content hash.
2. Send one unsigned request to the chosen Insight resource and require HTTP
   402.
3. Decode `PAYMENT-REQUIRED` and require exactly one selected `exact`
   requirement for `eip155:143`, the pinned Monad USDC contract, the exact
   requested resource URL, and the approved maximum amount.
4. Check the selected facilitator's current `/supported` response and require
   the same x402 v2 `exact` network. Do not infer support from a similarly
   named testnet.

For an integrated pre-trade path, the repository's tool can do the resource,
network, asset, and amount checks without loading a payer key or signing a
payment:

```sh
npm run monad:live-run -- \
  --intent /absolute/path/to/bounded-intent.json \
  --out /private/tmp/monad-x402-insight-quote \
  --quote
```

The input must name an actual bounded call; the example intent is not a launch
record. The output is evidence of a quote only.

### PriorSeal

1. Verify that the production D1 ledger migration, issuer key, policy, Monad
   RPC, and all reviewed x402 environment values are deployed.
2. Set the production allowlist to the approved Monad rail in the operator
   environment; do not widen it merely to make a check pass.
3. Run the existing quote-only production verifier:

```sh
npm run x402:production:check
```

It must report `ready: true`, with the exact selected network and paid-route
schedule. It must not send `PAYMENT-SIGNATURE`, call `/verify` or `/settle`, or
move funds. Separately run the Bazaar/catalog discovery check if the route is
advertised as agent-discoverable.

Any failed quote, URL mismatch, network mismatch, or missing facilitator
support is a release stop. Correct or roll back the configuration; never issue
a payment challenge as a diagnostic workaround.

## Gate 2 — one limited payment rehearsal

This gate is a financial action and requires a fresh, human-approved GO. The
approval must name:

- payer wallet and merchant payee;
- product, endpoint, method, full resource URL, network, asset, and maximum
  atomic amount;
- the one permitted payment attempt, a time window, and incident owner;
- the evidence output location and reconciliation owner.

One command, one payment: never automatically retry an unknown or failed
settlement. Preserve a sanitised evidence pack containing the decoded
challenge, payment requirement, `PAYMENT-RESPONSE`, service response hash,
facilitator result, transaction identifier, and terminal ledger event. The
reconciliation owner independently verifies the Monad transaction and confirms
the terminal state is `DELIVERED`; `SETTLEMENT_UNKNOWN` is an incident, not a
successful sale.

Perform this separately for Insight and PriorSeal. An Insight payment proves
Insight's purchase flow; it does not prove PriorSeal's payment flow, even if
both use Monad USDC.

## Gate 3 — integrated customer-path rehearsal

Only after both Gate 2 rehearsals reconcile:

1. Obtain an Insight Monad decision for the exact, bounded call.
2. Verify its signature against a pinned Insight trust root and require the
   product policy's acceptable verdict.
3. Construct the PriorSeal intent with the Insight commitment. The principal
   reviews and signs it outside the operator tooling.
4. The customer or its executor submits the exact call. PriorSeal observes it
   and issues a receipt; an independent verifier checks the Insight decision,
   authorization, execution match, and receipt evidence.
5. If a PriorSeal paid export is in scope, purchase and reconcile it as a
   separate Gate 2 event. Service payment does not authorise step 4.

For a first rehearsal, use only a customer-approved, non-sensitive,
bounded action. Do not characterise a zero-value technical ping as a lending
or economic-safety result.

## Gate 4 — commercial release

Do not call the service commercially complete until all are true:

- a non-self, approved design partner has completed the scope or paid for it;
- the partner's success criteria, evidence recipient, retention terms, support
  route, refund/credit policy, and escalation owner are recorded;
- the public pricing, supported Monad scope, known limitations, and refund
  contact match the deployment exactly;
- marketplace/API-Hub/Bazaar listings are verified as live rather than merely
  drafted or submitted;
- funnel telemetry distinguishes `challenge_issued`, payment authorization,
  settlement, delivery, and repeat use without retaining raw payment
  signatures.

A founder self-payment proves Gate 2 technical settlement, not Gate 4 demand.

## Completion record

The private release record must contain the following before public promotion:

| Gate | Required terminal evidence | Status |
| --- | --- | --- |
| 0 | Named owners, exact route/network/price, rollback plan | `PENDING` |
| 1 | Dated no-payment 402 proof for both products | `DONE 2026-10-27` — `docs/operations/monad-x402-quote-check-2026-10-27.md` |
| 2 | Reconciled, capped Monad settlement for Insight | `DONE 2026-10-27` — `~/Documents/PriorSeal-Evidence-20261027-monad-x402-gate2/` (tx `0x7363e7c2d3c5de24cf6a6232f6595db9fd142ca0a97410fe1fc05142ec44cff6`) |
| 2 | Reconciled, capped Monad settlement for PriorSeal | `DONE 2026-10-27` — same evidence dir (tx `0x9670574f248c792156171a0556efbc2efc4ca07ab96601d8c15b196f841c3e0f`) |
| 3 | Independently verified integrated receipt path | `PENDING` |
| 4 | External design-partner delivery or payment, operational commitments | `PENDING` |

Update these statuses only from the preserved evidence—not from a code merge,
configuration flag, or marketing draft.

### Gate 2 completion notes (2026-10-27)

- Both settlements reconciled independently via Monad RPC receipts and decoded
  USDC `Transfer` events: payer `0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC`
  → payee `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231`, 20000 atomic each;
  wallet balance delta exactly 40000 atomic. Authorization record, raw
  challenges, `PAYMENT-RESPONSE`s, service responses, attestation, and the
  one-shot rehearsal client are preserved in the evidence directory.
- Insight attestation verified against the production trust root published at
  `https://www.oracleinsight.xyz/.well-known/oracle-keys.json`
  (`0x6506F789Edd43338A416f59822A63F309f97E8ce`). PriorSeal readiness report
  signature verified against the published `/.well-known/priorseal-keys.json`
  (`production-1`); the report's embedded registry hash matches the live one.
- The internal `x402_settlements` terminal state was confirmed through the
  production settlement receipt plus the on-chain event. The portable bundle
  export (`GET /v1/receipts/:id/bundle`) is itself x402-metered and was not
  purchased—it requires its own Gate 2 authorization if needed.
- Gate 3 configuration prerequisite was repaired on 2026-10-27: the production
  Worker now has its `PRIORSEAL_RPC_MONAD` secret binding, and the binding is
  declared in `wrangler.jsonc`. This does **not** complete Gate 3: a separately
  authorised integrated-path run must still verify a newly issued signed
  readiness report with `chain.rpc=AVAILABLE`, `observedChainId=143`, and the
  selected subject's bytecode facts. Do not reuse the pre-configuration Gate-2
  report's `NOT_CONFIGURED` result as a current inspection.
