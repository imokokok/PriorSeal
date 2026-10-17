# Test record

## 2026-10-16 update

Added explicit Base and Arbitrum One native-USDC EIP-3009 profiles to the
TypeScript adapter. The bundled route and settlement fixture remains Base-only;
no Arbitrum route proof or live settlement was added. This change has not been
run through the verifier or repository test suite.

Date: 2026-09-18 (Asia/Shanghai)

Scope: nonproduction, EOA-only, fully offline synthetic evaluation.

## Source pins

- PriorSeal base commit: `9260a115c42358046a6af7af0c86489ec0ec252b`
- 402Signal source commit: `ca6e2f1ee806bec6621487338ba6ed3f1ac09352`
- 402Signal route guard: `@402signal/route-guard` v0.7.3
- Node.js used for the recorded run: v24.19.0

## Results

| Command / check | Result |
|---|---|
| `node verify.mjs` | PASS — 9/9 executable vectors |
| Manifest-only isolated copy, `node verify.mjs` | PASS — 9/9; no repository or `node_modules` present |
| Raw route request / response / challenge through official guard | PASS |
| Matching payment + binding signatures | PASS |
| Changed terms and both replay keys | PASS — blocked before release |
| Correctly signed recipient and amount mismatches | PASS — blocked before release |
| Expired route with still-valid payment authorization | PASS — blocked before release |
| Timeout and reorg reconciliation | PASS — replacement authorization blocked |
| PriorSeal `npm run check` | PASS |
| PriorSeal Node test suite | PASS — 143/143 |
| SDK build, web build and performance budget | PASS |

The generated signed fixture contains public typed data, digests, signatures
and an EOA address only. The ephemeral private key was not written to disk and
is not included. Settlement evidence is synthetic; no RPC, live transaction,
funds, production change, API-delivery claim or Bankr compatibility claim is
part of this result.
