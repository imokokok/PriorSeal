# Monad PriorSeal Ping v1

This is the first real Monad transaction lane for the portfolio: a wallet owner
deploys a deliberately minimal contract and then calls `record(bytes32)` with
**zero native value**. The call emits one event and cannot receive funds,
approve tokens, transfer tokens, or invoke another contract.

It is intentionally distinct from the Insight-backed financial safety gate:

| Demonstration | What it proves | What it does not claim |
| --- | --- | --- |
| Monad PriorSeal Ping | A human wallet signed a PriorSeal EIP-712 authorization for one exact zero-value call, and that exact call emitted the expected Monad event. | A market assessment, economic safety, token safety, or autonomous trading authority. |
| Monad Agent Safety Gate | How a bounded financial intent can be gated by a paid, signed Insight assessment before PriorSeal authorization. | That a non-financial `Ping` call received an Insight market assessment. |

The only live cost in this demonstration is the Monad gas shown and confirmed by
the principal's wallet. The scripts never accept a private key or broadcast a
transaction.

## What is created

`contracts/MonadPriorSealPing.sol` has one external function:

```solidity
record(bytes32 runId)
```

It requires `msg.value == 0` and emits `RunRecorded(runId, caller)`. Both the
event's `runId` and the exact calldata are bound into the prepared PriorSeal
authorization. The deployment is intentionally separate because a contract's
address is known only after its deployer and deployment nonce are fixed.

## 1. Prepare a wallet handoff

Use a new, empty, absolute output directory. The recommended form gets the
next pending nonce through a configured Monad RPC; it is a read-only RPC call.

```sh
npm run monad:ping:prepare -- \
  --principal 0xYOUR_WALLET_ADDRESS \
  --rpc "$PRIORSEAL_RPC_MONAD" \
  --label "YuTao Peng Monad capability demonstration" \
  --out /absolute/new/monad-ping-run
```

If you deliberately want an offline plan, supply the nonce obtained from the
wallet immediately before the run instead. Do not use this mode if the wallet
has a pending or concurrent transaction.

```sh
npm run monad:ping:prepare -- \
  --principal 0xYOUR_WALLET_ADDRESS \
  --deploy-nonce 42 \
  --out /absolute/new/monad-ping-run
```

The command writes:

- `deployment-transaction.json` — the unsigned contract-creation transaction.
- `record-transaction.json` — the subsequent exact call, with `valueWei: "0"`.
- `priorseal-typed-data.json` — the EIP-712 message the principal must review
  and sign; it is not a transaction.
- `WALLET-HANDOFF.md` — the exact nonce, predicted contract address, and safe
  wallet sequence.

The two transaction nonces are consecutive. Do not send another transaction
from the same wallet between the deployment and record call. If a wallet
rejects, replaces, or changes either transaction, discard the bundle and
prepare a fresh one.

## 2. Wallet-controlled execution

Read the generated `WALLET-HANDOFF.md` before any wallet prompt. In order:

1. Set the wallet to Monad mainnet (chain ID `143`) and check the displayed gas.
2. Send the exact deployment transaction from the bundle. Its `to` is empty and
   `value` is zero.
3. Confirm the receipt's deployed address equals the bundle's predicted address.
4. Sign `priorseal-typed-data.json` using the same wallet. This is an EIP-712
   message signature, not permission for an arbitrary future transaction.
5. Send the exact `record-transaction.json` call. It carries zero native value.

Do not share a seed phrase, private key, or wallet-export file. A user-facing
wallet must present and approve both chain transactions. The EIP-712 signature
is only retained locally to prove the prior authorization.

## 3. Independently verify the completed run

After both transactions are mined, pass their hashes and the separately
produced EIP-712 signature to the read-only verifier. Its output directory must
be new and empty.

```sh
npm run monad:ping:verify -- \
  --bundle /absolute/new/monad-ping-run \
  --rpc "$PRIORSEAL_RPC_MONAD" \
  --deployment-tx 0xDEPLOYMENT_TRANSACTION_HASH \
  --call-tx 0xRECORD_TRANSACTION_HASH \
  --signature 0xPRINCIPAL_EIP712_SIGNATURE \
  --out /absolute/new/monad-ping-verification
```

The verifier checks all of the following against the bundle rather than merely
checking that two Monad transactions exist:

- the RPC is chain ID `143`;
- the exact deployment bytecode, sender, zero value, nonce, and deterministic
  deployed address;
- the exact follow-up target, calldata, sender, zero value, and nonce;
- the principal's EIP-712 signature and its authorization time window; and
- the `RunRecorded(runId, caller)` event emitted by the expected contract.

`verification-report.json` reports a precise technical result. It does not
create an Insight attestation, receipt from a hosted PriorSeal service, audit,
or claim of production safety.

## Recorded live run

The first completed zero-value Monad run, including its public transaction
identifiers, verification scope, and Chinese summary, is recorded in
[LIVE-RUN-2026-10-21.md](./LIVE-RUN-2026-10-21.md). It is intentionally scoped
as a technical exact-call proof rather than financial or market-risk evidence.
