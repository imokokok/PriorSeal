# Web3 Agent Kit → PriorSeal context binding vector

This vector freezes the v1.18.1 interoperability decision:

- Web3 Agent Kit owns the `agent-call-envelope.v1` canonical payload and its
  SHA-256 digest.
- PriorSeal carries that exact digest under the same namespace and algorithm.
- PriorSeal does not normalize the envelope again and does not hash the digest
  a second time.
- The WAK policy decision remains a separate
  `web3-agent-kit.policy-decision.v1` commitment.

Run from the PriorSeal repository root:

```bash
npm run example:web3-agent-kit-context-binding
```

The verifier independently recomputes the WAK envelope digest from the frozen
payload, asks the PriorSeal SDK to construct both context commitments, and
requires the unique envelope binding to return `OK`.

This vector demonstrates deterministic identity composition. It does not prove
that Insight or PriorSeal is integrated into Web3 Agent Kit, that two addresses
have separate custody, or that a transaction is economically safe.
