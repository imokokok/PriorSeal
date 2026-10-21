# Agent and retail user guide

PriorSeal is a self-custodial authorization and evidence tool. It does not act
as a wallet, exchange, route builder, trading recommendation, or transaction
service.

## For a wallet owner

1. Review the exact bounded action and its expiry before authorizing it.
2. Sign only in your own wallet after verifying the authorization payload.
3. Retain the resulting receipt for independent review.

PriorSeal never asks a wallet owner for a seed phrase, private key, raw signed
transaction, or permission to broadcast a transaction.

## For an Agent integrator

An Agent may prepare a bounded authorization, but it must not present PriorSeal
as a quote, route-selection, signing, relay, or automatic-trading service. Keep
any signing and submission decision with the user-controlled wallet flow.
