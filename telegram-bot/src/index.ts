import { verifyInsightPolymarketGuardDecision } from '../../sdk/src/insight-polymarket-guard.js'
import {
  readStoredMarketEvidence,
} from './source-evidence.js'
import { upstreamAssessmentFailure, upstreamHttpError, upstreamTransportError } from './upstream-errors.ts'
import { hasAtLeastRemainingMs, priceContractEndTimeMs } from './assessment-window.js'
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
  TELEGRAM_INTEGRATION_SECRET?: string
  INSIGHT_BASE_URL?: string
  INSIGHT_KEY_REGISTRY_URL?: string
  ALLOWED_CHAT_IDS?: string
  LENDING_MINI_APP_ORIGIN?: string
  LENDING_MINI_APP_URL?: string
}

type TelegramMessage = { chat: { id: number }; text?: string }
type TelegramCallbackQuery = { id: string; from: { id: number }; message?: TelegramMessage; data?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }
type GuardVerdict = 'ALLOW' | 'CAUTION' | 'BLOCK'
type BotCommand = 'start' | 'help' | 'check' | 'evidence' | 'evidence-record' | 'link' | 'unlink' | 'account' | 'lending' | 'perp' | 'swap'

const MAX_BODY_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const PROTOCOL_ID = 'polymarket-prediction-mainnet'
const COMMAND_PATTERN = /^\/(start|help|check|evidence-record|evidence|link|unlink|account|lending|perp|swap)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i

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

function parseTelegramMessage(value: unknown): TelegramMessage | null {
  if (!isRecord(value) || !isRecord(value.chat) || !Number.isSafeInteger(value.chat.id) ||
      (value.text !== undefined && typeof value.text !== 'string')) return null
  return {
    chat: { id: value.chat.id as number },
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
  }
}

function parseUpdate(value: unknown): TelegramUpdate | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.update_id) || (value.update_id as number) < 0) return null
  if (value.message !== undefined) {
    const message = parseTelegramMessage(value.message)
    if (!message) return null
    return { update_id: value.update_id as number, message }
  }
  if (value.callback_query !== undefined) {
    const query = value.callback_query
    if (!isRecord(query) || typeof query.id !== 'string' || query.id.length > 256 || !isRecord(query.from) ||
        !Number.isSafeInteger(query.from.id) || (query.data !== undefined && typeof query.data !== 'string')) return null
    const message = query.message === undefined ? undefined : parseTelegramMessage(query.message)
    if (query.message !== undefined && !message) return null
    return {
      update_id: value.update_id as number,
      callback_query: {
        id: query.id,
        from: { id: query.from.id as number },
        ...(message ? { message } : {}),
        ...(typeof query.data === 'string' ? { data: query.data } : {}),
      },
    }
  }
  return {
    update_id: value.update_id as number,
  }
}

function commandOf(text: string): { command: BotCommand; args: string } | null {
  const match = COMMAND_PATTERN.exec(text.trim())
  if (!match) return null
  const command = match[1]?.toLowerCase()
  if (command !== 'start' && command !== 'help' && command !== 'check' && command !== 'evidence' && command !== 'evidence-record' && command !== 'link' && command !== 'unlink' && command !== 'account' &&
      command !== 'lending' && command !== 'perp' && command !== 'swap') return null
  return { command, args: match[2]?.trim() ?? '' }
}

function isSupportedPriceContractSlug(slug: string): boolean {
  return priceContractEndTimeMs(slug) !== undefined
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

async function answerTelegramCallback(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 180) } : {}) }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* the chat reply below remains the source of truth */ }
}

function assessmentMenu(): Record<string, unknown> {
  return { inline_keyboard: [
    [{ text: 'Assess a BTC 5-minute market', callback_data: 'market:btc:menu' }],
    [{ text: 'Link Insight account', callback_data: 'account:link' }, { text: 'Credits & account', callback_data: 'account:status' }],
    [{ text: 'Base lending · coming soon', callback_data: 'scene:lending' }],
    [{ text: 'Hyperliquid perps · coming soon', callback_data: 'scene:perp' }],
    [{ text: 'DEX swap · coming soon', callback_data: 'scene:swap' }],
  ] }
}

function marketSideKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [[
    { text: 'Assess Up', callback_data: 'market:btc:up' },
    { text: 'Assess Down', callback_data: 'market:btc:down' },
  ], [{ text: 'Cancel', callback_data: 'menu:cancel' }]] }
}

function assessableBtcPriceContractSlug(nowMs = Date.now()): string {
  const windowSeconds = 5 * 60
  const startSeconds = Math.floor(nowMs / 1_000 / windowSeconds) * windowSeconds
  const endMs = (startSeconds + windowSeconds) * 1_000
  // Keep a broad, human-usable assessment window. A button click never embeds
  // a timestamp; the bot chooses the market at click time and skips the
  // closing window when fewer than four minutes remain.
  const selectedStart = endMs - nowMs >= 4 * 60_000 ? startSeconds : startSeconds + windowSeconds
  return `btc-updown-5m-${selectedStart}`
}

async function sendTelegramEvidenceRecord(env: Env, chatId: number, caption: string, recordId: number, payload: unknown): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false
  let content: string
  try { content = JSON.stringify(payload) } catch { return false }
  if (new TextEncoder().encode(content).byteLength > 64 * 1024) return false
  try {
    const form = new FormData()
    form.set('chat_id', String(chatId))
    form.set('caption', caption.slice(0, 1_024))
    form.set('document', new Blob([content], { type: 'application/json' }), `priorseal-polymarket-evidence-${recordId}.json`)
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return false
    const resultText = await readBoundedStream(response.body, 8 * 1024)
    if (resultText === null) return false
    const result: unknown = JSON.parse(resultText)
    return isRecord(result) && result.ok === true
  } catch { return false }
}

async function fetchJson(url: string, init: RequestInit, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const service = url.includes('/.well-known/oracle-keys.json') ? 'KEY_REGISTRY' : 'INSIGHT'
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  } catch {
    throw upstreamTransportError(service)
  }
  if (!response.ok) throw upstreamHttpError(response, service)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`${service}_RESPONSE_TOO_LARGE`)
  const text = await readBoundedStream(response.body, maxBytes)
  if (text === null) throw new Error(`${service}_RESPONSE_TOO_LARGE`)
  try { return JSON.parse(text) as unknown } catch { throw new Error(`${service}_INVALID_JSON`) }
}

function polymarketAssessmentFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'INSIGHT_INVALID_JSON') return 'Insight returned an unreadable assessment response. No assessment was accepted.'
  if (message === 'KEY_REGISTRY_INVALID_JSON' || message === 'KEY_REGISTRY_INVALID') {
    return 'The trusted key registry returned invalid data. No assessment was accepted.'
  }
  if (message === 'INSIGHT_RESPONSE_TOO_LARGE' || message === 'KEY_REGISTRY_RESPONSE_TOO_LARGE') {
    return 'An upstream verification response exceeded the bot safety limit. No assessment was accepted.'
  }
  if (message.startsWith('ATTESTATION_')) {
    return 'Insight returned a decision that failed trusted signature verification. No assessment was accepted.'
  }
  if (message === 'ATTESTED_RESULT_MISMATCH') {
    return 'Insight returned a signed assessment for a different market or side. No assessment was accepted.'
  }
  return upstreamAssessmentFailure(error, 'Could not return a trusted assessment right now. Please try again later.')
}

type TelegramAccountStatus = {
  linked: boolean
  ready?: boolean
  balance?: number
  assessmentCostCredits?: number
}

function insightBase(env: Env): URL {
  if (!env.INSIGHT_BASE_URL || !env.TELEGRAM_INTEGRATION_SECRET) throw new Error('TELEGRAM_ACCOUNT_SERVICE_UNAVAILABLE')
  const base = new URL(env.INSIGHT_BASE_URL)
  if (base.protocol !== 'https:' || base.origin !== 'https://www.oracleinsight.xyz') throw new Error('BOT_UPSTREAM_URL_INVALID')
  return base
}

async function telegramAccountStatus(env: Env, telegramUserId: number): Promise<TelegramAccountStatus> {
  const endpoint = new URL('/api/telegram/account', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ telegramUserId: String(telegramUserId) }),
  }, 16 * 1024)
  if (!isRecord(response) || response.success !== true || typeof response.linked !== 'boolean') {
    throw new Error('TELEGRAM_ACCOUNT_SERVICE_UNAVAILABLE')
  }
  return {
    linked: response.linked,
    ...(typeof response.ready === 'boolean' ? { ready: response.ready } : {}),
    ...(typeof response.balance === 'number' ? { balance: response.balance } : {}),
    ...(typeof response.assessmentCostCredits === 'number' ? { assessmentCostCredits: response.assessmentCostCredits } : {}),
  }
}

async function telegramAccountLink(env: Env, telegramUserId: number): Promise<string> {
  const endpoint = new URL('/api/telegram/link/start', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ telegramUserId: String(telegramUserId) }),
  }, 16 * 1024)
  if (!isRecord(response) || response.success !== true || typeof response.link !== 'string') {
    throw new Error('TELEGRAM_ACCOUNT_SERVICE_UNAVAILABLE')
  }
  const link = new URL(response.link)
  if (link.origin !== 'https://www.oracleinsight.xyz' || link.pathname !== '/telegram-link' || !link.searchParams.has('challenge')) {
    throw new Error('TELEGRAM_ACCOUNT_LINK_INVALID')
  }
  return link.toString()
}

async function unlinkTelegramAccount(env: Env, telegramUserId: number): Promise<boolean> {
  const endpoint = new URL('/api/telegram/link/remove', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ telegramUserId: String(telegramUserId) }),
  }, 16 * 1024)
  return isRecord(response) && response.success === true && response.unlinked === true
}

async function assessLinkedPolymarket(
  env: Env,
  telegramUserId: number,
  updateId: number,
  slug: string,
  action: 'buy_up' | 'buy_down',
): Promise<{ decision: unknown; chargedCredits: number }> {
  const endpoint = new URL('/api/telegram/assessment', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      telegramUserId: String(telegramUserId),
      updateId,
      input: { protocolId: PROTOCOL_ID, marketSlug: slug, action },
    }),
  })
  if (!isRecord(response) || response.success !== true || !('data' in response)) {
    const code = isRecord(response) && typeof response.code === 'string' ? response.code : 'TELEGRAM_ASSESSMENT_UNAVAILABLE'
    throw new Error(code)
  }
  const chargedCredits = isRecord(response.billing) && typeof response.billing.chargedCredits === 'number'
    ? response.billing.chargedCredits
    : 0
  return { decision: response.data, chargedCredits }
}

async function refundUndeliveredAssessment(env: Env, telegramUserId: number, updateId: number): Promise<void> {
  const endpoint = new URL('/api/telegram/assessment/refund', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ telegramUserId: String(telegramUserId), updateId }),
  }, 16 * 1024)
  if (!isRecord(response) || response.success !== true) throw new Error('TELEGRAM_ASSESSMENT_REFUND_UNCONFIRMED')
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

async function checkMarket(
  env: Env,
  slug: string,
  action: 'buy_up' | 'buy_down',
  linked?: { telegramUserId: number; updateId: number },
): Promise<string> {
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
  const [response, registryDocument] = await Promise.all([
    linked
      ? assessLinkedPolymarket(env, linked.telegramUserId, linked.updateId, slug, action)
      : fetchJson(endpoint.toString(), { headers: { 'X-API-Key': apiKey, accept: 'application/json' } }),
    fetchJson(registryUrl.toString(), { headers: { accept: 'application/json' } }),
  ])
  const decision = isRecord(response) && 'decision' in response ? response.decision : response
  if (!isRecord(registryDocument)) throw new Error('KEY_REGISTRY_INVALID')
  const unwrapped = isRecord(decision) && decision.success === true && isRecord(decision.data) ? decision.data : decision
  const verification = await verifyInsightPolymarketGuardDecision(unwrapped, { keyRegistry: registryDocument as KeyRegistry })
  if (!verification.valid) throw new Error(`ATTESTATION_${verification.reason}`)
  const guard = guardFromResponse(unwrapped)
  if (!guard || guard.market === null || !isRecord(guard.market) || guard.market.marketSlug !== slug || guard.action !== action) {
    throw new Error('ATTESTED_RESULT_MISMATCH')
  }
  const billingText = isRecord(response) && typeof response.chargedCredits === 'number'
    ? `\nInsight credits charged: ${response.chargedCredits}`
    : ''
  return `${buildSummary(slug, action, guard)}${billingText}`
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok')
    if (url.pathname === '/telegram/lending/assess' || url.pathname === '/telegram/swap/settle') {
      return new Response('This assessment flow is not open for user testing.', {
        status: 410,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      })
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
            allowed_updates: ['message', 'callback_query'],
          }),
          signal: AbortSignal.timeout(10_000),
        })
        const telegramText = await readBoundedStream(telegramResponse.body, 8 * 1024)
        if (!telegramResponse.ok || telegramText === null) return new Response('webhook registration failed', { status: 502 })
        const telegramResult: unknown = JSON.parse(telegramText)
        if (!isRecord(telegramResult) || telegramResult.ok !== true || telegramResult.result !== true) {
          return new Response('webhook registration failed', { status: 502 })
        }
        const commandsResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commands: [
            { command: 'start', description: 'Open the assessment menu' },
            { command: 'check', description: 'Assess the next BTC market window' },
            { command: 'link', description: 'Link your Insight account' },
            { command: 'account', description: 'View your credits and account' },
            { command: 'unlink', description: 'Unlink your Insight account' },
            { command: 'lending', description: 'Base lending · coming soon' },
            { command: 'perp', description: 'Hyperliquid perps · coming soon' },
            { command: 'swap', description: 'DEX swap · coming soon' },
          ] }),
          signal: AbortSignal.timeout(10_000),
        })
        const commandsText = await readBoundedStream(commandsResponse.body, 8 * 1024)
        if (!commandsResponse.ok || commandsText === null) return new Response('bot command registration failed', { status: 502 })
        const commandsResult: unknown = JSON.parse(commandsText)
        if (!isRecord(commandsResult) || commandsResult.ok !== true || commandsResult.result !== true) {
          return new Response('bot command registration failed', { status: 502 })
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
    const callback = update.callback_query
    const message = update.message ?? callback?.message
    if (!message) return new Response('ok')
    let command = commandOf(message.text ?? '')
    if (callback) {
      const callbackData = callback.data ?? ''
      if (message.chat.id <= 0 || callback.from.id !== message.chat.id) {
        await answerTelegramCallback(env, callback.id, 'Open this assessment in your private chat with the bot.')
        return new Response('ok')
      }
      if (!allowedChat(message.chat.id, env.ALLOWED_CHAT_IDS)) {
        await answerTelegramCallback(env, callback.id, 'This private beta is not enabled for this chat yet.')
        return new Response('ok')
      }
      if (callbackData === 'market:btc:menu') {
        await answerTelegramCallback(env, callback.id)
        await sendTelegramMessage(env, message.chat.id, 'Choose a side. The bot will select a fresh BTC market when you tap Assess.', marketSideKeyboard())
        return new Response('ok')
      }
      if (callbackData === 'menu:cancel') {
        await answerTelegramCallback(env, callback.id, 'Cancelled.')
        await sendTelegramMessage(env, message.chat.id, 'No assessment was requested. Use /start whenever you are ready.', assessmentMenu())
        return new Response('ok')
      }
      if (callbackData === 'account:link' || callbackData === 'account:status') {
        await answerTelegramCallback(env, callback.id)
        command = { command: callbackData.endsWith(':link') ? 'link' : 'account', args: '' }
      } else if (callbackData.startsWith('scene:')) {
        await answerTelegramCallback(env, callback.id, 'This scenario is not open for user testing yet.')
        await sendTelegramMessage(env, message.chat.id, 'This scenario is still being prepared. The bot will not request JSON, wallet access, signatures, orders, or transactions. Use /start to try the available Polymarket assessment.')
        return new Response('ok')
      } else if (callbackData === 'market:btc:up' || callbackData === 'market:btc:down') {
        const side = callbackData.endsWith(':up') ? 'up' : 'down'
        await answerTelegramCallback(env, callback.id, `Preparing the next usable BTC window (${side}).`)
        command = { command: 'check', args: `btc ${side}` }
      } else {
        await answerTelegramCallback(env, callback.id, 'This button has expired. Use /start for a fresh menu.')
        return new Response('ok')
      }
    }
    if (!command) return new Response('ok')
    if (!allowedChat(message.chat.id, env.ALLOWED_CHAT_IDS)) {
      if (!env.ALLOWED_CHAT_IDS && message.chat.id > 0 && command.command === 'start') {
        await sendTelegramMessage(env, message.chat.id, `Private beta is not enabled for this chat yet. Your chat ID is ${message.chat.id}.`)
      }
      return new Response('ok')
    }
    if ((command.command === 'start' || command.command === 'help') && message.chat.id <= 0) {
      await sendTelegramMessage(env, message.chat.id, 'Open a private chat with this bot to view your account and request assessments.')
      return new Response('ok')
    }
    if ((command.command === 'link' || command.command === 'unlink' || command.command === 'account' || command.command === 'lending' || command.command === 'perp' || command.command === 'swap') && message.chat.id <= 0) {
      await sendTelegramMessage(env, message.chat.id, 'Account linking, credits, and scenario assessments are available in a private chat with the bot.')
      return new Response('ok')
    }
    if ((command.command === 'check' || command.command === 'evidence' || command.command === 'evidence-record') && message.chat.id <= 0) {
      await sendTelegramMessage(env, message.chat.id, 'Polymarket assessments and evidence are available in a private chat with the bot.')
      return new Response('ok')
    }

    const checkArgs = command.command === 'check' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedMarket, requestedSide, ...extraArgs] = checkArgs
    const requestedSlug = requestedMarket && /^(btc|bitcoin)$/i.test(requestedMarket)
      ? assessableBtcPriceContractSlug()
      : requestedMarket
    const validCheck = command.command === 'check' && Boolean(requestedSlug && requestedSide && !extraArgs.length && requestedSlug.length <= 200 &&
      !/[\u0000-\u0020\u007f]/.test(requestedSlug) && /^[a-z0-9][a-z0-9_-]*$/i.test(requestedSlug) &&
      isSupportedPriceContractSlug(requestedSlug) && ['up', 'down'].includes(requestedSide.toLowerCase()))
    const evidenceArgs = command.command === 'evidence' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedMarketId, ...extraEvidenceArgs] = evidenceArgs
    const validEvidence = command.command === 'evidence' && Boolean(requestedMarketId && !extraEvidenceArgs.length &&
      requestedMarketId.length <= 100 && /^[a-z0-9][a-z0-9_-]*$/i.test(requestedMarketId))
    const evidenceRecordArgs = command.command === 'evidence-record' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedEvidenceRecordId, ...extraEvidenceRecordArgs] = evidenceRecordArgs
    const validEvidenceRecord = command.command === 'evidence-record' && Boolean(requestedEvidenceRecordId && !extraEvidenceRecordArgs.length &&
      /^\d{1,16}$/.test(requestedEvidenceRecordId) && Number.isSafeInteger(Number(requestedEvidenceRecordId)))
    const object = env.STATE.getByName(String(message.chat.id))
    const reservation = await object.reserveUpdate(
      update.update_id,
      Math.floor(Date.now() / 1000),
      validCheck || validEvidence ? 'check' : 'other',
    )
    if (reservation === 'duplicate') return new Response('ok')
    if (reservation === 'in_progress') return new Response('update is still being processed', { status: 503 })
    let reply: string | null = null
    let replyMarkup: Record<string, unknown> | undefined
    let evidenceDocument: { recordId: number; value: unknown } | undefined
    let reservedFreeTrial = false
    let successfulPolymarketAssessment = false
    let linkedAssessmentForRefund: { telegramUserId: number; updateId: number } | null = null
    if (reservation === 'rate_limited') {
      reply = `Request limit reached: up to ${MAX_SCENARIO_REQUESTS_PER_HOUR} scenario/source assessment requests per rolling hour and ${MAX_SCENARIO_REQUESTS_PER_DAY} per rolling day per chat.`
    } else if (command.command === 'start' || command.command === 'help') {
      let linkedAccount: TelegramAccountStatus | null = null
      if (env.TELEGRAM_INTEGRATION_SECRET && message.chat.id > 0) {
        try { linkedAccount = await telegramAccountStatus(env, message.chat.id) } catch { /* keep the menu usable during a status outage */ }
      }
      const paymentCopy = linkedAccount?.linked
        ? `Each successful Polymarket assessment costs ${linkedAccount.assessmentCostCredits ?? 20} Insight credits. Use /account to check your balance before assessing.`
        : 'You can try one sponsored assessment before linking. After linking your Insight account, successful assessments use your Insight credits; failures are not charged.'
      reply = [
        'Welcome. Choose a scenario below. The BTC market is selected when you tap, so there are no expiring timestamps or JSON to prepare.',
        paymentCopy,
        'Base lending, Hyperliquid perps, and DEX swap are shown for orientation and will open only after their user-friendly flows and assessment-only APIs are ready.',
        'This bot never connects a wallet, asks for a signature, creates an authorization, places an order, or submits or relays a transaction.',
      ].join('\n')
      replyMarkup = assessmentMenu()
    } else if (command.command === 'link') {
      try {
        const link = await telegramAccountLink(env, message.chat.id)
        reply = `Open this secure Insight page and confirm the link while signed in. It expires in 15 minutes and can be used once:\n${link}\n\nLinking only connects your accounts; it does not authorize or submit transactions.`
      } catch {
        reply = 'Insight account linking is temporarily unavailable. No account was linked; please retry /link later.'
      }
    } else if (command.command === 'account') {
      try {
        const account = await telegramAccountStatus(env, message.chat.id)
        if (!account.linked) {
          reply = 'No Insight account is linked yet. Use /link, sign in on the official Insight website, and confirm the one-time link.'
        } else {
          const balance = account.balance ?? 0
          const cost = account.assessmentCostCredits ?? 20
          reply = `Insight account linked. Credit balance: ${balance}. One Polymarket assessment costs ${cost} credits (about ${Math.floor(balance / cost)} at the current balance). A credit charge is recorded only after a trusted assessment is produced.`
        }
      } catch {
        reply = 'Could not read the linked Insight account right now. No assessment or account change was made; please retry.'
      }
      replyMarkup = assessmentMenu()
    } else if (command.command === 'unlink') {
      try {
        const unlinked = await unlinkTelegramAccount(env, message.chat.id)
        reply = unlinked
          ? 'Your Telegram account is unlinked from Insight. Future assessments in this chat will not use your Insight credits.'
          : 'No linked Insight account was found for this Telegram chat.'
      } catch {
        reply = 'Could not unlink the account right now. No account change was confirmed; please retry.'
      }
    } else if (command.command === 'lending') {
      reply = 'Base lending is not open for user testing yet. The current Mini App requires raw call data, so this entry stays closed until the form and assessment contract match the product design.'
    } else if (command.command === 'perp') {
      reply = 'Hyperliquid perp assessment is not open for user testing yet. It will use a guided form and a long-lived review session; no JSON, order envelope, signature, or order submission will be required.'
    } else if (command.command === 'swap') {
      reply = 'DEX swap assessment is not open for user testing yet. It will use a reviewed quote and guided risk limits; the bot will not create approval/swap calldata or submit a transaction.'
    } else {
      if (command.command === 'check' && (!validCheck || !requestedSlug || !requestedSide)) {
        const hasSupportedShape = Boolean(requestedSlug && isSupportedPriceContractSlug(requestedSlug))
        if (!requestedSlug) reply = 'Usage: /check btc <up|down>'
        else if (hasSupportedShape) reply = 'Usage: /check btc <up|down>; the side must be up or down and no extra text may follow.'
        else reply = 'This /check currently supports the active BTC 5-minute up/down market. Use /check btc up or /check btc down.'
      } else if (command.command === 'check' && requestedSlug && priceContractEndTimeMs(requestedSlug) !== undefined &&
        !hasAtLeastRemainingMs(priceContractEndTimeMs(requestedSlug) as number)) {
        reply = 'This market closes in under 90 seconds. No assessment was requested; use the next active market window.'
      } else if (command.command === 'evidence' && (!validEvidence || !requestedMarketId)) {
        reply = 'Polymarket source evidence is paused in this pilot. It will reopen after per-user credits and evidence delivery are connected.'
      } else if (command.command === 'evidence-record' && !validEvidenceRecord) {
        reply = 'Usage: /evidence-record <record-id>'
      } else if (command.command === 'evidence-record' && requestedEvidenceRecordId) {
        try {
          const recordId = Number(requestedEvidenceRecordId)
          const stored = await object.getSourceEvidence(recordId, Math.floor(Date.now() / 1000))
          if (!stored) {
            reply = 'That evidence record is unavailable in this chat or its 30-day retention period has ended.'
          } else {
            const payload = readStoredMarketEvidence(stored)
            reply = `Original signed source evidence record ${recordId}. Collected ${stored.collectedAt}. The signature is archived as issued and may have expired; this is not a fresh assessment.`
            evidenceDocument = { recordId, value: payload }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
          console.error(JSON.stringify({ event: 'polymarket_evidence_record_read_failed', code: reason }))
          reply = 'Could not read that stored evidence record safely.'
        }
      } else if (command.command === 'evidence' && requestedMarketId) {
        reply = 'Polymarket source evidence is paused in this pilot. It will reopen after per-user credits and evidence delivery are connected.'
      } else {
        let linkedAccount: TelegramAccountStatus | null = null
        if (env.TELEGRAM_INTEGRATION_SECRET) {
          try {
            linkedAccount = await telegramAccountStatus(env, message.chat.id)
          } catch {
            reply = 'Insight account status is temporarily unavailable. No assessment was requested or charged; please retry.'
          }
        }
        if (!reply && linkedAccount?.linked && requestedSlug && requestedSide) {
          // If the Insight response is interrupted after its billing commit, ask
          // its idempotent compensation route to refund this update key. When
          // nothing was charged the refund endpoint safely reports NOT_CHARGED.
          linkedAssessmentForRefund = { telegramUserId: message.chat.id, updateId: update.update_id }
          try {
            reply = await checkMarket(env, requestedSlug, requestedSide.toLowerCase() === 'up' ? 'buy_up' : 'buy_down', {
              telegramUserId: message.chat.id,
              updateId: update.update_id,
            })
            successfulPolymarketAssessment = true
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'UNKNOWN'
            console.error(JSON.stringify({ event: 'telegram_linked_polymarket_assessment_failed', code: reason.slice(0, 80) }))
            try {
              await refundUndeliveredAssessment(env, message.chat.id, update.update_id)
            } catch (refundError) {
              const refundReason = refundError instanceof Error ? refundError.message.slice(0, 80) : 'UNKNOWN'
              console.error(JSON.stringify({ event: 'telegram_assessment_interrupted_refund_failed', code: refundReason }))
            }
            reply = reason === 'CREDIT_EXHAUSTED' || reason === 'INSIGHT_HTTP_402'
              ? 'Your Insight credit balance cannot cover this assessment. Use /account to check your balance and open Insight Billing to add credits. No assessment was delivered.'
              : reason === 'TELEGRAM_ACCOUNT_NOT_LINKED'
                  ? 'Your account link is not available yet. Use /link and confirm it on the official Insight website.'
                  : polymarketAssessmentFailure(error)
          }
        } else if (!reply && linkedAccount && !linkedAccount.linked) {
          const trial = await object.reservePolymarketTrial(message.chat.id, update.update_id, Math.floor(Date.now() / 1000))
          if (trial === 'used') {
            reply = 'Your sponsored assessment has been used. Link an Insight account with /link to continue using your own credits; use /account to review your account.'
          } else if (trial === 'in_progress') {
            reply = 'Your sponsored assessment is still processing. Please wait for its result before starting another.'
          } else {
            reservedFreeTrial = true
          }
        } else if (!reply && !env.TELEGRAM_INTEGRATION_SECRET) {
          const trial = await object.reservePolymarketTrial(message.chat.id, update.update_id, Math.floor(Date.now() / 1000))
          if (trial === 'used') reply = 'Your sponsored assessment has been used. Account linking is temporarily unavailable; please try again later.'
          else if (trial === 'in_progress') reply = 'Your sponsored assessment is still processing. Please wait for its result before starting another.'
          else reservedFreeTrial = true
        }

        if (!reply && reservedFreeTrial && requestedSlug && requestedSide) {
          try {
            reply = await checkMarket(env, requestedSlug, requestedSide.toLowerCase() === 'up' ? 'buy_up' : 'buy_down')
            successfulPolymarketAssessment = true
            reply += '\nSponsored trial: no user credits were charged. Link your Insight account with /link to continue after this sample.'
          } catch (error) {
            const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
            console.error(JSON.stringify({ event: 'polymarket_trial_assessment_failed', code: reason }))
            reply = polymarketAssessmentFailure(error)
          }
        }
      }
    }

    if (command.command === 'check') replyMarkup = assessmentMenu()
    const delivered = evidenceDocument
      ? await sendTelegramEvidenceRecord(env, message.chat.id, reply ?? '', evidenceDocument.recordId, evidenceDocument.value) ||
        await sendTelegramMessage(env, message.chat.id, 'The evidence record was found, but Telegram could not deliver its JSON document. Please retry /evidence-record.', replyMarkup)
      : await sendTelegramMessage(env, message.chat.id, reply, replyMarkup)
    if (delivered && linkedAssessmentForRefund && !successfulPolymarketAssessment) {
      try {
        await refundUndeliveredAssessment(env, linkedAssessmentForRefund.telegramUserId, linkedAssessmentForRefund.updateId)
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
        console.error(JSON.stringify({ event: 'telegram_assessment_interrupted_refund_retry_failed', code: reason }))
      }
    }
    if (!delivered) {
      if (reservedFreeTrial) object.releasePolymarketTrial(message.chat.id, update.update_id)
      if (linkedAssessmentForRefund) {
        try {
          await refundUndeliveredAssessment(env, linkedAssessmentForRefund.telegramUserId, linkedAssessmentForRefund.updateId)
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
          console.error(JSON.stringify({ event: 'telegram_assessment_delivery_refund_failed', code: reason }))
        }
      }
      await object.releaseUpdate(update.update_id)
      return new Response('telegram delivery failed', { status: 502 })
    }
    if (reservedFreeTrial) {
      if (successfulPolymarketAssessment) object.completePolymarketTrial(message.chat.id, update.update_id)
      else object.releasePolymarketTrial(message.chat.id, update.update_id)
    }
    await object.completeUpdate(update.update_id)
    return new Response('ok')
  },
} satisfies ExportedHandler<Env>
