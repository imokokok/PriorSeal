# Agent and retail public operations

This runbook covers PriorSeal's public **proposal-and-confirmation** surfaces:
the Agent discovery document, operator-issued Agent credits, and guarded Jupiter
and 0x Solana swap preparation. It does not authorize a trade, a payment, a
refund, a production configuration change, or a rollback.

## What is monitored

`npm run agent-retail:check` makes five public `GET` requests only. It verifies:

- process and D1 readiness, immutable release version, and the absence of the
  retired-origin headers;
- `workflowReady`, issuer and durable-storage readiness;
- `guardedJupiter` and `guardedZeroEx` are both explicitly `READY`;
- the public Agent discovery document has the same release version and still
  requires a principal signature for each exact action;
- operator-issued Agent credits are configured; and
- public paid commerce is explicitly locked: x402 acceptance and self-serve
  credit claims are both unavailable.

The command sends no Agent credential, payment signature, wallet signature, or
write request. It does not call a payment facilitator and cannot move funds.

The scheduled **Public service health** GitHub workflow runs this check in its
own job beside the existing portfolio diagnostic every fifteen minutes. Each
job retries after one minute before marking its own failure and preserves
redacted JSON output for fourteen days. Delivery uses the repository owner's
existing GitHub Actions notifications; do not add an email address, webhook,
or chat recipient until its owner has explicitly approved it.

## Before public promotion

Complete one [launch record](../templates/agent-retail-public-launch-record.md)
in the team's approved private change-control system. A template in this
repository is deliberately blank: publishing an invented support address,
legal entity, refund owner, or payee control claim would be misleading.

The release owner must confirm all of the following:

1. The public support URL and the incident owner are real, reachable, and
   authorized to receive customer data.
2. Terms, privacy notice, risk disclosure, supported jurisdictions, and the
   retention/deletion policy have received the applicable business and legal
   review.
3. The initial public scope states the supported wallets, chains, input/output
   assets, maximum amounts, expiry, slippage and any platform fees. Server-side
   policy remains the source of truth; a webpage cannot widen it.
4. The payee and any refund/chargeback owner have separately confirmed control
   of their accounts. A capability response is not evidence of ownership.
5. Customer-facing x402 purchase language and acceptance remain disabled until the separate
   [production x402 Go/No-Go](x402-production-go-no-go.md) record and an
   explicitly authorized paid rehearsal are complete.

The current pilot is invitation-only. YuTao Peng issues and revokes Agent
credentials manually after reviewing requests sent to `contact@priorseal.xyz`;
YuTao Peng also owns the pilot's manual refund and chargeback decisions. Observe
the public health workflow, then allow only a small reviewed cohort under the
existing server limits. Widening wallets, assets,
limits, fees, supported networks, or payment rails is a new reviewed release,
not a flag change made during an incident.

## Incident handling

1. Preserve the GitHub Actions artifact, public request ID, UTC timestamp,
   deployed version, and the exact failing readiness field. Do not copy Agent
   credentials, wallet signatures, raw payment headers, signed transactions,
   or personal data into a public issue.
2. If the check reports `workflowReady: false`, missing D1, issuer readiness,
   discovery-version drift, or an unavailable guarded integration, stop
   promoting the affected route. Do not redirect an authorized action to a
   different provider or resubmit a swap.
3. If public paid-commerce capability appears enabled, stop promotion and use
   [the x402 production Go/No-Go rollback procedure](x402-production-go-no-go.md).
   Do not accept a buyer payment until that separate record is approved.
4. If a user reports a swap with an unknown outcome, retain the exact package,
   authorization ID and transaction signature privately, then observe that
   signature. Never make a second submission from a timeout or support ticket.
5. Roll back only under an approved change decision. Verify the replacement
   version with `npm run production:smoke -- --read-only` and rerun the public
   readiness check after the platform reports the deployment active.

## Customer support boundary

Support may help a user understand a displayed review, retrieve public evidence,
or verify a receipt. Direct support, security, privacy, billing and pilot-access
requests to `contact@priorseal.xyz`, with a subject prefix matching the request.
It must never request a seed phrase, private key, raw Agent credential,
unredacted payment signature, or authority to sign/broadcast on the user's
behalf. A service payment does not grant the Agent or PriorSeal authority over
a customer action.

For the product flow and safe data to retain, use the
[Agent and retail user guide](../integrations/agent-retail-user-guide.md).
