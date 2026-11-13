# Action Evidence Passport v1

An **Action Evidence Passport** is the lightweight, downloadable presentation
wrapper for one existing Insight + PriorSeal combined review. It helps a
partner see the three facts in one file:

```text
Insight assessment evidence → PriorSeal authorization → observed execution
```

It is deliberately **not a protocol, signature, trust root, risk score, or
authorization layer**. The embedded `priorseal.review-manifest.v1` stays the
native evidence object; a verifier checks the original Insight and PriorSeal
artifacts with independently supplied trust configuration.

## Create a Passport

Build the checked-in TypeScript first:

```sh
npm run sdk:build
npm run core:build
```

Prepare a native `priorseal.review-manifest.v1` produced with
`buildReviewManifest`, then wrap it:

```sh
node examples/action-evidence-passport-v1/assemble.mjs \
  --manifest ./combined-review-manifest.json \
  --out ./action-evidence-passport.json \
  --title 'Base swap review — 2026-11-12'
```

For an optional x402 **service** payment record, preserve its original bytes:

```sh
node examples/action-evidence-passport-v1/assemble.mjs \
  --manifest ./combined-review-manifest.json \
  --out ./action-evidence-passport.json \
  --title 'Base swap review — 2026-11-12' \
  --service-payment ./x402-service-payment.json
```

The payment attachment remains `UNVERIFIED_SERVICE_PAYMENT` in this example.
It is an invoice/settlement record for evidence service, never permission for
the subject transaction and never proof that the subject transaction executed.

## Verify it

The trust JSON is independently provisioned reviewer configuration. It uses
the same shape accepted by `verifyReviewManifestLocally`: `trustedKeys`,
`expectedAudience`, and (when Insight artifacts are included) an Insight key
registry and applicable protocol/policy pins.

```sh
node examples/action-evidence-passport-v1/verify.mjs \
  --passport ./action-evidence-passport.json \
  --trust ./independently-pinned-trust.json
```

The verifier fails if the embedded native manifest is invalid or if the
Passport's convenience summary disagrees with that manifest. It does not
interpret or validate the service-payment attachment.

## Scope

- `summary` is convenience copy derived from native evidence, not an
  authoritative claim.
- The Passport preserves Insight and PriorSeal trust roots separately.
- A valid Passport does not establish runtime enforcement, economic safety,
  wallet custody, transaction broadcast, or partner adoption.
- The wrapper intentionally contains no recipient contact data or credentials;
  apply the normal disclosure review before attaching it to a partner email.
