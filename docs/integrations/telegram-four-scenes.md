# Four-scenario Telegram bot

The PriorSeal Telegram Worker provides one allowlisted bot for four entry points:

| Scenario | Bot entry | Insight capability | PriorSeal role | Transaction behavior |
| --- | --- | --- | --- | --- |
| Polymarket | `/check`, `/evidence` | Prediction integrity and reviewed source evidence | Verify signed decisions and source records | Read-only |
| Base lending | `/lending` | Signed lending assessment for one exact direct call | Bind the exact call to a user authorization and verify the receipt | Wallet confirmation is required in the Mini App |
| Hyperliquid perps | `/perp <JSON>` | Signed risk decision for one exact IOC order envelope | Verify the signature, expiry, exact envelope, authorization, and observed receipt | JSON artifact opens the Mini App; the user's wallet signs and submits one IOC order |
| DEX swap | `/swap <JSON>` | Reviewed direct-router guard over a pinned quote and two decision prices | Verify the signed decision, byte-exact calls, ordered authorizations, receipts, and signed settlement | JSON artifact opens the Mini App; approval and swap are separately confirmed by the user's wallet |

All four flows use the same Telegram bot, chat allowlist, webhook, and per-chat guard/evidence rate limit. Lending, perpetual, and swap flows must be opened from a private chat. The bot does not accept free-form messages, hold a wallet key, or send unsolicited notifications.

## Hyperliquid perpetual assessment

Command (send only in a private bot chat):

```text
/perp {"account":"0x1111111111111111111111111111111111111111","guard":{"protocolId":"hyperliquid-perps-mainnet","action":"open_long","assetSymbol":"BTC","marginAssetSymbol":"USDC","sizeUsd":950,"marginValueUsd":500},"order":{"action":{"type":"order","grouping":"na","orders":[{"a":0,"b":true,"p":"95000","s":"0.01","r":false,"t":{"limit":{"tif":"Ioc"}},"c":"0x0123456789abcdef0123456789abcdef"}]},"expiresAfter":<unix_ms_5_to_120_seconds_in_future>}
```

The example's expiry is a placeholder and must be replaced with a Unix millisecond timestamp 5–120 seconds in the future. The JSON binds the user's account, exact guard inputs, and one unsigned IOC order. Insight returns a signed decision; PriorSeal verifies it and prepares a corresponding intent only for `ALLOW`. The bot sends that decision and intent in a JSON file to the requesting private chat; it does not authorize the account.

Only BTC and ETH are accepted because those are the current reviewed Hyperliquid Perp Guard markets. Venue reads, API availability, and the attestation's short validity window can cause an assessment to fail closed. The JSON document includes a **Continue in PriorSeal** button. In the Telegram Mini App, upload the document or paste its JSON, check the decision and intent, and choose the one-shot execution action. PriorSeal authorization is accepted before the Hyperliquid signing prompt; the official Hyperliquid TypeScript SDK asks the connected wallet to sign and submit the exact IOC. The Mini App then observes the client order ID and checks the PriorSeal receipt and its binding to the signed Insight decision. If the short expiry passes, request a fresh assessment; never retry an uncertain IOC.

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

The MCP tool is class C3 and can consume API credits. Each request is initiated by an explicit Telegram command and is subject to the shared three-per-hour / ten-per-day limit. Operators should set a dedicated, limited Insight API key and monitor its quota. The JSON artifact opens the **Continue in PriorSeal** Mini App. It checks the signed decision against Insight's trusted key registry and reconstructs both intents before showing wallet prompts. The user separately authorizes and submits the token approval and swap call; PriorSeal observes and verifies both receipts. The Worker then asks Insight for signed settlement evidence. **Settlement is accepted only while the original decision remains valid**; if either wallet action, observation, or settlement finishes after expiry, the flow stops and preserves the transaction hashes without requesting a historical settlement.

## Perp and swap Mini App

Open `/app/telegram-scenarios` from the inline button attached to the bot's JSON artifact. A user may also upload the downloaded JSON or paste its contents. The page requires Telegram `initData`, validates the signed decision and exact intent locally, and stops on an expired, untrusted, altered, or non-ALLOW artifact. The Worker API URL is supplied at web build time through `VITE_LENDING_BOT_API_URL`; no Insight key is sent to the browser. Wallet activity requires an explicit click for each authorization and each transaction/order.

## Operational configuration

The existing Worker secrets remain server-side: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `INSIGHT_API_KEY`, and `ALLOWED_CHAT_IDS`. Swap settlement additionally checks the Telegram Mini App origin and revalidates the signed decision before and after the Insight call. `INSIGHT_BASE_URL` and `INSIGHT_KEY_REGISTRY_URL` must remain the configured Oracle Insight HTTPS origin. Do not add API keys, Telegram tokens, wallet private keys, or webhook secrets to the Mini App, Telegram messages, logs, or this document.

The Worker restricts perp and swap requests to private chats. It does not persist the perp or swap message body, signed decision, recipient, prices, or calldata; JSON artifacts exist only long enough to send the current response. The Durable Object persists update IDs and rate-limit timestamps, and its pre-existing Polymarket evidence records remain isolated to the chat that requested them.
