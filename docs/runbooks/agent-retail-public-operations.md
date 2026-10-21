# Agent and retail public operations

This runbook covers PriorSeal's public proposal-and-confirmation surfaces. It
does not authorize a trade, payment, refund, production configuration change,
or rollback.

## What is monitored

`npm run agent-retail:check` makes five public `GET` requests only. It verifies
process and D1 readiness, the immutable release version, issuer/storage
readiness, and the public Agent discovery document.

The check sends no Agent credential, payment signature, wallet signature, or
write request. It does not call a payment facilitator and cannot move funds.

## Incident handling

1. Preserve the GitHub Actions artifact, public request ID, UTC timestamp, and
   deployed version. Do not copy credentials, wallet signatures, raw signed
   transactions, or personal data into a public issue.
2. If an unsupported integration is advertised as available, stop promoting the
   affected surface and roll back under an approved change decision.
3. Support must not request a seed phrase, private key, signature, or authority
   to sign/broadcast on the user's behalf.
