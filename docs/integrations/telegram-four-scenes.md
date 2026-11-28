# Telegram bot: four-scenario product and rollout

This document describes the four-scene read-only Telegram product. The user-facing flows accept ordinary text values, show the credit price and available balance before confirmation, and retain a prepared confirmation for seven days. Current market data is fetched after confirmation. Old JSON commands and transaction-bound Mini Apps remain disabled. New scenario release is conditional on Insight and PriorSeal production deployments and the production secret/DB checks described below.

The product does not create PriorSeal authorizations and does not connect to wallets, sign, place orders, submit transactions, or relay user transactions.

| Scenario | User entry | Insight role | PriorSeal role | Current state |
| --- | --- | --- | --- | --- |
| Polymarket | `/start` → buttons; optional `/check btc <up|down>` | Assess market integrity and collect reviewed source evidence | Verify signed decisions and evidence | Active pilot; a side tap shows a quote and balance first; a separate confirmation starts the assessment |
| Base lending | `/lending <supply|borrow> <WETH|USDC> <WETH|USDC> <collateral USD> <debt USD>` | Assess one Aave V3 Base caller-declared what-if position | Verify signed assessment evidence | Assessment-only; linked Insight account required |
| Hyperliquid perps | `/perp <long|short> <BTC|ETH> <notional USD> <margin USD>` | Assess a caller-declared BTC/ETH position with live venue/oracle context | Verify signed assessment evidence | Assessment-only; linked Insight account required |
| DEX swap | `/swap <weth-usdc|usdc-usdt> <forward|reverse> <amount>` | Show a quote and reviewed-pool/TWAP evidence from Base Aerodrome | Verify signed assessment evidence | Assessment-only; always CAUTION pending user review; no recipient or calldata |

## Hard boundary

The Telegram Worker and Mini Apps may collect assessment inputs, call Insight, verify signed decisions, and display or retain read-only evidence. They must not create wallet authorization, connect to a wallet, sign, broadcast, place, modify, cancel, forward, or relay a user's transaction or order. They must not retain wallet secrets or exchange credentials. A verdict of `ALLOW` is an assessment result only; it is not permission to execute. Any action the user chooses to take happens independently outside this Telegram integration.

PriorSeal's separate authorization and execution-verification products remain outside these assessment flows. The Telegram integration never signs, submits, broadcasts, or relays a user's transaction or order. The review Mini App does not accept imported unsigned order artifacts.

## Polymarket

- `/start` and `/menu` open the scenario menu. The user chooses Up or Down with an inline button; the callback contains no market timestamp.
- A side tap displays the selected BTC 5-minute market, Insight assessment price, linked-account available balance, and a fresh read-only Polymarket midpoint. It does not call Insight's assessment service. A separate confirmation starts the signed read-only assessment; if the market rolls, the price moves by more than one live market tick, or account cost/balance changes, the old quote is discarded and a replacement quote needs a new confirmation. The user never prepares or copies expiring timestamps.
- A quote targets a full 120-second human review window. It is valid for at most 120 seconds and expires no later than market close minus the current service reserve. Entry is offered only when at least `120 seconds + reserve` remain in the market. During cold start, reserve is capped at 60 seconds, preserving a 120-second confirmation opportunity in the first 120 seconds of each 5-minute market.
- The Worker records only successful confirmation-to-Telegram-delivery duration, without Telegram IDs or request contents. Samples are retained for 30 days (up to 10,000); after 1,000 samples, the reserve is `ceil(P99.9 × 1.5)`. The reserve may not exceed 60 seconds. If it does, the 5-minute market assessment entry fails closed until measured service latency supports it. The 1.5 multiplier is an operational safety margin and must be reviewed against production latency before lowering the reserve.
- Before assessment, the Worker refreshes the active market, outcome midpoint, tick size, Insight assessment price, and available account credits. If the signed assessment's chosen-side quote moves more than one market tick from the confirmed reference, it is not delivered; linked charges are refunded, sponsored reservations are released, and the user must review a fresh quote. If an assessment returns after market close, it is stale and not presented as current; linked charges are refunded and sponsored reservations are released.
- Polymarket requests are private-chat-only. A failed assessment returns a retry/menu action and never asks the user to edit a timestamp.
- One successful sponsored sample is available before linking, limited to one per Telegram account and a global ceiling of 200 Insight credits per UTC calendar month (currently at most ten samples at 20 credits each). This pilot subsidy is available only to the configured private beta allowlist; it fails closed if current pricing or the shared budget is unavailable. `/link` opens a 15-minute one-time confirmation on the authenticated Insight website. `/account` reports linked status and credits; `/usage` lists the last ten billed assessments; `/privacy` opens the privacy notice; `/help` and `/cancel` explain or exit the flow; `/unlink` removes the association. Linked successful assessments consume the user's Insight credits idempotently; failed assessments and undelivered trials release their reservations.
- New `/evidence` collection is paused until it uses linked-account billing. `/evidence-record <record-id>` remains available only for signed records previously collected in that private chat; records are commitment-checked, retained for at most 30 days, and may contain expired signatures. Retrieval is not a fresh assessment.
- This bot does not create or manage CLOB orders.

## Base lending

The previous exact-call Mini App is disabled. This scenario only accepts a caller-declared what-if position through `/lending <supply|borrow> <collateral WETH|USDC> <loan WETH|USDC> <post-action collateral USD> <post-action debt USD>`. V1 supports Aave V3 on Base. The bot does not read an address or a user's actual wallet position and labels values as caller-declared. It returns the signed guard result without calldata, a transaction envelope, or any wallet interaction.

## Hyperliquid perps

The previous `/perp <JSON>` endpoint is disabled. V1 accepts `/perp <long|short> <BTC|ETH> <notional USD> <margin USD>`, then requires a separate confirmation that can be used for seven days. Current venue and oracle data are collected after confirmation. All position values are caller-declared. The signed report has no IOC expiry, order envelope, signature request, or exchange authorization.

## DEX swap

The previous `/swap <JSON>` endpoint and settlement path are disabled. V1 accepts `/swap <weth-usdc|usdc-usdt> <forward|reverse> <amount>` and uses only read-only on-chain quote/TWAP evidence from the two reviewed Base Aerodrome Slipstream pools below. It never collects a recipient or constructs approval/swap calldata. The result is always `CAUTION`: it presents the quote and reference deviation for user review and does not claim to assess a transaction-specific slippage limit or execution outcome. Other networks, pools, and tokens are unavailable.

Reviewed profiles for future launch include:

- `base-aerodrome-slipstream-weth-usdc-cl100`
- `base-aerodrome-slipstream-usdc-usdt-cl1`
- `base-pancakeswap-v3-usdc-usdt-100`
- `bnb-pancakeswap-v3-usdt-usdc-100`
- `bnb-pancakeswap-v3-usdt-wbnb-100`
- `monad-pancakeswap-v3-wmon-usdc-500`

Settlement verification of a user-performed trade is outside this Telegram product and must not be offered by the bot.

## Account, trial, billing, and release gates

All three scenarios require a linked authenticated Insight account and use its existing credit wallet. The account screen shows current price and available credits before confirmation. Prepared confirmations are private-chat-bound, single-use, and available for seven days. The market read and assessment are performed only after confirmation. Charges are idempotent and scene-labelled; failures, signature-verification failures, and undelivered report files invoke an idempotent compensation route. Signed reports declare a 30-day validity window; after it, their signature remains historical evidence of the snapshot, not a current assessment.

Each scene returns only a signed read-only report. A successful `ALLOW` remains a risk assessment, never transaction authorization. Production release additionally requires the Worker’s Ed25519 request-signing private key, the pinned Insight verification key, Supabase migration `telegram_readonly_scenarios`, and a smoke check that `/start`, account pricing, scenario confirmation, assessment signature verification, billing, and refund behavior are coherent. If any check is unavailable, that scene must fail closed and must not be described as live.

## Operations and data handling

The Worker uses webhook verification, the configured private beta allowlist, and per-chat request limits. Keep `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_INTEGRATION_PRIVATE_KEY`, `INSIGHT_API_KEY`, and the chat allowlist in Worker secrets. Insight pins only the matching public verification key; no shared integration secret is needed in Vercel. Do not log request bodies, wallet keys, API keys, link tokens, or bot credentials; failure logs contain only bounded reason codes.
