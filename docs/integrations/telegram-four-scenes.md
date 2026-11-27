# Four-scenario Telegram bot

One allowlisted Telegram bot gives read-only assessment and evidence entry points for Polymarket, lending, perpetuals, and DEX swaps. The integration does not create PriorSeal authorizations and does not connect to wallets, sign, place orders, submit transactions, or relay user transactions.

| Scenario | Bot entry | Insight role | PriorSeal role | Telegram capability |
| --- | --- | --- | --- | --- |
| Polymarket | `/check`, `/evidence` | Assess market integrity and collect reviewed source evidence | Verify signed decisions and evidence | Read-only market check and source record |
| Base lending | `/lending` | Assess caller-declared post-action risk for one exact unsigned call | Verify the signed decision and exact-call binding | Risk assessment only on four reviewed Base protocols |
| Hyperliquid perps | `/perp <JSON>` | Assess one exact BTC/ETH IOC order request | Verify the signed assessment and request binding | Risk assessment only; no exchange order |
| DEX swap | `/swap <JSON>` | Assess one reviewed profile, quote, and bounded policy | Verify the signed assessment and request binding | Risk assessment only; no approval or swap call is produced for submission |

## Hard boundary

The Telegram Worker and Mini Apps may collect assessment inputs, call Insight, verify signed decisions, and display or retain read-only evidence. They must not create wallet authorization, connect to a wallet, sign, broadcast, place, modify, cancel, forward, or relay a user's transaction or order. They must not retain wallet secrets or exchange credentials. A verdict of `ALLOW` is an assessment result only; it is not permission to execute. Any action the user chooses to take happens independently outside this Telegram integration.

PriorSeal's separate authorization and execution-verification products remain outside these assessment flows. The Telegram integration never signs, submits, broadcasts, or relays a user's transaction or order. Existing prior assessment artifacts that contain executable intents are not accepted by the read-only Mini App; request a fresh assessment.

## Polymarket

- `/check btc <up|down>` returns a signed, read-only assessment of the current BTC 5-minute market. The bot resolves the current market slug when it receives the message.
- `/evidence <market-id>` collects reviewed source records and stores the original signed evidence JSON for 30 days (up to 100 records per chat). Use `/evidence-record <record-id>` in the same chat to retrieve it. Stored commitments are checked before delivery; the original signature may have expired, and retrieval is not a fresh assessment. Expired records are removed by a Durable Object alarm and rejected on lookup.
- This bot does not create or manage CLOB orders.

## Base lending

`/lending` opens the assessment Mini App. It supports exact-call risk assessment for `aave-v3-base`, `morpho-blue-base`, `compound-v3-base`, and `moonwell-base`, with `supply` or `borrow` as the declared action. The user provides one unsigned Base call and caller-declared post-action collateral/debt values. Morpho additionally requires the exact market ID.

The Worker verifies Telegram Mini App identity and allowlist, calls Insight using its server-side API key, verifies Insight's signature, and returns the signed decision. The Mini App checks that the decision matches the declared inputs and exact call. It has no wallet connector, authorization button, transaction submission, or transaction reconciliation path. Insight's lending assessment uses caller-declared post-action USD values; it does not simulate a live protocol position.

## Hyperliquid perpetuals

`/perp <JSON>` accepts guard inputs and one exact unsigned IOC request for BTC or ETH. The assessment does not bind to an account, so the bot does not accept an account field. The order object is used as assessment input only. The bot generates the short-lived expiry when it receives the request, so users do not need to calculate or send one.

Example shape (the bot adds the short-lived expiry internally):

```text
/perp {"guard":{"protocolId":"hyperliquid-perps-mainnet","action":"open_long","assetSymbol":"BTC","marginAssetSymbol":"USDC","sizeUsd":950,"marginValueUsd":500},"order":{"action":{"type":"order","grouping":"na","orders":[{"a":0,"b":true,"p":"95000","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}},"c":"0x0123456789abcdef0123456789abcdef"}]}}}
```

The Worker verifies Insight's signed result and the exact request binding, then returns the signed assessment as JSON. The artifact contains no PriorSeal intent. Opening it only verifies and displays the decision; no wallet connection, authorization, signature, or order submission is performed.

## DEX swap

`/swap <JSON>` assesses an exact-input request against one reviewed profile:

- `base-aerodrome-slipstream-weth-usdc-cl100`
- `base-aerodrome-slipstream-usdc-usdt-cl1`
- `base-pancakeswap-v3-usdc-usdt-100`
- `bnb-pancakeswap-v3-usdt-usdc-100`
- `bnb-pancakeswap-v3-usdt-wbnb-100`
- `monad-pancakeswap-v3-wmon-usdc-500`

The request specifies profile, direction, amount, recipient, source/destination decision prices, and bounded policy. The bot adds the short-lived assessment deadline when the message arrives. Example shape:

```text
/swap {"guard":{"profileId":"base-aerodrome-slipstream-weth-usdc-cl100","direction":"token0-to-token1","amountIn":"0.1","recipient":"0x1111111111111111111111111111111111111111","sourceDecisionPriceUsd":3500,"destinationDecisionPriceUsd":1,"policy":{"maxSlippageBps":50,"maxPriceImpactBps":30,"maxTwapDeviationBps":50,"maxReferenceDeviationBps":100,"maxQuoteAgeSeconds":60}}}
```

The Worker calls Insight's reviewed `prepare_agent_swap_guard` assessment, verifies the signed decision and exact request binding, then returns the signed assessment only. It does not build PriorSeal approval/swap intents, ask for wallet authorization, or submit or relay calls. The Worker also exposes an authenticated `/telegram/swap/settle` endpoint for optional post-trade verification: it accepts an already-submitted swap transaction hash, the signed assessment, and an optional approval transaction hash, then asks Insight for signed settlement evidence. It accepts no raw transaction for forwarding and never signs, broadcasts, submits, or relays a transaction. This endpoint verifies activity the user submitted independently; it does not initiate a swap.

## Operations and data handling

All four scenarios use the same allowlist, webhook, and per-chat request limits. Lending, perpetual, and swap commands are private-chat-only. Insight API usage may consume the configured account's quota or credits.

Keep `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `INSIGHT_API_KEY`, and the chat allowlist in Worker secrets. The Mini Apps receive no Insight API key. Do not log request bodies, wallet keys, API keys, or bot credentials. The Worker stores only update IDs, rate-limit timestamps, and the configured Polymarket source-evidence records; it does not persist lending/perp/swap request bodies or decisions.
