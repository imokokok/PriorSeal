import {
  verifyInsightBaseLendingGuardDecision,
} from '../../sdk/src/insight-base-lending-guard.js'
import type { InsightBaseLendingGuardDecision } from '../../sdk/src/insight-base-lending-guard.js'
import type { TelegramBotState } from './telegram-state.js'
import { UpstreamHttpError, upstreamAssessmentFailure, upstreamHttpError } from './upstream-errors.ts'

const INSIGHT_ORIGIN = 'https://www.oracleinsight.xyz'
const MAX_RESPONSE_BYTES = 256 * 1024
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HEX_CALLDATA = /^0x(?:[0-9a-fA-F]{2})+$/
const UINT = /^(?:0|[1-9][0-9]*)$/
const PROTOCOLS = ['aave-v3-base', 'morpho-blue-base', 'compound-v3-base', 'moonwell-base'] as const
const ACTIONS = ['supply', 'borrow'] as const

type ProtocolId = (typeof PROTOCOLS)[number]
type Action = (typeof ACTIONS)[number]

export type BaseLendingAssessmentInput = {
  guard: {
    protocolId: ProtocolId
    action: Action
    collateralSymbol: string
    loanSymbol: string
    collateralValueUsd: number
    debtValueUsd: number
    marketId?: string
  }
  transaction: {
    chainId: 8453
    from: string
    to: string
    data: `0x${string}`
    nonce: string | number
    value?: string | number
  }
}

export type BaseLendingAssessment = {
  decision: InsightBaseLendingGuardDecision
  verification: { valid: true; reason: string; decisionHash: string; validUntil: number }
}

export type TelegramMiniAppIdentity = { userId: number; authDate: number }

export type BaseLendingWorkerEnv = {
  STATE?: DurableObjectNamespace<TelegramBotState>
  TELEGRAM_BOT_TOKEN?: string
  ALLOWED_CHAT_IDS?: string
  INSIGHT_API_KEY?: string
  INSIGHT_BASE_URL?: string
  INSIGHT_KEY_REGISTRY_URL?: string
  LENDING_MINI_APP_ORIGIN?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function uint(value: unknown): boolean {
  return (typeof value === 'string' && UINT.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!
  return difference === 0
}

/** Verify Telegram's signed Mini App identity before a Worker uses private API credentials. */
export async function verifyTelegramMiniAppInitData(
  rawInitData: unknown,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
): Promise<TelegramMiniAppIdentity> {
  if (typeof rawInitData !== 'string' || rawInitData.length < 1 || rawInitData.length > 8_192 || !botToken) {
    throw new TypeError('TELEGRAM_INIT_DATA_INVALID')
  }
  const params = new URLSearchParams(rawInitData)
  if ([...params.keys()].length > 32 || [...params.keys()].length !== new Set(params.keys()).size) {
    throw new TypeError('TELEGRAM_INIT_DATA_INVALID')
  }
  const suppliedHash = params.get('hash')
  const authDateRaw = params.get('auth_date')
  const userRaw = params.get('user')
  if (!suppliedHash || !/^[0-9a-f]{64}$/i.test(suppliedHash) || !authDateRaw || !/^\d{1,12}$/.test(authDateRaw) || !userRaw) {
    throw new TypeError('TELEGRAM_INIT_DATA_INVALID')
  }
  const authDate = Number(authDateRaw)
  if (!Number.isSafeInteger(authDate) || authDate > now + 30 || now - authDate > 300) {
    throw new TypeError('TELEGRAM_INIT_DATA_EXPIRED')
  }
  const fields = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = await hmacSha256(new TextEncoder().encode(botToken), 'WebAppData')
  const expectedHash = await hmacSha256(secretKey, fields)
  const expectedHex = Array.from(expectedHash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (!equalBytes(new TextEncoder().encode(expectedHex), new TextEncoder().encode(suppliedHash.toLowerCase()))) {
    throw new TypeError('TELEGRAM_INIT_DATA_SIGNATURE_INVALID')
  }
  let user: unknown
  try { user = JSON.parse(userRaw) as unknown } catch { throw new TypeError('TELEGRAM_INIT_DATA_USER_INVALID') }
  if (!isRecord(user) || !Number.isSafeInteger(user.id) || (user.id as number) <= 0) {
    throw new TypeError('TELEGRAM_INIT_DATA_USER_INVALID')
  }
  return { userId: user.id as number, authDate }
}

function validateInput(value: unknown): BaseLendingAssessmentInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ['guard', 'transaction']) ||
      !isRecord(value.guard) || !isRecord(value.transaction) ||
      !hasOnlyKeys(value.guard, ['protocolId', 'action', 'collateralSymbol', 'loanSymbol', 'collateralValueUsd', 'debtValueUsd', 'marketId']) ||
      !hasOnlyKeys(value.transaction, ['chainId', 'from', 'to', 'data', 'nonce', 'value'])) {
    throw new TypeError('LENDING_INPUT_INVALID')
  }
  const guard = value.guard
  const transaction = value.transaction
  if (!PROTOCOLS.includes(guard.protocolId as ProtocolId) || !ACTIONS.includes(guard.action as Action) ||
      typeof guard.collateralSymbol !== 'string' || !/^[A-Za-z][A-Za-z0-9.-]{0,15}$/.test(guard.collateralSymbol) ||
      typeof guard.loanSymbol !== 'string' || !/^[A-Za-z][A-Za-z0-9.-]{0,15}$/.test(guard.loanSymbol) ||
      typeof guard.collateralValueUsd !== 'number' || !Number.isFinite(guard.collateralValueUsd) || guard.collateralValueUsd <= 0 ||
      typeof guard.debtValueUsd !== 'number' || !Number.isFinite(guard.debtValueUsd) || guard.debtValueUsd < 0 ||
      (guard.marketId !== undefined && (typeof guard.marketId !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(guard.marketId))) ||
      (guard.protocolId === 'morpho-blue-base' && guard.marketId === undefined)) {
    throw new TypeError('LENDING_GUARD_INPUT_INVALID')
  }
  if (transaction.chainId !== 8453 || typeof transaction.from !== 'string' || !ADDRESS.test(transaction.from) ||
      typeof transaction.to !== 'string' || !ADDRESS.test(transaction.to) ||
      typeof transaction.data !== 'string' || !HEX_CALLDATA.test(transaction.data) ||
      !uint(transaction.nonce) || !uint(transaction.value ?? 0) || String(transaction.value ?? 0) !== '0') {
    throw new TypeError('LENDING_TRANSACTION_INVALID')
  }
  return value as unknown as BaseLendingAssessmentInput
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('UPSTREAM_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('UPSTREAM_EMPTY_RESPONSE')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('UPSTREAM_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('UPSTREAM_INVALID_JSON')
  }
}

function responseData(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('INSIGHT_RESPONSE_INVALID')
  if (value.success === true && isRecord(value.data)) return value.data
  return value
}

/** Ensure the verified attestation still describes the exact UI risk inputs and call. */
export function assertLendingDecisionMatchesRequest(
  decision: InsightBaseLendingGuardDecision,
  input: BaseLendingAssessmentInput,
): void {
  const guard = decision.guard
  const market = isRecord(guard.market) ? guard.market : null
  const projected = isRecord(guard.projected) ? guard.projected : null
  const sameAddress = (left: unknown, right: string) =>
    typeof left === 'string' && left.toLowerCase() === right.toLowerCase()
  if (!market || !projected || guard.protocolId !== input.guard.protocolId || guard.action !== input.guard.action ||
      typeof market.collateralSymbol !== 'string' || market.collateralSymbol.toLowerCase() !== input.guard.collateralSymbol.toLowerCase() ||
      typeof market.loanSymbol !== 'string' || market.loanSymbol.toLowerCase() !== input.guard.loanSymbol.toLowerCase() ||
      (input.guard.marketId !== undefined && (typeof market.marketId !== 'string' || market.marketId.toLowerCase() !== input.guard.marketId.toLowerCase())) ||
      projected.collateralValueUsd !== input.guard.collateralValueUsd || projected.debtValueUsd !== input.guard.debtValueUsd ||
      decision.transaction.chainId !== input.transaction.chainId ||
      !sameAddress(decision.transaction.from, input.transaction.from) || !sameAddress(decision.transaction.to, input.transaction.to) ||
      decision.transaction.data.toLowerCase() !== input.transaction.data.toLowerCase() ||
      String(decision.transaction.nonce) !== String(input.transaction.nonce) || String(decision.transaction.value) !== '0') {
    throw new Error('LENDING_DECISION_REQUEST_MISMATCH')
  }
}

/** Fetches a signed, exact-call Insight decision and builds its PriorSeal-bound intent. */
export async function assessAndBindBaseLendingAction(
  rawInput: unknown,
  env: { INSIGHT_API_KEY?: string; INSIGHT_BASE_URL?: string; INSIGHT_KEY_REGISTRY_URL?: string },
  fetcher: typeof fetch = fetch,
): Promise<BaseLendingAssessment> {
  const input = validateInput(rawInput)
  if (!env.INSIGHT_API_KEY || env.INSIGHT_BASE_URL !== INSIGHT_ORIGIN ||
      env.INSIGHT_KEY_REGISTRY_URL !== `${INSIGHT_ORIGIN}/.well-known/oracle-keys.json`) {
    throw new Error('BOT_CONFIGURATION_INCOMPLETE')
  }

  const [decisionResponse, registryResponse] = await Promise.all([
    fetcher(`${INSIGHT_ORIGIN}/api/v1/safety/base-lending-guard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': env.INSIGHT_API_KEY, accept: 'application/json' },
      body: JSON.stringify({ guard: input.guard, transaction: input.transaction }),
      signal: AbortSignal.timeout(15_000),
    }),
    fetcher(`${INSIGHT_ORIGIN}/.well-known/oracle-keys.json`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    }),
  ])
  if (!decisionResponse.ok) throw upstreamHttpError(decisionResponse)
  if (!registryResponse.ok) throw upstreamHttpError(registryResponse, 'KEY_REGISTRY')
  const [rawDecision, rawRegistry] = await Promise.all([readJson(decisionResponse), readJson(registryResponse)])
  if (!isRecord(rawRegistry)) throw new Error('KEY_REGISTRY_INVALID')
  const decision = responseData(rawDecision)
  const trustedKeys = rawRegistry as Parameters<typeof verifyInsightBaseLendingGuardDecision>[1]['keyRegistry']
  const verification = await verifyInsightBaseLendingGuardDecision(decision, { keyRegistry: trustedKeys })
  if (!verification.valid || !verification.decisionHash || !verification.validUntil) {
    throw new Error(`LENDING_ATTESTATION_${verification.reason}`)
  }
  if (!isRecord(decision) || !isRecord(decision.guard) || !isRecord(decision.action)) {
    throw new Error('LENDING_DECISION_INVALID')
  }
  const typedDecision = decision as unknown as InsightBaseLendingGuardDecision
  assertLendingDecisionMatchesRequest(typedDecision, input)
  return {
    decision: typedDecision,
    verification: {
      valid: true,
      reason: verification.reason,
      decisionHash: verification.decisionHash,
      validUntil: verification.validUntil,
    },
  }
}

/** A bounded Telegram summary that keeps the lending verdict and action proof distinct. */
export function formatBaseLendingAssessment(result: BaseLendingAssessment): string {
  const { decision, verification } = result
  const guard = decision.guard
  const projected = isRecord(guard.projected) ? guard.projected : {}
  const ltv = typeof projected.ltv === 'number' && Number.isFinite(projected.ltv)
    ? `${(projected.ltv * 100).toFixed(2)}%`
    : 'n/a'
  const buffer = typeof projected.liquidationBufferPct === 'number' && Number.isFinite(projected.liquidationBufferPct)
    ? `${projected.liquidationBufferPct.toFixed(2)}%`
    : 'n/a'
  const evaluatedAt = typeof guard.evaluatedAt === 'string' && Number.isFinite(Date.parse(guard.evaluatedAt))
    ? new Date(guard.evaluatedAt).toISOString()
    : 'n/a'
  const protocol = guard.protocolId.replaceAll('-', ' ')
  const displayVerdict = ['ALLOW', 'CAUTION', 'BLOCK'].includes(guard.verdict) ? guard.verdict : 'UNKNOWN'
  return [
    `Base lending check: ${protocol} / ${guard.action}`,
    `Insight: ${displayVerdict} | LTV: ${ltv} | Liquidation buffer: ${buffer}`,
    `Decision: ${verification.decisionHash.slice(0, 10)}… | Expires: ${new Date(verification.validUntil * 1000).toISOString()}`,
    `Assessed: ${evaluatedAt}`,
    `Exact-call binding: ${decision.action.amount} units | ${decision.transaction.to}`,
    'Read-only risk assessment; no authorization, signing, or transaction submission is available in this Telegram flow.',
    'This assessment is not a liquidation guarantee.',
  ].join('\n')
}

async function boundedRequestJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('REQUEST_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('REQUEST_BODY_EMPTY')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('REQUEST_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new Error('REQUEST_INVALID_JSON') }
}

function miniAppCorsHeaders(request: Request, env: BaseLendingWorkerEnv): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' })
  const origin = request.headers.get('Origin')
  if (origin && env.LENDING_MINI_APP_ORIGIN && origin === env.LENDING_MINI_APP_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'content-type')
    headers.set('Access-Control-Max-Age', '600')
  }
  return headers
}

/** Mini App HTTP boundary: strict origin, fresh Telegram identity, configured-chat allowlist and bounded JSON. */
export async function handleBaseLendingAssessmentRequest(
  request: Request,
  env: BaseLendingWorkerEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = miniAppCorsHeaders(request, env)
  const origin = request.headers.get('Origin')
  if (!env.LENDING_MINI_APP_ORIGIN || origin !== env.LENDING_MINI_APP_ORIGIN) {
    return Response.json({ success: false, message: 'Mini App origin is not allowed.' }, { status: 403, headers })
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return Response.json({ success: false, message: 'Method not allowed.' }, { status: 405, headers })
  try {
    const body = await boundedRequestJson(request)
    if (!isRecord(body) || !hasOnlyKeys(body, ['initData', 'input']) ||
        typeof body.initData !== 'string' || !('input' in body)) throw new Error('REQUEST_INVALID')
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error('BOT_CONFIGURATION_INCOMPLETE')
    const identity = await verifyTelegramMiniAppInitData(body.initData, env.TELEGRAM_BOT_TOKEN)
    const allowedChats = env.ALLOWED_CHAT_IDS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
    if (!(allowedChats.length === 1 && allowedChats[0] === '*') && !allowedChats.includes(String(identity.userId))) {
      throw new Error('TELEGRAM_USER_NOT_ALLOWED')
    }
    if (!env.STATE) throw new Error('BOT_CONFIGURATION_INCOMPLETE')
    const state = env.STATE.getByName(String(identity.userId))
    if (!await state.reserveLendingAssessment(Math.floor(Date.now() / 1000))) {
      return Response.json({ success: false, message: 'LENDING_RATE_LIMITED' }, { status: 429, headers })
    }
    const assessment = await assessAndBindBaseLendingAction(body.input, env, fetcher)
    return Response.json({ success: true, data: { assessment } }, { status: 200, headers })
  } catch (caught) {
    const code = caught instanceof Error ? caught.message.slice(0, 96) : 'LENDING_ASSESSMENT_FAILED'
    const upstream = caught instanceof UpstreamHttpError ? caught : undefined
    const status = code === 'TELEGRAM_USER_NOT_ALLOWED' ? 403 :
      code === 'REQUEST_TOO_LARGE' ? 413 : code === 'BOT_CONFIGURATION_INCOMPLETE' ? 503 :
      upstream?.status === 402 || upstream?.status === 429 ? upstream.status :
      code.startsWith('INSIGHT_HTTP_') || code.startsWith('KEY_REGISTRY_HTTP_') ? 502 : 400
    const responseHeaders = new Headers(headers)
    if (upstream?.status === 429 && upstream.retryAfterSeconds) {
      responseHeaders.set('Retry-After', String(upstream.retryAfterSeconds))
    }
    return Response.json({
      success: false,
      code,
      message: upstreamAssessmentFailure(caught, 'Base lending assessment could not be completed. No assessment was produced.'),
      ...(upstream?.status === 429 && upstream.retryAfterSeconds
        ? { retryAfterSeconds: upstream.retryAfterSeconds }
        : {}),
    }, { status, headers: responseHeaders })
  }
}
