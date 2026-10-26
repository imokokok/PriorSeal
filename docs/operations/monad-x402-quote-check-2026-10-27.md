# Monad x402 no-payment quote check — 2026-10-27

**Status:** `GATE_1_QUOTE_VALIDATED`
**Checked at:** 2026-10-27 02:40:12 Asia/Shanghai
(`2026-10-26T18:40:12.464Z`)

This is a current, no-payment production check for the Insight + PriorSeal
Monad commercialisation path. It is evidence for Gate 1 of the
[Monad x402 commercialisation gate](../runbooks/monad-x402-commercialization-gate.md),
not evidence that either product has settled a Monad payment or completed a
commercial customer delivery.

## Safety boundary

Each request was an unsigned public `GET` request. Neither request sent
`PAYMENT-SIGNATURE`, used a wallet or private key, called a facilitator
settlement endpoint, or broadcast a Monad transaction. Both returned HTTP 402
and were stopped there.

## Insight

| Check | Result |
| --- | --- |
| Resource | `GET https://www.oracleinsight.xyz/api/v1/safety/pre-trade?asset=ETH&destinationAsset=USDC&chainId=143&action=swap&tradeAmountUsd=1&schemaVersion=3` |
| HTTP / x402 result | `402` / x402 v2 |
| Monad options matching `exact` + `eip155:143` | Exactly 1 |
| Payment requirement | 20,000 atomic units (`$0.02`), `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (Monad USDC), `USDC` v2 |
| Payee | `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231` |
| Quote validity | 60 seconds |
| `PAYMENT-REQUIRED` header SHA-256 | `4a1d61de149d455341341a8f1b3f3cf734ddfc77cf35985aeab3bd894594c740` |
| 402 response body SHA-256 | `ac9c118233cbfa53eff58afad6851ada827e1eb2b3487ac9b0cae0bb13e7290b` |

The live `/.well-known/x402` manifest independently advertised the same Monad
USDC option and amount at this check time.

## PriorSeal

| Check | Result |
| --- | --- |
| Resource | `GET https://priorseal.xyz/v1/integration-readiness?chainId=143&subjectAddress=0x0000000000000000000000000000000000000000` |
| HTTP / x402 result | `402` / x402 v2 |
| Monad options matching `exact` + `eip155:143` | Exactly 1 |
| Payment requirement | 20,000 atomic units (`$0.02`), `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (Monad USDC), `USDC` v2 |
| Payee | `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231` |
| Quote validity | 300 seconds |
| `PAYMENT-REQUIRED` header SHA-256 | `4ec081e7deca16c71536f648a509d2ba6fd15d02c9e5f5b1afc01da9091b10fa` |
| 402 response body SHA-256 | `ed1fd0e024f601e50e15f34ea046c9abd94d89a204ee7d376758b54fe6bc691a` |

The same production check read `GET /v1/capabilities` successfully. It reported
`payments.x402.configured: true`, listed Monad (`eip155:143`) as an active EVM
network with the same USDC contract, and listed these paid routes at `$0.02`:

- `GET /v1/receipts/:receiptId/bundle`
- `GET /v1/integration-readiness`

## Result and next gate

Both production services can currently issue a correct, resource-bound Monad
x402 payment challenge. This satisfies the **quote availability** portion of
Gate 1.

It does not satisfy Gate 2 (a separately approved, capped Monad payment and
independent reconciliation), Gate 3 (a complete Insight → PriorSeal customer
path), or Gate 4 (an external design-partner commercial delivery). Those gates
remain pending and require the designated human approvals.
