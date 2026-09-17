# Headless Oracle market-state pair v1

This offline fixture demonstrates the recommended short-window composition:

1. Fetch a Headless Oracle receipt immediately before authorization.
2. Put its `headlessoracle.market-state.v1` SHA-256 digest in the exact-call intent's context commitments, then sign the PriorSeal authorization.
3. Fetch a distinct receipt at execution time and verify both receipts against the pinned issuer key, venue, status, mode, coverage, and each receipt's own validity window.
4. Put the execution-time receipt and its digest in the final evidence bundle. Do not represent that second digest as authorization-time evidence.

Run:

```bash
npm run example:headless-market-state-pair
```

The included receipts came from the public Headless Oracle demo endpoint on 2026-09-17. The policy therefore opts into `demo` explicitly and accepts `CLOSED` solely to exercise the composition. Production callers should omit `allowedReceiptModes` to retain the SDK's `live`-only default and set business-appropriate allowed statuses.
