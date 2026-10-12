# Security Policy

## Reporting a vulnerability

Email **imokokok123@gmail.com**, or use GitHub's private vulnerability reporting on this repository.

Please **do not open a public issue** for anything you believe is exploitable.

Include what you can of:

- Affected package and version (`priorseal-sdk`) or commit / deployment
- A minimal reproduction (exact commands, exact bytes)
- The exact fail-closed behavior you expected versus the result you observed — an authorization or observation check that passes when it should reject is the highest-severity class here
- Any signed evidence or registry snapshot bytes needed to rerun your case

## Scope

In scope: anything that could let authorization or execution evidence be forged, replayed, or accepted when it should fail closed. Examples: cryptographic verification bugs in the SDK and its bridge to `verify-insight-receipt`, temporal-evidence replay and finality checks, intent/capability binding, and the signing/attestation paths of the worker.

Out of scope: the _meaning_ of a signed observation (evidence, not endorsement), availability, and reports that only apply to modified or unsigned inputs.

## What to expect

- Acknowledgement within 5 business days
- Status updates at least weekly until resolution
- Credit in release notes if you want it — say so in your report

## Supported versions

Security fixes target the latest published release of `priorseal-sdk`. Older versions are fixed at maintainer discretion.
