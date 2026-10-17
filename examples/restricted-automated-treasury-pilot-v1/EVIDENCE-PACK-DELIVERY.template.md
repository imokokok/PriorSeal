# Restricted Automation Pilot — Evidence Pack Delivery Record

> Copy this file to a customer-controlled private location before completing it.
> Do not put completed records, wallet addresses, public keys, RPC URLs, contact
> details, credentials, or signatures into this repository. The ignored local
> fallback filename is `evidence-pack-delivery.private.md`.

## Identity and scope

- Pilot ID:
- Staging environment identifier:
- Scope record SHA-256:
- Scope validation output SHA-256:
- Accepted execution profile: `priorseal.execution-profile.exact-call.v1`
- Test-only confirmation (must be `true`):
- Start and completion time (ISO 8601 with offset):

## Evidence Pack inventory

- Evidence Pack filename and SHA-256:
- Separate trust-root filename and SHA-256:
- Run summary filename and SHA-256:
- Offline verifier version / source commit:
- Offline verifier output filename and SHA-256:
- Delivery channel reference (no credentials):

## Required acceptance checks

- [ ] Exact authorized operation completed once in the agreed staging environment.
- [ ] Changed recipient or call target was rejected before broadcast.
- [ ] Replay of the authorization was rejected.
- [ ] Same nonce on a different guarded route was rejected.
- [ ] Changed router bytecode or code hash was rejected and the attempted action was retained for recovery.
- [ ] The retained `UNCERTAIN` attempt was reconciled without an automatic re-broadcast.
- [ ] A reviewer who is independent of the executor and evidence owner verified the pack using the separately delivered trust root.

## Review, retention, and limits

- Independent reviewer / approval reference:
- Evidence retention location reference (no path, URL, or credentials):
- Retention period:
- Recovery owner / incident reference:
- Known exceptions or stop conditions:

This record proves only that the listed bounded staging checks and offline
verification took place. It does not authorize production use, custody,
unsupervised trading, funding, customer onboarding, or a commercial agreement.
