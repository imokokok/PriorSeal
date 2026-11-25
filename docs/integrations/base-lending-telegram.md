# Base lending checks in the shared Telegram bot

This integration connects an exact Base lending call to both products:

1. Insight assesses protocol risk and issues a short-lived signed decision for the exact call.
2. The bot service independently verifies the decision against Insight's published key registry.
3. On `ALLOW`, PriorSeal's SDK builds an exact-call intent carrying the verified Insight decision commitment.
4. A wallet-facing review screen asks the user to authorize that intent. The bot never receives a wallet key or submits a transaction.
5. After the user's executor submits the original call, PriorSeal observes it and produces execution evidence for a final receipt message.

The bot-side assessment module is `telegram-bot/src/base-lending.ts`. It accepts only Base chain ID 8453, zero native value, and the lending profiles decoded by Insight: Aave V3 Base, Morpho Blue Base, Compound V3 Base USDC Comet, and reviewed Moonwell Base markets. Morpho requires its market ID. Unknown calls, malformed inputs, missing or untrusted attestations, expired decisions, and non-`ALLOW` verdicts never produce a PriorSeal intent.

## Server-side call

The Telegram Worker exposes `POST /telegram/lending/assess` for the Mini App and calls `assessAndBindBaseLendingAction()` only after validating the user's fresh Telegram Mini App session, allowlist entry, request origin, and bounded request body. A per-user Durable Object limit caps the assessment endpoint at three requests per hour and ten per day. Keep `INSIGHT_API_KEY` in the Worker secret store. The helper pins Insight's API and key registry to `https://www.oracleinsight.xyz`; it does not accept caller-provided upstream URLs.

```ts
import { assessAndBindBaseLendingAction, formatBaseLendingAssessment } from './base-lending.js'

const result = await assessAndBindBaseLendingAction(input, env)
const telegramText = formatBaseLendingAssessment(result)
if (!result.priorSealIntent) {
  // Show the verified CAUTION or BLOCK decision; do not offer authorization.
}
// Return the verified decision and exact PriorSeal intent to the wallet UI.
// The UI must show the full call and get an explicit user wallet signature.
```

The intent lifetime is capped by the caller to at most five minutes, matching Insight's lending attestation window. The caller must also ensure its chosen expiry is in the future. The Mini App independently verifies the signed decision before rendering the result and requires the transaction sender to match the connected wallet. An Insight `ALLOW` is an assessment only; the wallet signature is the user's authorization, and it is separate from transaction submission.

## First release boundary

The initial Mini App accepts an exact unsigned transaction pasted by the user and enables the four profiles supported by the current Insight Guard: Aave V3 Base, Morpho Blue Base, Compound V3 Base USDC Comet, and reviewed Moonwell Base markets. The user must confirm the displayed calldata and wallet prompt. Do not accept arbitrary contract targets, multicalls, approvals bundled with the lending action, private keys, or automatic retries. The app does not construct calldata or estimate transaction outcomes. Store only assessment timestamps for rate limiting; do not persist transaction requests, wallet details, Telegram message bodies, or market assessment bodies.

The existing bot's Polymarket path remains an independent scenario under the same bot command router. It does not share protocol inputs, verdict logic, or trust roots with the lending flow.
