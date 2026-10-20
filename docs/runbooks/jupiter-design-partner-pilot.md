# Jupiter guarded-swap design-partner pilot

This runbook scopes one bounded Solana Jupiter ExactIn design-partner pilot.
It does not authorize a payment, deployment, or transaction.

## 1. Agree the scope before preparing anything

Record the partner, input and output mints, maximum input, maximum slippage,
allowed programs and lookup tables, authorization expiry, reviewer, support
owner, fee, and success criterion. Disclose any USDC platform fee, its basis
points, recipient, and floor rounding before a signer authorizes the swap. Do
not make an economic, execution, or asset-safety claim.

## 2. Validate the route without funds

Check the deployed health, readiness, capabilities, and OpenAPI endpoints;
confirm guarded Jupiter is ready, Solana authorization is enabled, and the
displayed fee matches the reviewed scope. Open `/jupiter` and
`/app/jupiter-guarded-swap` in a fresh browser profile, then run the focused
guarded-Jupiter test suite. Configuration readiness proves only configuration
and storage; it does not prove live RPC, TSA, Jupiter, or Insight reachability.

## 3. Obtain a separate funded GO

Before any transaction, obtain a new explicit GO identifying the wallet,
network, input and output mints, maximum input, maximum platform and network
fees, expiry, incident owner, and evidence viewers. Use one small transaction.
Preserve the raw Jupiter response, compiled unsigned transaction, Insight
input, signed authorization, submit result, observation, and independent
verification result. If submission state is unknown, do not retry automatically.

## 4. Measure the pilot without browser tracking

Deployment logs may export only these structured protected-route events:

- `guarded_jupiter.prepare_succeeded`
- `guarded_jupiter.submit_completed` with its submission outcome
- `http.request_failed`, filtered by route and reason

Configure the deployment logger/exporter and review aggregate counts. These
events contain the route, request ID, and outcome only; they exclude request
bodies, wallet addresses, transaction bytes, and provider credentials. They
are operational logs, not browser analytics, and do not prove settlement or
customer satisfaction.

## 5. Close before expanding

Independently verify the resulting evidence, record the outcome against the
agreed success criterion, and resolve every failure or unknown submission.
Expand the pilot only under a newly approved scope.
