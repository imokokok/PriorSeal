# Jupiter guarded-swap design-partner pilot

This runbook scopes one bounded, user-controlled Solana Jupiter ExactIn
design-partner pilot for an Agent or trading application. It does not authorize
a payment, deployment, or transaction.

Use the public [pilot-brief page](https://priorseal.xyz/jupiter/pilot-intake) to
structure a non-sensitive request. The page is client-side only: it does not
collect a lead, transmit fields, or replace an agreed private business channel.
Use the public GitHub Issue form only for redacted developer collaboration.

## 1. Agree the scope before preparing anything

Record the partner, Agent/application name and identity-verification source (if
any), the Agent proposal-record owner and retention location, input and output
mints, maximum input, maximum slippage, maximum network and priority fees,
allowed programs and pinned lookup tables, authorization expiry, reviewer,
support owner, fee, evidence consumer, and success criterion. Disclose any
USDC platform fee, its basis points, recipient, and floor rounding before a
signer authorizes the swap. Do not make an economic, execution,
Agent-reputation, or asset-safety claim.

The Agent may propose the route and call the preparation APIs, but it must not
receive a transaction-signing key or a reusable authorization. Retain the same
`priorseal.agent-proposal.v1` record that was committed into the prepared
intent. The wallet principal reviews the Agent ID, rationale, exact spend,
minimum output, fees and expiry, then signs one authorization and the same
final transaction. The pilot must stop if lookup tables are unpinned or a
maximum priority fee is absent.

Choose the offer deliberately:

- **PriorSeal** when the buyer needs exact authorization, a one-time relay
  boundary, and portable execution evidence.
- **Insight** when the buyer needs a simulation or decision input, without
  treating it as a price, asset-safety, or investment verdict.
- **Insight + PriorSeal** when the buyer needs the decision input, exact
  authority, execution attempt, and evidence connected but independently
  reviewable.

## 2. Validate the route without funds

Check the deployed health, readiness, capabilities, Agent integration manifest,
and OpenAPI endpoints; confirm guarded Jupiter is ready, Solana authorization
is enabled, and the displayed fee matches the reviewed scope. Open `/jupiter` and
`/app/jupiter-guarded-swap` in a fresh browser profile, then run the focused
guarded-Jupiter test suite. Configuration readiness proves only configuration
and storage; it does not prove live RPC, TSA, Jupiter, or Insight reachability.

## 3. Obtain a separate funded GO

Before any transaction, obtain a new explicit GO identifying the wallet,
Agent/application, network, input and output mints, maximum input, maximum
platform, network and priority fees, expiry, incident owner, and evidence
viewers. Use one small transaction. Preserve the raw Jupiter response,
compiled unsigned transaction, Insight input, signed authorization, submit
result, observation, and independent verification result. If submission state
is unknown, do not retry automatically.

## 4. Measure the pilot without browser tracking

Deployment logs may export only these structured protected-route events:

- `guarded_jupiter.prepare_succeeded`
- `guarded_jupiter.submit_completed` with its submission outcome
- `http.request_failed`, filtered by route and reason

Configure the deployment logger/exporter and review aggregate counts with
`npm run jupiter:pilot:metrics -- /absolute/path/to/events.ndjson`. The tool
rejects records outside the permitted event schema and emits aggregate counts
only. These events contain the route, request ID, and outcome only; they
exclude request bodies, wallet addresses, transaction bytes, and provider
credentials. They are operational logs, not browser analytics, and do not
prove settlement or customer satisfaction.

Record the following only in the private closeout record, not in public
analytics: proposal-to-authorization conversion, authorization-to-signature
conversion, independent-verification completion, user cancellation reason,
partner-confirmed value, and support response time. The existing server events
cannot establish those facts by themselves.

## 5. Close before expanding

Independently verify the resulting evidence, record the outcome against the
agreed success criterion, and resolve every failure or unknown submission.
Use [the closeout template](../templates/jupiter-pilot-closeout.md) to keep
the funded GO, evidence result, exceptions, metrics, and expansion decision
separate. Expand the pilot only under a newly approved scope.
