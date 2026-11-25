# PriorSeal Polymarket Telegram bot

An opt-in, read-only free-beta interface to Insight's Polymarket services. It handles `/start`, `/help`, `/check <market-slug> <up|down>`, and `/evidence <market-id>`. `/check` verifies the existing short-horizon market-integrity guard. `/evidence` collects only sources configured in Insight's reviewed market binding and verifies the signed source record with PriorSeal before showing a summary and commitment. It does not send unsolicited messages, forecast event outcomes, connect wallets, submit trades, or hold user funds. `/check`'s selected side is an input label for an integrity check, not a trading recommendation.

Each successful `/check` verifies the short-lived guard attestation. Each `/evidence` request verifies Insight's EIP-712 signature, signer epoch, expiry and exact record hash with PriorSeal's verifier; it then stores the signed response and commitment in that chat's Durable Object and emits the commitment digest and record ID in the Telegram reply. BLS and NWS station observations are supported when a server-side reviewed market binding names the exact source. Storage is capped at 100 records per chat, prunes expired/old records, and retains entries for up to 30 days. Missing, expired, modified, oversized or untrusted evidence is never presented as verified. Both commands share the existing limit of three requests per rolling hour and ten per rolling day per chat. This is a private bot evidence record, not a PriorSeal receipt or a public transparency anchor. Insight API-key usage may incur the account's normal metering or credit consumption.

## Configure

From the repository root, use the pinned Node.js version (`nvm use`). Use the root-installed Wrangler; this worker has its own config and entry point.

1. Create a Telegram bot with BotFather and choose where it is allowed to reply. For an initial private beta, set `ALLOWED_CHAT_IDS` to comma-separated Telegram chat IDs. With this setting absent, `/check` is disabled; a private `/start` only returns that chat's ID so the owner can allow it. Set it to `*` only when intentionally opening checks to any chat. Keep this setting secret because chat IDs can identify private groups. Slash commands are the only messages handled.
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

## Data handling

The Durable Object stores Telegram update IDs, request timestamps, and signed source-evidence records per chat for duplicate suppression, rolling limits, and evidence retention, plus lending assessment timestamps per Telegram user. It does not persist message text, usernames, wallet information, or lending transaction/assessment bodies. Logs include a short failure code only; never add API keys, bot tokens, webhook secrets, or request payloads to logs.

This beta uses the Insight API key on the server side. Keep its allowance limited and monitor Insight usage. The bot does not proxy arbitrary URLs or expose an API-key field to Telegram users.
