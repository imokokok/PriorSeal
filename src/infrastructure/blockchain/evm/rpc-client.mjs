// Generated from rpc-client.mts by npm run core:build. Do not edit directly.
import { errorCode } from "../../../shared/error-code.mjs";
import { PriorSealError } from "../../../domain/errors.mjs";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hex = (value) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
const hash = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const data = (value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
const nonce = (value) => hex(value) || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optional = (value, guard) => value === void 0 || value === null || guard(value);
function rpcError(code, message) {
  return new PriorSealError(code, message);
}
function validResult(method, value) {
  if (method === "eth_chainId" || method === "eth_blockNumber") return hex(value);
  if (method === "eth_call") return data(value);
  if (method === "eth_getCode") return data(value);
  if (method === "eth_getStorageAt") return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
  if (method === "debug_traceTransaction") return record(value) && Object.entries(value).every(([account, state]) => /^0x[0-9a-fA-F]{40}$/.test(account) && record(state) && optional(state.code, data) && optional(state.balance, hex) && optional(state.nonce, nonce) && optional(state.storage, (storage) => record(storage) && Object.entries(storage).every(([slot, word]) => hash(slot) && typeof word === "string" && /^0x[0-9a-fA-F]{64}$/.test(word))));
  if (method === "eth_getTransactionByHash") return value === null || record(value) && hash(value.hash) && hex(value.nonce) && optional(value.from, (item) => typeof item === "string" && /^0x[0-9a-fA-F]{40}$/.test(item)) && optional(value.to, (item) => typeof item === "string" && /^0x[0-9a-fA-F]{40}$/.test(item)) && optional(value.input, data) && optional(value.value, hex) && optional(value.gasPrice, hex) && optional(value.blockNumber, hex) && optional(value.blockHash, hash);
  if (method === "eth_getTransactionReceipt") return value === null || record(value) && hex(value.status) && hex(value.blockNumber) && hex(value.gasUsed) && hash(value.blockHash) && optional(value.transactionHash, hash) && optional(value.effectiveGasPrice, hex) && (value.logs === void 0 || Array.isArray(value.logs) && value.logs.every((item) => record(item) && (item.topics === void 0 || Array.isArray(item.topics) && item.topics.every((topic) => typeof topic === "string"))));
  if (method === "eth_getBlockByHash" || method === "eth_getBlockByNumber") return value === null || record(value) && hex(value.timestamp) && optional(value.number, hex) && optional(value.hash, hash);
  return true;
}
function validateEnvelope(body, method) {
  if (!record(body) || body.jsonrpc !== "2.0" || body.id !== 1 || "error" in body === "result" in body) {
    throw rpcError("RPC_INVALID_RESPONSE", "RPC endpoint returned an invalid JSON-RPC envelope");
  }
  if ("error" in body) {
    if (!record(body.error) || !Number.isInteger(body.error.code) || typeof body.error.message !== "string") {
      throw rpcError("RPC_INVALID_RESPONSE", "RPC endpoint returned an invalid JSON-RPC error");
    }
    throw rpcError("RPC_REMOTE_ERROR", "RPC endpoint returned an error");
  }
  if (!validResult(method, body.result)) throw rpcError("RPC_INVALID_RESPONSE", "RPC endpoint returned an invalid result");
  return body.result;
}
function aborted() {
  return rpcError("REQUEST_ABORTED", "Request was aborted");
}
function createRpcClient({
  fetchImpl = fetch,
  timeoutMs = 1e4,
  retries = 1,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  metrics = null
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
  if (!Number.isSafeInteger(retries) || retries < 0) throw new TypeError("retries must be a non-negative integer");
  async function request(url, method, params, signal) {
    if (signal?.aborted) throw aborted();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal
      });
      if (!response.ok) throw rpcError("RPC_HTTP_ERROR", `RPC endpoint returned HTTP ${response.status}`);
      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw rpcError("RPC_INVALID_RESPONSE", "RPC endpoint returned invalid JSON");
      }
      if (signal?.aborted) throw aborted();
      if (controller.signal.aborted) throw rpcError("RPC_TIMEOUT", "RPC endpoint timed out");
      return validateEnvelope(body, method);
    } catch (error) {
      if (signal?.aborted) throw aborted();
      if (controller.signal.aborted) throw rpcError("RPC_TIMEOUT", "RPC endpoint timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function retryDelay(ms, signal) {
    if (signal?.aborted) throw aborted();
    if (!signal) {
      await sleep(ms);
      return;
    }
    let cancel;
    const cancellation = new Promise((_resolve, reject) => {
      cancel = () => reject(aborted());
      signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      if (signal.aborted) throw aborted();
      await Promise.race([sleep(ms), cancellation]);
      if (signal.aborted) throw aborted();
    } finally {
      if (cancel) signal.removeEventListener("abort", cancel);
    }
  }
  return {
    async call(url, method, params, signal) {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const started = Date.now();
        try {
          const result = await request(url, method, params, signal);
          metrics?.timing?.("priorseal_rpc_latency_ms", Date.now() - started, { method, outcome: "ok" });
          return result;
        } catch (error) {
          lastError = error;
          metrics?.increment?.("priorseal_rpc_errors_total", { method, code: errorCode(error) ?? "RPC_FAILURE" });
          if (errorCode(error) === "REQUEST_ABORTED") throw error;
          if (attempt < retries) await retryDelay(Math.min(100 * 2 ** attempt, 1e3), signal);
        }
      }
      throw lastError instanceof PriorSealError ? lastError : rpcError("RPC_FAILURE", "RPC endpoint failed");
    }
  };
}
export {
  createRpcClient
};
