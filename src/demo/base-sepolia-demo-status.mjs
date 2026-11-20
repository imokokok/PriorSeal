// Generated from base-sepolia-demo-status.mts by npm run core:build. Do not edit directly.
const DEMO_PATH = "/demo-api/base-sepolia/transaction";
const RPC_URLS = ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"];
const BLOCKSCOUT_API = "https://base-sepolia.blockscout.com/api/v2";
const CHAIN_ID = "0x14a34";
const TRANSACTION_HASH = "0x9d6502f4cf45e838a11208269dc2407b01c9fe56e40660f78b90465c07866523";
const EXPECTED_BLOCK_HASH = "0x3929326deb7d43dbcc2a026f01f717e0f07d830fa6fa7291f7f49c740f60d451";
const TOKEN_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RECIPIENT_ADDRESS = "0x54d4ddfD8A8C582Ae55450c573617D5bccF860F8";
const AMOUNT_BASE_UNITS = "100793";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const envelope = await response.json();
  if (!isRecord(envelope) || envelope.jsonrpc !== "2.0" || envelope.id !== 1) throw new Error("RPC_INVALID_RESPONSE");
  if ("error" in envelope) {
    const error = envelope.error;
    if (isRecord(error) && typeof error.message === "string" && /pruned history unavailable/i.test(error.message)) throw new Error("RPC_PRUNED_HISTORY");
    throw new Error("RPC_PROVIDER_ERROR");
  }
  if (!("result" in envelope)) throw new Error("RPC_INVALID_RESPONSE");
  return envelope.result;
}
async function selectRpcEndpoint() {
  for (const url of RPC_URLS) {
    try {
      const chainId = await rpc(url, "eth_chainId", []);
      if (typeof chainId === "string" && chainId.toLowerCase() === CHAIN_ID) return url;
    } catch {
    }
  }
  throw new Error("RPC_UNAVAILABLE");
}
async function blockscout(path) {
  const response = await fetch(`${BLOCKSCOUT_API}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error("INDEXER_UNAVAILABLE");
  const body = await response.json();
  if (!isRecord(body)) throw new Error("INDEXER_INVALID_RESPONSE");
  return body;
}
function blockscoutTransferMatches(transaction) {
  if (!Array.isArray(transaction.token_transfers)) return false;
  const matches = transaction.token_transfers.filter((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.token) || !isRecord(candidate.to) || !isRecord(candidate.from) || !isRecord(candidate.total)) return false;
    return typeof candidate.token.address_hash === "string" && candidate.token.address_hash.toLowerCase() === TOKEN_ADDRESS.toLowerCase() && typeof candidate.to.hash === "string" && candidate.to.hash.toLowerCase() === RECIPIENT_ADDRESS.toLowerCase() && typeof candidate.from.hash === "string" && candidate.from.hash.toLowerCase() === "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" && typeof candidate.total.value === "string" && candidate.total.value === AMOUNT_BASE_UNITS && candidate.token.decimals === "6";
  });
  return matches.length === 1;
}
async function readFromBlockscout() {
  const transaction = await blockscout(`/transactions/${TRANSACTION_HASH}`);
  if (typeof transaction.hash !== "string" || transaction.hash.toLowerCase() !== TRANSACTION_HASH.toLowerCase()) throw new Error("INDEXER_INVALID_TRANSACTION");
  if (typeof transaction.block_number !== "number" || !Number.isSafeInteger(transaction.block_number) || transaction.block_number < 0) throw new Error("INDEXER_INVALID_BLOCK");
  if (typeof transaction.status !== "string" || !["ok", "error", "pending"].includes(transaction.status)) throw new Error("INDEXER_INVALID_STATUS");
  if (typeof transaction.confirmations !== "number" || !Number.isSafeInteger(transaction.confirmations) || transaction.confirmations < 0) throw new Error("INDEXER_INVALID_CONFIRMATIONS");
  const indexedBlock = await blockscout(`/blocks/${transaction.block_number}`);
  if (indexedBlock.height !== transaction.block_number || typeof indexedBlock.hash !== "string" || !HASH.test(indexedBlock.hash)) throw new Error("INDEXER_INVALID_BLOCK");
  const transferMatched = blockscoutTransferMatches(transaction);
  const confirmations = transaction.confirmations;
  const latestBlock = BigInt(transaction.block_number) + BigInt(Math.max(confirmations - 1, 0));
  const canonical = transaction.status !== "pending" && indexedBlock.hash.toLowerCase() === EXPECTED_BLOCK_HASH.toLowerCase();
  const state = transaction.status === "pending" ? "PENDING" : transaction.status === "error" ? "FAILED" : !canonical ? "REORGED" : transferMatched ? "CONFIRMED" : "INCONSISTENT";
  return {
    schema: "priorseal.transaction-recovery-demo-status.v1",
    state,
    chainId: 84532,
    transactionHash: TRANSACTION_HASH,
    blockNumber: String(transaction.block_number),
    blockHash: indexedBlock.hash,
    confirmations,
    latestBlock: latestBlock.toString(),
    canonical,
    receiptStatus: transaction.status === "ok" ? "0x1" : transaction.status === "error" ? "0x0" : void 0,
    tokenAddress: TOKEN_ADDRESS,
    recipientAddress: RECIPIENT_ADDRESS,
    amountBaseUnits: AMOUNT_BASE_UNITS,
    transferMatched,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "base-sepolia-blockscout-index"
  };
}
function asHex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(value)) throw new Error(`RPC_INVALID_${label}`);
  return value;
}
function asBlock(value) {
  if (!isRecord(value) || typeof value.number !== "string" || !/^0x[0-9a-f]+$/i.test(value.number) || typeof value.hash !== "string" || !HASH.test(value.hash)) throw new Error("RPC_INVALID_BLOCK");
  return { number: BigInt(value.number), hash: value.hash };
}
function transferMatches(receipt) {
  if (!Array.isArray(receipt.logs)) return false;
  return receipt.logs.some((candidate) => {
    if (!isRecord(candidate) || typeof candidate.address !== "string" || !ADDRESS.test(candidate.address) || candidate.address.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) return false;
    if (!Array.isArray(candidate.topics) || candidate.topics.length < 3 || typeof candidate.topics[0] !== "string" || candidate.topics[0].toLowerCase() !== TRANSFER_TOPIC) return false;
    if (typeof candidate.topics[2] !== "string" || !/^0x[0-9a-f]{64}$/i.test(candidate.topics[2]) || candidate.topics[2].slice(-40).toLowerCase() !== RECIPIENT_ADDRESS.slice(2).toLowerCase()) return false;
    if (typeof candidate.data !== "string" || !/^0x[0-9a-f]{64}$/i.test(candidate.data)) return false;
    return BigInt(candidate.data) === BigInt(AMOUNT_BASE_UNITS);
  });
}
async function readBaseSepoliaDemoStatus() {
  let rpcUrl = null;
  try {
    rpcUrl = await selectRpcEndpoint();
  } catch {
  }
  if (!rpcUrl) return readFromBlockscout();
  try {
    const status = await readRpcStatus(rpcUrl);
    return status.state === "NOT_FOUND" ? readFromBlockscout() : status;
  } catch (error) {
    if (error instanceof Error && error.message === "RPC_WRONG_CHAIN") throw error;
    return readFromBlockscout();
  }
}
async function readRpcStatus(rpcUrl) {
  const [transactionValue, receiptValue, latestBlockValue] = await Promise.all([
    rpc(rpcUrl, "eth_getTransactionByHash", [TRANSACTION_HASH]),
    rpc(rpcUrl, "eth_getTransactionReceipt", [TRANSACTION_HASH]),
    rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false])
  ]);
  const latestBlock = asBlock(latestBlockValue);
  if (transactionValue === null) {
    return { schema: "priorseal.transaction-recovery-demo-status.v1", state: "NOT_FOUND", chainId: 84532, transactionHash: TRANSACTION_HASH, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), source: "base-sepolia-json-rpc" };
  }
  if (!isRecord(transactionValue) || typeof transactionValue.hash !== "string" || transactionValue.hash.toLowerCase() !== TRANSACTION_HASH.toLowerCase()) throw new Error("RPC_INVALID_TRANSACTION");
  if (receiptValue === null) {
    return { schema: "priorseal.transaction-recovery-demo-status.v1", state: "PENDING", chainId: 84532, transactionHash: TRANSACTION_HASH, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), source: "base-sepolia-json-rpc" };
  }
  if (!isRecord(receiptValue) || typeof receiptValue.transactionHash !== "string" || receiptValue.transactionHash.toLowerCase() !== TRANSACTION_HASH.toLowerCase() || typeof receiptValue.status !== "string" || !/^0x[01]$/i.test(receiptValue.status)) throw new Error("RPC_INVALID_RECEIPT");
  const inclusion = asBlock({ number: receiptValue.blockNumber, hash: receiptValue.blockHash });
  const canonicalBlockValue = await rpc(rpcUrl, "eth_getBlockByNumber", [`0x${inclusion.number.toString(16)}`, false]);
  const canonicalBlock = asBlock(canonicalBlockValue);
  const isCanonical = canonicalBlock.hash.toLowerCase() === inclusion.hash.toLowerCase();
  const confirmations = latestBlock.number >= inclusion.number ? Number(latestBlock.number - inclusion.number + 1n) : 0;
  const transferMatched = transferMatches(receiptValue);
  let state;
  if (!isCanonical) state = "REORGED";
  else if (receiptValue.status.toLowerCase() === "0x0") state = "FAILED";
  else if (!transferMatched) state = "INCONSISTENT";
  else state = "CONFIRMED";
  return {
    schema: "priorseal.transaction-recovery-demo-status.v1",
    state,
    chainId: 84532,
    transactionHash: TRANSACTION_HASH,
    blockNumber: inclusion.number.toString(),
    blockHash: inclusion.hash,
    confirmations,
    latestBlock: latestBlock.number.toString(),
    canonical: isCanonical,
    receiptStatus: receiptValue.status.toLowerCase(),
    tokenAddress: TOKEN_ADDRESS,
    recipientAddress: RECIPIENT_ADDRESS,
    amountBaseUnits: AMOUNT_BASE_UNITS,
    transferMatched,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "base-sepolia-json-rpc"
  };
}
async function handleBaseSepoliaDemoStatusRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== DEMO_PATH) return json({ error: { code: "NOT_FOUND" } }, 404);
  if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  try {
    return json(await readBaseSepoliaDemoStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^RPC_(?:WRONG_CHAIN|INVALID_[A-Z_]+|UNAVAILABLE)$/.test(message) ? message : "RPC_UNAVAILABLE";
    return json({ error: { code, message: "Could not verify the recorded transaction against Base Sepolia." } }, 502);
  }
}
export {
  handleBaseSepoliaDemoStatusRequest,
  readBaseSepoliaDemoStatus
};
