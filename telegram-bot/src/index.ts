import { verifyInsightPolymarketGuardDecision } from '../../sdk/src/insight-polymarket-guard.js'
import {
  collectMarketEvidence,
} from './source-evidence.js'
import { handleBaseLendingAssessmentRequest } from './base-lending.js'
import { handleTelegramSwapSettlementRequest } from './base-swap-settlement.js'
import {
  assessHyperliquidCommand,
  assessSwapCommand,
  parseScenarioPayload,
} from './market-scenarios.js'
import {
  MAX_SCENARIO_REQUESTS_PER_DAY,
  MAX_SCENARIO_REQUESTS_PER_HOUR,
  TelegramBotState,
} from './telegram-state.js'
import type { KeyRegistry } from 'verify-insight-receipt'

export { TelegramBotState } from './telegram-state.js'

type Env = {
  STATE: DurableObjectNamespace<TelegramBotState>
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  WEBHOOK_SETUP_SECRET?: string
  INSIGHT_API_KEY?: string
  INSIGHT_BASE_URL?: string
  INSIGHT_KEY_REGISTRY_URL?: string
  ALLOWED_CHAT_IDS?: string
  LENDING_MINI_APP_ORIGIN?: string
  LENDING_MINI_APP_URL?: string
}

type TelegramMessage = { chat: { id: number }; text?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage }
type GuardVerdict = 'ALLOW' | 'CAUTION' | 'BLOCK'
type BotCommand = 'start' | 'help' | 'check' | 'evidence' | 'lending' | 'perp' | 'swap'

const MAX_BODY_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const PROTOCOL_ID = 'polymarket-prediction-mainnet'
const COMMAND_PATTERN = /^\/(start|help|check|evidence|lending|perp|swap)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) return null
  return readBoundedStream(request.body, maxBytes)
}

async function readBoundedStream(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

async function secretMatches(expected: string, actual: string | null): Promise<boolean> {
  if (!actual || !expected) return false
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [left, right] = await Promise.all([digest(expected), digest(actual)])
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function allowedChat(chatId: number, raw: string | undefined): boolean {
  if (!raw) return false
  const entries = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (entries.length === 1 && entries[0] === '*') return true
  return entries.includes(String(chatId))
}

function parseUpdate(value: unknown): TelegramUpdate | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.update_id) || (value.update_id as number) < 0) return null
  if (value.message === undefined) return { update_id: value.update_id as number }
  if (!isRecord(value.message) || !isRecord(value.message.chat) ||
      !Number.isSafeInteger(value.message.chat.id) ||
      (value.message.text !== undefined && typeof value.message.text !== 'string')) return null
  return {
    update_id: value.update_id as number,
    message: {
      chat: { id: value.message.chat.id as number },
      ...(typeof value.message.text === 'string' ? { text: value.message.text } : {}),
    },
  }
}

function commandOf(text: string): { command: BotCommand; args: string } | null {
  const match = COMMAND_PATTERN.exec(text.trim())
  if (!match) return null
  const command = match[1]?.toLowerCase()
  if (command !== 'start' && command !== 'help' && command !== 'check' && command !== 'evidence' &&
      command !== 'lending' && command !== 'perp' && command !== 'swap') return null
  return { command, args: match[2]?.trim() ?? '' }
}

function scenarioErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z0-9_]{1,80}$/.test(message) ? message : 'SCENARIO_REQUEST_INVALID'
}

function hasValidationIssueAtPath(error: unknown, path: string): boolean {
  if (!isRecord(error) || !Array.isArray(error.issues)) return false
  return error.issues.some((issue) => isRecord(issue) && Array.isArray(issue.path) && issue.path.includes(path))
}

function isSupportedPriceContractSlug(slug: string): boolean {
  const match = /^([a-z0-9]+)-updown-(\d+)m-(\d{10,})$/.exec(slug.trim().toLowerCase())
  if (!match) return false
  const windowSeconds = Number(match[2]) * 60
  const windowStartSeconds = Number(match[3])
  return Number.isSafeInteger(windowSeconds) && windowSeconds >= 60 && Number.isSafeInteger(windowStartSeconds)
}

function lendingMiniAppKeyboard(env: Env): Record<string, unknown> | undefined {
  if (!env.LENDING_MINI_APP_URL || !env.LENDING_MINI_APP_ORIGIN) return undefined
  try {
    const url = new URL(env.LENDING_MINI_APP_URL)
    if (url.protocol !== 'https:' || url.origin !== env.LENDING_MINI_APP_ORIGIN || url.username || url.password) return undefined
    return { inline_keyboard: [[{ text: 'Open Base Lending', web_app: { url: url.toString() } }]] }
  } catch { return undefined }
}

async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return false
    const resultText = await readBoundedStream(response.body, 8 * 1024)
    if (resultText === null) return false
    const result: unknown = JSON.parse(resultText)
    return isRecord(result) && result.ok === true
  } catch { return false }
}

async function sendTelegramScenarioArtifact(
  env: Env,
  chatId: number,
  caption: string,
  fileName: string,
  artifact: Record<string, unknown>,
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || chatId <= 0) return false
  let content: string
  try {
    content = JSON.stringify(artifact, null, 2)
  } catch {
    return false
  }
  if (new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) return false
  try {
    const form = new FormData()
    form.set('chat_id', String(chatId))
    form.set('caption', caption.slice(0, 1_024))
    form.set('document', new Blob([content], { type: 'application/json' }), fileName)
    form.set('reply_markup', JSON.stringify({
      inline_keyboard: [[{ text: 'Review assessment in PriorSeal', web_app: { url: 'https://priorseal.xyz/app/telegram-scenarios' } }]],
    }))
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return false
    const responseText = await readBoundedStream(response.body, 8 * 1024)
    if (responseText === null) return false
    const result: unknown = JSON.parse(responseText)
    return isRecord(result) && result.ok === true
  } catch {
    return false
  }
}

async function fetchJson(url: string, init: RequestInit, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('UPSTREAM_TOO_LARGE')
  const text = await readBoundedStream(response.body, maxBytes)
  if (text === null) throw new Error('UPSTREAM_TOO_LARGE')
  try { return JSON.parse(text) as unknown } catch { throw new Error('UPSTREAM_INVALID_JSON') }
}

function safeField(value: unknown, maxLength = 180): string {
  return typeof value === 'string' ? value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength) : 'n/a'
}

function guardFromResponse(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const data = value.success === true && isRecord(value.data) ? value.data : value
  return isRecord(data) && isRecord(data.guard) ? data.guard : null
}

function buildSummary(slug: string, action: 'buy_up' | 'buy_down', guard: Record<string, unknown>): string {
  const market = isRecord(guard.market) ? guard.market : {}
  const quotes = isRecord(guard.quotes) ? guard.quotes : {}
  const timing = isRecord(guard.timing) ? guard.timing : {}
  const verdict = guard.verdict as GuardVerdict
  const status = verdict === 'ALLOW' || verdict === 'CAUTION' || verdict === 'BLOCK' ? verdict : 'UNKNOWN'
  const displayAction = action === 'buy_up' ? 'UP' : 'DOWN'
  const checks = Array.isArray(guard.checks) ? guard.checks.filter(isRecord) : []
  const checkSummary = checks.reduce<{ pass: number; caution: number; block: number }>((counts, item) => {
    if (item.status === 'pass') counts.pass++
    else if (item.status === 'caution') counts.caution++
    else if (item.status === 'block') counts.block++
    return counts
  }, { pass: 0, caution: 0, block: 0 })
  const quotedPrice = typeof quotes.chosenSidePrice === 'number' && Number.isFinite(quotes.chosenSidePrice)
    ? quotes.chosenSidePrice.toFixed(3)
    : 'n/a'
  const evaluatedAt = Number.isSafeInteger(timing.evaluatedAtMs) && (timing.evaluatedAtMs as number) >= 0 &&
      (timing.evaluatedAtMs as number) <= 8_640_000_000_000_000
    ? new Date(timing.evaluatedAtMs as number).toISOString()
    : 'n/a'
  return [
    `Polymarket check: ${slug}`,
    `Side: ${displayAction} | Guard: ${status}`,
    `Venue quoted price: ${quotedPrice}`,
    `Market active: ${typeof market.active === 'boolean' ? String(market.active) : 'n/a'}`,
    `Checks: ${checkSummary.pass} pass, ${checkSummary.caution} caution, ${checkSummary.block} block`,
    `Settlement: ${safeField(market.settlementVenue)} | Source: ${safeField(market.resolutionSourceUrl)}`,
    `Assessed: ${evaluatedAt}`,
    'Transaction authority: none',
    'PriorSeal: Insight signature and trusted key verified',
    'Read-only metadata; not an outcome forecast or trade recommendation.',
  ].join('\n')
}

async function checkMarket(env: Env, slug: string, action: 'buy_up' | 'buy_down'): Promise<string> {
  const apiKey = env.INSIGHT_API_KEY
  const base = env.INSIGHT_BASE_URL
  const registryAddress = env.INSIGHT_KEY_REGISTRY_URL
  if (!apiKey || !base || !registryAddress) throw new Error('BOT_CONFIGURATION_INCOMPLETE')
  let baseUrl: URL
  let registryUrl: URL
  try {
    baseUrl = new URL(base)
    registryUrl = new URL(registryAddress)
  } catch { throw new Error('BOT_UPSTREAM_URL_INVALID') }
  if (baseUrl.protocol !== 'https:' || registryUrl.protocol !== 'https:' ||
      baseUrl.origin !== 'https://www.oracleinsight.xyz' || registryUrl.origin !== baseUrl.origin ||
      registryUrl.pathname !== '/.well-known/oracle-keys.json') throw new Error('BOT_UPSTREAM_URL_INVALID')

  const endpoint = new URL('/api/v1/safety/prediction-guard/attestation', baseUrl)
  endpoint.search = new URLSearchParams({ protocolId: PROTOCOL_ID, action, marketSlug: slug }).toString()
  const [decision, registryDocument] = await Promise.all([
    fetchJson(endpoint.toString(), { headers: { 'X-API-Key': apiKey, accept: 'application/json' } }),
    fetchJson(registryUrl.toString(), { headers: { accept: 'application/json' } }),
  ])
  if (!isRecord(registryDocument)) throw new Error('KEY_REGISTRY_INVALID')
  const verification = await verifyInsightPolymarketGuardDecision(decision, { keyRegistry: registryDocument as KeyRegistry })
  if (!verification.valid) throw new Error(`ATTESTATION_${verification.reason}`)
  const guard = guardFromResponse(decision)
  if (!guard || guard.market === null || !isRecord(guard.market) || guard.market.marketSlug !== slug || guard.action !== action) {
    throw new Error('ATTESTED_RESULT_MISMATCH')
  }
  return buildSummary(slug, action, guard)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok')
    if (url.pathname === '/telegram/lending/assess') {
      return handleBaseLendingAssessmentRequest(request, env)
    }
    if (url.pathname === '/telegram/swap/settle') {
      return handleTelegramSwapSettlementRequest(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/admin/register-webhook') {
      if (!env.WEBHOOK_SETUP_SECRET) return new Response('not found', { status: 404 })
      const authorization = request.headers.get('Authorization')
      const setupToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
      if (!await secretMatches(env.WEBHOOK_SETUP_SECRET, setupToken)) return new Response('unauthorized', { status: 401 })
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response('service unavailable', { status: 503 })

      try {
        const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: new URL('/telegram/webhook', url.origin).toString(),
            secret_token: env.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: ['message'],
          }),
          signal: AbortSignal.timeout(10_000),
        })
        const telegramText = await readBoundedStream(telegramResponse.body, 8 * 1024)
        if (!telegramResponse.ok || telegramText === null) return new Response('webhook registration failed', { status: 502 })
        const telegramResult: unknown = JSON.parse(telegramText)
        if (!isRecord(telegramResult) || telegramResult.ok !== true || telegramResult.result !== true) {
          return new Response('webhook registration failed', { status: 502 })
        }
        return new Response('webhook registered')
      } catch {
        return new Response('webhook registration failed', { status: 502 })
      }
    }
    if (request.method !== 'POST' || url.pathname !== '/telegram/webhook') return new Response('not found', { status: 404 })
    if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.INSIGHT_API_KEY) {
      return new Response('service unavailable', { status: 503 })
    }
    if (!await secretMatches(env.TELEGRAM_WEBHOOK_SECRET, request.headers.get('X-Telegram-Bot-Api-Secret-Token'))) {
      return new Response('unauthorized', { status: 401 })
    }

    const text = await readBoundedText(request, MAX_BODY_BYTES)
    if (text === null) return new Response('payload too large', { status: 413 })
    let raw: unknown
    try { raw = JSON.parse(text) as unknown } catch { return new Response('invalid json', { status: 400 }) }
    const update = parseUpdate(raw)
    if (!update) return new Response('invalid update', { status: 400 })
    const message = update.message
    if (!message) return new Response('ok')
    const command = commandOf(message.text ?? '')
    if (!command) return new Response('ok')
    if (!allowedChat(message.chat.id, env.ALLOWED_CHAT_IDS)) {
      if (!env.ALLOWED_CHAT_IDS && message.chat.id > 0 && command.command === 'start') {
        await sendTelegramMessage(env, message.chat.id, `Private beta is not enabled for this chat yet. Your chat ID is ${message.chat.id}.`)
      }
      return new Response('ok')
    }
    if ((command.command === 'lending' || command.command === 'perp' || command.command === 'swap') && message.chat.id <= 0) {
      await sendTelegramMessage(env, message.chat.id, 'Open lending, Perp, and Swap assessments in a private chat so your assessment inputs are not exposed in a group.')
      return new Response('ok')
    }

    const checkArgs = command.command === 'check' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedSlug, requestedSide, ...extraArgs] = checkArgs
    const validCheck = command.command === 'check' && Boolean(requestedSlug && requestedSide && !extraArgs.length && requestedSlug.length <= 200 &&
      !/[\u0000-\u0020\u007f]/.test(requestedSlug) && /^[a-z0-9][a-z0-9_-]*$/i.test(requestedSlug) &&
      isSupportedPriceContractSlug(requestedSlug) && ['up', 'down'].includes(requestedSide.toLowerCase()))
    const evidenceArgs = command.command === 'evidence' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedMarketId, ...extraEvidenceArgs] = evidenceArgs
    const validEvidence = command.command === 'evidence' && Boolean(requestedMarketId && !extraEvidenceArgs.length &&
      requestedMarketId.length <= 100 && /^[a-z0-9][a-z0-9_-]*$/i.test(requestedMarketId))
    let perpPayload: unknown = null
    let swapPayload: unknown = null
    if (command.command === 'perp') {
      try { perpPayload = parseScenarioPayload(command.args) } catch { /* usage response below */ }
    }
    if (command.command === 'swap') {
      try { swapPayload = parseScenarioPayload(command.args) } catch { /* usage response below */ }
    }
    const validPerp = perpPayload !== null
    const validSwap = swapPayload !== null
    const object = env.STATE.getByName(String(message.chat.id))
    const reservation = await object.reserveUpdate(
      update.update_id,
      Math.floor(Date.now() / 1000),
      validCheck || validEvidence || validPerp || validSwap ? 'check' : 'other',
    )
    if (reservation === 'duplicate') return new Response('ok')
    let reply: string | null = null
    let replyMarkup: Record<string, unknown> | undefined
    let scenarioArtifact: { fileName: string; value: Record<string, unknown> } | undefined
    if (reservation === 'rate_limited') {
      reply = `Request limit reached: up to ${MAX_SCENARIO_REQUESTS_PER_HOUR} scenario/source assessment requests per rolling hour and ${MAX_SCENARIO_REQUESTS_PER_DAY} per rolling day per chat.`
    } else if (command.command === 'start' || command.command === 'help') {
      reply = [
        'One bot for four scenarios:',
        '/check <market-slug> <up|down> — Polymarket assessment',
        '/evidence <market-id> — signed Polymarket source evidence',
        '/lending — open the Base lending Mini App',
        '/perp <JSON> — read-only Hyperliquid IOC risk assessment',
        '/swap <JSON> — read-only reviewed DEX swap risk assessment',
        'Guard/source assessments: up to 60 requests per rolling hour and 500 per rolling day per chat; lending has a separate user-based limit.',
        'Open Lending, Perp, and Swap only in private chat; artifacts contain signed assessments only. This bot flow has no wallet authorization or transaction/order submission.',
        'Guard commands use the configured Insight API quota/credits. PriorSeal independently verifies signed decisions and evidence.',
      ].join('\n')
    } else if (command.command === 'lending') {
      replyMarkup = lendingMiniAppKeyboard(env)
      reply = replyMarkup
        ? 'Open the Base lending Mini App for a read-only risk assessment of one exact unsigned call. It does not request wallet authorization or submit transactions.'
        : 'The Base lending Mini App is not configured yet. Please try again later.'
    } else if (command.command === 'perp') {
      if (!validPerp) {
        reply = 'Usage: /perp {JSON with account, guard, and exact unsigned IOC order envelope}. See docs/integrations/telegram-four-scenes.md.'
      } else {
        try {
          const result = await assessHyperliquidCommand(env, perpPayload)
          reply = result.summary
          scenarioArtifact = { fileName: `priorseal-hyperliquid-perp-${update.update_id}.json`, value: result.artifact }
        } catch (error) {
          const reason = scenarioErrorCode(error)
          console.error(JSON.stringify({ event: 'hyperliquid_perp_assessment_failed', code: reason }))
          reply = hasValidationIssueAtPath(error, 'expiresAfter')
            ? 'Invalid order.expiresAfter: use a fresh Unix timestamp in milliseconds, 5–120 seconds ahead. Generate it immediately before sending with Date.now() + 60_000; a timestamp can expire while the message is in transit.'
            : 'Could not return a trusted Hyperliquid perp assessment right now. Please try again later.'
        }
      }
    } else if (command.command === 'swap') {
      if (!validSwap) {
        reply = 'Usage: /swap {JSON with reviewed guard parameters}. See docs/integrations/telegram-four-scenes.md.'
      } else {
        try {
          const result = await assessSwapCommand(env, swapPayload)
          reply = result.summary
          scenarioArtifact = { fileName: `priorseal-dex-swap-${update.update_id}.json`, value: result.artifact }
        } catch (error) {
          const reason = scenarioErrorCode(error)
          console.error(JSON.stringify({ event: 'agent_swap_assessment_failed', code: reason }))
          reply = reason === 'SWAP_DEADLINE_MUST_BE_WITHIN_120_SECONDS' || hasValidationIssueAtPath(error, 'deadlineUnixSeconds')
            ? 'Invalid guard.deadlineUnixSeconds: use a fresh Unix timestamp in seconds, no more than 120 seconds ahead. Generate it immediately before sending with Math.floor(Date.now() / 1000) + 60.'
            : 'Could not return a trusted DEX swap assessment right now. Please try again later.'
        }
      }
    } else {
      if (command.command === 'check' && (!validCheck || !requestedSlug || !requestedSide)) {
        const hasSupportedShape = Boolean(requestedSlug && isSupportedPriceContractSlug(requestedSlug))
        if (!requestedSlug) reply = 'Usage: /check <active-market-slug> <up|down>'
        else if (hasSupportedShape) reply = 'Usage: /check <active-market-slug> <up|down>; the side must be up or down and no extra text may follow.'
        else reply = 'This /check currently supports short-term price contracts only, with a slug like btc-updown-5m-<10-digit Unix timestamp>. Use the slug of a currently active market; event slugs such as what-price-will-bitcoin-hit-before-2027 are not supported.'
      } else if (command.command === 'evidence' && (!validEvidence || !requestedMarketId)) {
        reply = 'Usage: /evidence <market-id>'
      } else if (command.command === 'evidence' && requestedMarketId) {
        try {
          const record = await collectMarketEvidence(env, requestedMarketId)
          await object.storeSourceEvidence(
            update.update_id,
            record.marketId,
            record.collectedAt,
            record.evidenceHash,
            record.payloadJson,
            Math.floor(Date.now() / 1000),
          )
          reply = `${record.summary}\nEvidence record: ${update.update_id} (stored privately for up to 30 days)`
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
          console.error(JSON.stringify({ event: 'polymarket_evidence_failed', code: reason }))
          reply = 'Could not return trusted source evidence right now. Please try again later.'
        }
      } else {
        try {
          reply = await checkMarket(env, requestedSlug, requestedSide.toLowerCase() === 'up' ? 'buy_up' : 'buy_down')
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
          console.error(JSON.stringify({ event: 'polymarket_check_failed', code: reason }))
          reply = 'Could not return a trusted assessment right now. Please try again later.'
        }
      }
    }

    const delivered = scenarioArtifact
      ? await sendTelegramScenarioArtifact(env, message.chat.id, reply ?? '', scenarioArtifact.fileName, scenarioArtifact.value) ||
        await sendTelegramMessage(env, message.chat.id, reply ?? 'Assessment complete; the JSON artifact could not be sent.', replyMarkup)
      : await sendTelegramMessage(env, message.chat.id, reply, replyMarkup)
    if (!delivered) {
      await object.releaseUpdate(update.update_id)
      return new Response('telegram delivery failed', { status: 502 })
    }
    await object.completeUpdate(update.update_id)
    return new Response('ok')
  },
} satisfies ExportedHandler<Env>
