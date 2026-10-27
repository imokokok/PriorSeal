# x402 Credit-pack staging rehearsal — 2026-10-27

Status: reconciled and closed. This was one isolated Base Sepolia testnet
payment; it is not a production customer purchase or an authorization to run a
mainnet payment.

## Scope and cap

- Resource: `GET /v1/agent-credit-packs/staging-10/checkout`
- Network / asset: `eip155:84532` / Base Sepolia USDC
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Payee: `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231`
- Exact cap: `100000` atomic units ($0.10 test USDC) for 10 Agent Credits
- Account: `staging:credit-pack-rehearsal`, seeded with 1 Credit

The client was confirmation-gated, accepted only the fixed authenticated `GET`
above, and rejected a second signed request.

## Reconciliation

| Item | Result |
| --- | --- |
| Settled transaction | `0xc97d0cf7f1afb5296b6b808c117690b806e0ca4505ec43689d06ab0306a1c68e` |
| Durable purchase | `xcp_a1a059d6ce358501fb86092b21bf4df8` |
| Payment ledger | `xpl_ca62c0da5bb11cdc8f9c50afd121d8bf` |
| Purchase state | `CREDITED` |
| Ledger sequence | one `PAYMENT_AUTHORIZED`, then one `DELIVERED` for the same transaction |
| Credit balance | 1 → 11; exactly 10 Credits granted once |

No additional payment was submitted. The D1 purchase, immutable payment
ledger, and authenticated account readback were queried read-only to complete
the reconciliation.

## Incident and correction

The first client received a successful settlement response that omitted its
`account` field, even though the purchase was already durable and credited.
The cause was response assembly: after composing the Credit-pack delivery
state, the optional payment-evidence binder restored the pre-delivery body.

The fix keeps the current composed body when attempting evidence binding. A
regression test enables issuer payment evidence on a Credit-pack checkout and
asserts that `CREDITS_GRANTED`, the credited account, and settlement details
remain present. The corrected Worker was deployed to staging as version
`1c7f6cab-457e-45f5-8279-765e15916b8d`; a later no-payment probe confirmed:

- authenticated account: HTTP 200, 11 Credits remaining;
- Credit-pack checkout: HTTP 402 with only the fixed Base Sepolia requirement;
- public capabilities: `verified_action` discovery and `staging-10` pack are
  advertised.

This correction did not reuse the payment payload and did not create a second
settlement.
