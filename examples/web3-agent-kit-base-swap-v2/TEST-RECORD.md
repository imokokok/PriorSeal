# Test record

- Date: 2026-09-17
- Command: `npm run example:web3-agent-kit-base-swap-v2`
- Result: `PASS`
- Baseline: `OK`

| Case | Expected | Actual |
|---|---|---|
| Complete exported evidence | `OK` | `OK` |
| Tampered governor decision | `GOVERNOR_DECISION_MISMATCH` | `GOVERNOR_DECISION_MISMATCH` |
| Authorization gate bypass policy | `GOVERNOR_AUTHORIZATION_GATE_BYPASS` | `GOVERNOR_AUTHORIZATION_GATE_BYPASS` |
| Tampered raw calldata | `DRAFT_CALLDATA_HASH_MISMATCH` | `DRAFT_CALLDATA_HASH_MISMATCH` |
| Historical Insight key revoked | `INSIGHT_KEY_REVOKED` | `INSIGHT_KEY_REVOKED` |
| Tampered observed execution | `PRIORSEAL_INVALID_SIGNATURE` | `PRIORSEAL_INVALID_SIGNATURE` |

The positive result reconstructed the Web3 Agent Kit policy handoff, principal authorization, exact-call match, signed timing windows, confirmed execution and `COMPLIANT` result. It also verified both attestations and the PriorSeal receipt using historical keys after a modeled ordinary rotation.

This v2 test record describes deterministic synthetic evidence and additionally pins principal exact-call authorization as mandatory for both eligible PASS branches. It is not a live Base transaction, production-key test, Web3 Agent Kit adoption claim or economic-safety guarantee.
