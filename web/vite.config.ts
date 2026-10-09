import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PILOT_ENTRY_POINT, PILOT_USER_OPERATION_EVENT_TOPIC } from './src/lib/erc4337-profile'

const sdkPackage = JSON.parse(readFileSync(new URL('../sdk/package.json', import.meta.url), 'utf8')) as { version: string }
const localApiTarget = process.env.PRIORSEAL_LOCAL_API_URL?.trim() || 'http://127.0.0.1:3000'

const rpcMethods = new Set(['eth_chainId', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_getBlockByNumber', 'eth_getLogs'])
const bundlerMethods = new Set(['eth_chainId', 'eth_supportedEntryPoints', 'eth_estimateUserOperationGas', 'eth_sendUserOperation', 'eth_getUserOperationByHash', 'eth_getUserOperationReceipt'])
const hashPattern = /^0x[0-9a-f]{64}$/i
const blockNumberPattern = /^0x[0-9a-f]+$/i

function isPilotUserOperationEventQuery(params: unknown[]) {
  if (params.length !== 1 || !params[0] || typeof params[0] !== 'object' || Array.isArray(params[0])) return false
  const filter = params[0] as Record<string, unknown>
  const allowedKeys = new Set(['address', 'topics', 'fromBlock', 'toBlock'])
  if (Object.keys(filter).some((key) => !allowedKeys.has(key))
    || typeof filter.address !== 'string'
    || filter.address.toLowerCase() !== PILOT_ENTRY_POINT.toLowerCase()
    || !Array.isArray(filter.topics)
    || filter.topics.length !== 2
    || typeof filter.topics[0] !== 'string'
    || filter.topics[0].toLowerCase() !== PILOT_USER_OPERATION_EVENT_TOPIC.toLowerCase()
    || typeof filter.topics[1] !== 'string'
    || !hashPattern.test(filter.topics[1])
    || typeof filter.fromBlock !== 'string'
    || !blockNumberPattern.test(filter.fromBlock)
    || typeof filter.toBlock !== 'string'
    || !blockNumberPattern.test(filter.toBlock)) return false
  try {
    const fromBlock = BigInt(filter.fromBlock)
    const toBlock = BigInt(filter.toBlock)
    return toBlock >= fromBlock && toBlock - fromBlock < 10_000n
  } catch {
    return false
  }
}

function writeRpcError(response: ServerResponse, id: unknown, status: number, code: number, message: string) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify({ jsonrpc: '2.0', id: typeof id === 'string' || typeof id === 'number' ? id : null, error: { code, message } }))
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > 200_000) throw new Error('body-too-large')
    chunks.push(data)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function localSafe4337RpcProxy(): Plugin {
  const proxyUrl = process.env.PRIORSEAL_ERC4337_HTTP_PROXY?.trim()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  const routes = new Map([
    ['/__priorseal_rpc', { endpoint: process.env.PRIORSEAL_RPC_BASE_SEPOLIA?.trim(), methods: rpcMethods }],
    ['/__priorseal_bundler', { endpoint: process.env.PRIORSEAL_ERC4337_BUNDLER_BASE_SEPOLIA?.trim(), methods: bundlerMethods }],
  ])
  return {
    name: 'priorseal-local-safe4337-rpc-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const route = routes.get(pathname)
        if (!route) { next(); return }
        void (async () => {
          if (request.method !== 'POST') { writeRpcError(response, null, 405, -32600, 'POST required'); return }
          if (!route.endpoint) { writeRpcError(response, null, 503, -32000, 'Provider is not configured for this local pilot'); return }
          let id: unknown = null
          try {
            const raw = await requestBody(request)
            const parsed: unknown = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { writeRpcError(response, null, 400, -32600, 'Invalid JSON-RPC request'); return }
            const input = parsed as Record<string, unknown>
            id = typeof input.id === 'string' || typeof input.id === 'number' ? input.id : 1
            const params = input.params === undefined ? [] : input.params
            if ((input.jsonrpc !== undefined && input.jsonrpc !== '2.0') || typeof input.method !== 'string' || !route.methods.has(input.method) || !Array.isArray(params)) { writeRpcError(response, id, 400, -32600, 'Unsupported JSON-RPC request'); return }
            if (input.method === 'eth_getLogs' && !isPilotUserOperationEventQuery(params)) { writeRpcError(response, id, 400, -32600, 'Unsupported JSON-RPC request'); return }
            const normalizedRequest = JSON.stringify({ jsonrpc: '2.0', id, method: input.method, params })
            const upstream = await undiciFetch(route.endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: normalizedRequest,
              signal: AbortSignal.timeout(15_000),
              ...(dispatcher ? { dispatcher } : {}),
            })
            const envelope: unknown = await upstream.json()
            if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) { writeRpcError(response, id, 502, -32000, 'Provider returned an invalid response'); return }
            const output = envelope as Record<string, unknown>
            if (output.jsonrpc !== '2.0' || output.id !== id || ('error' in output) === ('result' in output)) { writeRpcError(response, id, 502, -32000, 'Provider returned an invalid response'); return }
            if ('error' in output) {
              const error = output.error && typeof output.error === 'object' && !Array.isArray(output.error) ? output.error as Record<string, unknown> : {}
              writeRpcError(response, id, 200, Number.isInteger(error.code) ? Number(error.code) : -32000, 'Upstream RPC request failed')
              return
            }
            response.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            response.end(JSON.stringify({ jsonrpc: '2.0', id, result: output.result }))
          } catch (error) {
            const message = error instanceof Error && error.message === 'body-too-large' ? 'Request is too large' : 'Local RPC proxy could not reach the provider'
            writeRpcError(response, id, message === 'Request is too large' ? 413 : 502, -32000, message)
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localSafe4337RpcProxy()],
  resolve: {
    alias: [{ find: /^buffer$/, replacement: fileURLToPath(new URL('./src/shims/buffer.ts', import.meta.url)) }],
  },
  define: {
    __PRIORSEAL_SDK_VERSION__: JSON.stringify(sdkPackage.version),
  },
  server: {
    proxy: {
      '/health': localApiTarget,
      '/v1': localApiTarget,
      '/.well-known': localApiTarget,
    }
  }
})
