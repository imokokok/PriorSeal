# Headless Oracle market-state pair v1

This offline fixture demonstrates the recommended short-window composition:

1. Fetch a Headless Oracle receipt immediately before authorization.
2. Put its `headlessoracle.market-state.v1` SHA-256 digest in the exact-call intent's context commitments, then sign the PriorSeal authorization.
3. Fetch a distinct receipt at execution time. Its signed `issued_at` must be at or after `authorityTime`; verify both receipts against the pinned issuer key, venue, status, mode, available signed coverage, and each receipt's own validity window.
4. Put the execution-time receipt and its digest in the final evidence bundle. Do not represent that second digest as authorization-time evidence.

Run:

```bash
npm run example:headless-market-state-pair
```

The included receipts came from the public Headless Oracle demo endpoint on 2026-09-17. The policy therefore opts into `demo` explicitly and accepts `CLOSED` solely to exercise the composition. Production callers should omit `allowedReceiptModes` to retain the SDK's `live`-only default, require `OPEN` for execution, and set `requiredFeedState: 'live'` where live halt-feed coverage is required. The `live` mode alone does not prove an authenticated or paid call. Only `OPEN` and `CLOSED` can be eligible under policy; `UNKNOWN`, `HALTED`, unrecognized statuses, and a signed `feed_state` other than `live` or `not_covered` always reject. A historical signed receipt without `coverage` can be verified with no feed-state requirement, but supplies no coverage evidence.

`vectors.json` also names negative cases for receipt ordering, unsafe signed states, failed feed, an override with signed `reason`, and a historical receipt without `coverage`. The test runner signs the mutated variants with a local test key; the original demo receipt bytes remain unchanged.
