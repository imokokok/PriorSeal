# Restricted automated treasury pilot

This pilot demonstrates one bounded automated EVM operation from authorization through independently verifiable evidence. It uses a local Ganache chain, ephemeral Ed25519 issuer key and valueless test tokens only. It never connects to a wallet, a public RPC or a market-data API.

The supported action is one reviewed original Uniswap V3 `exactInputSingle`-shaped ERC-20 call. The local runner requires authorization before it submits the call, checks the exact signed call again immediately before broadcast and observes the final transaction before it produces a receipt.

The runner demonstrates all of these outcomes:

- A matching, single-use authorization is accepted and the reviewed call executes.
- A change to the recipient is rejected before broadcast.
- Replaying the same authorization does not submit again.
- A router-code change immediately before broadcast is rejected and leaves the signer nonce claimed for reconciliation.
- The final receipt is exported as a standard `priorseal.verification-bundle.v1` Evidence Pack and verified with an explicitly supplied trust root.

## Run the pilot

Install Ganache outside the repository, as a disposable local test dependency:

```sh
npm install --prefix /tmp/priorseal-local-evm --ignore-scripts --no-audit --no-fund ganache@7.9.2
```

Then run the local pilot and write its artifacts to a new, empty directory:

```sh
GANACHE_MODULE=/tmp/priorseal-local-evm/node_modules/ganache/dist/node/core.js \
PRIORSEAL_PILOT_OUTPUT_DIR=/tmp/priorseal-restricted-pilot \
npm run pilot:restricted-automation
```

The directory receives three artifacts:

| File | Purpose |
| --- | --- |
| `evidence-pack.json` | The portable, signed `priorseal.verification-bundle.v1` receipt package. |
| `trust-root.json` | The public key and audience the offline verifier must receive separately. This test run creates an ephemeral key; it is not a production trust root. |
| `run-summary.json` | The local harness's scope and assertion results. It is operational context, not a signed claim. |

Verify the Evidence Pack without contacting the PriorSeal HTTP service:

```sh
npm run verify:restricted-automation-pilot -- \
  /tmp/priorseal-restricted-pilot/evidence-pack.json \
  /tmp/priorseal-restricted-pilot/trust-root.json
```

The verifier refuses to establish trust from the key registry carried inside the Evidence Pack. In a real pilot, the customer and independent reviewer must pin the issuer key through their own approved channel before they use the package.

## Production handoff criteria

This is a reusable local acceptance drill, not a production integration. Before a customer operation is in scope, fix the following in that customer's environment:

1. One reviewed executor and exact call profile, including an independent router-code hash.
2. One customer-held signing route whose every broadcast path invokes the PriorSeal guard.
3. A durable shared attempt store for all executions using the same signer nonce.
4. A customer-approved issuer key and independent time-evidence mode.
5. A named outside reviewer, Evidence Pack retention location and recovery owner for uncertain executions.

The pilot does not claim custody, transaction profitability, market-data validation, unrestricted DeFi coverage, or production readiness.
