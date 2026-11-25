import { z } from 'zod'
import {
  buildAgentSwapGuardBoundIntents,
  agentSwapGuardIntentAsset,
  verifyInsightAgentSwapGuardDecision,
} from '../../sdk/src/insight-base-agent-swap-guard.js'
import {
  buildHyperliquidPerpGuardBoundIntent,
  verifyInsightHyperliquidPerpGuardDecision,
} from '../../sdk/src/insight-hyperliquid-perp-guard.js'
import type { KeyRegistry } from 'verify-insight-receipt'

type ScenarioEnv = {
  INSIGHT_API_KEY?: string
  INSIGHT_BASE_URL?: string
  INSIGHT_KEY_REGISTRY_URL?: string
}

const ADDRESS = /^0x[\da-f]{40}$/i
const CLOID = /^0x[\da-f]{32}$/i
const HEX = /^0x(?:[\da-f]{2})*$/i
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
  expiresAfter: z.number().int().positive(),
}).strict()

const PerpRequestSchema = z.object({
  account: z.string().regex(ADDRESS),
  guard: PerpGuardSchema,
  order: PerpOrderSchema,
}).strict().superRefine((request, context) => {
  const order = request.order.action.orders[0]
  if (!order) return
  const expectedBuy = request.guard.action === 'open_long'
  if (order.b !== expectedBuy) context.addIssue({ code: 'custom', path: ['order', 'action', 'orders', 0, 'b'], message: 'order side must match guard action' })
  if (request.guard.assetSymbol !== 'BTC' && request.guard.assetSymbol !== 'ETH') return
  if (request.order.expiresAfter <= Date.now() + 5_000 || request.order.expiresAfter > Date.now() + 120_000) {
    context.addIssue({ code: 'custom', path: ['order', 'expiresAfter'], message: 'expiry must be 5 to 120 seconds in the future' })
  }
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
  deadlineUnixSeconds: z.number().int().positive(),
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
  approvalNonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
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
  if (!response.ok) throw new Error(`KEY_REGISTRY_HTTP_${response.status}`)
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

function amountToEightDecimals(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > 8) throw new Error('ORDER_SIZE_PRECISION_UNSUPPORTED')
  const raw = `${whole}${fraction.padEnd(8, '0')}`.replace(/^0+(?=\d)/, '')
  if (!/^[1-9]\d*$/.test(raw)) throw new Error('ORDER_SIZE_INVALID')
  return raw
}

function intentId(prefix: string, suffix: string): string {
  return `${prefix}-${suffix.replace(/^0x/i, '').toLowerCase()}`
}

function jsonFileResult(summary: string, artifact: Record<string, unknown>) {
  return { summary, artifact }
}

export async function assessHyperliquidCommand(env: ScenarioEnv, payload: unknown): Promise<{ summary: string; artifact: Record<string, unknown> }> {
  const input = PerpRequestSchema.parse(payload)
  const { apiKey, base } = configured(env)
  const response = await fetch(new URL('/api/v1/safety/hyperliquid-perp-guard', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': apiKey, accept: 'application/json' },
    body: JSON.stringify({ guard: input.guard, order: input.order }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`INSIGHT_HTTP_${response.status}`)
  const body: unknown = JSON.parse(await responseText(response, MAX_RESPONSE_BYTES))
  const decision = unwrapDecision(body)
  if (!decision) throw new Error('INSIGHT_DECISION_MISSING')
  const registry = await getKeyRegistry(env)
  const verification = await verifyInsightHyperliquidPerpGuardDecision(decision, { keyRegistry: registry })
  if (!verification.valid) throw new Error(`INSIGHT_DECISION_${verification.reason}`)

  const guard = isRecord(decision.guard) ? decision.guard : null
  const model = guard && isRecord(guard.projected) ? guard.projected : null
  const order = input.order.action.orders[0]!
  const evaluated = guard && typeof guard.verdict === 'string' ? guard.verdict : 'UNKNOWN'
  let intent: unknown = null
  if (evaluated === 'ALLOW') {
    intent = await buildHyperliquidPerpGuardBoundIntent({
      intentId: intentId('hyperliquid-perp', order.c),
      account: input.account,
      amount: amountToEightDecimals(order.s),
      nonce: Date.now(),
      validUntil: Math.floor(input.order.expiresAfter / 1_000),
    }, decision, { keyRegistry: registry })
  }
  const safeNumber = (value: unknown, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
  const summary = [
    `Hyperliquid ${input.guard.assetSymbol} ${input.guard.action.replace('open_', '').toUpperCase()}: ${evaluated}`,
    `Declared size / margin: $${input.guard.sizeUsd.toFixed(2)} / $${input.guard.marginValueUsd.toFixed(2)}`,
    `Effective leverage: ${safeNumber(model?.effectiveLeverage)}x | liquidation buffer: ${safeNumber(model?.liquidationBufferPct)}%`,
    `PriorSeal intent: ${intent ? 'prepared and bound to the exact IOC order' : 'not created because verdict is not ALLOW'}`,
    `Insight decision: ${verification.decisionHash} (valid until ${verification.validUntil ? new Date(verification.validUntil * 1_000).toISOString() : 'n/a'})`,
    'No exchange signature, authorization, or order submission was made. The bot only returned this assessment summary.',
  ].join('\n')
  return jsonFileResult(summary, { scenario: 'hyperliquid-perp', insightDecision: decision, priorSealIntent: intent, transactionAuthority: 'none' })
}

async function callInsightSwapTool(env: ScenarioEnv, args: z.infer<typeof SwapGuardSchema>): Promise<Record<string, unknown>> {
  const { apiKey, base } = configured(env)
  const response = await fetch(new URL('/api/mcp', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-API-Key': apiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'priorseal-telegram-swap', method: 'tools/call', params: { name: 'prepare_agent_swap_guard', arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`INSIGHT_MCP_HTTP_${response.status}`)
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
  const input = SwapRequestSchema.parse(payload)
  const now = Math.floor(Date.now() / 1_000)
  if (input.guard.deadlineUnixSeconds <= now || input.guard.deadlineUnixSeconds > now + 120) throw new Error('SWAP_DEADLINE_MUST_BE_WITHIN_120_SECONDS')
  const decision = await callInsightSwapTool(env, input.guard)
  const registry = await getKeyRegistry(env)
  const verification = await verifyInsightAgentSwapGuardDecision(decision, { keyRegistry: registry })
  if (!verification.valid) throw new Error(`INSIGHT_DECISION_${verification.reason}`)
  const guard = isRecord(decision.guard) ? decision.guard : null
  const verdict = guard && typeof guard.verdict === 'string' ? guard.verdict : 'UNKNOWN'
  let intents: unknown = null
  if (verdict === 'ALLOW') {
    if (!guard || !isRecord(guard.binding) || !isRecord(guard.transactionsToSign) || !isRecord(guard.transactionsToSign.approval) || !isRecord(guard.transactionsToSign.swap) || typeof guard.binding.chainId !== 'number' || typeof guard.binding.recipient !== 'string' || typeof guard.binding.approval !== 'object' || !guard.binding.approval || typeof guard.binding.approval.amountRaw !== 'string' || typeof guard.binding.approval.token !== 'string' || !isRecord(decision.attestation) || !isRecord(decision.attestation.data) || typeof decision.attestation.data.validUntil !== 'number') {
      throw new Error('INSIGHT_SWAP_BINDING_MISSING')
    }
    const validUntil = Math.min(decision.attestation.data.validUntil, now + 120)
    const chainId = guard.binding.chainId
    const sender = guard.binding.recipient
    const asset = agentSwapGuardIntentAsset(guard.binding.approval.token, chainId)
    const amount = guard.binding.approval.amountRaw
    const approvalTx = guard.transactionsToSign.approval
    const swapTx = guard.transactionsToSign.swap
    if (typeof approvalTx.to !== 'string' || typeof approvalTx.value !== 'string' || typeof approvalTx.data !== 'string' || typeof swapTx.to !== 'string' || typeof swapTx.value !== 'string' || typeof swapTx.data !== 'string' || !HEX.test(approvalTx.data) || !HEX.test(swapTx.data)) throw new Error('INSIGHT_SWAP_CALLS_MALFORMED')
    intents = await buildAgentSwapGuardBoundIntents({
      approval: {
        intentId: intentId('swap-approval', decision.decisionHash as string), asset, amount, validUntil,
        transaction: { chainId, from: sender, to: approvalTx.to, data: approvalTx.data as `0x${string}`, value: approvalTx.value, nonce: input.approvalNonce },
      },
      swap: {
        intentId: intentId('swap-execution', decision.decisionHash as string), asset, amount, validUntil,
        transaction: { chainId, from: sender, to: swapTx.to, data: swapTx.data as `0x${string}`, value: swapTx.value, nonce: input.approvalNonce + 1 },
      },
    }, decision, { keyRegistry: registry })
  }
  const scope = guard && isRecord(guard.scope) ? guard.scope : null
  const market = guard && isRecord(guard.market) ? guard.market : null
  const exactInput = market && isRecord(market.exactInput) ? market.exactInput : null
  const summary = [
    `DEX swap ${String(scope?.profileId ?? input.guard.profileId)}: ${verdict}`,
    `Chain ID: ${String(scope?.chainId ?? 'n/a')} | Amount in: ${String(exactInput?.amountInRaw ?? 'not quoted')}`,
    `PriorSeal intents: ${intents ? 'separate approval and swap calls bound to the exact signed decision' : 'not created because verdict is not ALLOW'}`,
    `Insight decision: ${String(decision.decisionHash ?? 'n/a')} (verified through trusted key registry)`,
    'No wallet signature or transaction submission was made. The bot only returned this assessment summary.',
  ].join('\n')
  return jsonFileResult(summary, { scenario: 'dex-swap', insightDecision: decision, priorSealIntents: intents, transactionAuthority: 'none' })
}
