import { PriorSealError } from '../../../domain/errors.mjs';
import { decodeBase58, isSolanaPublicKey, SOLANA_MAINNET_CAIP2, type SolanaTransactionMessage } from '../../../domain/solana.mjs';
import { errorCode } from '../../../shared/error-code.mjs';
import type { RpcMetrics } from '../evm/rpc-client.mjs';

const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

type RpcStatus = { slot: number; confirmations: number | null; err: unknown; confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null };
type RpcMessage = {
  header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
  accountKeys: string[];
  recentBlockhash: string;
  instructions: Array<{ programIdIndex: number; accounts: number[]; data: string }>;
  addressTableLookups?: Array<{ accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }>;
  messageVersion: 'legacy' | 'v0' | 'v1';
  transactionConfig?: { computeUnitLimit: number | null; heapSize: number | null; loadedAccountsDataSizeLimit: number | null; priorityFeeLamports: string | null };
};

export async function observeSolana({ chainId, txHash, rpcUrls, confirmations = 0, finalityRequirement, expectedTransaction, signal, fetcher = fetch, metrics = null }:
  { chainId: number; txHash: string; rpcUrls: string[]; confirmations?: number; finalityRequirement: 'CONFIRMATIONS' | 'RPC_FINALIZED'; expectedTransaction: SolanaTransactionMessage; signal?: AbortSignal; fetcher?: typeof fetch; metrics?: RpcMetrics | null }) {
  if (chainId !== 0 || expectedTransaction.network !== 'mainnet-beta' || expectedTransaction.feePayer === '') throw new PriorSealError('INVALID_SOLANA_OBSERVATION', 'Solana observer requires a mainnet-beta transaction intent');
  if (finalityRequirement === 'RPC_FINALIZED') return pending(chainId, txHash, 'RPC_FINALIZED is not enabled for this Solana profile');
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) throw new PriorSealError('RPC_UNAVAILABLE', 'No Solana RPC endpoint is configured');
  if (typeof txHash !== 'string' || decodeBase58(txHash).length !== 64) throw new PriorSealError('INVALID_TX_HASH', 'Solana transaction signature must be a 64-byte base58 value');
  let observedError: unknown;
  for (const [index, rpcUrl] of rpcUrls.entries()) {
    try {
      const context = { chain: SOLANA_MAINNET_CAIP2, operation: 'execution_observation', endpoint: String(index + 1) };
      const genesisHash = await rpc<string>(rpcUrl, 'getGenesisHash', [], fetcher, signal, metrics, context);
      if (genesisHash !== MAINNET_GENESIS_HASH) throw new PriorSealError('SOLANA_CLUSTER_MISMATCH', 'RPC endpoint is not connected to Solana mainnet-beta');
      const statusResult = asRecord(await rpc<unknown>(rpcUrl, 'getSignatureStatuses', [[txHash], { searchTransactionHistory: true }], fetcher, signal, metrics, context), 'getSignatureStatuses result');
      if (!Array.isArray(statusResult.value) || statusResult.value.length !== 1) throw new PriorSealError('RPC_INVALID_RESPONSE', 'getSignatureStatuses returned an invalid value list');
      const status = normalizeStatus(statusResult.value[0]);
      const txResult = await rpc<Record<string, unknown> | null>(rpcUrl, 'getTransaction', [txHash, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }], fetcher, signal, metrics, context);
      if (txResult === null) return { chainId, chainRef: SOLANA_MAINNET_CAIP2, txHash, status: status ? 'PENDING' : 'NOT_FOUND', blockNumber: status?.slot ?? null, blockHash: null, executedAt: null, observedAt: Math.floor(Date.now() / 1000), action: 'SOLANA_TRANSACTION', nonce: expectedTransaction.recentBlockhash, sender: expectedTransaction.feePayer, recipient: expectedTransaction.feePayer, asset: null, amount: null, transfers: [], transferMatchUnique: false, gasUsed: null, fee: null, executionDataAvailable: false, observationSource: 'solana-json-rpc', finalityState: status?.confirmationStatus ?? 'UNKNOWN', confirmations: Number(status?.confirmations ?? 0) };
      const transaction = asRecord(txResult.transaction, 'transaction');
      const messageVersion = normalizeTransactionVersion(txResult.version);
      const signatures = stringArray(transaction.signatures, 'transaction.signatures', 1, 64);
      if (!signatures.every(signature => decodeBase58(signature).length === 64)) throw new PriorSealError('RPC_INVALID_RESPONSE', 'RPC returned an invalid transaction signature');
      if (signatures[0] !== txHash) throw new PriorSealError('RPC_INVALID_RESPONSE', 'RPC transaction signature does not match the requested signature');
      const message = normalizeRpcMessage(asRecord(transaction.message, 'transaction.message'), messageVersion);
      const meta = asRecord(txResult.meta, 'meta');
      if (meta.err !== undefined && status && canonicalJson(meta.err) !== canonicalJson(status.err)) throw new PriorSealError('RPC_INVALID_RESPONSE', 'getTransaction and signature status disagree about the transaction result');
      const loaded = isRecord(meta.loadedAddresses) ? meta.loadedAddresses : { writable: [], readonly: [] };
      const actualTransaction = toIntentMessage(message, loaded);
      const slot = safeInteger(txResult.slot, 'slot');
      if (status && status.slot !== slot) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Transaction slot does not match signature status');
      const blockTime = txResult.blockTime == null ? null : safeInteger(txResult.blockTime, 'blockTime');
      const fee = decimalString(meta.fee, 'meta.fee');
      const rpcConfirmation = status?.confirmationStatus ?? null;
      const confirmed = rpcConfirmation === 'confirmed' || rpcConfirmation === 'finalized';
      const seenConfirmations = status?.confirmations === null ? 1 : Number(status?.confirmations ?? 0);
      const enoughConfirmations = confirmed && seenConfirmations >= confirmations;
      const executionStatus = enoughConfirmations ? meta.err == null ? 'CONFIRMED' : 'REVERTED' : 'PENDING';
      const block = await rpc<Record<string, unknown> | null>(rpcUrl, 'getBlock', [slot, { commitment: 'confirmed', transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 1 }], fetcher, signal, metrics, context);
      const blockHash = block === null ? null : publicKey(block.blockhash, 'block.blockhash');
      const messageMatched = canonicalJson(actualTransaction) === canonicalJson(expectedTransaction);
      return {
        chainId, chainRef: SOLANA_MAINNET_CAIP2, txHash, status: executionStatus,
        blockNumber: slot, blockHash, executedAt: blockTime, observedAt: Math.floor(Date.now() / 1000),
        action: 'SOLANA_TRANSACTION', nonce: expectedTransaction.recentBlockhash,
        sender: expectedTransaction.feePayer, recipient: expectedTransaction.feePayer,
        target: null, calldataHash: null, asset: null, amount: null, transfers: [], transferMatchUnique: false,
        nativeValue: null, tokenValue: null, gasUsed: meta.computeUnitsConsumed == null ? null : decimalString(meta.computeUnitsConsumed, 'meta.computeUnitsConsumed'),
        fee, executionDataAvailable: true, observationSource: 'solana-json-rpc',
        finalityState: confirmed ? 'CONFIRMED' : 'INSUFFICIENT_FINALITY', confirmations: Math.max(0, seenConfirmations),
        solanaTransaction: actualTransaction,
        ...(messageMatched ? {} : { complianceHint: 'SOLANA_MESSAGE_MISMATCH' }),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      observedError = error;
    }
  }
  if (observedError instanceof PriorSealError) throw observedError;
  throw new PriorSealError('RPC_UNAVAILABLE', 'All configured Solana RPC endpoints failed');
}

async function rpc<T>(url: string, method: string, params: unknown[], fetcher: typeof fetch, signal: AbortSignal | undefined, metrics: RpcMetrics | null, context: Record<string, string>): Promise<T> {
  const tags = { method, ...context };
  const started = Date.now();
  try {
    if (signal?.aborted) throw new PriorSealError('REQUEST_ABORTED', 'Request was aborted');
    const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'priorseal-solana-observer', method, params }), signal: combineSignal(signal) });
    if (!response.ok) throw new PriorSealError('RPC_HTTP_ERROR', `Solana RPC returned HTTP ${response.status} for ${method}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || body.jsonrpc !== '2.0' || body.id !== 'priorseal-solana-observer') throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned an invalid JSON-RPC envelope');
    if (body.error != null) throw new PriorSealError('RPC_CALL_FAILED', 'Solana RPC rejected the observation request');
    if (!Object.hasOwn(body, 'result')) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC response is missing result');
    metrics?.timing?.('priorseal_rpc_latency_ms', Date.now() - started, { ...tags, outcome: 'ok' });
    return body.result as T;
  } catch (error) {
    metrics?.increment?.('priorseal_rpc_errors_total', { ...tags, code: errorCode(error) ?? 'RPC_FAILURE' });
    throw error;
  }
}

function normalizeRpcMessage(value: Record<string, unknown>, messageVersion: RpcMessage['messageVersion']): RpcMessage {
  const header = asRecord(value.header, 'message.header');
  const accountKeys = stringArray(value.accountKeys, 'message.accountKeys', 1, 256).map((key, index) => publicKey(key, `message.accountKeys[${index}]`));
  const instructions = value.instructions;
  if (!Array.isArray(instructions) || instructions.length < 1 || instructions.length > 128) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned an invalid instruction list');
  const normalizedInstructions = instructions.map((entry, index) => {
    const item = asRecord(entry, `message.instructions[${index}]`);
    const accounts = numberArray(item.accounts, `message.instructions[${index}].accounts`, 256);
    if (typeof item.data !== 'string' || (item.data.length > 0 && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(item.data))) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned invalid instruction data');
    return { programIdIndex: safeInteger(item.programIdIndex, 'programIdIndex'), accounts, data: item.data };
  });
  const addressTableLookups = value.addressTableLookups == null ? [] : value.addressTableLookups;
  if (!Array.isArray(addressTableLookups) || addressTableLookups.length > 32) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned invalid address table lookups');
  let transactionConfig: RpcMessage['transactionConfig'];
  if (messageVersion === 'v1') {
    const rawConfig = asRecord(value.transactionConfig, 'message.transactionConfig');
    const configKeys = ['computeUnitLimit', 'heapSize', 'loadedAccountsDataSizeLimit', 'priorityFee'];
    if (Object.keys(rawConfig).some((key) => !configKeys.includes(key))) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned unsupported transaction config fields');
    transactionConfig = {
      computeUnitLimit: nullableU32(rawConfig.computeUnitLimit, 'transactionConfig.computeUnitLimit'),
      heapSize: nullableU32(rawConfig.heapSize, 'transactionConfig.heapSize'),
      loadedAccountsDataSizeLimit: nullableU32(rawConfig.loadedAccountsDataSizeLimit, 'transactionConfig.loadedAccountsDataSizeLimit'),
      priorityFeeLamports: rawConfig.priorityFee === null ? null : decimalString(rawConfig.priorityFee, 'transactionConfig.priorityFee'),
    };
    if (transactionConfig.computeUnitLimit === null || transactionConfig.loadedAccountsDataSizeLimit === null || addressTableLookups.length !== 0) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana v1 transaction is missing required config or uses address table lookups');
  } else if (value.transactionConfig != null) {
    throw new PriorSealError('RPC_INVALID_RESPONSE', 'Legacy and v0 messages must not contain transactionConfig');
  }
  return {
    messageVersion,
    ...(transactionConfig ? { transactionConfig } : {}),
    header: {
      numRequiredSignatures: safeInteger(header.numRequiredSignatures, 'header.numRequiredSignatures'),
      numReadonlySignedAccounts: safeInteger(header.numReadonlySignedAccounts, 'header.numReadonlySignedAccounts'),
      numReadonlyUnsignedAccounts: safeInteger(header.numReadonlyUnsignedAccounts, 'header.numReadonlyUnsignedAccounts'),
    },
    accountKeys,
    recentBlockhash: publicKey(value.recentBlockhash, 'message.recentBlockhash'),
    instructions: normalizedInstructions,
    addressTableLookups: addressTableLookups.map((entry, index) => {
      const item = asRecord(entry, `message.addressTableLookups[${index}]`);
      return { accountKey: publicKey(item.accountKey, 'lookup.accountKey'), writableIndexes: numberArray(item.writableIndexes, 'lookup.writableIndexes', 256), readonlyIndexes: numberArray(item.readonlyIndexes, 'lookup.readonlyIndexes', 256) };
    }),
  };
}

function normalizeStatus(value: unknown): RpcStatus | null {
  if (value === null) return null;
  const status = asRecord(value, 'signature status');
  if (status.confirmations !== null && (!Number.isSafeInteger(status.confirmations) || Number(status.confirmations) < 0)) throw new PriorSealError('RPC_INVALID_RESPONSE', 'signature status confirmations are invalid');
  if (status.confirmationStatus !== null && !['processed', 'confirmed', 'finalized'].includes(String(status.confirmationStatus))) throw new PriorSealError('RPC_INVALID_RESPONSE', 'signature status commitment is invalid');
  return {
    slot: safeInteger(status.slot, 'signature status slot'),
    confirmations: status.confirmations as number | null,
    err: status.err,
    confirmationStatus: status.confirmationStatus as RpcStatus['confirmationStatus'],
  };
}

function toIntentMessage(message: RpcMessage, loaded: Record<string, unknown>): SolanaTransactionMessage {
  const writable = stringArray(loaded.writable, 'meta.loadedAddresses.writable', 0, 256).map((key, index) => publicKey(key, `loadedAddresses.writable[${index}]`));
  const readonly = stringArray(loaded.readonly, 'meta.loadedAddresses.readonly', 0, 256).map((key, index) => publicKey(key, `loadedAddresses.readonly[${index}]`));
  if (message.accountKeys.length === 0) throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana message has no fee payer');
  const addressTableLookups = message.addressTableLookups ?? [];
  return {
    network: 'mainnet-beta', feePayer: message.accountKeys[0], recentBlockhash: message.recentBlockhash,
    messageVersion: message.messageVersion,
    ...(message.transactionConfig ? { transactionConfig: message.transactionConfig } : {}),
    header: message.header, accountKeys: message.accountKeys, addressTableLookups,
    loadedAddresses: { writable, readonly },
    instructions: message.instructions.map(({ programIdIndex, accounts, data }) => ({ programIdIndex, accountIndexes: accounts, data })),
  };
}

function normalizeTransactionVersion(value: unknown): RpcMessage['messageVersion'] {
  if (value === 'legacy') return 'legacy';
  if (value === 0) return 'v0';
  if (value === 1) return 'v1';
  throw new PriorSealError('RPC_INVALID_RESPONSE', 'Solana RPC returned an unsupported or missing transaction version');
}
function nullableU32(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new PriorSealError('RPC_INVALID_RESPONSE', field + ' is not a uint32 or null');
  return value;
}
function pending(chainId: number, txHash: string, message: string) {
  return { chainId, chainRef: SOLANA_MAINNET_CAIP2, txHash, status: 'PENDING', blockNumber: null, blockHash: null, executedAt: null, observedAt: Math.floor(Date.now() / 1000), action: 'SOLANA_TRANSACTION', nonce: null, sender: null, recipient: null, executionDataAvailable: false, observationSource: 'solana-json-rpc', finalityState: 'INSUFFICIENT_FINALITY', confirmations: 0, error: message };
}
function combineSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (!signal) return AbortSignal.timeout(10_000);
  return AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function asRecord(value: unknown, field: string): Record<string, unknown> { if (!isRecord(value)) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not an object`); return value; }
function publicKey(value: unknown, field: string): string { if (!isSolanaPublicKey(value)) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not a valid Solana public key`); return value; }
function safeInteger(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not a non-negative integer`); return value; }
function decimalString(value: unknown, field: string): string { if ((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'number' && !Number.isSafeInteger(value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not an unsigned integer`); return String(value); }
function stringArray(value: unknown, field: string, min: number, max: number): string[] { if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((entry) => typeof entry === 'string')) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not a valid string array`); return value as string[]; }
function numberArray(value: unknown, field: string, max: number): number[] { if (!Array.isArray(value) || value.length > max || !value.every((entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0 && entry <= 255)) throw new PriorSealError('RPC_INVALID_RESPONSE', `${field} is not a valid index array`); return value as number[]; }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
