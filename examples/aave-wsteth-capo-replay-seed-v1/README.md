# Aave wstETH CAPO replay seed v1

**Status:** reproducible two-transaction seed; not yet a sale-grade six-piece sample.

This pack ties one CAPO parameter update to one real Aave V3 liquidation event on Ethereum. It is intended to test whether buyers value a replay that makes an oracle-parameter transition inspectable. Aave and LlamaRisk have already published incident analyses; this pack does not claim a new incident discovery.

## What the public records show

- The Aave CAPO adapter emitted `CapParametersUpdated` in block `24626860`, transaction `0x32c64151469cf2202cbc9581139c6de7b34dae2012eba9daf49311265dfe5a1e`.
- The event records `snapshotRatio = 1191926196478762900`, `snapshotTimestamp = 1772535647`, `maxRatioGrowthPerSecond = 3326024394`, and `maxYearlyRatioGrowthPercent = 880`.
- A successful transaction in the next block, `24626861`, contains an Aave V3 `LiquidationCall` for wstETH collateral and WETH debt. The event reports `10.003153278366877706` wstETH collateral seized against `11.836703277700000242` WETH debt.
- Aave's post-mortem reports an approximately 2.855% downward effective exchange-rate deviation, about 10,938 wstETH in liquidation volume across 34 accounts, and no protocol bad debt.

The update and liquidation records are from Etherscan transaction pages and decoded receipt-event logs. `observations.json` preserves the event topics/data shown there. It is not a raw `eth_getTransactionReceipt` export. A direct request to the public Ethereum RPC host failed DNS resolution on this workstation, so I used the explorer records for this bounded seed. `derive.mts` replays the CAPO arithmetic from the event parameters and the update-block timestamp. It does not perform a historical `eth_call` or establish the exact runtime bytecode version deployed at that block.

## Explorer cross-check

Checked against the Etherscan transaction pages and decoded logs on 2026-10-11:

| Field | Sample value | Explorer result |
|---|---|---|
| CAPO update transaction | `0x32c64151469cf2202cbc9581139c6de7b34dae2012eba9daf49311265dfe5a1e` | Exact hash match; successful, block `24626860`, `2026-03-10 11:46:11 UTC` (`1773143171`). |
| CAPO event parameters | Snapshot ratio `1191926196478762900`; snapshot timestamp `1772535647`; growth/sec `3326024394`; annual growth `880` | Exact match to Etherscan's decoded `CapParametersUpdated` log. Snapshot timestamp converts to `2026-03-03 11:00:47 UTC`. |
| Liquidation example transaction | `0x7872defdef7b839d43e79797ce4c4461b9727861db6aa9e72347f8e995812f5f` | Exact hash match; successful, block `24626861`, `2026-03-10 11:46:23 UTC` (`1773143183`). |
| Liquidation event amounts | `10.003153278366877706` wstETH and `11.836703277700000242` WETH | Exact match to the decoded `LiquidationCall` log and token-transfer view. |
| Price figures | Snapshot ratio `1.191926196478762900`; replayed cap `1.193946836122721601` | These are wstETH/stETH exchange ratios, not USD-denominated prices. The replayed cap agrees with Aave's approximate `1.1939`. No historical USD oracle answer or live ratio is claimed. |
| Incident price impact | `2.855%` | Updated from the earlier rounded `2.85%` transcription to match Aave's stated approximate value. |

The transaction hashes, block numbers, timestamps, and decoded event values matched. The only correction was precision: `2.85%` is now recorded as `2.855%` where the Aave post-mortem gives that figure.

## Reproduce the parameter calculation

From the PriorSeal repository root, after `npm ci`:

```sh
npm run core:build
node examples/aave-wsteth-capo-replay-seed-v1/derive.mjs
```

The command validates the recorded event words, calculates the maximum ratio with integer arithmetic, compares the rounded growth-rate event field, and writes `replay.json`.

`CHECKSUMS.sha256` records the current bundle digests for drift detection. It is not a signature, does not identify a trusted issuer, and is not a PriorSeal receipt.

The derived values are:

```text
elapsed from snapshot to update block: 607,524 seconds
internal scaled growth / second:       3,326,024,394,030,033
reconstructed maximum ratio:            1.193946836122721601
event-rounded growth / second:           3,326,024,394
```

The reconstructed cap agrees with the approximately `1.1939` value in Aave's post-mortem. The recorded and replayed values are wstETH/stETH exchange ratios, not USD prices. This is a formula replay, not a direct historical read of `latestAnswer()`, the base ETH/USD feed, or the live wstETH/stETH ratio.

## Six-piece sale-sample gate

| Required piece | Current state |
|---|---|
| Source list and adapter identity | Partial: official Aave post-mortem, official source code, and two explorer transaction records are linked. The historical feed/adapter source graph still needs a pinned block-state read. |
| Raw updates with ordering and timestamps | Partial: one adapter update and one liquidation transaction are recorded; no complete event-range scan. |
| Protocol-used price | Partial: CAPO cap arithmetic is reconstructed. Historical `latestAnswer()`, base ETH/USD answer, and actual wstETH/stETH ratio have not been directly read at the event block. |
| Update-to-liquidation association | One real liquidation example is included. The full incident's liquidation set is not linked transaction by transaction. |
| Completeness and finality | Incomplete: no archive-RPC range scan, independent receipt-byte fetch, reorg/finality check, or all-account reconciliation. |
| Reproduction and delivery files | Present for the bounded parameter calculation; incomplete for the full incident reconstruction. |

## Commercial fit

- **Insight alone:** the closest fit is a fixed-scope historical oracle/adapter replay. The buyer question is whether a repeatable, independently checkable parameter-to-price reconstruction saves risk or engineering time. The published post-mortem means the sales proposition must be the reusable evidence workflow, not a novel incident conclusion.
- **PriorSeal alone:** this historical event has no PriorSeal authorization or receipt. A retrospective signature cannot establish who approved the update before execution.
- **Insight + PriorSeal:** a future workflow could commit the assessment digest to a newly proposed exact setter call, obtain approval before execution, then verify the observed call. This incident only motivates that hypothesis; it does not prove a buyer wants it.

Compared with the earlier Mag-7 weekend replay, CAPO is the stronger lead sample candidate because it combines a real liquidation with complex adapter behavior. Keep the Mag-7 pack as a repeatability/weekly-monitoring demo. The CAPO pack still needs the range scan and historical state reads above before it passes the sale-sample gate.

The current research gate remains unchanged: do not add product investment until two independent buyers pay for a bounded delivery and at least one buys again. No outreach has been sent from this pack.

## Gaps to close before calling it procurement-ready

1. Obtain a working public archive source and fetch the two transaction receipts plus historical CAPO/base-feed state directly.
2. Scan the complete affected block/time interval for all `CapParametersUpdated` and `LiquidationCall` events; preserve raw RPC responses, log indices, block hashes, and source failures.
3. Pin the deployed adapter bytecode/source version and reproduce the exact `latestAnswer()` result at the update and liquidation blocks.
4. Reconcile the complete liquidation quantity and affected accounts against Aave's aggregate report.
5. Re-render the final evidence pack after those chain checks before using it as a sale sample.

## Sources

- [Aave / Chaos Labs post-mortem](https://governance.aave.com/t/post-mortem-exchange-rate-misallignment-on-wsteth-core-and-prime-instances/24269)
- [Etherscan: parameter update transaction](https://etherscan.io/tx/0x32c64151469cf2202cbc9581139c6de7b34dae2012eba9daf49311265dfe5a1e)
- [Etherscan: liquidation example](https://etherscan.io/tx/0x7872defdef7b839d43e79797ce4c4461b9727861db6aa9e72347f8e995812f5f)
- [Routescan: CAPO adapter event history](https://routescan.io/address/0xe1D97bF61901B075E9626c8A2340a7De385861Ef/events)
- [Aave CAPO source: `PriceCapAdapterBase.sol`](https://github.com/aave-dao/aave-price-feeds/blob/main/src/contracts/PriceCapAdapterBase.sol)
- [LlamaRisk's public response](https://governance.aave.com/t/post-mortem-exchange-rate-misallignment-on-wsteth-core-and-prime-instances/24269/18)
