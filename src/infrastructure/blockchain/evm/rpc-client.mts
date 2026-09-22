import { errorCode } from '../../../shared/error-code.mjs';
import { PriorSealError } from '../../../domain/errors.mjs';

function rpcError(code: string, message: string) { return new PriorSealError(code, message); }
type RpcMetrics = { timing?: (name: string, duration: number, tags: Record<string, string>) => void; increment?: (name: string, tags: Record<string, string>) => void };
export function createRpcClient({ fetchImpl = fetch, timeoutMs = 10_000, retries = 1, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), metrics = null }: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<unknown>; metrics?: RpcMetrics | null } = {}) {
  return {
    async call<T = unknown>(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); const started = Date.now();
        try {
          const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
          if (!response.ok) throw rpcError('RPC_HTTP_ERROR', `RPC endpoint returned HTTP ${response.status}`);
          const body: unknown = await response.json(); if (!body || typeof body !== 'object' || !('jsonrpc' in body) || body.jsonrpc !== '2.0' || !('id' in body) || body.id !== 1) throw rpcError('RPC_INVALID_RESPONSE', 'RPC endpoint returned an invalid JSON-RPC envelope');
          const envelope = body as { error?: unknown; result?: unknown };
          if (envelope.error) throw rpcError('RPC_REMOTE_ERROR', 'RPC endpoint returned an error');
          metrics?.timing?.('priorseal_rpc_latency_ms', Date.now() - started, { method, outcome: 'ok' }); return envelope.result as T;
        } catch (error) { lastError = error; metrics?.increment?.('priorseal_rpc_errors_total', { method, code: errorCode(error) ?? 'RPC_FAILURE' }); if (signal?.aborted) throw rpcError('REQUEST_ABORTED', 'Request was aborted'); if (controller.signal.aborted) lastError = rpcError('RPC_TIMEOUT', 'RPC endpoint timed out'); if (attempt < retries) await sleep(Math.min(100 * 2 ** attempt, 1_000)); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      }
      throw lastError instanceof PriorSealError ? lastError : rpcError('RPC_FAILURE', 'RPC endpoint failed');
    },
  };
}
