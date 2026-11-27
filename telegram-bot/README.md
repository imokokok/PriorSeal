# PriorSeal multi-scenario Telegram bot

An opt-in private beta that brings four read-only scenario entry points into one bot: Polymarket (`/check`, `/evidence`), Base lending (`/lending`), Hyperliquid perpetuals (`/perp`), and reviewed DEX swaps (`/swap`). It only responds to slash commands from allowed chat IDs. Lending, Perp, and Swap are private-chat-only. The bot returns signed assessments and evidence; it does not connect to wallets, create authorizations, sign, place orders, submit transactions, or relay user transactions. No Telegram scenario proxies a user's transaction or order.

Each `/check` and `/evidence` request verifies relevant Insight signatures with PriorSeal before displaying a trusted summary. `/perp <JSON>` assesses one exact Hyperliquid IOC request and returns a signed assessment artifact only. `/swap <JSON>` calls Insight's reviewed multichain Agent Swap Guard and returns its verified signed assessment only. The read-only Mini App verifies and displays these artifacts; it does not create authorization intents or connect to a wallet. `/lending` similarly assesses one exact unsigned Base call. The guard/source commands (`/check`, `/evidence`, `/perp`, and `/swap`) share an allowance of 60 requests per rolling hour and 500 per rolling day per chat. Lending assessments use a separate allowance of 60 per rolling hour and 500 per rolling day per Telegram user. Insight API-key usage may consume the configured account's normal quota or credits.

## Configure

From the repository root, use the pinned Node.js version (`nvm use`). Use the root-installed Wrangler; this worker has its own config and entry point.

1. Create a Telegram bot with BotFather and choose where it is allowed to reply. For an initial private beta, set `ALLOWED_CHAT_IDS` to comma-separated Telegram chat IDs. With this setting absent, assessments are disabled; a private `/start` only returns that chat's ID so the owner can allow it. Set it to `*` only when intentionally opening assessments to any chat. Keep this setting secret because chat IDs can identify private groups. Slash commands are the only messages handled.
2. Set the bot token, a random webhook secret, a temporary random setup secret, and a dedicated Insight API key as Cloudflare secrets:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN --config telegram-bot/wrangler.jsonc
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put WEBHOOK_SETUP_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put INSIGHT_API_KEY --config telegram-bot/wrangler.jsonc
   npx wrangler secret put ALLOWED_CHAT_IDS --config telegram-bot/wrangler.jsonc
   ```

   Enter secret values only at Wrangler's prompt. Do not put them in source, the config, shell command arguments, or logs.

3. Generate the worker binding types, inspect the deployment preview, then deploy:

   ```sh
   npm run sdk:build
   npx wrangler types telegram-bot/worker-configuration.d.ts --config telegram-bot/wrangler.jsonc
   npx wrangler deploy --config telegram-bot/wrangler.jsonc --dry-run
   npx wrangler deploy --config telegram-bot/wrangler.jsonc
   ```

4. Register the webhook by making one `POST` request to the deployed Worker URL plus `/admin/register-webhook`, with `Authorization: Bearer <WEBHOOK_SETUP_SECRET>`. This calls Telegram's `setWebhook` using the worker's own token and webhook secret. Then delete `WEBHOOK_SETUP_SECRET`; the registration endpoint returns 404 when that secret is absent. The webhook secret is verified from Telegram's `X-Telegram-Bot-Api-Secret-Token` header.

The worker must be deployed before Telegram's webhook is configured. With no custom route, Wrangler uses the account's configured `workers.dev` subdomain and prints the deployed URL. If `workers.dev` is unavailable, add a dedicated route in this worker's own config; this does not change PriorSeal's production Worker. Configure Telegram's webhook to the deployed URL plus `/telegram/webhook`, with `secret_token` set to the same secret stored as `TELEGRAM_WEBHOOK_SECRET`. The first deployment creates the SQLite-backed Durable Object class migration declared in `wrangler.jsonc`.

## Base lending Mini App

The shared bot exposes Base lending from `/lending`. The Worker config opens `https://priorseal.xyz/app/lending` and accepts Mini App API calls only from `https://priorseal.xyz`; update `LENDING_MINI_APP_URL` and `LENDING_MINI_APP_ORIGIN` together if the web app moves. Set the public web build variable `VITE_LENDING_BOT_API_URL` to the deployed Telegram Worker origin. This endpoint URL is public; keep the Insight API key in the Worker secret store.

Set `ALLOWED_CHAT_IDS` to comma-separated private Telegram user/chat IDs allowed to make lending assessments. The Mini App's signed Telegram `initData` is verified by the Worker before it uses the Insight key. Each user is limited to 60 lending assessments per rolling hour and 500 per rolling day. The same bot command router keeps `/check` for Polymarket and `/lending` for this separate flow.

The user pastes one exact unsigned direct Base call. The app does not construct protocol calldata, bundle token approvals, connect to a wallet, authorize, or submit. Insight assesses and signs the decision; PriorSeal verifies its signature and binding to the supplied call. This flow does not issue an execution receipt because it does not initiate or reconcile a transaction.

## Perpetual and DEX swap commands

`/perp <JSON>` accepts `guard` and one exact unsigned IOC request envelope as assessment input. The guard includes protocol ID `hyperliquid-perps-mainnet`, action `open_long`/`open_short`, reviewed asset `BTC`/`ETH`, `USDC`, notional, and declared margin. The order includes asset index, side, limit price, size, `Ioc` time in force, client order ID, and `expiresAfter` as a Unix timestamp in **milliseconds**, 90–120 seconds ahead. Generate it immediately before sending (for example, `Date.now() + 110_000`); don't reuse a timestamp from an earlier message. Insight assesses this request; PriorSeal verifies its signed decision and binding. The assessment does not bind to an account, so no account field is accepted. The JSON artifact contains only the decision, with no PriorSeal intent. Nothing in the Telegram flow submits an exchange order.

`/swap <JSON>` accepts only `guard`. The guard specifies a supported profile, direction, amount, recipient, source/destination decision prices, `deadlineUnixSeconds` as a Unix timestamp in **seconds** (90–120 seconds ahead), and policy thresholds. Generate the deadline immediately before sending (for example, `Math.floor(Date.now() / 1000) + 110`); a 13-digit millisecond value or an old timestamp is invalid. The command invokes Insight's `prepare_agent_swap_guard` assessment, so it can consume API credits. PriorSeal verifies the signed decision and exact request binding. The JSON artifact contains only the signed assessment; it does not include PriorSeal approval/swap intents. The Worker has a separate authenticated `/telegram/swap/settle` endpoint for optional post-trade verification. It accepts an already-submitted transaction hash and the signed assessment, asks Insight for signed settlement evidence, and does not receive or forward raw transactions, sign, broadcast, submit, or relay a user transaction. The endpoint cannot initiate a swap. See `docs/integrations/telegram-four-scenes.md` for full payload shapes and supported profiles.

`/check <market-slug> <up|down>` currently supports only short-term price contracts whose slug matches the `asset-updown-window-timestamp` shape (for example, `btc-updown-5m-<10-digit Unix timestamp>`). Use a currently active Polymarket market slug with at least 90 seconds remaining; markets closer to closing are rejected before an assessment is requested. Event markets such as `what-price-will-bitcoin-hit-before-2027` are outside this assessment's supported market type.

`/evidence <market-id>` stores the original verified, signed evidence JSON for up to 30 days (maximum 100 records per chat). Its reply includes a record ID. Use `/evidence-record <record-id>` in the same chat to retrieve the original JSON document. The bot checks its stored evidence commitment before sending it. The archived signature is the original attestation and may have expired; retrieval does not create a fresh assessment. Expired records are deleted by a Durable Object alarm and are also rejected on lookup.

## Data handling

The Durable Object stores Telegram update IDs, request timestamps, and signed source-evidence records per chat for duplicate suppression, rolling limits, and evidence retention, plus lending assessment timestamps per Telegram user. It does not persist message text, usernames, wallet information, or lending transaction/assessment bodies. Logs include a short failure code only; never add API keys, bot tokens, webhook secrets, or request payloads to logs.

This beta uses the Insight API key on the server side. Keep its allowance limited and monitor Insight usage. The bot does not proxy arbitrary URLs or expose an API-key field to Telegram users.
