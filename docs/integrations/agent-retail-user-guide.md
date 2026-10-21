# Agent and retail user guide

PriorSeal is a self-custodial **proposal, confirmation, and evidence** layer.
It can help an Agent or application present one bounded Jupiter or 0x route,
but it is not a wallet, a trading recommendation, an automatic strategy, or a
promise of price, token quality, settlement, or profit.

## For a wallet owner

1. Start from **PriorSeal Swap** and select the guarded Jupiter or 0x flow.
2. Treat the Agent/application ID and retained rationale as context, not proof
   that a trade is good. Reject anything you do not understand.
3. Before signing, review the exact input amount, output floor, slippage,
   disclosed fees, priority/network-fee limit, route expiry, and the one-time
   Agent proposal binding. The wallet remains the signer and fee payer.
4. A submitted route has one relay attempt. If its outcome is unknown, observe
   the returned transaction signature; do not submit the action again.
5. Save the receipt or evidence bundle and verify it with independently
   established issuer-key trust. A receipt proves the stated authorization and
   observation boundary, not an investment outcome.

Never provide a seed phrase, private key, wallet signature, raw signed
transaction, or Agent service credential to a support channel.

## For an Agent integrator

1. Discover the public contract at
   `/.well-known/priorseal-agent.json` and check `/v1/capabilities` before
   presenting an available workflow.
2. Create a short `priorseal.agent-proposal.v1` record with a stable Agent ID,
   proposal ID, timestamp, and readable rationale. Retain the record; PriorSeal
   commits its digest to the exact action but does not rate or authenticate the
   Agent.
3. Send the proposal only to the guarded prepare endpoint. Do not ask PriorSeal
   to hold a transaction-signing key or produce a principal signature.
4. Present the returned exact review to the principal-controlled wallet. Accept
   only its signature for the exact, unexpired package.
5. Submit once through the documented guarded endpoint, then observe and store
   the returned signature and verification result. Recovery means observing the
   same action, never creating a replacement action automatically.

An Agent service key pays only for PriorSeal service usage. It is not an
execution mandate, wallet credential, or substitute for the principal's
signature. Keep it in the integrator's secret manager and use a distinct
idempotency key for each attempted service mutation.

## If something is unavailable

If the public capability response reports an integration as unavailable, do not
fall back to a raw route, a different provider, a broader amount, or a longer
expiry. Tell the user that the protected route is not available and retain no
new authorization. If a completed transaction cannot be observed yet, keep its
signature and wait for the explicit pending/reconciliation result.

For public support, security, privacy, billing or pilot access, use
`contact@priorseal.xyz` with a clear subject prefix. Do not include sensitive
incident data, wallet secrets, raw signatures or credentials; public issues
must remain redacted.
