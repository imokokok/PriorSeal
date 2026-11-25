# PriorSeal multi-scenario Telegram bot

An opt-in private beta that brings four scenario entry points into one bot: Polymarket (`/check`, `/evidence`), Base lending (`/lending`), Hyperliquid perpetuals (`/perp`), and reviewed DEX swaps (`/swap`). It only responds to slash commands from allowed chat IDs. Lending, Perp, and Swap are private-chat-only. Guard commands return assessment and evidence; they do not predict outcomes, sign orders, or submit trades. The lending Mini App keeps wallet signing and submission under the user's explicit confirmation.

Each `/check` and `/evidence` request verifies its relevant Insight signatures with PriorSeal before displaying a trusted summary. `/perp <JSON>` checks one exact Hyperliquid IOC order, verifies the signed decision, and prepares a PriorSeal intent only for `ALLOW`. `/swap <JSON>` calls Insight's reviewed multichain Agent Swap Guard, verifies the signed result with PriorSeal, and prepares separate approval/swap intents only for `ALLOW`. Both commands send the requester a JSON artifact in the private chat with the signed decision and corresponding PriorSeal intent; neither signs or submits a transaction. The swap policy is supplied explicitly in the command JSON and is checked against independent evidence. Guard and evidence commands share a limit of three requests per rolling hour and ten per rolling day per chat. Insight API-key usage may consume the configured account's normal quota or credits.

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
   npx wrangler types telegram-bot/worker-configuration.d.ts --config telegram-bot/wrangler.jsonc
   npx wrangler deploy --config telegram-bot/wrangler.jsonc --dry-run
   npx wrangler deploy --config telegram-bot/wrangler.jsonc
   ```

4. Register the webhook by making one `POST` request to the deployed Worker URL plus `/admin/register-webhook`, with `Authorization: Bearer <WEBHOOK_SETUP_SECRET>`. This calls Telegram's `setWebhook` using the worker's own token and webhook secret. Then delete `WEBHOOK_SETUP_SECRET`; the registration endpoint returns 404 when that secret is absent. The webhook secret is verified from Telegram's `X-Telegram-Bot-Api-Secret-Token` header.

The worker must be deployed before Telegram's webhook is configured. With no custom route, Wrangler uses the account's configured `workers.dev` subdomain and prints the deployed URL. If `workers.dev` is unavailable, add a dedicated route in this worker's own config; this does not change PriorSeal's production Worker. Configure Telegram's webhook to the deployed URL plus `/telegram/webhook`, with `secret_token` set to the same secret stored as `TELEGRAM_WEBHOOK_SECRET`. The first deployment creates the SQLite-backed Durable Object class migration declared in `wrangler.jsonc`.

## Base lending Mini App

The shared bot exposes Base lending from `/lending`. The Worker config opens `https://priorseal.xyz/app/lending` and accepts Mini App API calls only from `https://priorseal.xyz`; update `LENDING_MINI_APP_URL` and `LENDING_MINI_APP_ORIGIN` together if the web app moves. Set the public web build variable `VITE_LENDING_BOT_API_URL` to the deployed Telegram Worker origin. This endpoint URL is public; keep the Insight API key in the Worker secret store.

Set `ALLOWED_CHAT_IDS` to comma-separated private Telegram user/chat IDs allowed to make lending assessments. The Mini App's signed Telegram `initData` is verified by the Worker before it uses the Insight key. Each user is limited to three lending assessments per rolling hour and ten per rolling day. The same bot command router keeps `/check` for Polymarket and `/lending` for this separate flow.

The user pastes one exact unsigned direct Base transaction. The app does not construct protocol calldata, bundle token approvals, or use an API key in the browser. Insight assesses and signs the decision; PriorSeal's SDK builds an intent only for a verified `ALLOW`. The wallet separately authorizes and submits the exact transaction, and the app then reconciles the original hash and verifies both evidence roots. An uncertain wallet result requires hash reconciliation; the app will not submit a second time.

## Perpetual and DEX swap commands

`/perp <JSON>` accepts `account`, `guard`, and the exact unsigned IOC `order` envelope. The guard includes protocol ID `hyperliquid-perps-mainnet`, action `open_long`/`open_short`, reviewed asset `BTC`/`ETH`, `USDC`, notional, and declared margin. The order includes current asset index, side, limit price, size, `Ioc` time in force, unique cloid, and expiry 5–120 seconds ahead. Insight assesses and signs this exact order; PriorSeal verifies its signature and builds an intent only for `ALLOW`. The bot sends the signed decision and prepared intent as JSON to the requester in private chat; it does not authorize the user's Hyperliquid account or submit the order.

`/swap <JSON>` accepts `guard` and `approvalNonce`. The guard specifies a supported profile, direction, amount, recipient, source/destination decision prices, deadline, and policy thresholds. The command invokes Insight's `prepare_agent_swap_guard` MCP tool, so it can consume API credits. PriorSeal verifies the signed decision and builds ordered approval/swap intents only for `ALLOW`. The bot sends the signed decision and intents as JSON to the requesting private chat. See `docs/integrations/telegram-four-scenes.md` for full payload shapes and supported profiles.

## Data handling

The Durable Object stores Telegram update IDs, request timestamps, and signed source-evidence records per chat for duplicate suppression, rolling limits, and evidence retention, plus lending assessment timestamps per Telegram user. It does not persist message text, usernames, wallet information, or lending transaction/assessment bodies. Logs include a short failure code only; never add API keys, bot tokens, webhook secrets, or request payloads to logs.

This beta uses the Insight API key on the server side. Keep its allowance limited and monitor Insight usage. The bot does not proxy arbitrary URLs or expose an API-key field to Telegram users.
