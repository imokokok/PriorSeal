# PriorSeal Polymarket Telegram bot

An opt-in, read-only free-beta interface to Insight's Polymarket guard. It only handles `/start`, `/help`, and `/check <market-slug> <up|down>` commands. It does not send unsolicited messages, forecast event outcomes, connect wallets, submit trades, or hold user funds. The user must choose the side being assessed; the result is guard metadata, not a trading recommendation.

Each successful check requests one short-lived Insight EIP-712 attestation and verifies the signature and signer epoch against Insight's published key registry using PriorSeal's verifier. A failed, expired, or untrusted attestation is never presented as a valid assessment. The free beta is capped at three checks per rolling hour and ten per rolling day per chat. Insight API-key usage may incur the account's normal metering or credit consumption.

## Configure

From the repository root, use the pinned Node.js version (`nvm use`). Use the root-installed Wrangler; this worker has its own config and entry point.

1. Create a Telegram bot with BotFather and choose where it is allowed to reply. For an initial private beta, set `ALLOWED_CHAT_IDS` to comma-separated Telegram chat IDs. With this setting absent, `/check` is disabled; a private `/start` only returns that chat's ID so the owner can allow it. Set it to `*` only when intentionally opening checks to any chat. Keep this setting secret because chat IDs can identify private groups. Slash commands are the only messages handled.
2. Set the bot token, a random webhook secret, a temporary random setup secret, and a dedicated Insight API key as Cloudflare secrets:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN --config telegram-bot/wrangler.jsonc
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put WEBHOOK_SETUP_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put INSIGHT_API_KEY --config telegram-bot/wrangler.jsonc
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

## Data handling

The Durable Object stores Telegram update IDs and check timestamps per chat for duplicate suppression and rolling limits. It does not persist message text, usernames, wallet information, or market assessment bodies. Logs include a short failure code only; never add API keys, bot tokens, webhook secrets, or request payloads to logs.

This beta uses the Insight API key on the server side. Keep its allowance limited and monitor Insight usage. The bot does not proxy arbitrary URLs or expose an API-key field to Telegram users.
