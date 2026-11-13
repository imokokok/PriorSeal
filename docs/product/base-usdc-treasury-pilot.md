# Base USDC Treasury Pilot (historical reference)

> **Status:** This document records an earlier organization/treasury pilot
> concept. It is not PriorSeal's current product-development or commercial
> direction. Do not begin new work from this plan; use the
> [personal Agent roadmap](agent-first-roadmap.md) instead.

## Product decision

This earlier proposed paid pilot was a **bounded Base USDC organization or treasury payment**. It was not a general payment product and did not turn PriorSeal into a custodian, payment processor, policy engine, or organization-approval system.

The buyer is the team responsible for an onchain treasury, procurement flow, or controlled disbursement. The operational user may be an executor or agent operator; the person who values the product is the finance, operations, security, or audit owner who needs evidence of the payment path.

## Pilot outcome

For one real payment path, a reviewer can establish these distinct claims:

1. **Seal:** an identified wallet signed one bounded authorization for Base USDC: execution wallet, recipient, atomic amount, nonce, and expiry.
2. **Witness:** PriorSeal accepted that authorization before execution using a configured independent proof mode. `issuer` acceptance alone is insufficient for an external pilot.
3. **Match:** the organization-provided Base transaction was observed and compared with the accepted authorization; pending and indeterminate outcomes remain explicit.
4. **Review:** a reviewer receives a portable signed receipt and independently selects the issuer key and expected audience used to validate it.

## Fixed pilot surface

- Chain: Base, EIP-155 chain ID `8453`.
- Asset: Base USDC, canonical identifier `eip155:8453/erc20:0x833589fcd6edbe08f4c7c32d4f71b54bda02913`.
- Action: one `TRANSFER` intent per authorization.
- Amount: USDC atomic units; `1000000` means 1 USDC.
- Authorization: single-use EIP-712 or an independently configured supported authorizer.
- Execution: submitted by the customer-controlled wallet, Safe, agent, or payment system. PriorSeal never holds a transaction-signing key or broadcasts the payment.

The pilot must not claim recipient identity, organizational approval validity, economic safety, token legitimacy, or complete accounting correctness.

## Entry gate

Before asking a wallet to sign, the deployment must publish:

- the Base chain and transfer profile;
- a configured Base RPC observer;
- a non-`issuer` proof mode: RFC 3161, witness quorum, or EVM anchor;
- a policy that permits the Base USDC asset and intended recipient/amount range.

The console can check the first three configuration signals. The customer must independently verify the policy, wallet controls, recipient allowlist, and real-world payment approval.

## Pilot delivery and success

The paid deliverable is one reproducible evidence path, not a count of authorizations:

1. deployment and policy preflight;
2. a signed and independently witnessed authorization;
3. a customer-submitted Base USDC transaction and Match result;
4. a receipt bundle independently reviewed by a named external reviewer or customer control owner.

Early product metric: completed real-chain pilot paths. Once an outside reviewer is participating, the north-star metric becomes completed and independently reviewed Verified Actions. Track outreach, design-partner meetings, committed pilot paths, and paid pilots alongside the product metric.

## Explicitly deferred

- Safe/wallet-native organization approval UX;
- multi-step or recurring payment authority;
- recipient onboarding and KYC;
- payment initiation, custody, settlement, or reconciliation;
- a standalone Witness dashboard;
- a generic treasury-management product.

These are customer-specific follow-ons after a paid pilot identifies the integration requirement.
