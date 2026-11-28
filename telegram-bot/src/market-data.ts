type MarketToken = { token_id: string; outcome: string }

export type MarketReference = { price: number; tickSize: number }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function arrayValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

function tokensOf(market: Record<string, unknown>): MarketToken[] | null {
  const tokens = arrayValue(market.tokens)
  if (tokens) {
    const parsed = tokens.flatMap((item): MarketToken[] => record(item) &&
      typeof item.token_id === 'string' && item.token_id.length > 0 && item.token_id.length <= 200 &&
      typeof item.outcome === 'string' ? [{ token_id: item.token_id, outcome: item.outcome }] : [])
    if (parsed.length >= 2) return parsed
  }
  const ids = arrayValue(market.clobTokenIds)
  const outcomes = arrayValue(market.outcomes)
  if (!ids || !outcomes || ids.length !== outcomes.length) return null
  const parsed = ids.flatMap((id, index): MarketToken[] => typeof id === 'string' && id.length > 0 && id.length <= 200 &&
    typeof outcomes[index] === 'string' ? [{ token_id: id, outcome: outcomes[index] as string }] : [])
  return parsed.length >= 2 ? parsed : null
}

async function getJson(url: URL, service: 'GAMMA' | 'CLOB'): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) })
  } catch { throw new Error(`POLYMARKET_${service}_UNAVAILABLE`) }
  if (!response.ok) throw new Error(`POLYMARKET_${service}_UNAVAILABLE`)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > 128 * 1024) throw new Error(`POLYMARKET_${service}_INVALID_RESPONSE`)
  if (!response.body) throw new Error(`POLYMARKET_${service}_UNAVAILABLE`)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    let part: ReadableStreamReadResult<Uint8Array>
    try { part = await reader.read() } catch { throw new Error(`POLYMARKET_${service}_UNAVAILABLE`) }
    if (part.done) break
    size += part.value.byteLength
    if (size > 128 * 1024) {
      await reader.cancel()
      throw new Error(`POLYMARKET_${service}_INVALID_RESPONSE`)
    }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error(`POLYMARKET_${service}_INVALID_RESPONSE`) }
  try { return JSON.parse(text) as unknown } catch { throw new Error(`POLYMARKET_${service}_INVALID_RESPONSE`) }
}

export async function fetchMarketReference(slug: string, side: 'up' | 'down'): Promise<MarketReference> {
  if (!/^[a-z0-9][a-z0-9_-]{1,199}$/i.test(slug)) throw new Error('POLYMARKET_MARKET_INVALID')
  const marketUrl = new URL('https://gamma-api.polymarket.com/markets')
  marketUrl.searchParams.set('slug', slug)
  const rawMarkets = await getJson(marketUrl, 'GAMMA')
  if (!Array.isArray(rawMarkets) || rawMarkets.length !== 1 || !record(rawMarkets[0])) {
    throw new Error('POLYMARKET_MARKET_UNAVAILABLE')
  }
  const market = rawMarkets[0]
  if (market.slug !== slug || market.active !== true || market.closed !== false) throw new Error('POLYMARKET_MARKET_CLOSED')
  const wanted = side === 'up' ? 'up' : 'down'
  const token = tokensOf(market)?.find((item) => item.outcome.trim().toLowerCase() === wanted)
  if (!token) throw new Error('POLYMARKET_MARKET_INVALID')

  const midpointUrl = new URL('https://clob.polymarket.com/midpoint')
  midpointUrl.searchParams.set('token_id', token.token_id)
  const tickUrl = new URL('https://clob.polymarket.com/tick-size')
  tickUrl.searchParams.set('token_id', token.token_id)
  const [midpointRaw, tickRaw] = await Promise.all([getJson(midpointUrl, 'CLOB'), getJson(tickUrl, 'CLOB')])
  const priceValue = record(midpointRaw) ? Number(midpointRaw.mid) : Number.NaN
  const tickValue = record(tickRaw) ? Number(tickRaw.minimum_tick_size) : Number.NaN
  if (!Number.isFinite(priceValue) || priceValue < 0 || priceValue > 1 ||
      !Number.isFinite(tickValue) || tickValue <= 0 || tickValue > 1) {
    throw new Error('POLYMARKET_MARKET_INVALID')
  }
  return { price: priceValue, tickSize: tickValue }
}
