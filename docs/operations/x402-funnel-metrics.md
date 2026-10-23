# x402 funnel metrics

The production Worker writes four structured, non-sensitive lifecycle events
for every paid-resource request. They intentionally exclude IP addresses,
wallet addresses, payment headers/payloads, receipt IDs, request bodies and
subject-chain transaction hashes.

| Event | Meaning | Safe dimensions |
| --- | --- | --- |
| `x402.challenge_issued` | A caller reached a protected resource and received a 402 requirement, or supplied an invalid payment. | route template, configured price, available-network count, outcome |
| `x402.payment_authorized` | The facilitator accepted a payment proof before resource dispatch. | route template, configured price, payment network |
| `x402.settlement_succeeded` / `x402.settlement_failed` / `x402.settlement_unknown` | Settlement reached the named outcome. | route template, price on success, network, retry count or non-sensitive reason |
| `x402.delivery_completed` | A settled resource response was delivered. | route template, response status, network |

`x402.resource_withheld` is also emitted when a verified payment proof reaches
a resource that cannot be delivered. It is operational diagnosis, not a
successful purchase.

Compute the commercial funnel from the counts, not from raw client identity:

```text
challenge → payment_authorized → settlement_succeeded → delivery_completed
```

The durable x402 ledger continues to preserve post-authorization settlement and
delivery evidence. Challenge interest stays in Worker logs so a no-payment
visitor does not create a buyer record in the application database.
