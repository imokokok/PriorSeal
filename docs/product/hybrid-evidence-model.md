# Hybrid evidence model

PriorSeal is **off-chain by default and chain-aware when the customer already
has a relevant transaction**. It must never require a customer to create a
test transfer, self-transfer, or native-token balance merely to obtain
authorization evidence.

## Delivery lanes

| Lane | What PriorSeal does | New customer transaction? | Gas policy |
| --- | --- | ---: | --- |
| Signed authorization | Accepts a principal signature, adds independent time evidence, and issues a signed record | No | No chain gas |
| Read-only execution evidence | Reads an integrator-supplied EVM/Solana transaction hash and compares the observed result to the prior authorization | No | PriorSeal pays no subject-transaction gas; the transaction retains its normal business fee payer |
| Operator-managed transparency checkpoint | Batches authorization-log commitments and anchors one checkpoint when a higher assurance plan requires it | No | The PriorSeal operator submits and funds the batch anchor; its cost belongs in the plan price |

The public capability response exposes this shape as `evidenceDelivery`:
`OFFCHAIN_SIGNED_RECEIPT`, `READ_ONLY`, and either
`OPERATOR_MANAGED_OPTIONAL` or `NOT_CONFIGURED` anchoring. This describes the
evidence service, not the integrator's own wallet or execution system.

## What this means for a customer

A customer can obtain authorization evidence without a wallet connection or
native token. If an application later performs a real business transaction,
it supplies that existing transaction hash to PriorSeal for observation. The
receipt can then distinguish authorization, observation, confirmation, and
compliance; it does not claim that PriorSeal submitted the transaction.

The normal network fee for a customer-owned business action remains part of
that action. PriorSeal must not create a second transaction just to demonstrate
that it can observe one. If an integration sells gasless execution, it must
describe the result accurately as **customer authorization plus
integrator-sponsored submission**, with the integrator's relayer/paymaster as
the fee payer.

## Optional anchoring

Full receipts, signed authorizations, policy evidence, and readable context
remain off-chain so that sensitive information is not made public and routine
use has no gas or confirmation delay. An anchoring plan publishes only a
hash-based checkpoint; it does not publish the full receipt or customer
context. The existing anchor preparation and recording tools are operator
tools: the platform, not the customer, owns the funding decision and submits
the anchor transaction from its approved operational wallet.

Batching means that one anchor can cover many acceptance-log entries. It is a
high-assurance feature rather than a per-action prerequisite. Deployments that
need ordering evidence without a chain write should use RFC 3161 or a witness
quorum.

## Commerce boundary

x402 remains an optional payment rail for allowlisted, read-only evidence
exports. It never grants authority over a subject transaction and never pays
for write endpoints. A facilitator may submit the settlement transaction;
that settlement is separate from the subject execution chain.

Customer-funded Agent-credit top-ups are disabled by default, including in the
production Worker configuration. Enabling them requires both public paid
commerce and the explicit `PRIORSEAL_SELF_SERVE_CREDITS_ENABLED=true` switch.
That is a separately reviewed commercial product because it intentionally asks
the payer to make an on-chain USDC transfer. Operator-issued credits remain
available for pilots, contracts, and included plan allowances without making
an end user fund an on-chain top-up.

## Product claims

Use these distinctions in product copy and customer discussions:

- **Authorization evidence:** a principal signed a bounded request before the
  stated action; no chain transaction is implied.
- **Execution evidence:** an independently observed transaction hash matched
  the authorization's supported fields; PriorSeal did not submit it.
- **Anchored evidence:** an operator-funded batch checkpoint makes a prior
  off-chain evidence-log state independently checkable on the selected chain.
- **Gasless execution:** an integration, not PriorSeal by default, submitted
  the customer-authorized action through a relayer or paymaster.

Do not collapse these claims into “on-chain proof,” “gasless,” or “user paid”
without naming the actual subject transaction and fee payer.
