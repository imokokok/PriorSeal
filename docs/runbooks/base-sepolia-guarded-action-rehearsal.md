# Base Sepolia Guarded Action rehearsal

This runbook proves the **workflow boundary**, not a production Aave deployment
or commercial payment rail. It uses the existing Base Sepolia exact-call
evidence fixture and requires an explicit wallet/payment authorization before
any new transaction is broadcast.

## Offline verification — no wallet, no payment

From the repository root, verify the published fixture:

```sh
npm run verify:web3-agent-kit-base-sepolia-live
```

This checks the recorded exact-call authorization, trust root, receipt and
binding offline. It does not contact a wallet or create a transaction. Add
`--online` through the existing script only when a trusted Base Sepolia RPC is
available and you want to compare the fixture against public chain data.

## Guarded Action rehearsal record

For a new, separately authorized test action, persist these state transitions:

1. `RISK_EVALUATED` — use an assessment appropriate to the exact test action;
   a `BLOCK` is terminal.
2. `AUTHORIZATION_PREPARED` then `AUTHORIZATION_SIGNATURE_REQUESTED` — show
   the exact canonical call and collect only the principal's EIP-712 approval.
3. `AUTHORIZATION_ACCEPTED` — record the acceptance and expiry. If it is not
   active, record `UNKNOWN` and reconcile; do not submit.
4. `SUBMISSION_RECORDED` — after the approved executor submits exactly once,
   persist the canonical transaction hash.
5. `OBSERVATION_STARTED` and `OBSERVATION_RECORDED` — observe that original
   hash. A timeout/reorg/missing hash stays `UNKNOWN`; it is never a signal to
   broadcast a replacement.
6. `VERIFICATION_RECORDED` — independently verify the matching final receipt.

## Required approval gates

- A testnet broadcast still requires the principal/executor's explicit approval
  and a named, maximum-spend testnet route.
- Never use the publicly documented development key in the existing historical
  fixture for a new run.
- Do not put wallet keys, payment credentials, or a user signature into the
  repository, a run log, a Skill archive, or a chat prompt.
- A successful testnet rehearsal does not authorize Base mainnet, a payment
  rail, a Wallet MCP allowlist, smart-account/UserOperation support, or a
  generic swap/batch route.
