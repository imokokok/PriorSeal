import { RunProofError } from '../../core/errors.mjs';

function rpcError(code, message) { return new RunProofError(code, message); }
export function createRpcClient({ fetchImpl = fetch, timeoutMs = 10_000, retries = 1, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), metrics = null } = {}) {
  return {
    async call(url, method, params, signal) {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); const started = Date.now();
        try {
          const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
          if (!response.ok) throw rpcError('RPC_HTTP_ERROR', `RPC endpoint returned HTTP ${response.status}`);
          const body = await response.json(); if (!body || body.jsonrpc !== '2.0' || body.id !== 1) throw rpcError('RPC_INVALID_RESPONSE', 'RPC endpoint returned an invalid JSON-RPC envelope');
          if (body.error) throw rpcError('RPC_REMOTE_ERROR', 'RPC endpoint returned an error');
          metrics?.timing?.('runproof_rpc_latency_ms', Date.now() - started, { method, outcome: 'ok' }); return body.result;
        } catch (error) { lastError = error; metrics?.increment?.('runproof_rpc_errors_total', { method, code: error.code ?? 'RPC_FAILURE' }); if (signal?.aborted) throw rpcError('REQUEST_ABORTED', 'Request was aborted'); if (controller.signal.aborted) lastError = rpcError('RPC_TIMEOUT', 'RPC endpoint timed out'); if (attempt < retries) await sleep(Math.min(100 * 2 ** attempt, 1_000)); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      }
      throw lastError instanceof RunProofError ? lastError : rpcError('RPC_FAILURE', 'RPC endpoint failed');
    },
  };
}
