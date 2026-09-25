import { errorCode } from '../../../shared/error-code.mjs';
import { PriorSealError } from '../../../domain/errors.mjs';

function rpcError(code: string, message: string) { return new PriorSealError(code, message); }
type RpcMetrics = { timing?: (name: string, duration: number, tags: Record<string, string>) => void; increment?: (name: string, tags: Record<string, string>) => void };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const data = (value: unknown): value is string => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
const optional = (value: unknown, guard: (value: unknown) => boolean): boolean => value === undefined || value === null || guard(value);

function validResult(method: string, value: unknown): boolean {
  if (method === 'eth_chainId' || method === 'eth_blockNumber') return hex(value);
  if (method === 'eth_call') return data(value);
  if (method === 'eth_getTransactionByHash') return value === null || record(value) && hash(value.hash) && hex(value.nonce) && optional(value.from, (item) => typeof item === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item)) && optional(value.to, (item) => typeof item === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item)) && optional(value.input, data) && optional(value.value, hex) && optional(value.gasPrice, hex) && optional(value.blockNumber, hex) && optional(value.blockHash, hash);
  if (method === 'eth_getTransactionReceipt') return value === null || record(value) && hex(value.status) && hex(value.blockNumber) && hex(value.gasUsed) && hash(value.blockHash) && optional(value.transactionHash, hash) && optional(value.effectiveGasPrice, hex) && (value.logs === undefined || Array.isArray(value.logs) && value.logs.every((item: unknown) => record(item) && (item.topics === undefined || Array.isArray(item.topics) && item.topics.every((topic: unknown) => typeof topic === 'string'))));
  if (method === 'eth_getBlockByHash' || method === 'eth_getBlockByNumber') return value === null || record(value) && hex(value.timestamp) && optional(value.number, hex) && optional(value.hash, hash);
  return true;
}

export function createRpcClient({ fetchImpl = fetch, timeoutMs = 10_000, retries = 1, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), metrics = null }: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<unknown>; metrics?: RpcMetrics | null } = {}) {
  return {
    async call<T = unknown>(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); const started = Date.now();
        try {
          const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
          if (!response.ok) throw rpcError('RPC_HTTP_ERROR', `RPC endpoint returned HTTP ${response.status}`);
          const body: unknown = await response.json();
          if (!record(body) || body.jsonrpc !== '2.0' || body.id !== 1 || ('error' in body) === ('result' in body)) throw rpcError('RPC_INVALID_RESPONSE', 'RPC endpoint returned an invalid JSON-RPC envelope');
          if ('error' in body) {
            if (!record(body.error) || !Number.isInteger(body.error.code) || typeof body.error.message !== 'string') throw rpcError('RPC_INVALID_RESPONSE', 'RPC endpoint returned an invalid JSON-RPC error');
            throw rpcError('RPC_REMOTE_ERROR', 'RPC endpoint returned an error');
          }
          if (!validResult(method, body.result)) throw rpcError('RPC_INVALID_RESPONSE', 'RPC endpoint returned an invalid result');
          metrics?.timing?.('priorseal_rpc_latency_ms', Date.now() - started, { method, outcome: 'ok' }); return body.result as T;
        } catch (error) { lastError = error; metrics?.increment?.('priorseal_rpc_errors_total', { method, code: errorCode(error) ?? 'RPC_FAILURE' }); if (signal?.aborted) throw rpcError('REQUEST_ABORTED', 'Request was aborted'); if (controller.signal.aborted) lastError = rpcError('RPC_TIMEOUT', 'RPC endpoint timed out'); if (attempt < retries) await sleep(Math.min(100 * 2 ** attempt, 1_000)); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      }
      throw lastError instanceof PriorSealError ? lastError : rpcError('RPC_FAILURE', 'RPC endpoint failed');
    },
  };
}
