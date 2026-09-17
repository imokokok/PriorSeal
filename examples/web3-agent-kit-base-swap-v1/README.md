# Web3 Agent Kit × Insight × PriorSeal: one Base swap

This is a compact, executable answer to the two design questions raised by Maulana: who has final authority when Insight and Web3 Agent Kit both influence execution, and whether an independent reviewer can reproduce authorization, timing and compliance from exported evidence after ordinary attestation expiry or key rotation.

The fixture is synthetic and never broadcasts a transaction. It models one native ETH → USDC swap on Base using the transaction shape currently constructed by Web3 Agent Kit's Uniswap V2 path at commit [`b673b82`](https://github.com/ulsreall/web3-agent-kit/commit/b673b82e4e90dfc86942fd59533a6b3e5f32598c).

## Recommended authority model

There is one final **policy** decision point: the Web3 Agent Kit governor.

| Component | Authority in this contract | What it records |
|---|---|---|
| Insight | Signed advisory risk input; never calls the signer and never broadcasts | `PASS`, `CAUTION`, `DANGER` or `BLOCK`, evidence commitments, freshness and validity |
| Web3 Agent Kit governor | Sole final agent-side policy decision | Native allowlist/limit result, Insight mapping, reason codes and whether to deny, request confirmation or proceed |
| Principal | Exact-call authority, exercised after the governor permits the handoff | EIP-712 signature over chain, target, calldata hash, value, transaction nonce, executor, validity and context commitments |
| PriorSeal | Evidence and compliance layer; it does not reinterpret or override the Insight verdict | Authorization acceptance, observed transaction, exact-call comparison, finality and `COMPLIANT` / `NON_COMPLIANT` |

The recommended v1 mapping is deterministic:

- `PASS` → eligible; all native governor rules must still pass.
- `CAUTION` → require explicit principal confirmation. Autonomous execution stops until that confirmation creates a new exact-call authorization.
- `DANGER` or `BLOCK` → deny. There is no override path in this v1 policy.
- missing, invalid, unknown-key or stale Insight evidence → deny.

This avoids two independent blocking authorities. Insight signs a fact. The governor chooses and applies the policy that consumes that fact. PriorSeal proves the subsequent authorization and outcome.

## Bounded flow

```text
Web3 Agent Kit transaction draft
  → two signed Insight v3 checks (WETH and USDC quote legs)
  → deterministic governor composition
  → principal-signed PriorSeal exact-call authorization
  → sign and submit the unchanged Web3 Agent Kit draft
  → PriorSeal chain observation and signed receipt
  → local verification from exported JSON + pinned keys
```

The successful fixture timeline is:

| Event | Signed or committed time |
|---|---:|
| Draft created | `2026-09-17T09:57:30Z` |
| Insight checks | `2026-09-17T09:58:00Z` |
| Governor decision | `2026-09-17T09:59:30Z` |
| Principal authorization | `2026-09-17T10:00:00Z` |
| PriorSeal acceptance | `2026-09-17T10:00:01Z` |
| Synthetic chain execution | `2026-09-17T10:01:00Z` |
| Observation and receipt | `2026-09-17T10:01:05Z` |

The Insight checks remain valid until `10:08:00Z`; the exact-call authorization expires earlier at `10:03:00Z`. If submission would fall outside either Insight window, the policy is `REASSESS_AND_REAUTHORIZE`: obtain fresh signed checks, rerun the governor and issue a replacement authorization. An old assessment never silently authorizes a delayed submission.

## Exact Web3 Agent Kit seam

The reviewed Web3 Agent Kit commit already has:

- immutable `TransactionIntent` values and deterministic `intent_id`;
- `ExecutionPolicy.evaluate()` returning `allowed`, stable denial reasons and `requires_confirmation`;
- a Base Uniswap V2 router path at `0x4752…d24`;
- local wallet signing and raw-transaction submission.

Its own safety-pipeline document also says write-capable modules do not yet share one enforced preflight pipeline. The current Uniswap path constructs, signs and sends inside `execute()`. The minimal adapter therefore belongs after the complete transaction dict is built and before `Wallet.sign_transaction()`:

```python
tx = build_swap_transaction(...)              # existing Web3.py dict
intent = TransactionIntent.from_evm_transaction(
    chain=Chain.BASE,
    action=ActionType.SWAP,
    transaction=tx,
)
native = execution_policy.evaluate(intent)
insight = insight_client.assess_swap(tx, quote)
decision = compose(native, insight, policy_id="wak-base-swap-insight-composition-v1")

if decision.is_denied:
    raise PolicyDenied(decision.reason_codes)

authorization = priorseal.authorize_exact_call(
    transaction=tx,
    context_commitments=[insight.digest, decision.policy_digest, decision.digest],
)
signed = wallet.sign_transaction(tx, Chain.BASE)
tx_hash = w3.eth.send_raw_transaction(signed)
```

The fixture deliberately uses native ETH → USDC, so the bounded action does not hide a preceding ERC-20 approval transaction. Token → token swaps would require a second, separately governed and authorized approval action in the current implementation.

## Binding points

The exported `evidence-bundle.json` contains every business object the verifier consumes.

### 1. Web3 Agent Kit draft

The verifier recomputes the current Web3 Agent Kit `intent_id` from action, calldata, chain, contract, native value and sender. PriorSeal additionally binds fields that the current Web3 Agent Kit intent ID does not include, notably the EVM transaction nonce.

### 2. Insight evidence

Both Insight Oracle Safety Check v3 envelopes include the signed EIP-712 payload, signatures, UIDs, canonical request hashes, validity windows and the complete provider-observation arrays. The verifier independently recomputes:

- both EIP-712 UIDs and signatures;
- both canonical request hashes;
- provider-observation commitments;
- participant counts, agreement and source-group counts;
- quorum and independence gates;
- the two-leg `insight.pretrade-pair.v1` commitment; and
- that governor evaluation and execution occurred inside the signed windows.

### 3. Governor evidence

`governor.policy` contains the authority contract and mapping above. `governor.decision` records the native decision, both Insight references, the resulting effect, the exact call and final handoff decision. Their RFC 8785-compatible canonical JSON SHA-256 digests enter the PriorSeal intent as:

- `web3-agent-kit.execution-policy.jcs.v1`
- `web3-agent-kit.policy-decision.jcs.v1`

The governor object does not need a second independent signing key in this design. Its exact bytes are committed by the principal's signed PriorSeal authorization, and the verifier deterministically recomputes the decision from the pinned policy plus signed Insight evidence. If Web3 Agent Kit later wants a separately operated governor, an additional governor signature can be added without changing the exact-call fields.

### 4. PriorSeal authorization and receipt

The signed `priorseal.intent.v2` binds:

- Base `chainId` `8453`;
- executor/sender;
- router target;
- full calldata hash;
- native value;
- EVM transaction nonce;
- validity window;
- Insight pair commitment;
- governor policy and decision commitments; and
- confirmation and maximum gas-used constraints.

The receipt embeds the principal authorization, issuer acceptance and complete observed execution. The local verifier checks both signatures, reconstructs all hashes and compares execution with the authorized call before accepting `COMPLIANT`.

## Self-contained and historical verification

The evidence bundle carries the receipt payloads and registry snapshots; `trust-roots.json` models keys pinned through a separate trusted channel. Bundled keys are discovery material, not self-authenticating trust anchors.

The fixture intentionally rotates both issuers' keys after issuance:

- the Insight attestation key has a historical `validUntil`, plus a successor key;
- the PriorSeal receipt key is `retired`, plus an active successor key.

The old evidence still verifies because key validity is evaluated at the signed issuance/check time. Ordinary evidence expiry prevents new use; it does not erase the historical statement. Ordinary key rotation likewise preserves old verification. Revocation is different and remains visible: the verifier fails closed if the historical Insight key is marked revoked. A compromise policy may additionally distinguish “valid at issuance” from “currently distrusted”; it must not rewrite the bytes that were originally signed.

No online Insight or PriorSeal API is needed. A production consumer should archive the immutable registry/release document it trusted, or pin key fingerprints out of band, instead of trusting only a registry copied beside the receipt.

## Reproduce locally

From a PriorSeal checkout:

```sh
npm run generate:web3-agent-kit-base-swap
npm run example:web3-agent-kit-base-swap
```

The verifier runs one positive case and four fail-closed mutations: changed governor decision, changed calldata, revoked historical Insight key and changed observed execution.

Expected result: `status: PASS`, baseline `OK`, and each mutation rejected with its expected reason.

## What an independent reviewer can and cannot conclude

A passing verification independently reproduces:

- which exact Base call the principal authorized;
- which signed Insight assessments and governor policy/decision it referenced;
- the order and validity of assessment, policy decision, authorization, execution and observation;
- whether the observed transaction matched the authorization; and
- how the final compliance result was derived.

It does **not** prove that the synthetic transaction was broadcast, the market data was economically correct, the trade was profitable, the Web3 Agent Kit project has adopted the contract, the current runtime cannot bypass its signer hook, or either product guarantees economic safety. The v1 receipt proves chain execution time, not an independently attested mempool broadcast time. Add a relayer-signed submission receipt only if exact broadcast timing is an acceptance requirement.

## Open confirmation requested from Web3 Agent Kit

One implementation detail still belongs to Maulana: confirm whether the preferred hook is a transaction-builder split inside `Uniswap.execute()` or a generic pre-sign wallet interceptor. The latter covers swaps and every future write-capable module, while the former is the narrowest first test.

