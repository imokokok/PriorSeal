# Monad Agent Safety Gate v1

This is the first public, reproducible evidence artifact for the Monad Agent
Safety Gate walkthrough:

```text
Agent proposes a Monad action
  → Insight issues a signed pre-trade verdict
  → an integrator-owned policy maps the verdict to proceed / confirm / deny
  → a principal signs one bounded PriorSeal authorization
  → execution is observed and exported for independent review
```

The checked-in artifact is deliberately **synthetic and no-broadcast**. It
uses public fixture keys, pays no x402 request, calls no hosted API, and does
not name or interact with a deployed Monad protocol. That boundary is
intentional: a runnable proof of authorization and verification must not be
mistaken for a real trade, a customer payment, chain finality, or economic
safety.

## Reproduce

From a fresh PriorSeal checkout with Node.js 22 or later:

```sh
npm ci
npm run example:monad-agent-safety-gate
```

The command regenerates `evidence-bundle.json` from deterministic test keys,
then verifies it locally. The report must end with `"status": "PASS"` and
establishes all of the following:

- the signed Insight attestation concerns Monad mainnet (`eip155:143`);
- a `PASS` verdict reaches only `PROCEED_TO_PRINCIPAL_AUTHORIZATION`, never
  permission to sign or broadcast;
- the PriorSeal authorization binds chain, executor, target, calldata hash,
  native value, expiry, and both Insight and policy-decision commitments;
- the observed action matches that exact authorization; and
- altered Insight evidence or a tampered PriorSeal receipt fails verification.

To validate an already exported bundle without regenerating it, run:

```sh
npm run verify:monad-agent-safety-gate
```

`DANGER` and `BLOCK` map to `DENY`; `CAUTION` maps to an additional principal
confirmation. A service payment is deliberately separate from authority over
the subject transaction.

## Public walkthrough boundary

This artifact is the offline proof component of the future live walkthrough.
The live version must use a user-owned wallet and an explicitly authorized
Monad x402 payment to Insight, then an integration-owned execution path and
PriorSeal production evidence. Do not add credentials, fund fixture addresses,
or represent this sample as a payment, endorsement, or production deployment.

The next activation criterion is one independently operated agent completing
the live flow and an external reviewer verifying its exported evidence bundle.
