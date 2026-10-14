# APS checkout-gate per-order limit check

Status as of October 14, 2026: **sandbox contribution submitted for review**. The public discussion is
[agent-governance-vocabulary issue #199](https://github.com/aeoess/agent-governance-vocabulary/issues/199),
and the proposed adapter scope was stated in
[YuTao's comment](https://github.com/aeoess/agent-governance-vocabulary/issues/199#issuecomment-6140170009).
The generic checkout-gate evidence hook [PR #1](https://github.com/agent-passport-system/aps-checkout-gate/pull/1)
merged at 2026-10-13 23:07:59 Asia/Shanghai. The optional `priorsealLimitCheck`
adapter and five synthetic cases were submitted in
[PR #4](https://github.com/agent-passport-system/aps-checkout-gate/pull/4),
head `45a9439b4f9e16034eb15e3b5a806645e151a347`; it is open for maintainer
review. The focused cases pass 5/5 and `npm run typecheck` passes in the PR
checkout. All cap values are examples; no store-specific cap has been supplied.

## Implemented sandbox boundary

The APS checkout gate owns grant validation, scope, its atomic budget reservation,
and signing permit/refusal receipts. Its optional evidence hook can host an
additional per-order ceiling check before reservation. The proposed cap is
configured independently by the store and remains separate from the APS
`per_action` and cumulative grant limits.

| Input | Rule |
| --- | --- |
| Merchant | Must equal the cap's one merchant scope segment. |
| Currency | Must equal the cap's upper-case ISO 4217 currency. |
| Amount | Must be a positive integer in minor units and no greater than the cap. |
| Cap identity | Must identify a store-configured cap distinct from the APS grant limit. |

The submitted sandbox adapter binds its evidence identifier to the gate's
exact request `action_ref` and the configured cap. A changed amount changes the
request digest and triggers the check again. There is no FX conversion, second
budget reservation, dispatch, payment, settlement or fulfillment claim.

## What a pass would mean

A pass in the submitted code means only that the exact purchase request matches the configured
merchant and currency and is at or below the configured per-order ceiling.
It would not mean that the request is safe, the APS grant is valid by virtue of
PriorSeal, the store placed an order, or payment settled. The adapter proposal
does not verify a signed PriorSeal artifact or call the PriorSeal service.

## Remaining input

A store must provide the cap ID, merchant ID, currency and maximum amount in
minor units. The cap must be distinct from the APS per-action grant limit. The
PR's `example-store` / USD values do not satisfy that requirement. Until a store
supplies its own cap and the receiving project reviews/accepts the PR, this is
not a retail integration or pilot.
