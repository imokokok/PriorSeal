# Compatibility gate

This skill supports a deliberately small profile because a transaction that is
safe to display is not necessarily one PriorSeal can prove was authorized and
executed exactly.

| Wallet MCP result | PriorSeal status in this skill | Reason |
| --- | --- | --- |
| One final Base EOA call plus matching EOA nonce and one canonical tx hash | Eligible | The EVM exact-call profile can bind the full envelope before signing and compare it after observation. |
| Wallet MCP `swap` | Assessment-only | The public Wallet MCP interface does not expose the reviewed final call and nonce required by this profile. |
| `send_calls` batch, including ERC-20 approval + action | Assessment-only | A one-call authorization must not be silently broadened to cover an atomic batch. |
| Smart account / UserOperation | Assessment-only unless separately integrated | PriorSeal has account-specific ERC-4337 profiles, but this skill does not infer that Wallet MCP emitted a supported account, EntryPoint, UserOperation, and traceable call. |
| ERC-1271 or ERC-6492 signature result | Assessment-only unless separately configured | The EOA signing profile must not unwrap or reinterpret contract-wallet signatures. |
| Pending, reorged, unknown or non-canonical status | No resubmission | The authorization is a one-use evidence object; settlement requires reconciliation, not an automatic retry. |

Adding a row requires a versioned adapter, test vectors, deployment trust pins,
and a named integrator that can supply the exact wallet-side object. It is not a
configuration toggle.
