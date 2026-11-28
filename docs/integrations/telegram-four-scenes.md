# Telegram bot: four-scenario product and rollout

This document is the four-scenario product blueprint. The current user pilot opens only the Polymarket assessment. Base lending, Hyperliquid perps, and DEX swap remain closed until their guided input forms, account-aware billing, read-only response contracts, and verification flows meet the release gates below. Old JSON commands and exact-call Mini Apps are disabled. Do not publish their old test instructions.

The product does not create PriorSeal authorizations and does not connect to wallets, sign, place orders, submit transactions, or relay user transactions.

| Scenario | User entry | Insight role | PriorSeal role | Current state |
| --- | --- | --- | --- | --- |
| Polymarket | `/start` → buttons; optional `/check btc <up|down>` | Assess market integrity and collect reviewed source evidence | Verify signed decisions and evidence | Active pilot; a side tap shows a quote and balance first; a separate confirmation starts the assessment |
| Base lending | Shown as coming soon | Assess a user-declared what-if position or read-only public position | Verify signed assessment evidence | Closed; no calldata or raw transaction form |
| Hyperliquid perps | Shown as coming soon | Assess a guided position-size and margin scenario | Verify signed assessment evidence | Closed; no order envelope, IOC expiry, or account authorization |
| DEX swap | Shown as coming soon | Assess a quote, route, and user-selected risk limits | Verify signed assessment evidence | Closed until the assessment-only API returns no approval/swap calldata |

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

The previous exact-call Mini App is disabled. It required transaction JSON and returned a decision bound to executable call data, which is not the user-facing assessment product. The future form should read a public address's position where supported and separately label hypothetical changes supplied by the user. If live position reading is unavailable, the form must say inputs are caller-declared. The assessment must return no calldata or transaction/order envelope.

## Hyperliquid perps

The previous `/perp <JSON>` endpoint is disabled. The future experience is a guided form for asset, direction, size, and margin, followed by a review screen with enough time to inspect the result. Any short-lived exchange assessment fields are created inside server infrastructure and are not user inputs or user-facing artifacts. The assessment API must bind to the declared scenario and must not return an executable order envelope.

## DEX swap

The previous `/swap <JSON>` endpoint and settlement path are disabled. They depended on exact quote, recipient, slippage, and transaction data supplied as JSON and could return data bound to executable approval/swap calls. The future experience must use an assessment-only API with no executable calldata. A guided form will expose supported network, token pair, amount, quote age, slippage, price impact, and reference deviation in ordinary fields. It will not collect a recipient or build an approval/swap transaction.

Reviewed profiles for future launch include:

- `base-aerodrome-slipstream-weth-usdc-cl100`
- `base-aerodrome-slipstream-usdc-usdt-cl1`
- `base-pancakeswap-v3-usdc-usdt-100`
- `bnb-pancakeswap-v3-usdt-usdc-100`
- `bnb-pancakeswap-v3-usdt-wbnb-100`
- `monad-pancakeswap-v3-wmon-usdc-500`

Settlement verification of a user-performed trade is outside this Telegram product and must not be offered by the bot.

## Account, trial, billing, and release gates

The controlled pilot now links Telegram accounts to authenticated Insight accounts and uses each linked user's existing credit wallet. A server-side integration secret protects the linking/status/assessment routes. The bot never receives or displays an Insight API key. The first sponsored sample is capped at one successful assessment per private Telegram account; linked assessments are idempotently charged only after a trusted result is produced. Upstream, timeout, and verification failures do not charge credits.

Keep each scenario closed until its user form and API response contract avoid raw JSON and executable envelopes, the signed assessment is bound to those ordinary inputs, PriorSeal can verify it, account-aware quotas are enforced, and failure/no-charge/idempotency behavior is in place. A successful `ALLOW` remains a risk assessment, never transaction authorization.

## Operations and data handling

The active pilot uses webhook verification, the configured private beta allowlist, per-chat request limits, and a one-sample Durable Object gate. The other scenario endpoints return `410 Gone`; the old Mini Apps are replaced by a stage notice. Keep `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_INTEGRATION_SECRET`, `INSIGHT_API_KEY`, and the chat allowlist in Worker secrets. Configure the matching `TELEGRAM_INTEGRATION_SECRET` in Insight. The Mini Apps receive no Insight API key. Do not log request bodies, wallet keys, API keys, link tokens, or bot credentials.
