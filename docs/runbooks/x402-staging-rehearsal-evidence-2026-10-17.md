# Base Sepolia x402 receipt-bundle rehearsal evidence

Scope: isolated `priorseal-staging` only. This is a Base Sepolia testnet
rehearsal, not a production payment, security attestation, or customer-facing
commercial launch.

## Evidence identifiers

| Evidence | Value |
| --- | --- |
| PriorSeal receipt | `psr_deb86e8c35fea8268806afd6aeefbab7` |
| Authorization | `auth_9673ba5d162f15c62dca904c3d4e67e1` |
| Subject execution transaction | `0x788f08681e79146b2ab54d74e112249e4de7affb856b605ac51d8e0f4f461554` |
| Subject execution block | Base Sepolia `48230920` |
| Receipt schema and result | `priorseal.execution-receipt.v3`; `COMPLETED`, `CONFIRMED`, `COMPLIANT` |
| Receipt issuer key | `priorseal-staging` / `staging-1` / Ed25519 |
| Paid resource | `GET /v1/receipts/psr_deb86e8c35fea8268806afd6aeefbab7/bundle` |
| x402 network and asset | `eip155:84532`; Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Quoted and settled amount | `10000` atomic units (`0.01` test USDC) |
| Payer | `0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC` |
| Test payee | `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231` |
| Settlement transaction | `0xb3feecbc896a51ea1f611f1e27936a93032a91d757413f94846db8a5f6d4799e` |
| Settlement block | Base Sepolia `48231145` |
| Portable bundle hash | `05feaa9ac2a75cb5d00340b3af9994564b46b9c971a6196b668e57c52141dfaa` |
| Signed payment-evidence ID | `psp_eff42090ee9e86b9831db8d28203b2a8` |
| x402 ledger | `xpl_2a3bf1d97e08d406dda1af02d96494e3` |
| Active Worker version after policy restoration | `594aa94e-2049-422f-860d-1d014df70d22` |
| Restored staging policy hash | `0xfac3a88cde1ebdb58f18ef9ebc4b32f5b181f8af8b67205eaab7692c654677a8` |

## Verified assertions

1. The client first received an HTTP 402 challenge, then accepted exactly one
   requirement: the fixed receipt-bundle resource, Base Sepolia, the stated
   test-USDC contract, fixed test payee, and `10000` atomic units.
2. Its required locally pinned `staging-1` issuer fingerprint matched the
   active staging public-key registry before the client signed a payment.
3. The paid response was HTTP 200. The native portable verification bundle
   verified locally with result `OK`; the embedded
   `priorseal.x402-payment-evidence.v1` also verified locally with result
   `OK`.
4. The settlement transaction succeeded on Base Sepolia. Its USDC `Transfer`
   event moves exactly `10000` atomic units from the identified payer to the
   fixed test payee. The transaction submitter is the facilitator, which is
   expected for gasless EIP-3009 settlement.
5. Immutable staging D1 ledger events record exactly one `PAYMENT_AUTHORIZED`
   event (`xle_4a0c631196ce8db27d06096d8908bf6a`, Unix ms
   `1792230576457`) followed by one terminal `DELIVERED` event
   (`xle_b3e2fe363e1b67bd94e116984f87d54d`, Unix ms `1792230577505`).
   The terminal event binds the same resource URL, network, amount, payer,
   settlement transaction, payment-evidence ID, one settlement attempt, and
   HTTP 200 delivery.
6. The temporary one-use authorization policy used to create the receipt was
   replaced after the run with the reviewed staging deny-by-default policy.
   Its deployed public policy hash matches the checked-in policy document.

## Persistent Evidence Pack rehearsal

The initial rehearsal above deliberately retained only public identifiers. A
second, isolated Base Sepolia rehearsal exercised the Evidence Pack retention
path added to the staging runner. It accessed the same fixed receipt-bundle
resource under the same pinned issuer and fixed payment terms.

| Evidence | Value |
| --- | --- |
| Settlement transaction | `0x6dd04340c19f363ed939dbf03db13f7ac7d5edc39001e4772c4803dc9841e0e3` |
| Settlement block | Base Sepolia `48231988` |
| Portable bundle hash | `749178b7ec46b73332a08480bd0035983a3ac07fb2a0c4ca7bf4fc4adf08c1dd` |
| Signed payment-evidence ID | `psp_b1c669561afb411f9a91ba39af05c331` |
| x402 ledger | `xpl_3d81dcfe8789796c270fefed8c1f7e4a` |
| Ledger events | `PAYMENT_AUTHORIZED` (`xle_db63c155466dd60a7f744b8af0e809c6`), then `DELIVERED` (`xle_84d080f761be90a8c64a69f548571b5d`) |

The new runner wrote a local Evidence Pack outside the repository. Its
directory mode is `0700`; each retained artifact is `0600`. The manifest
hashes matched `payment-challenge.json`, `verification-bundle.json`,
`settlement.json`, and `verification-result.json`. The pack contains neither
the raw `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` nor wallet key material. The
second ledger's terminal event records the same payer, resource, `10000`
atomic-unit amount, Base Sepolia network, HTTP 200 delivery, payment-evidence
ID, and exactly one settlement attempt. The Base Sepolia receipt is successful
and includes the matching USDC `Transfer` from the test payer to the fixed test
payee for `10000` atomic units.

## Retention boundary

The initial runner validated the complete signed bundle in memory and records
its bundle hash and signed payment-evidence ID above. The current runner can
also retain a local Evidence Pack outside the repository, with the protections
recorded above. Neither path persists raw `PAYMENT-SIGNATURE`,
`PAYMENT-RESPONSE`, wallet material, or those artifacts in this repository.
Fetching the protected bundle again would require another testnet payment and
was deliberately not performed.

The receipt remains available from the staging receipt endpoint. Independent
verifiers must establish the issuer public key through their own trusted
out-of-band pin; the staging HTTPS key registry is discovery metadata, not the
trust anchor.
