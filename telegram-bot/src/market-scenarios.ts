import { z } from 'zod'
import {
  verifyInsightAgentSwapGuardDecision,
} from '../../sdk/src/insight-base-agent-swap-guard.js'
import {
  verifyInsightHyperliquidPerpGuardDecision,
} from '../../sdk/src/insight-hyperliquid-perp-guard.js'
import { createReadOnlyScenarioArtifact } from './read-only-scenario-artifact.js'
import { assertSwapDecisionMatchesRequest } from './swap-request-binding.js'
import { isWithinAssessmentDeadlineWindow } from './assessment-window.js'
import { withPerpAssessmentExpiry, withSwapAssessmentDeadline } from './assessment-deadlines.ts'
import { upstreamHttpError } from './upstream-errors.ts'
import type { KeyRegistry } from 'verify-insight-receipt'

type ScenarioEnv = {
  INSIGHT_API_KEY?: string
  INSIGHT_BASE_URL?: string
  INSIGHT_KEY_REGISTRY_URL?: string
}

const ADDRESS = /^0x[\da-f]{40}$/i
const CLOID = /^0x[\da-f]{32}$/i
const POSITIVE_DECIMAL = /^(?:0\.(?:0*[1-9][0-9]*)|[1-9][0-9]*(?:\.[0-9]+)?)$/
const MAX_RESPONSE_BYTES = 512 * 1024

const PerpGuardSchema = z.object({
  protocolId: z.literal('hyperliquid-perps-mainnet'),
  action: z.enum(['open_long', 'open_short']),
  assetSymbol: z.enum(['BTC', 'ETH']),
  marginAssetSymbol: z.literal('USDC'),
  sizeUsd: z.number().finite().positive().max(1_000_000_000_000),
  marginValueUsd: z.number().finite().positive().max(1_000_000_000_000),
}).strict()

const PerpOrderSchema = z.object({
  action: z.object({
    type: z.literal('order'),
    grouping: z.literal('na'),
    orders: z.array(z.object({
      a: z.number().int().min(0).max(9_999),
      b: z.boolean(),
      p: z.string().regex(POSITIVE_DECIMAL),
      s: z.string().regex(POSITIVE_DECIMAL),
      r: z.literal(false),
      t: z.object({ limit: z.object({ tif: z.literal('Ioc') }).strict() }).strict(),
      c: z.string().regex(CLOID),
    }).strict()).length(1),
  }).strict(),
  expiresAfter: z.number().int().positive().optional(),
}).strict()

const PerpRequestSchema = z.object({
  guard: PerpGuardSchema,
  order: PerpOrderSchema,
}).strict().superRefine((request, context) => {
  const order = request.order.action.orders[0]
  if (!order) return
  const expectedBuy = request.guard.action === 'open_long'
  if (order.b !== expectedBuy) context.addIssue({ code: 'custom', path: ['order', 'action', 'orders', 0, 'b'], message: 'order side must match guard action' })
})

const SwapGuardSchema = z.object({
  profileId: z.enum([
    'base-aerodrome-slipstream-weth-usdc-cl100',
    'base-aerodrome-slipstream-usdc-usdt-cl1',
    'base-pancakeswap-v3-usdc-usdt-100',
    'bnb-pancakeswap-v3-usdt-usdc-100',
    'bnb-pancakeswap-v3-usdt-wbnb-100',
    'monad-pancakeswap-v3-wmon-usdc-500',
  ]),
  direction: z.enum(['token0-to-token1', 'token1-to-token0']).optional(),
  amountIn: z.string().regex(POSITIVE_DECIMAL).max(128),
  recipient: z.string().regex(ADDRESS),
  deadlineUnixSeconds: z.number().int().positive().optional(),
  sourceDecisionPriceUsd: z.number().finite().positive().max(1_000_000_000),
  destinationDecisionPriceUsd: z.number().finite().positive().max(1_000_000_000),
  policy: z.object({
    maxSlippageBps: z.number().int().min(0).max(1_000),
    maxPriceImpactBps: z.number().finite().min(0).max(1_000),
    maxTwapDeviationBps: z.number().finite().min(0).max(1_000),
    maxReferenceDeviationBps: z.number().int().min(0).max(1_000),
    maxQuoteAgeSeconds: z.number().int().min(1).max(120),
  }).strict(),
}).strict()

const SwapRequestSchema = z.object({
  guard: SwapGuardSchema,
}).strict()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function responseText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw new Error('UPSTREAM_TOO_LARGE')
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('UPSTREAM_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('UPSTREAM_INVALID_UTF8') }
}

function configured(env: ScenarioEnv): { apiKey: string; base: URL; registry: URL } {
  if (!env.INSIGHT_API_KEY || !env.INSIGHT_BASE_URL || !env.INSIGHT_KEY_REGISTRY_URL) throw new Error('BOT_CONFIGURATION_INCOMPLETE')
  const base = new URL(env.INSIGHT_BASE_URL)
  const registry = new URL(env.INSIGHT_KEY_REGISTRY_URL)
  if (base.protocol !== 'https:' || base.origin !== 'https://www.oracleinsight.xyz' ||
      registry.protocol !== 'https:' || registry.origin !== base.origin || registry.pathname !== '/.well-known/oracle-keys.json') {
    throw new Error('BOT_UPSTREAM_URL_INVALID')
  }
  return { apiKey: env.INSIGHT_API_KEY, base, registry }
}

async function getKeyRegistry(env: ScenarioEnv): Promise<KeyRegistry> {
  const { apiKey, registry } = configured(env)
  void apiKey
  const response = await fetch(registry, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw upstreamHttpError(response, 'KEY_REGISTRY')
  const text = await responseText(response, 64 * 1024)
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('KEY_REGISTRY_INVALID')
  return value as KeyRegistry
}

function unwrapDecision(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (value.schema === 'insight.base-agent-swap-guard-decision.v1' || value.schema === 'insight.hyperliquid-perp-guard-decision.v1') return value
  if (isRecord(value.data)) return unwrapDecision(value.data)
  if (isRecord(value.decision)) return unwrapDecision(value.decision)
  if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (isRecord(item) && typeof item.text === 'string') {
        try { return unwrapDecision(JSON.parse(item.text) as unknown) } catch { /* continue */ }
      }
    }
  }
  return null
}

export function parseScenarioPayload(raw: string): unknown {
  if (raw.length < 2 || raw.length > 3_500) throw new Error('PAYLOAD_SIZE_INVALID')
  try { return JSON.parse(raw) as unknown } catch { throw new Error('PAYLOAD_INVALID_JSON') }
}

export function preparePerpAssessmentRequest(payload: unknown, nowMs = Date.now()) {
  const parsed = PerpRequestSchema.parse(payload)
  return withPerpAssessmentExpiry(parsed, nowMs)
}

export function prepareSwapAssessmentRequest(payload: unknown, nowMs = Date.now()) {
  const parsed = SwapRequestSchema.parse(payload)
  return withSwapAssessmentDeadline(parsed, nowMs)
}

function jsonFileResult(summary: string, artifact: Record<string, unknown>) {
  return { summary, artifact }
}

function sameJson(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return canonical(left) === canonical(right)
}

/** Fail closed if a trusted signed decision is valid but for different request inputs. */
export function assertPerpDecisionMatchesRequest(
  decision: Record<string, unknown>,
  input: z.infer<typeof PerpRequestSchema>,
): void {
  const guard = isRecord(decision.guard) ? decision.guard : null
  const market = guard && isRecord(guard.market) ? guard.market : null
  const projected = guard && isRecord(guard.projected) ? guard.projected : null
  const venue = guard && isRecord(guard.venue) ? guard.venue : null
  const requestedOrder = input.order.action.orders[0]
  const decisionOrder = isRecord(decision.order) ? decision.order : null
  if (!guard || !market || !projected || !venue || !requestedOrder ||
      guard.protocolId !== input.guard.protocolId || guard.action !== input.guard.action ||
      market.assetSymbol !== input.guard.assetSymbol || market.marginAssetSymbol !== input.guard.marginAssetSymbol ||
      projected.sizeUsd !== input.guard.sizeUsd || projected.marginValueUsd !== input.guard.marginValueUsd ||
      venue.observedAssetIndex !== requestedOrder.a || !sameJson(decisionOrder, input.order)) {
    throw new Error('INSIGHT_DECISION_REQUEST_MISMATCH')
  }
}

export async function assessHyperliquidCommand(env: ScenarioEnv, payload: unknown): Promise<{ summary: string; artifact: Record<string, unknown> }> {
  const input = preparePerpAssessmentRequest(payload)
  const { apiKey, base } = configured(env)
  const response = await fetch(new URL('/api/v1/safety/hyperliquid-perp-guard', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': apiKey, accept: 'application/json' },
    body: JSON.stringify({ guard: input.guard, order: input.order }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw upstreamHttpError(response)
  const body: unknown = JSON.parse(await responseText(response, MAX_RESPONSE_BYTES))
  const decision = unwrapDecision(body)
  if (!decision) throw new Error('INSIGHT_DECISION_MISSING')
  const registry = await getKeyRegistry(env)
  const verification = await verifyInsightHyperliquidPerpGuardDecision(decision, { keyRegistry: registry })
  if (!verification.valid) throw new Error(`INSIGHT_DECISION_${verification.reason}`)
  assertPerpDecisionMatchesRequest(decision, input)

  const guard = isRecord(decision.guard) ? decision.guard : null
  const model = guard && isRecord(guard.projected) ? guard.projected : null
  const evaluated = guard && typeof guard.verdict === 'string' ? guard.verdict : 'UNKNOWN'
  const safeNumber = (value: unknown, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
  const summary = [
    `Hyperliquid ${input.guard.assetSymbol} ${input.guard.action.replace('open_', '').toUpperCase()}: ${evaluated}`,
    `Declared size / margin: $${input.guard.sizeUsd.toFixed(2)} / $${input.guard.marginValueUsd.toFixed(2)}`,
    `Effective leverage: ${safeNumber(model?.effectiveLeverage)}x | liquidation buffer: ${safeNumber(model?.liquidationBufferPct)}%`,
    `Insight decision: ${verification.decisionHash} (valid until ${verification.validUntil ? new Date(verification.validUntil * 1_000).toISOString() : 'n/a'})`,
    'Read-only assessment. No authorization, wallet signature, or order submission is available in this Telegram flow.',
  ].join('\n')
  return jsonFileResult(summary, createReadOnlyScenarioArtifact('hyperliquid-perp', decision))
}

async function callInsightSwapTool(env: ScenarioEnv, args: z.infer<typeof SwapGuardSchema>): Promise<Record<string, unknown>> {
  const { apiKey, base } = configured(env)
  const response = await fetch(new URL('/api/mcp', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-API-Key': apiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'priorseal-telegram-swap', method: 'tools/call', params: { name: 'prepare_agent_swap_guard', arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw upstreamHttpError(response, 'INSIGHT_MCP')
  const text = await responseText(response, MAX_RESPONSE_BYTES)
  let rpc: unknown
  try { rpc = JSON.parse(text) as unknown } catch { throw new Error('INSIGHT_MCP_INVALID_JSON') }
  if (!isRecord(rpc) || isRecord(rpc.error) || !isRecord(rpc.result)) throw new Error('INSIGHT_MCP_CALL_FAILED')
  const result = rpc.result
  if (result.isError === true) throw new Error('INSIGHT_MCP_TOOL_FAILED')
  const decision = unwrapDecision(result)
  if (!decision) throw new Error('INSIGHT_SWAP_DECISION_MISSING')
  return decision
}

export async function assessSwapCommand(env: ScenarioEnv, payload: unknown): Promise<{ summary: string; artifact: Record<string, unknown> }> {
  const input = prepareSwapAssessmentRequest(payload)
  if (!isWithinAssessmentDeadlineWindow(input.guard.deadlineUnixSeconds * 1_000)) throw new Error('BOT_GENERATED_SWAP_DEADLINE_INVALID')
  const decision = await callInsightSwapTool(env, input.guard)
  const registry = await getKeyRegistry(env)
  const verification = await verifyInsightAgentSwapGuardDecision(decision, { keyRegistry: registry })
  if (!verification.valid) throw new Error(`INSIGHT_DECISION_${verification.reason}`)
  assertSwapDecisionMatchesRequest(decision, input)
  const guard = isRecord(decision.guard) ? decision.guard : null
  const verdict = guard && typeof guard.verdict === 'string' ? guard.verdict : 'UNKNOWN'
  const scope = guard && isRecord(guard.scope) ? guard.scope : null
  const market = guard && isRecord(guard.market) ? guard.market : null
  const exactInput = market && isRecord(market.exactInput) ? market.exactInput : null
  const summary = [
    `DEX swap ${String(scope?.profileId ?? input.guard.profileId)}: ${verdict}`,
    `Chain ID: ${String(scope?.chainId ?? 'n/a')} | Amount in: ${String(exactInput?.amountInRaw ?? 'not quoted')}`,
    `Insight decision: ${String(decision.decisionHash ?? 'n/a')} (verified through trusted key registry)`,
    'Read-only assessment. No authorization, wallet signature, or transaction submission is available in this Telegram flow.',
  ].join('\n')
  return jsonFileResult(summary, createReadOnlyScenarioArtifact('dex-swap', decision))
}
