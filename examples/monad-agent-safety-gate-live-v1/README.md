# Monad Agent Safety Gate: Live Run v1

This is the operational successor to the synthetic safety-gate example. The
normal command is offline: it creates a bounded plan but does not call Insight,
load a private key, sign an x402 payment, sign a subject transaction, or
broadcast anything.

## 1. Create an offline plan

Use a **new, empty, absolute** output directory:

```sh
npm run monad:live-run -- \
  --intent "$PWD/examples/monad-agent-safety-gate-live-v1/intent.dry-run.json" \
  --out /private/tmp/monad-live-run-plan
```

`run-plan.json` binds the planned Monad call and planned Insight request URL,
and explicitly records that no payment or subject transaction occurred.
`tradeAmountUsd` is a dollar value with at most six decimal places; Insight's
signed attestation independently carries the equivalent micro-USD integer.

## 2. Validate a live quote without paying

After replacing the example intent with an actual bounded call, append
`--quote`. It makes one unsigned request and requires HTTP 402. It rejects a
quote unless there is exactly one Monad `eip155:143` `exact` option for the
pinned Monad USDC contract and its amount is within the configured cap.

```sh
npm run monad:live-run -- --intent /absolute/intent.json --out /absolute/new-output --quote
```

## 3. One explicitly authorized x402 payment

This is a real spend. Before using it, independently pin Insight's current
production EIP-712 attester in a copy of `trust-roots.template.json`, using
the published key material at
`https://www.oracleinsight.xyz/.well-known/oracle-keys.json`. Never use a
sample signer.

The command requires both `--pay` and `--confirm-x402-payment`, permits one
signed request to the exact quoted URL, refuses a second signed retry, verifies
the returned Insight v3 attestation, and writes an unsigned PriorSeal EIP-712
authorization request.

```sh
# Load MONAD_LIVE_RUN_PAYER_PRIVATE_KEY from a password manager or secret store
# in your runner environment before this command. Never place it in a command.
npm run monad:live-run -- \
  --intent /absolute/intent.json \
  --trust-roots /absolute/trust-roots.json \
  --out /absolute/new-output \
  --pay --confirm-x402-payment
```

The tool never exports the private key. Do not place one in JSON, command
history, or a tracked environment file.

## 4. Subject execution remains separate

`priorseal-authorization-request.json` is only a signing request. The
principal must inspect and sign it in their own wallet; an integration-owned
executor must separately submit the exact authorized call and record the
observed Monad transaction. Paying Insight never becomes permission to execute
the subject transaction.

Do not claim that a live run is complete until a third party can verify the
x402 settlement, Insight signature, principal authorization, and observed
Monad execution together.
