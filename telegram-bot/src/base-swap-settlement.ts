import { verifyInsightAgentSwapGuardDecision } from '../../sdk/src/insight-base-agent-swap-guard.js'
import { verifyInsightAgentSwapGuardSettlement } from '../../sdk/src/insight-base-agent-swap-guard-settlement.js'
import type { KeyRegistry } from 'verify-insight-receipt'
import { verifyTelegramMiniAppInitData } from './base-lending.js'
import type { TelegramBotState } from './telegram-state.js'

const INSIGHT_ORIGIN = 'https://www.oracleinsight.xyz'
const MAX_BODY_BYTES = 256 * 1024
const TX_HASH = /^0x[0-9a-fA-F]{64}$/

type Env = {
  STATE?: DurableObjectNamespace<TelegramBotState>
  TELEGRAM_BOT_TOKEN?: string
  ALLOWED_CHAT_IDS?: string
  INSIGHT_API_KEY?: string
  LENDING_MINI_APP_ORIGIN?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('REQUEST_BODY_EMPTY')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('REQUEST_TOO_LARGE') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new Error('REQUEST_INVALID_JSON') }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new Error('INSIGHT_RESPONSE_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('INSIGHT_RESPONSE_EMPTY')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); throw new Error('INSIGHT_RESPONSE_TOO_LARGE') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('INSIGHT_RESPONSE_INVALID_UTF8') }
}

function headersFor(request: Request, env: Env): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' })
  const origin = request.headers.get('Origin')
  if (origin && origin === env.LENDING_MINI_APP_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'content-type')
    headers.set('Access-Control-Max-Age', '600')
  }
  return headers
}

function extractSettlement(value: unknown): unknown {
  if (!isRecord(value)) return null
  if (isRecord(value.settlement)) return value.settlement
  if (isRecord(value.data)) return extractSettlement(value.data)
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (!isRecord(item) || typeof item.text !== 'string') continue
      try {
        const settlement = extractSettlement(JSON.parse(item.text) as unknown)
        if (settlement) return settlement
      } catch { /* continue through text blocks */ }
    }
  }
  return null
}

async function loadKeyRegistry(): Promise<KeyRegistry> {
  const response = await fetch(`${INSIGHT_ORIGIN}/.well-known/oracle-keys.json`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`KEY_REGISTRY_HTTP_${response.status}`)
  const body: unknown = JSON.parse(await readBoundedText(response, 64 * 1024))
  if (!isRecord(body)) throw new Error('KEY_REGISTRY_INVALID')
  return body as KeyRegistry
}

/** Authenticated, short-window post-trade closure; never signs or submits a transaction. */
export async function handleTelegramSwapSettlementRequest(request: Request, env: Env): Promise<Response> {
  const headers = headersFor(request, env)
  const origin = request.headers.get('Origin')
  if (!env.LENDING_MINI_APP_ORIGIN || origin !== env.LENDING_MINI_APP_ORIGIN) {
    return Response.json({ success: false, message: 'MINI_APP_ORIGIN_NOT_ALLOWED' }, { status: 403, headers })
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return Response.json({ success: false, message: 'METHOD_NOT_ALLOWED' }, { status: 405, headers })

  try {
    const body = await readBoundedJson(request)
    if (!isRecord(body) || typeof body.initData !== 'string' || !isRecord(body.decision) ||
        typeof body.swapTxHash !== 'string' || !TX_HASH.test(body.swapTxHash) ||
        (body.approvalTxHash !== undefined && (typeof body.approvalTxHash !== 'string' || !TX_HASH.test(body.approvalTxHash)))) {
      throw new Error('REQUEST_INVALID')
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.ALLOWED_CHAT_IDS || !env.INSIGHT_API_KEY || !env.STATE) {
      throw new Error('BOT_CONFIGURATION_INCOMPLETE')
    }
    const identity = await verifyTelegramMiniAppInitData(body.initData, env.TELEGRAM_BOT_TOKEN)
    const allowlist = env.ALLOWED_CHAT_IDS.split(',').map((value) => value.trim()).filter(Boolean)
    if (!(allowlist.length === 1 && allowlist[0] === '*') && !allowlist.includes(String(identity.userId))) {
      throw new Error('TELEGRAM_USER_NOT_ALLOWED')
    }

    const keys = await loadKeyRegistry()
    const beforeCall = Math.floor(Date.now() / 1000)
    const verification = await verifyInsightAgentSwapGuardDecision(body.decision, { keyRegistry: keys, now: beforeCall })
    if (!verification.valid || !verification.trusted || verification.expired || !verification.validUntil || verification.validUntil <= beforeCall) {
      throw new Error(`SWAP_DECISION_${verification.reason.toUpperCase()}`)
    }
    const state = env.STATE.getByName(String(identity.userId))
    if (!await state.reserveSwapSettlement(beforeCall)) {
      return Response.json({ success: false, message: 'SWAP_SETTLEMENT_RATE_LIMITED' }, { status: 429, headers })
    }

    const response = await fetch(`${INSIGHT_ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-API-Key': env.INSIGHT_API_KEY },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'priorseal-telegram-swap-settlement', method: 'tools/call',
        params: { name: 'settle_agent_swap_guard', arguments: {
          decision: body.decision,
          swapTxHash: body.swapTxHash,
          ...(typeof body.approvalTxHash === 'string' ? { approvalTxHash: body.approvalTxHash } : {}),
        } },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`INSIGHT_MCP_HTTP_${response.status}`)
    const rpc: unknown = JSON.parse(await readBoundedText(response, 256 * 1024))
    if (!isRecord(rpc) || isRecord(rpc.error) || !isRecord(rpc.result) || rpc.result.isError === true) throw new Error('INSIGHT_SETTLEMENT_FAILED')
    const settlement = extractSettlement(rpc.result)
    if (!settlement || !isRecord(settlement) || !isRecord(settlement.data)) throw new Error('INSIGHT_SETTLEMENT_MISSING')

    const signedSettlement = await verifyInsightAgentSwapGuardSettlement(settlement, { keyRegistry: keys })
    if (!signedSettlement.valid) throw new Error(`SETTLEMENT_${signedSettlement.reason.toUpperCase()}`)
    const decision = body.decision as Record<string, unknown>
    const guard = isRecord(decision.guard) ? decision.guard : null
    const binding = guard && isRecord(guard.binding) ? guard.binding : null
    const scope = guard && isRecord(guard.scope) ? guard.scope : null
    const settlementData = settlement.data
    if (!binding || !isRecord(binding.swap) || !scope || settlementData.decisionHash !== decision.decisionHash ||
        settlementData.chainId !== scope.chainId || typeof binding.recipient !== 'string' ||
        typeof settlementData.recipient !== 'string' || settlementData.recipient.toLowerCase() !== binding.recipient.toLowerCase() ||
        settlementData.onChainSwapCalldataHash !== binding.swap.calldataHash ||
        typeof settlementData.swapTxHash !== 'string' || settlementData.swapTxHash.toLowerCase() !== (body.swapTxHash as string).toLowerCase()) {
      throw new Error('SETTLEMENT_DECISION_OR_TRANSACTION_MISMATCH')
    }
    const checkedAt = Math.floor(Date.now() / 1000)
    if (checkedAt >= verification.validUntil) throw new Error('SWAP_DECISION_EXPIRED_DURING_SETTLEMENT')
    const crossCheck = { valid: true, reason: 'OK', swapTxHash: settlementData.swapTxHash }
    return Response.json({ success: true, data: { settlement, verification: crossCheck } }, { status: 200, headers })
  } catch (caught) {
    const code = caught instanceof Error ? caught.message.slice(0, 96) : 'SWAP_SETTLEMENT_FAILED'
    const status = code === 'TELEGRAM_USER_NOT_ALLOWED' ? 403 : code === 'REQUEST_TOO_LARGE' ? 413 :
      code === 'BOT_CONFIGURATION_INCOMPLETE' ? 503 : code.startsWith('INSIGHT_MCP_HTTP_') ? 502 : 400
    return Response.json({ success: false, message: code }, { status, headers })
  }
}
