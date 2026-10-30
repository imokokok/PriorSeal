/**
 * No-money discovery check for the Wallet MCP companion skill.
 * Requires Node 22+ and makes no wallet, paid-tool, or transaction request.
 */
const servers = [
  ['Insight', 'https://www.oracleinsight.xyz/api/mcp'],
  ['PriorSeal', 'https://priorseal.xyz/mcp'],
] as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP returned a non-object JSON response')
  return value as JsonRecord
}

async function rpc(url: string, method: string, params?: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${method}-${crypto.randomUUID()}`, method, ...(params ? { params } : {}) }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const body = record(await response.json())
  if (body.jsonrpc !== '2.0' || ('error' in body && body.error)) throw new Error(`${method} returned an MCP error`)
  return body
}

async function notifyInitialized(url: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  if (!response.ok) throw new Error(`notifications/initialized returned HTTP ${response.status}`)
}

for (const [name, url] of servers) {
  const initialized = await rpc(url, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'wallet-mcp-insight-priorseal-connection-check', version: '0.2.0' },
  })
  const result = record(initialized.result)
  const serverInfo = record(result.serverInfo)
  await notifyInitialized(url)
  const tools = await rpc(url, 'tools/list')
  console.log(`${name}: ${String(serverInfo.name)} ${String(serverInfo.version)}; free discovery reachable; tools/list completed`)
  if (!record(tools.result).tools || !Array.isArray(record(tools.result).tools)) throw new Error(`${name} did not return a tools array`)
}
