# Four-scenario Telegram bot

The PriorSeal Telegram Worker provides one allowlisted bot for four entry points:

| Scenario | Bot entry | Insight capability | PriorSeal role | Transaction behavior |
| --- | --- | --- | --- | --- |
| Polymarket | `/check`, `/evidence` | Prediction integrity and reviewed source evidence | Verify signed decisions and source records | Read-only |
| Base lending | `/lending` | Signed lending assessment for one exact direct call | Bind the exact call to a user authorization and verify the receipt | Wallet confirmation is required in the Mini App |
| Hyperliquid perps | `/perp <JSON>` | Signed risk decision for one exact IOC order envelope | Verify the signature, expiry, and exact envelope; build an intent only for `ALLOW` | JSON sent to the requesting private chat; no account authorization or submission |
| DEX swap | `/swap <JSON>` | Reviewed direct-router guard over a pinned quote and two decision prices | Verify the signed decision and byte-exact approval/swap calls; build ordered intents only for `ALLOW` | JSON sent to the requesting private chat; no wallet signing, relay, or broadcast |

All four flows use the same Telegram bot, chat allowlist, webhook, and per-chat guard/evidence rate limit. The bot does not accept free-form messages, hold a wallet key, or send unsolicited notifications.

## Hyperliquid perpetual assessment

Command (send only in a private bot chat):

```text
/perp {"account":"0x1111111111111111111111111111111111111111","guard":{"protocolId":"hyperliquid-perps-mainnet","action":"open_long","assetSymbol":"BTC","marginAssetSymbol":"USDC","sizeUsd":950,"marginValueUsd":500},"order":{"action":{"type":"order","grouping":"na","orders":[{"a":0,"b":true,"p":"95000","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}},"c":"0x0123456789abcdef0123456789abcdef"}]},"expiresAfter":<unix_ms_5_to_120_seconds_in_future>}
```

The example's expiry is a placeholder and must be replaced with a Unix millisecond timestamp 5–120 seconds in the future. The JSON binds the user's account, exact guard inputs, and one unsigned IOC order. Insight returns a signed decision; PriorSeal verifies it and prepares a corresponding intent only for `ALLOW`. The bot sends that decision and intent in a JSON file to the requesting private chat; it does not authorize the account.

Only BTC and ETH are accepted because those are the current reviewed Hyperliquid Perp Guard markets. Venue reads, API availability, and the attestation's short validity window can cause an assessment to fail closed.

## Reviewed DEX swap assessment

Command (send only in a private bot chat):

```text
/swap {"guard":{"profileId":"base-aerodrome-slipstream-weth-usdc-cl100","direction":"token0-to-token1","amountIn":"0.1","recipient":"0x1111111111111111111111111111111111111111","deadlineUnixSeconds":<unix_seconds_within_120_seconds>,"sourceDecisionPriceUsd":3500,"destinationDecisionPriceUsd":1,"policy":{"maxSlippageBps":50,"maxPriceImpactBps":30,"maxTwapDeviationBps":50,"maxReferenceDeviationBps":100,"maxQuoteAgeSeconds":60}},"approvalNonce":12}
```

Supported profiles:

- `base-aerodrome-slipstream-weth-usdc-cl100`
- `base-aerodrome-slipstream-usdc-usdt-cl1`
- `base-pancakeswap-v3-usdc-usdt-100`
- `bnb-pancakeswap-v3-usdt-usdc-100`
- `bnb-pancakeswap-v3-usdt-wbnb-100`
- `monad-pancakeswap-v3-wmon-usdc-500`

Replace the deadline placeholder with a Unix timestamp no more than 120 seconds ahead. The caller supplies the reviewed profile, pair direction, amount, recipient, approval nonce, source/destination decision prices, and bounded risk policy. The bot requests a fresh pinned venue quote and verifies Insight's signed result with PriorSeal. On `ALLOW`, PriorSeal builds two ordered intents from the exact approval and swap calls; the bot sends the signed decision and intents as a JSON file to the requesting private chat. `CAUTION`, `BLOCK`, missing attestation, or failed signature/binding verification does not authorize a different route.

The MCP tool is class C3 and can consume API credits. Each request is initiated by an explicit Telegram command and is subject to the shared three-per-hour / ten-per-day limit. Operators should set a dedicated, limited Insight API key and monitor its quota.

## Operational configuration

The existing Worker secrets remain server-side: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `INSIGHT_API_KEY`, and `ALLOWED_CHAT_IDS`. `INSIGHT_BASE_URL` and `INSIGHT_KEY_REGISTRY_URL` must remain the configured Oracle Insight HTTPS origin. Do not add API keys, Telegram tokens, wallet private keys, or webhook secrets to the Mini App, Telegram messages, logs, or this document.

The Worker restricts perp and swap requests to private chats. It does not persist the perp or swap message body, signed decision, recipient, prices, or calldata; JSON artifacts exist only long enough to send the current response. The Durable Object persists update IDs and rate-limit timestamps, and its pre-existing Polymarket evidence records remain isolated to the chat that requested them.
