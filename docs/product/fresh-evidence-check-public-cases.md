# Fresh Evidence Check public-case policy

Fresh Evidence Check is purchasable for an already-issued,
authorization-bound PriorSeal receipt:

```text
GET https://priorseal.xyz/v1/evidence/receipts/{receiptId}/check
```

The endpoint returns x402 requirements before it reads or re-observes the
receipt. A successful settled request returns a newly signed
`priorseal.fresh-evidence-check.v1` record. It is read-only and does not give
the buyer authority over the subject-chain action.

## Case 01 — Monad technical record

The public [Monad Ping record](../../examples/monad-priorseal-ping-v1/LIVE-RUN-2026-10-21.md)
is a real zero-native-value, exact-call technical case. Its transaction and
contract identifiers are public so anyone can independently inspect them on
Monad. It deliberately does **not** publish the original EIP-712 signature or
a hosted PriorSeal receipt ID, so it is not presented as a purchasable Fresh
Evidence Check. Publishing one would require a separate, owner-approved
receipt whose authorization evidence is intended for public distribution.

This is the right boundary: public chain data does not imply consent to expose
an authorization artifact or turn a personal record into a marketing example.

## Case 02 — Solana public-record lane

The production service supports Solana mainnet-beta receipts and the same
fresh-check endpoint. The launch template is deliberately receipt-ID based:

```text
https://priorseal.xyz/v1/evidence/receipts/{public-owner-approved-receiptId}/check
```

No current production Solana receipt ID is copied into public documentation.
Existing records can contain a user principal and must remain private unless
their owner explicitly approves publication. To create a public Solana case,
run a zero-value or otherwise non-sensitive, owner-controlled transaction,
issue its receipt with a clear publication notice, then publish only that new
receipt ID and its scope statement here.

## Publication checklist

Before a receipt ID becomes a public paid case, confirm all of the following:

1. The owner has explicitly approved the receipt ID, authorization evidence,
   transaction hash, principal identifier and any embedded metadata for public
   distribution.
2. The action is non-sensitive and does not create an investment, safety,
   custody, payment-success, or economic-performance claim.
3. The case page names the subject chain and explains that x402 payment pays
   for a read-only evidence service, not for transaction authority.
4. A no-payment request receives a 402 challenge and an independent signature
   check of the delivered report succeeds.

