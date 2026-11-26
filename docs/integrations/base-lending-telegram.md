# Base lending assessments in the shared Telegram bot

The `/lending` Mini App provides read-only risk assessment and signed-decision verification:

1. The user provides caller-declared post-action values and one exact unsigned Base call.
2. Insight assesses the declared protocol risk and signs a decision bound to that call.
3. The Worker validates the Telegram session and allowlist, then verifies Insight's signature.
4. The Mini App independently verifies the signature and checks that the decision still matches the submitted input.

The Telegram flow does not create PriorSeal authorization intents, connect to wallets, sign, broadcast, submit, or reconcile transactions. A verdict of `ALLOW` remains an assessment result only.

The assessment module is `telegram-bot/src/base-lending.ts`. It accepts Base chain ID 8453, zero native value, and only the exact lending calls decoded by Insight: Aave V3 Base, Morpho Blue Base, Compound V3 Base USDC Comet, and reviewed Moonwell Base markets. Actions are limited to `supply` and `borrow`; Morpho requires its market ID. Unknown calls, malformed input, missing/untrusted signatures, and request mismatches fail closed.

## Server-side call

The Telegram Worker exposes `POST /telegram/lending/assess` for the Mini App. It calls `assessAndBindBaseLendingAction()` only after validating the fresh Telegram Mini App session, allowlist, request origin, rate limit, and bounded request body. Keep `INSIGHT_API_KEY` in Worker secrets. The helper pins the Insight API and key registry to `https://www.oracleinsight.xyz` and does not accept caller-provided upstream URLs.

```ts
import { assessAndBindBaseLendingAction, formatBaseLendingAssessment } from './base-lending.js'

const result = await assessAndBindBaseLendingAction(input, env)
const telegramText = formatBaseLendingAssessment(result)
// Return the signed decision and its verification result. No intent or authorization is created.
```

Insight's risk calculation uses caller-declared post-action USD values; it does not simulate the current on-chain protocol position. The result is not a liquidation guarantee.

## Data handling

The Worker stores lending request timestamps for per-user rate limiting, but does not persist request bodies, calldata, wallet details, or signed lending decisions. The Mini App uses no wallet provider. Never add private keys, authorization payloads, or transaction-submission logic to this assessment route.
