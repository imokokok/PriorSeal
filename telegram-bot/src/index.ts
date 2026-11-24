import { verifyInsightPolymarketGuardDecision } from '../../sdk/src/insight-polymarket-guard.js'
import { TelegramBotState } from './telegram-state.js'
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
}

type TelegramMessage = { chat: { id: number }; text?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage }
type GuardVerdict = 'ALLOW' | 'CAUTION' | 'BLOCK'

const MAX_BODY_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const PROTOCOL_ID = 'polymarket-prediction-mainnet'
const COMMAND_PATTERN = /^\/(start|help|check)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i

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

function commandOf(text: string): { command: 'start' | 'help' | 'check'; args: string } | null {
  const match = COMMAND_PATTERN.exec(text.trim())
  if (!match) return null
  const command = match[1]?.toLowerCase()
  if (command !== 'start' && command !== 'help' && command !== 'check') return null
  return { command, args: match[2]?.trim() ?? '' }
}

async function sendTelegramMessage(env: Env, chatId: number, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return false
    const resultText = await readBoundedStream(response.body, 8 * 1024)
    if (resultText === null) return false
    const result: unknown = JSON.parse(resultText)
    return isRecord(result) && result.ok === true
  } catch { return false }
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

    const checkArgs = command.command === 'check' ? command.args.split(/\s+/).filter(Boolean) : []
    const [requestedSlug, requestedSide, ...extraArgs] = checkArgs
    const validCheck = command.command === 'check' && Boolean(requestedSlug && requestedSide && !extraArgs.length && requestedSlug.length <= 200 &&
      !/[\u0000-\u0020\u007f]/.test(requestedSlug) && /^[a-z0-9][a-z0-9_-]*$/i.test(requestedSlug) &&
      ['up', 'down'].includes(requestedSide.toLowerCase()))
    const object = env.STATE.getByName(String(message.chat.id))
    const reservation = await object.reserveUpdate(update.update_id, Math.floor(Date.now() / 1000), validCheck ? 'check' : 'other')
    if (reservation === 'duplicate') return new Response('ok')
    let reply: string | null = null
    if (reservation === 'rate_limited') {
      reply = 'Free beta limit reached: up to 3 checks per hour and 10 per day per chat.'
    } else if (command.command === 'start' || command.command === 'help') {
      reply = 'Use /check <market-slug> <up|down> for a read-only assessment. The bot verifies Insight’s short-lived signature with PriorSeal before returning a summary.'
    } else {
      if (!validCheck || !requestedSlug || !requestedSide) {
        reply = 'Usage: /check <market-slug> <up|down>'
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

    const delivered = await sendTelegramMessage(env, message.chat.id, reply)
    if (!delivered) {
      await object.releaseUpdate(update.update_id)
      return new Response('telegram delivery failed', { status: 502 })
    }
    await object.completeUpdate(update.update_id)
    return new Response('ok')
  },
} satisfies ExportedHandler<Env>
