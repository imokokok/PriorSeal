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
  SPONSORED_TRIAL_MONTHLY_CREDIT_CAP,
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

type TelegramMessage = { chat: { id: number }; from?: { id: number; language_code?: string }; text?: string }
type TelegramCallbackQuery = { id: string; from: { id: number; language_code?: string }; message?: TelegramMessage; data?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }
type GuardVerdict = 'ALLOW' | 'CAUTION' | 'BLOCK'
type BotCommand = 'start' | 'help' | 'menu' | 'usage' | 'privacy' | 'cancel' | 'check' | 'evidence' | 'evidence-record' | 'link' | 'unlink' | 'account' | 'lending' | 'perp' | 'swap'

const MAX_BODY_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const PROTOCOL_ID = 'polymarket-prediction-mainnet'
const COMMAND_PATTERN = /^\/(start|help|menu|usage|privacy|cancel|check|evidence-record|evidence|link|unlink|account|lending|perp|swap)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i

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
    ...(isRecord(value.from) && Number.isSafeInteger(value.from.id) ? { from: { id: value.from.id as number, ...(typeof value.from.language_code === 'string' ? { language_code: value.from.language_code.slice(0, 16) } : {}) } } : {}),
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
        from: { id: query.from.id as number, ...(typeof query.from.language_code === 'string' ? { language_code: query.from.language_code.slice(0, 16) } : {}) },
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
  if (command !== 'start' && command !== 'help' && command !== 'menu' && command !== 'usage' && command !== 'privacy' && command !== 'cancel' && command !== 'check' && command !== 'evidence' && command !== 'evidence-record' && command !== 'link' && command !== 'unlink' && command !== 'account' &&
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

function localizedMenu(locale: 'en' | 'zh'): Record<string, unknown> {
  if (locale === 'en') return assessmentMenu()
  return { inline_keyboard: [
    [{ text: '评估 BTC 5 分钟市场', callback_data: 'market:btc:menu' }],
    [{ text: '绑定 Insight 账户', callback_data: 'account:link' }, { text: '积分与账户', callback_data: 'account:status' }],
    [{ text: 'Base 借贷 · 暂未开放', callback_data: 'scene:lending' }],
    [{ text: 'Hyperliquid 永续 · 暂未开放', callback_data: 'scene:perp' }],
    [{ text: 'DEX Swap · 暂未开放', callback_data: 'scene:swap' }],
  ] }
}

function marketSideKeyboard(): Record<string, unknown> {
  return { inline_keyboard: [[
    { text: 'Assess Up', callback_data: 'market:btc:up' },
    { text: 'Assess Down', callback_data: 'market:btc:down' },
  ], [{ text: 'Cancel', callback_data: 'menu:cancel' }]] }
}

function localizedMarketSideKeyboard(locale: 'en' | 'zh'): Record<string, unknown> {
  if (locale === 'en') return marketSideKeyboard()
  return { inline_keyboard: [[
    { text: '查看上涨风险', callback_data: 'market:btc:up' },
    { text: '查看下跌风险', callback_data: 'market:btc:down' },
  ], [{ text: '取消', callback_data: 'menu:cancel' }]] }
}

function localeOf(update: TelegramUpdate): 'en' | 'zh' {
  const lang = update.message?.from?.language_code ?? update.callback_query?.from.language_code ?? ''
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function confirmationKeyboard(token: string, locale: 'en' | 'zh'): Record<string, unknown> {
  return { inline_keyboard: [[
    { text: locale === 'zh' ? '确认并评估' : 'Confirm and assess', callback_data: `confirm:${token}` },
    { text: locale === 'zh' ? '取消' : 'Cancel', callback_data: 'menu:cancel' },
  ]] }
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

function polymarketAssessmentFailure(error: unknown, locale: 'en' | 'zh' = 'en'): string {
  if (locale === 'zh') return '当前无法生成或验证可信评估。没有发起交易，评估失败不会扣除用户积分；请稍后重试。'
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
  frozen?: number
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
  for (const field of ['assessmentCostCredits', ...(response.linked ? ['balance', 'frozen'] : [])]) {
    const value = response[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('TELEGRAM_ACCOUNT_SERVICE_UNAVAILABLE')
  }
  if (response.linked && (response.frozen as number) > (response.balance as number)) throw new Error('TELEGRAM_ACCOUNT_SERVICE_UNAVAILABLE')
  return {
    linked: response.linked,
    ...(typeof response.ready === 'boolean' ? { ready: response.ready } : {}),
    ...(typeof response.balance === 'number' ? { balance: response.balance } : {}),
    ...(typeof response.frozen === 'number' ? { frozen: response.frozen } : {}),
    assessmentCostCredits: response.assessmentCostCredits as number,
  }
}

async function telegramUsage(env: Env, telegramUserId: number): Promise<Array<{ assessedAt: string; chargedCredits: number; verdict?: GuardVerdict }>> {
  const endpoint = new URL('/api/telegram/usage', insightBase(env))
  const response = await fetchJson(endpoint.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELEGRAM_INTEGRATION_SECRET}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ telegramUserId: String(telegramUserId) }),
  }, 16 * 1024)
  if (!isRecord(response) || response.success !== true || !Array.isArray(response.assessments)) throw new Error('TELEGRAM_USAGE_UNAVAILABLE')
  return response.assessments.flatMap((row) => isRecord(row) && typeof row.assessedAt === 'string' &&
    Number.isFinite(Date.parse(row.assessedAt)) && typeof row.chargedCredits === 'number' && Number.isFinite(row.chargedCredits) && row.chargedCredits > 0
    ? [{ assessedAt: row.assessedAt, chargedCredits: row.chargedCredits,
        ...(row.verdict === 'ALLOW' || row.verdict === 'CAUTION' || row.verdict === 'BLOCK' ? { verdict: row.verdict } : {}) }]
    : [])
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

function buildSummary(slug: string, action: 'buy_up' | 'buy_down', guard: Record<string, unknown>, locale: 'en' | 'zh' = 'en'): string {
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
  if (locale === 'zh') return [
    `Polymarket 风险评估：${slug}`,
    `方向：${displayAction === 'UP' ? '上涨' : '下跌'} · 风险判定：${status}`,
    `场所报价：${quotedPrice}`,
    `市场有效：${typeof market.active === 'boolean' ? String(market.active) : '未知'}`,
    `检查结果：${checkSummary.pass} 通过、${checkSummary.caution} 提示、${checkSummary.block} 阻止`,
    `结算方：${safeField(market.settlementVenue)} · 来源：${safeField(market.resolutionSourceUrl)}`,
    `评估时间：${evaluatedAt}`,
    '交易权限：无',
    'PriorSeal：Insight 签名与可信密钥已验证',
    '这是只读风险评估，不是结果预测或交易建议。',
  ].join('\n')
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
  locale: 'en' | 'zh' = 'en',
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
    ? locale === 'zh' ? `\n本次扣除 Insight 积分：${response.chargedCredits}` : `\nInsight credits charged: ${response.chargedCredits}`
    : ''
  return `${buildSummary(slug, action, guard, locale)}${billingText}`
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
        const commandLists = {
          en: [
            { command: 'start', description: 'Open the assessment menu' },
            { command: 'menu', description: 'Choose an assessment scenario' },
            { command: 'check', description: 'Get a fresh BTC assessment quote' },
            { command: 'link', description: 'Link your Insight account' },
            { command: 'account', description: 'View credits and account' },
            { command: 'usage', description: 'View recent assessments' },
            { command: 'privacy', description: 'Read the privacy notice' },
            { command: 'help', description: 'How to use this bot' },
            { command: 'cancel', description: 'Cancel the current step' },
            { command: 'unlink', description: 'Unlink your Insight account' },
            { command: 'lending', description: 'Base lending · coming soon' },
            { command: 'perp', description: 'Hyperliquid perps · coming soon' },
            { command: 'swap', description: 'DEX swap · coming soon' },
          ],
          zh: [
            { command: 'start', description: '打开评估菜单' },
            { command: 'menu', description: '选择评估场景' },
            { command: 'check', description: '获取 BTC 评估报价' },
            { command: 'link', description: '绑定 Insight 账户' },
            { command: 'account', description: '查看积分和账户' },
            { command: 'usage', description: '查看近期评估记录' },
            { command: 'privacy', description: '查看隐私说明' },
            { command: 'help', description: '查看使用帮助' },
            { command: 'cancel', description: '取消当前步骤' },
            { command: 'unlink', description: '解除 Insight 绑定' },
            { command: 'lending', description: 'Base 借贷 · 暂未开放' },
            { command: 'perp', description: 'Hyperliquid 永续 · 暂未开放' },
            { command: 'swap', description: 'DEX Swap · 暂未开放' },
          ],
        }
        const commandsResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commands: commandLists.en }),
          signal: AbortSignal.timeout(10_000),
        })
        const commandsText = await readBoundedStream(commandsResponse.body, 8 * 1024)
        if (!commandsResponse.ok || commandsText === null) return new Response('bot command registration failed', { status: 502 })
        const commandsResult: unknown = JSON.parse(commandsText)
        if (!isRecord(commandsResult) || commandsResult.ok !== true || commandsResult.result !== true) {
          return new Response('bot command registration failed', { status: 502 })
        }
        const localizedCommandsResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setMyCommands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commands: commandLists.zh, language_code: 'zh' }),
          signal: AbortSignal.timeout(10_000),
        })
        const localizedCommandsText = await readBoundedStream(localizedCommandsResponse.body, 8 * 1024)
        if (!localizedCommandsResponse.ok || localizedCommandsText === null) return new Response('localized bot command registration failed', { status: 502 })
        const localizedCommandsResult: unknown = JSON.parse(localizedCommandsText)
        if (!isRecord(localizedCommandsResult) || localizedCommandsResult.ok !== true || localizedCommandsResult.result !== true) {
          return new Response('localized bot command registration failed', { status: 502 })
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
    let confirmedAssessment: { slug: string; side: 'up' | 'down'; cost: number } | null = null
    const locale = localeOf(update)
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
        await sendTelegramMessage(env, message.chat.id, locale === 'zh'
          ? '选择要评估的方向。点击后会生成新报价；在确认前不会发起评估或扣除积分。'
          : 'Choose a side to assess. This creates a fresh quote; no assessment or credit charge happens until you confirm.', localizedMarketSideKeyboard(locale))
        return new Response('ok')
      }
      if (callbackData === 'menu:cancel') {
        await answerTelegramCallback(env, callback.id, 'Cancelled.')
        await sendTelegramMessage(env, message.chat.id, locale === 'zh' ? '已取消，没有发起评估。准备好后使用 /menu。' : 'Cancelled. No assessment was requested. Use /menu whenever you are ready.', localizedMenu(locale))
        return new Response('ok')
      }
      if (callbackData === 'account:link' || callbackData === 'account:status') {
        await answerTelegramCallback(env, callback.id)
        command = { command: callbackData.endsWith(':link') ? 'link' : 'account', args: '' }
      } else if (callbackData.startsWith('scene:')) {
        await answerTelegramCallback(env, callback.id, 'This scenario is not open for user testing yet.')
        await sendTelegramMessage(env, message.chat.id, locale === 'zh'
          ? '此场景仍在准备中。机器人不会索取 JSON、钱包访问、签名、订单或交易。可用 /menu 查看当前开放的 Polymarket 只读评估。'
          : 'This scenario is still being prepared. The bot will not request JSON, wallet access, signatures, orders, or transactions. Use /menu to try the available read-only Polymarket assessment.')
        return new Response('ok')
      } else if (callbackData.startsWith('confirm:')) {
        const token = callbackData.slice('confirm:'.length)
        if (!/^[a-f0-9]{24}$/.test(token)) {
          await answerTelegramCallback(env, callback.id, locale === 'zh' ? '确认按钮无效，请重新开始。' : 'This confirmation is invalid. Please start again.')
          return new Response('ok')
        }
        const state = env.STATE.getByName(String(message.chat.id))
        confirmedAssessment = await state.consumeAssessmentConfirmation(token, message.chat.id, Math.floor(Date.now() / 1000))
        if (!confirmedAssessment) {
          await answerTelegramCallback(env, callback.id, locale === 'zh' ? '此确认已使用或已过期，请重新报价。' : 'This confirmation was used or expired. Please request a fresh quote.')
          return new Response('ok')
        }
        await answerTelegramCallback(env, callback.id, locale === 'zh' ? '已确认，正在评估。' : 'Confirmed. Assessment is starting.')
        command = { command: 'check', args: `${confirmedAssessment.slug} ${confirmedAssessment.side}` }
      } else if (callbackData === 'market:btc:up' || callbackData === 'market:btc:down') {
        const side = callbackData.endsWith(':up') ? 'up' : 'down'
        await answerTelegramCallback(env, callback.id, locale === 'zh' ? '正在获取当前价格和账户信息。' : 'Checking the current price and account.')
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
    if ((command.command === 'start' || command.command === 'help' || command.command === 'menu' || command.command === 'usage' || command.command === 'privacy' || command.command === 'cancel') && message.chat.id <= 0) {
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
    let reservedSponsoredBudget = false
    let successfulPolymarketAssessment = false
    let linkedAssessmentForRefund: { telegramUserId: number; updateId: number } | null = null
    if (reservation === 'rate_limited') {
      reply = `Request limit reached: up to ${MAX_SCENARIO_REQUESTS_PER_HOUR} scenario/source assessment requests per rolling hour and ${MAX_SCENARIO_REQUESTS_PER_DAY} per rolling day per chat.`
    } else if (command.command === 'check' && validCheck && requestedSlug && requestedSide && !confirmedAssessment) {
      try {
        const account = env.TELEGRAM_INTEGRATION_SECRET ? await telegramAccountStatus(env, message.chat.id) : null
        const cost = account?.assessmentCostCredits
        if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost <= 0) {
          reply = locale === 'zh'
            ? '暂时无法确认当前评估价格，因此没有发起评估。请稍后重试。'
            : 'The current assessment price could not be verified, so no assessment was started. Please retry later.'
        } else if (!account?.linked && env.ALLOWED_CHAT_IDS?.trim() === '*') {
          reply = locale === 'zh'
            ? '匿名赞助试用仅在封闭白名单试点中开放。本聊天暂不可用；请绑定 Insight 账户以使用自己的积分。'
            : 'The anonymous sponsored sample is limited to the closed allowlisted pilot and is unavailable in this chat. Link an Insight account to use your own credits.'
        } else if (account?.linked && Math.max(0, (account.balance ?? 0) - (account.frozen ?? 0)) < cost) {
          const available = Math.max(0, (account.balance ?? 0) - (account.frozen ?? 0))
          reply = locale === 'zh'
            ? `当前可用余额 ${available} 积分，低于本次费用 ${cost} 积分，因此无法继续评估。可在 Insight 充值后再试。`
            : `Your available balance is ${available} credits, below the ${cost}-credit assessment price. No assessment can run until you add credits in Insight.`
          replyMarkup = localizedMenu(locale)
        } else {
          const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')
          await object.createAssessmentConfirmation(token, message.chat.id, requestedSlug, requestedSide.toLowerCase() as 'up' | 'down', cost, Math.floor(Date.now() / 1000))
          const available = account?.linked ? Math.max(0, (account.balance ?? 0) - (account.frozen ?? 0)) : 0
          reply = account?.linked
            ? locale === 'zh'
              ? `评估报价\n市场：${requestedSlug}\n方向：${requestedSide.toUpperCase()}\n费用：${cost} Insight 积分\n当前可用余额：${available}\n\n确认后才会运行只读风险评估并扣费。确认意向保留 7 天；市场窗口或价格变化时会先显示新报价，不会自动评估。`
              : `Assessment quote\nMarket: ${requestedSlug}\nSide: ${requestedSide.toUpperCase()}\nPrice: ${cost} Insight credits\nAvailable balance: ${available}\n\nConfirm to run the read-only risk assessment and charge credits. Your confirmation intent lasts 7 days; if the market window or price changes, the bot will show a new quote and will not assess automatically.`
            : locale === 'zh'
              ? `免费试用报价\n市场：${requestedSlug}\n方向：${requestedSide.toUpperCase()}\n用户费用：0 积分（由试点额度赞助）\n\n每个 Telegram 账户限一次，试点每月总额上限 ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP} 积分。确认后才会启动。`
              : `Sponsored trial quote\nMarket: ${requestedSlug}\nSide: ${requestedSide.toUpperCase()}\nYour cost: 0 credits (covered by the pilot)\n\nOne per Telegram account; the pilot has a global monthly ceiling of ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP} credits. Confirm to start.`
          replyMarkup = confirmationKeyboard(token, locale)
        }
      } catch {
        reply = locale === 'zh'
          ? '当前无法获取可信报价或账户余额，没有发起评估。请稍后重试。'
          : 'A trusted quote or account balance is unavailable. No assessment was started; please retry later.'
      }
    } else if (command.command === 'start' || command.command === 'help' || command.command === 'menu' || command.command === 'cancel') {
      let linkedAccount: TelegramAccountStatus | null = null
      if (env.TELEGRAM_INTEGRATION_SECRET && message.chat.id > 0) {
        try { linkedAccount = await telegramAccountStatus(env, message.chat.id) } catch { /* keep the menu usable during a status outage */ }
      }
      if (command.command === 'help') {
        reply = locale === 'zh'
          ? '使用 /menu 选择场景。/account 查看余额，/usage 查看最近评估记录，/link 或 /unlink 管理账户绑定，/privacy 查看隐私说明，/cancel 取消当前步骤。只读评估不会代表你交易。'
          : 'Use /menu to choose a scenario. /account shows your balance; /usage shows recent assessments; /link and /unlink manage account linking; /privacy explains data use; /cancel exits the current step. Read-only assessments never trade for you.'
        replyMarkup = localizedMenu(locale)
      } else {
        const cost = linkedAccount?.assessmentCostCredits
        const paymentCopy = linkedAccount?.linked
          ? (typeof cost === 'number' && cost > 0 ? (locale === 'zh' ? `每次成功评估 ${cost} Insight 积分。评估前会显示报价和可用余额，并要求你再次确认。` : `Each successful assessment costs ${cost} Insight credits. You will review the quote and available balance, then confirm before it runs.`) : (locale === 'zh' ? '暂时无法读取价格；价格恢复后才能评估。' : 'Pricing is temporarily unavailable; assessments stay disabled until it can be verified.'))
          : linkedAccount && !linkedAccount.linked
            ? (locale === 'zh' ? `可体验一次试点赞助评估；每个账户一次，试点每月上限 ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP} 积分。` : `You can try one sponsored pilot assessment per Telegram account, within a global monthly ceiling of ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP} credits.`)
            : (locale === 'zh' ? '暂时无法确认账户状态和评估价格，评估功能暂不可用；请稍后重试。' : 'Account status and assessment pricing are temporarily unavailable. Assessments stay disabled; please retry later.')
        reply = locale === 'zh'
          ? `欢迎使用 Insight × PriorSeal。选择下方场景，点击后获取报价；市场在你确认时选择，不需要时间戳或 JSON。\n${paymentCopy}\nBase 借贷、Hyperliquid 永续、DEX Swap 暂未开放，直到易用流程和只读评估接口准备完成。\n机器人不连接钱包、不索取签名、不创建授权、不下单、不提交或转发交易。`
          : `Welcome to Insight × PriorSeal. Choose a scenario below. You will see a quote before confirming; the market is selected at confirmation time, with no timestamps or JSON to prepare.\n${paymentCopy}\nBase lending, Hyperliquid perps, and DEX swap remain closed until their user-friendly flows and read-only assessment APIs are ready.\nThis bot never connects a wallet, asks for a signature, creates authorization, places orders, or submits or relays transactions.`
        replyMarkup = localizedMenu(locale)
      }
    } else if (command.command === 'privacy') {
      reply = locale === 'zh'
        ? '隐私说明：https://www.oracleinsight.xyz/privacy\n机器人只处理完成账户绑定、请求只读评估和提供服务所需的数据。不会用你的 Telegram 账户代表你签名、下单或提交交易。'
        : 'Privacy: https://www.oracleinsight.xyz/privacy\nThe bot processes only the data needed to link your account, request read-only assessments, and provide the service. It never uses your Telegram account to sign, place orders, or submit transactions.'
    } else if (command.command === 'usage') {
      try {
        const usage = await telegramUsage(env, message.chat.id)
        reply = usage.length
          ? `${locale === 'zh' ? '最近的 Polymarket 评估：' : 'Recent Polymarket assessments:'}\n${usage.map((item) => `${new Date(item.assessedAt).toISOString()} · ${item.verdict ?? (locale === 'zh' ? '未知' : 'unknown')} · ${item.chargedCredits} ${locale === 'zh' ? '积分' : 'credits'}`).join('\n')}`
          : (locale === 'zh' ? '暂无已计费的评估记录。' : 'No billed assessments yet.')
      } catch {
        reply = locale === 'zh' ? '暂时无法读取用量记录，请稍后重试。' : 'Usage history is temporarily unavailable. Please retry later.'
      }
      replyMarkup = localizedMenu(locale)
    } else if (command.command === 'link') {
      try {
        const link = await telegramAccountLink(env, message.chat.id)
          reply = locale === 'zh'
            ? `请登录 Insight 官方网站并确认账户绑定。链接仅可使用一次，15 分钟后过期：\n${link}\n\n绑定仅关联账户，不会授权或提交交易。`
            : `Open this secure Insight page and confirm the link while signed in. It expires in 15 minutes and can be used once:\n${link}\n\nLinking only connects your accounts; it does not authorize or submit transactions.`
      } catch {
          reply = locale === 'zh' ? 'Insight 账户绑定暂时不可用。没有完成绑定，请稍后重试 /link。' : 'Insight account linking is temporarily unavailable. No account was linked; please retry /link later.'
      }
    } else if (command.command === 'account') {
      try {
        const account = await telegramAccountStatus(env, message.chat.id)
        if (!account.linked) {
          reply = locale === 'zh' ? '尚未绑定 Insight 账户。使用 /link 后登录 Insight 官方网站并确认一次性绑定。' : 'No Insight account is linked yet. Use /link, sign in on the official Insight website, and confirm the one-time link.'
        } else {
          const balance = account.balance ?? 0
          const available = Math.max(0, balance - (account.frozen ?? 0))
          const cost = account.assessmentCostCredits
          reply = typeof cost === 'number' && Number.isSafeInteger(cost) && cost > 0
            ? (locale === 'zh'
              ? `已绑定 Insight 账户。总积分：${balance}；冻结：${account.frozen ?? 0}；可用：${available}。每次 Polymarket 评估 ${cost} 积分（当前可进行约 ${Math.floor(available / cost)} 次）。只有成功生成可信评估后才扣费。`
              : `Insight account linked. Credits: ${balance}; frozen: ${account.frozen ?? 0}; available: ${available}. One Polymarket assessment costs ${cost} credits (about ${Math.floor(available / cost)} at the current balance). Credits are charged only after a trusted assessment is produced.`)
            : (locale === 'zh' ? '已绑定 Insight 账户，但暂时无法确认当前价格；评估暂不可用。' : 'Insight account linked, but current pricing is unavailable; assessments are temporarily disabled.')
        }
      } catch {
        reply = locale === 'zh' ? '暂时无法读取 Insight 账户。没有发起评估或更改账户，请稍后重试。' : 'Could not read the linked Insight account right now. No assessment or account change was made; please retry.'
      }
      replyMarkup = localizedMenu(locale)
    } else if (command.command === 'unlink') {
      try {
        const unlinked = await unlinkTelegramAccount(env, message.chat.id)
        reply = unlinked
          ? (locale === 'zh' ? 'Telegram 账户已解除与 Insight 的绑定。之后在此聊天中评估不会使用你的 Insight 积分。' : 'Your Telegram account is unlinked from Insight. Future assessments in this chat will not use your Insight credits.')
          : (locale === 'zh' ? '此 Telegram 聊天没有绑定 Insight 账户。' : 'No linked Insight account was found for this Telegram chat.')
      } catch {
        reply = locale === 'zh' ? '暂时无法解除绑定，没有确认账户变更，请稍后重试。' : 'Could not unlink the account right now. No account change was confirmed; please retry.'
      }
    } else if (command.command === 'lending') {
      reply = locale === 'zh'
        ? 'Base 借贷暂未开放测试。现有 Mini App 仍需要原始调用数据；在引导表单和只读评估接口符合产品设计前，此入口保持关闭。'
        : 'Base lending is not open for user testing yet. The current Mini App requires raw call data, so this entry stays closed until the form and assessment contract match the product design.'
    } else if (command.command === 'perp') {
      reply = locale === 'zh'
        ? 'Hyperliquid 永续评估暂未开放测试。未来会采用引导式表单和充足的审核时间，不会要求 JSON、订单信封、签名或提交订单。'
        : 'Hyperliquid perp assessment is not open for user testing yet. It will use a guided form and a long-lived review session; no JSON, order envelope, signature, or order submission will be required.'
    } else if (command.command === 'swap') {
      reply = locale === 'zh'
        ? 'DEX Swap 评估暂未开放测试。未来会采用报价审核和风险限额表单；机器人不会创建授权或 Swap calldata，也不会提交交易。'
        : 'DEX swap assessment is not open for user testing yet. It will use a reviewed quote and guided risk limits; the bot will not create approval/swap calldata or submit a transaction.'
    } else {
      if (command.command === 'check' && (!validCheck || !requestedSlug || !requestedSide)) {
        const hasSupportedShape = Boolean(requestedSlug && isSupportedPriceContractSlug(requestedSlug))
        if (!requestedSlug) reply = 'Usage: /check btc <up|down>'
        else if (hasSupportedShape) reply = 'Usage: /check btc <up|down>; the side must be up or down and no extra text may follow.'
        else reply = 'This /check currently supports the active BTC 5-minute up/down market. Use /check btc up or /check btc down.'
      } else if (command.command === 'check' && requestedSlug && priceContractEndTimeMs(requestedSlug) !== undefined &&
        !confirmedAssessment && !hasAtLeastRemainingMs(priceContractEndTimeMs(requestedSlug) as number)) {
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
        if (!reply && confirmedAssessment && requestedSlug && requestedSide && assessableBtcPriceContractSlug() !== requestedSlug) {
          const currentSlug = assessableBtcPriceContractSlug()
          const cost = linkedAccount?.assessmentCostCredits
          if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost <= 0) {
            reply = locale === 'zh' ? '市场窗口已更新，但当前费用无法确认，因此没有发起评估。请稍后重试。' : 'The market window changed and the current price could not be verified. No assessment was started; please retry later.'
          } else {
            const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')
            await object.createAssessmentConfirmation(token, message.chat.id, currentSlug, requestedSide.toLowerCase() as 'up' | 'down', cost, Math.floor(Date.now() / 1000))
            const available = linkedAccount?.linked ? Math.max(0, (linkedAccount.balance ?? 0) - (linkedAccount.frozen ?? 0)) : 0
            reply = linkedAccount?.linked
              ? (locale === 'zh'
                ? `市场窗口已更新，旧报价已作废。新报价：${currentSlug} · ${requestedSide.toUpperCase()} · ${cost} 积分；可用余额 ${available}。确认后才会运行评估。`
                : `The market window changed, so the old quote was discarded. New quote: ${currentSlug} · ${requestedSide.toUpperCase()} · ${cost} credits; available balance ${available}. Confirm to run the assessment.`)
              : (locale === 'zh'
                ? `市场窗口已更新，旧报价已作废。新报价：${currentSlug} · ${requestedSide.toUpperCase()} · 用户费用 0 积分（试点赞助，每月总上限 ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP} 积分）。确认后启动。`
                : `The market window changed, so the old quote was discarded. New quote: ${currentSlug} · ${requestedSide.toUpperCase()} · your cost is 0 credits (pilot-sponsored, global monthly ceiling ${SPONSORED_TRIAL_MONTHLY_CREDIT_CAP}). Confirm to start.`)
            replyMarkup = confirmationKeyboard(token, locale)
          }
        }
        if (!reply && linkedAccount?.linked && requestedSlug && requestedSide) {
          const freshCost = linkedAccount.assessmentCostCredits
          const available = Math.max(0, (linkedAccount.balance ?? 0) - (linkedAccount.frozen ?? 0))
          if (!confirmedAssessment || typeof freshCost !== 'number' || freshCost !== confirmedAssessment.cost || available < freshCost ||
              assessableBtcPriceContractSlug() !== requestedSlug) {
            reply = locale === 'zh'
              ? '报价、可用余额或市场窗口已变化，因此没有发起评估或扣费。请重新发送 /check btc up 或 /check btc down 获取新报价。'
              : 'The quote, available balance, or market window changed, so no assessment was started or charged. Send /check btc up or /check btc down for a fresh quote.'
          }
        }
        if (!reply && linkedAccount?.linked && requestedSlug && requestedSide && confirmedAssessment) {
          // If the Insight response is interrupted after its billing commit, ask
          // its idempotent compensation route to refund this update key. When
          // nothing was charged the refund endpoint safely reports NOT_CHARGED.
          linkedAssessmentForRefund = { telegramUserId: message.chat.id, updateId: update.update_id }
          try {
            reply = await checkMarket(env, requestedSlug, requestedSide.toLowerCase() === 'up' ? 'buy_up' : 'buy_down', {
              telegramUserId: message.chat.id,
              updateId: update.update_id,
            }, locale)
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
              ? (locale === 'zh'
                ? 'Insight 可用积分不足。使用 /account 查看余额，并前往 Insight 账单充值。本次没有完成评估或扣费。'
                : 'Your Insight credit balance cannot cover this assessment. Use /account to check your balance and open Insight Billing to add credits. No assessment was delivered.')
              : reason === 'TELEGRAM_ACCOUNT_NOT_LINKED'
                  ? (locale === 'zh' ? '账户尚未完成绑定。使用 /link 并在 Insight 官方网站确认。' : 'Your account link is not available yet. Use /link and confirm it on the official Insight website.')
              : polymarketAssessmentFailure(error, locale)
          }
        } else if (!reply && linkedAccount && !linkedAccount.linked) {
          const cost = linkedAccount.assessmentCostCredits
          if (!confirmedAssessment || typeof cost !== 'number' || cost !== confirmedAssessment.cost ||
              env.ALLOWED_CHAT_IDS?.trim() === '*' || !env.TELEGRAM_INTEGRATION_SECRET ||
              assessableBtcPriceContractSlug() !== requestedSlug) {
            reply = locale === 'zh'
              ? '当前试用条件无法确认或不在封闭试点范围内，没有运行评估。请绑定账户后使用自己的积分，或稍后重试。'
              : 'The sponsored trial cannot be verified or is outside the closed pilot, so no assessment ran. Link your account to use your credits, or retry later.'
          }
          const globalBudget = env.STATE.getByName('sponsored-trial-global-v1')
          if (!reply && !globalBudget.reserveSponsoredTrialBudget(update.update_id, cost as number, Math.floor(Date.now() / 1000))) {
            reply = locale === 'zh'
              ? '本月赞助试用额度已用完或暂不可用。没有发起评估；请绑定 Insight 账户使用自己的积分。'
              : 'The monthly sponsored trial budget is exhausted or unavailable. No assessment was started; link an Insight account to use your credits.'
          } else if (!reply) reservedSponsoredBudget = true
          const trial = !reply ? await object.reservePolymarketTrial(message.chat.id, update.update_id, Math.floor(Date.now() / 1000)) : 'in_progress'
          if (!reply && trial === 'used') {
            reply = locale === 'zh'
              ? '你的赞助试用已使用。使用 /link 绑定 Insight 账户后，可使用自己的积分继续；使用 /account 查看账户。'
              : 'Your sponsored assessment has been used. Link an Insight account with /link to continue using your own credits; use /account to review your account.'
          } else if (!reply && trial === 'in_progress') {
            reply = locale === 'zh' ? '你的赞助评估仍在处理中。请等待结果后再开始下一次。' : 'Your sponsored assessment is still processing. Please wait for its result before starting another.'
          } else if (!reply) {
            reservedFreeTrial = true
          }
        }

        if (!reply && reservedFreeTrial && requestedSlug && requestedSide) {
          try {
            reply = await checkMarket(env, requestedSlug, requestedSide.toLowerCase() === 'up' ? 'buy_up' : 'buy_down', undefined, locale)
            successfulPolymarketAssessment = true
            reply += locale === 'zh'
              ? '\n赞助试用：未扣除你的积分。试用后请使用 /link 绑定 Insight 账户以继续。'
              : '\nSponsored trial: no user credits were charged. Link your Insight account with /link to continue after this sample.'
          } catch (error) {
            const reason = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
            console.error(JSON.stringify({ event: 'polymarket_trial_assessment_failed', code: reason }))
            reply = polymarketAssessmentFailure(error, locale)
            if (reservedSponsoredBudget) env.STATE.getByName('sponsored-trial-global-v1').releaseSponsoredTrialBudget(update.update_id, Math.floor(Date.now() / 1000))
          }
        }
      }
    }

    if (command.command === 'check' && !replyMarkup) replyMarkup = localizedMenu(locale)
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
      if (reservedSponsoredBudget) env.STATE.getByName('sponsored-trial-global-v1').releaseSponsoredTrialBudget(update.update_id, Math.floor(Date.now() / 1000))
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
      if (successfulPolymarketAssessment) {
        object.completePolymarketTrial(message.chat.id, update.update_id)
        if (reservedSponsoredBudget) env.STATE.getByName('sponsored-trial-global-v1').completeSponsoredTrialBudget(update.update_id, Math.floor(Date.now() / 1000))
      }
      else object.releasePolymarketTrial(message.chat.id, update.update_id)
    }
    if (reservedSponsoredBudget && !successfulPolymarketAssessment) env.STATE.getByName('sponsored-trial-global-v1').releaseSponsoredTrialBudget(update.update_id, Math.floor(Date.now() / 1000))
    await object.completeUpdate(update.update_id)
    return new Response('ok')
  },
} satisfies ExportedHandler<Env>
