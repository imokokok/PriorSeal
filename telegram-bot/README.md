# Insight × PriorSeal Telegram bot

This bot is a read-only assessment and evidence interface. It does not connect to a wallet, request authorization or signatures, create transaction instructions, place or relay orders, or submit transactions. A successful `ALLOW` result is an assessment only.

## User flow

1. Send `/start` in a private chat. Choose **Assess a BTC 5-minute market**, then **Assess Up** or **Assess Down**. The bot selects a usable market when the button is tapped. Users do not construct JSON or copy timestamps.
2. The bot first shows an assessment quote with the selected market, current outcome midpoint, tick size, and (for linked accounts) current cost and available balance. The quote stays usable for at most 120 seconds. A separate confirmation starts the assessment. The bot rechecks the market window, midpoint, account cost, and balance before starting; a rollover or price move greater than one live price tick requires a new confirmation.
3. One successful assessment is sponsored before account linking. A failed assessment or failed Telegram delivery does not consume that trial.
4. To continue, use `/link`, sign in on the official Insight website, and explicitly confirm the one-time account link. It expires after 15 minutes and can be used once.
5. Use `/account` to check the Insight credit balance and price. Linked assessments debit credits only after Insight returns a trusted signed result. The bot does not require users to create an API key. `/unlink` removes the association.
6. Base lending, Hyperliquid perps, and DEX swap appear as coming soon. Their assessment routes remain closed until guided input forms and signed assessment-only APIs are ready.

The two-minute review window is separate from the market-close buffer. The Worker records successful confirmation-to-Telegram-delivery durations without Telegram IDs or request contents, retaining at most 10,000 samples for 30 days. Until it has 1,000 samples, it reserves up to 60 seconds for service completion; afterward it derives the reserve from P99.9 latency multiplied by 1.5. A reserve above 60 seconds disables the 5-minute flow until latency supports it. Market entry requires at least 120 seconds for user review plus the current reserve, and quotes expire no later than market close minus that reserve. Price drift is measured against the live market tick size, not a fixed percentage.

For a command-line assessment, `/check btc up` or `/check btc down` is also supported. The bot selects the market at request time, sends a quote with an explicit confirmation button, and starts only after that confirmation. Do not use old payload examples containing JSON, Unix deadlines, unsigned orders, recipients, or transaction calldata.

## Configure the Worker

Use the pinned Node.js version (`nvm use`) and the root-installed Wrangler.

1. Create a bot with BotFather. Set `ALLOWED_CHAT_IDS` to comma-separated Telegram IDs for the initial private beta. With the setting absent, assessments are disabled; `/start` returns the chat ID so an administrator can add it. Use `*` only when deliberately opening the bot to everyone.
2. Store these values as Cloudflare Worker secrets. Enter them only at Wrangler prompts; never place values in source, config, shell arguments, or logs.

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN --config telegram-bot/wrangler.jsonc
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put WEBHOOK_SETUP_SECRET --config telegram-bot/wrangler.jsonc
   npx wrangler secret put INSIGHT_API_KEY --config telegram-bot/wrangler.jsonc
   npx wrangler secret put TELEGRAM_INTEGRATION_PRIVATE_KEY --config telegram-bot/wrangler.jsonc
   npx wrangler secret put ALLOWED_CHAT_IDS --config telegram-bot/wrangler.jsonc
   ```

   `TELEGRAM_INTEGRATION_PRIVATE_KEY` is an Ed25519 PKCS#8 PEM private key. Insight pins the matching public key in server code and verifies signed method, path, body, and timestamp headers. Keep the private key only in this Cloudflare Worker secret; do not configure a shared secret in Vercel. The Worker also needs `INSIGHT_BASE_URL` and `INSIGHT_KEY_REGISTRY_URL` from its config.

3. Generate types and inspect the deployment preview before deploying the Worker:

   ```sh
   npm run sdk:build
   npx wrangler types telegram-bot/worker-configuration.d.ts --config telegram-bot/wrangler.jsonc
   npx wrangler deploy --config telegram-bot/wrangler.jsonc --dry-run
   npx wrangler deploy --config telegram-bot/wrangler.jsonc
   ```

   The Telegram Worker routes Insight API and key-registry requests through the
   `INSIGHT_WEB` Service Binding to the `insight-web` Worker. Both Workers must
   be deployed in the same Cloudflare account. Telegram and external provider
   requests continue to use normal HTTPS fetch.

4. After deployment, send one `POST` request to the Worker URL plus `/admin/register-webhook` with `Authorization: Bearer <WEBHOOK_SETUP_SECRET>`. This registers the webhook and the visible Telegram command menu. Then delete `WEBHOOK_SETUP_SECRET`; the registration endpoint returns 404 when it is absent.

The first deployment creates the SQLite-backed Durable Object migration declared in `wrangler.jsonc`. Keep the chat allowlist, bot token, webhook secret, Ed25519 private key, and Insight assessment key private.

## Four-scene rollout

| Scene | Current state | Planned user input | Hard boundary |
| --- | --- | --- | --- |
| Polymarket | Controlled pilot | BTC market and Up/Down buttons | No order placement or trade authorization |
| Base lending | Coming soon | Public position read or user-declared what-if | No raw calls or calldata |
| Hyperliquid perps | Coming soon | Guided position size and margin | No order envelope or exchange submission |
| DEX swap | Coming soon | Guided pair, amount, quote age, and risk limits | No recipient, approval call, or swap submission |

The closed Base lending Mini App and old perp/swap artifact importer show a stage notice. The prior lending and swap execution-oriented endpoints return `410 Gone`. Product contracts and release gates are in [the four-scene design](../docs/integrations/telegram-four-scenes.md).

## Data handling

The Durable Object deduplicates Telegram updates, enforces per-chat request limits, caps the sponsored sample at one successful assessment per Telegram account, and retains previously collected signed Polymarket evidence for at most 30 days. New evidence collection is paused during this pilot. It does not store message text, usernames, or user wallet secrets. Logs may include bounded failure codes, never payloads, credentials, link challenges, or API keys.
