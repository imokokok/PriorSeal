# Action Evidence Passport

## Purpose

The Action Evidence Passport is a compact delivery format for an outbound
design-partner conversation. It makes an existing combined review easy to
download, hand to another reviewer, and verify without explaining several
separate repositories or APIs first.

It projects the already-supported flow:

```text
Insight assessment evidence → PriorSeal authorization → observed execution → local review
```

The Passport is a **presentation wrapper** around an existing
`priorseal.review-manifest.v1`; it is not a new commercial product, protocol
signer, verdict, or trust framework. Its v1 wrapper schema exists only to
preserve a readable summary plus the native manifest in one downloadable JSON
file. A native manifest remains the only evidence object that verification
relies on.

## When to use it

Create one only when a concrete outbound action needs a self-contained demo or
review attachment—for example, a follow-up to a prospective wallet, Agent
builder, treasury integrator, or design partner. Do not make it a standing
roadmap item or invent synthetic partner activity to justify it.

The first usable Passport should contain one exact, reproducible action and:

1. Original Insight assessment artifacts, with their signed bytes intact.
2. A native PriorSeal verification bundle containing the principal
   authorization and observed execution receipt.
3. The expected transaction hash and original attachment hashes supplied by
   the review manifest.
4. Independently provisioned trust configuration for the reviewer, delivered
   through a channel separate from the Passport.

Use the SDK exports `createActionEvidencePassport`,
`parseActionEvidencePassport`, and `verifyActionEvidencePassport` from
`priorseal-sdk/verifier`; the executable wrapper and verifier are in
[`examples/action-evidence-passport-v1`](../../examples/action-evidence-passport-v1/README.md).

## Required boundaries

- Do not describe a wrapped manifest as a new signed certificate. The wrapper
  has no issuer signature and may not upgrade any claim in the embedded
  artifact.
- Do not merge Insight and PriorSeal trust roots. Each is verified under its
  own independently selected key registry and policy.
- Do not infer runtime enforcement from a committed Insight assessment. A
  native receipt or review manifest can show artifact relationships, not that
  every signer path consumed an assessment.
- If an x402 receipt is attached, label it only as a service-payment record.
  It does not authorize the target action, prove target-chain execution, or
  replace the principal's authorization.
- Preserve explicit uncertainty: pending, reorged, unavailable, mismatched or
  non-compliant execution must remain visible in the native review result.

## Delivery checklist

1. Independently pin the Insight and PriorSeal verification configuration.
2. Run the local manifest review before creating the Passport.
3. Create the wrapper and run its verifier with the same independently pinned
   configuration.
4. Provide the Passport, its native-manifest verification path, and the trust
   configuration's independent source. Never put private keys, API keys,
   wallet seed phrases, or paid-service credentials into the package.
5. State whether the sample is synthetic, testnet, or live, and state what it
   does not prove.
