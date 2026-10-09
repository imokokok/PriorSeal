import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi } from 'viem';
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { getRpcUrls } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';

const CHAIN_ID = 84532;
const SAFE = '0xDBad58d4340E1CF5ADec9aF02E494EE9f9174C0f';
const OWNER = '0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC';
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const MODULE = '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226';
const ENTRY_POINT_HASH = '0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58';
const MODULE_HASH = '0x2aea997c4e3cf0e2f333025372e219abcfde81c21fc2f8fb066414a5685dd3e0';
const SAFE_PROXY_HASH = '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c';
const SAFE_SINGLETON_HASH = '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff';
const SAFE_FALLBACK_HANDLER_SLOT = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';
const MODULE_ABI = parseAbi(['function SUPPORTED_ENTRYPOINT() view returns (address)']);
const SAFE_ABI = parseAbi(['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)']);
const equal = (left: unknown, right: string) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const codeHash = (code: string) => code === '0x' ? null : keccak256(code as `0x${string}`).toLowerCase();
const storageAddress = (word: string) => /^0x[0-9a-fA-F]{64}$/.test(word) ? `0x${word.slice(-40)}`.toLowerCase() : null;

const config = loadRuntimeConfig();
const rpcUrls = getRpcUrls(CHAIN_ID) ?? [];
const entryPointPin = config.erc4337EntryPoints.find((entry) => entry.chainId === CHAIN_ID && entry.version === '0.7' && equal(entry.address, ENTRY_POINT));
const safePin = config.safe4337Trust.find((entry) => entry.chainId === CHAIN_ID && entry.version === '0.7' && equal(entry.entryPointAddress, ENTRY_POINT) && equal(entry.moduleAddress, MODULE));
const expectedPinsMatch = Boolean(entryPointPin && safePin
  && equal(entryPointPin.codeHash, ENTRY_POINT_HASH)
  && equal(safePin.moduleCodeHash, MODULE_HASH)
  && equal(safePin.safeProxyCodeHash, SAFE_PROXY_HASH)
  && equal(safePin.safeSingletonCodeHash, SAFE_SINGLETON_HASH));
const result: {
  schema: string;
  checkedAt: string;
  scope: string;
  chain: { id: number; name: string };
  safe: { address: string; funded: boolean | null; balanceWei?: string; singleton?: string; ownerMatches?: boolean; threshold?: string; moduleEnabled?: boolean; fallbackHandler?: string };
  trustPinsMatch: boolean;
  rpcEndpoints: Record<string, unknown>[];
  bundler: { provider: string; configured: boolean; supportsEntryPoint: boolean | null };
  readyForSafeObservation: boolean;
  submissionPrerequisitesPassed: boolean;
  blockers: string[];
} = {
  schema: 'priorseal.erc4337-pilot-readiness.v1',
  checkedAt: new Date().toISOString(),
  scope: 'READ_ONLY_CHAIN_AND_PROVIDER_CHECKS; DOES_NOT_SIGN_OR_SUBMIT_TRANSACTIONS',
  chain: { id: CHAIN_ID, name: 'Base Sepolia' },
  safe: { address: SAFE, funded: null },
  trustPinsMatch: expectedPinsMatch,
  rpcEndpoints: [],
  bundler: { provider: 'unconfigured', configured: false, supportsEntryPoint: null },
  readyForSafeObservation: false,
  submissionPrerequisitesPassed: false,
  blockers: [],
};

if (!expectedPinsMatch) result.blockers.push('Local EntryPoint/Safe trust pins are missing or do not match the verified Base Sepolia v0.7 deployments.');
if (rpcUrls.length === 0) result.blockers.push('PRIORSEAL_RPC_BASE_SEPOLIA is empty; configure a Base Sepolia RPC that supports debug_traceTransaction with Geth prestateTracer.');

const rpc = createRpcClient({ timeoutMs: 15_000, retries: 0 });
for (const [index, url] of rpcUrls.entries()) {
  const endpoint: { endpoint: number; chainIdMatches: boolean; trustMatches: boolean; safeModuleReady: boolean; funded: boolean; prestateTracer: boolean; ok: boolean; issues: string[] } = { endpoint: index + 1, chainIdMatches: false, trustMatches: false, safeModuleReady: false, funded: false, prestateTracer: false, ok: false, issues: [] };
  const issues = endpoint.issues;
  try {
    const chainIdHex = await rpc.call<string>(url, 'eth_chainId', []);
    endpoint.chainIdMatches = Number(BigInt(chainIdHex)) === CHAIN_ID;
    if (!endpoint.chainIdMatches) issues.push('RPC_CHAIN_ID_MISMATCH');

    const [entryPointCode, moduleCode, safeCode, safeBalance, singletonWord, fallbackWord, ownersData, thresholdData] = await Promise.all([
      rpc.call<string>(url, 'eth_getCode', [ENTRY_POINT, 'latest']),
      rpc.call<string>(url, 'eth_getCode', [MODULE, 'latest']),
      rpc.call<string>(url, 'eth_getCode', [SAFE, 'latest']),
      rpc.call<string>(url, 'eth_getBalance', [SAFE, 'latest']),
      rpc.call<string>(url, 'eth_getStorageAt', [SAFE, '0x0', 'latest']),
      rpc.call<string>(url, 'eth_getStorageAt', [SAFE, SAFE_FALLBACK_HANDLER_SLOT, 'latest']),
      rpc.call<`0x${string}`>(url, 'eth_call', [{ to: SAFE, data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'getOwners' }) }, 'latest']),
      rpc.call<`0x${string}`>(url, 'eth_call', [{ to: SAFE, data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'getThreshold' }) }, 'latest']),
    ]);
    const singleton = storageAddress(singletonWord);
    endpoint.trustMatches = codeHash(entryPointCode) === ENTRY_POINT_HASH
      && codeHash(moduleCode) === MODULE_HASH
      && codeHash(safeCode) === SAFE_PROXY_HASH
      && equal(singleton, '0x29fcb43b46531Bca003ddc8FCB67FFE91900C762');
    if (!endpoint.trustMatches) issues.push('ONCHAIN_CODE_OR_SINGLETON_MISMATCH');
    const singletonCode = singleton ? await rpc.call<string>(url, 'eth_getCode', [singleton, 'latest']) : '0x';
    if (codeHash(singletonCode) !== SAFE_SINGLETON_HASH) {
      endpoint.trustMatches = false;
      issues.push('SAFE_SINGLETON_CODE_HASH_MISMATCH');
    }

    const moduleSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [MODULE, 1n]));
    const enabledWord = await rpc.call<string>(url, 'eth_getStorageAt', [SAFE, moduleSlot, 'latest']);
    const supportedData = encodeFunctionData({ abi: MODULE_ABI, functionName: 'SUPPORTED_ENTRYPOINT' });
    const supportedResult = await rpc.call<`0x${string}`>(url, 'eth_call', [{ to: MODULE, data: supportedData }, 'latest']);
    const supportedEntryPoint = decodeFunctionResult({ abi: MODULE_ABI, functionName: 'SUPPORTED_ENTRYPOINT', data: supportedResult });
    const owners = decodeFunctionResult({ abi: SAFE_ABI, functionName: 'getOwners', data: ownersData });
    const threshold = decodeFunctionResult({ abi: SAFE_ABI, functionName: 'getThreshold', data: thresholdData });
    const ownerMatches = Array.isArray(owners) && owners.length === 1 && equal(owners[0], OWNER) && BigInt(String(threshold)) === 1n;
    if (!ownerMatches) issues.push('SAFE_OWNER_OR_THRESHOLD_MISMATCH');
    const fallbackHandler = storageAddress(fallbackWord);
    const moduleEnabled = Boolean(storageAddress(enabledWord) && storageAddress(enabledWord) !== `0x${'0'.repeat(40)}`);
    endpoint.safeModuleReady = ownerMatches && moduleEnabled && equal(fallbackHandler, MODULE) && equal(supportedEntryPoint, ENTRY_POINT);
    if (!moduleEnabled) issues.push('SAFE_4337_MODULE_NOT_ENABLED');
    if (!equal(fallbackHandler, MODULE)) issues.push('SAFE_FALLBACK_HANDLER_MISMATCH');
    if (!equal(supportedEntryPoint, ENTRY_POINT)) issues.push('MODULE_ENTRY_POINT_MISMATCH');

    const balanceWei = BigInt(safeBalance).toString(10);
    endpoint.funded = BigInt(balanceWei) > 0n;
    if (!endpoint.funded) issues.push('SAFE_HAS_NO_TEST_ETH');
    result.safe = { address: SAFE, funded: endpoint.funded, balanceWei, ...(singleton ? { singleton } : {}), ownerMatches, threshold: String(threshold), moduleEnabled, fallbackHandler: fallbackHandler ?? undefined };

    if (endpoint.chainIdMatches && endpoint.trustMatches && endpoint.safeModuleReady) {
      const block = await rpc.call<Record<string, unknown>>(url, 'eth_getBlockByNumber', ['latest', true]);
      const transactions = Array.isArray(block.transactions) ? block.transactions : [];
      const transaction = transactions.find((candidate): candidate is Record<string, unknown> => candidate !== null && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).hash === 'string');
      if (!transaction) issues.push('NO_RECENT_TRANSACTION_AVAILABLE_FOR_TRACE_PROBE');
      else {
        try {
          const prestate = await rpc.call<Record<string, unknown>>(url, 'debug_traceTransaction', [transaction.hash, { tracer: 'prestateTracer', tracerConfig: { diffMode: false } }]);
          endpoint.prestateTracer = prestate !== null && typeof prestate === 'object' && !Array.isArray(prestate) && Object.keys(prestate).some((address) => /^0x[0-9a-fA-F]{40}$/.test(address));
          if (!endpoint.prestateTracer) issues.push('PRESTATE_TRACER_RESPONSE_INVALID');
        } catch {
          issues.push('PRESTATE_TRACER_REQUEST_FAILED');
        }
      }
    }
  } catch {
    issues.push('RPC_READ_OR_TRACE_CHECK_FAILED');
  }
  endpoint.ok = Boolean(endpoint.chainIdMatches && endpoint.trustMatches && endpoint.safeModuleReady && endpoint.funded && endpoint.prestateTracer);
  result.rpcEndpoints.push(endpoint);
}

const readyEndpoint = result.rpcEndpoints.some((endpoint) => endpoint.ok === true);
result.readyForSafeObservation = Boolean(expectedPinsMatch && readyEndpoint);
if (!readyEndpoint && rpcUrls.length > 0) result.blockers.push('No configured Base Sepolia RPC passed chain, code, Safe setup, funding, and prestate trace checks.');

const dedicatedBundlerUrl = process.env.PRIORSEAL_ERC4337_BUNDLER_BASE_SEPOLIA?.trim();
const bundlerUrls = [...new Set([...(dedicatedBundlerUrl ? [dedicatedBundlerUrl] : []), ...rpcUrls])];
for (const url of bundlerUrls) {
  try {
    const supported = await rpc.call<unknown>(url, 'eth_supportedEntryPoints', []);
    result.bundler = {
      provider: dedicatedBundlerUrl && url === dedicatedBundlerUrl ? 'dedicated Base Sepolia bundler endpoint' : 'same Base Sepolia RPC endpoint',
      configured: true,
      supportsEntryPoint: Array.isArray(supported) && supported.some((address) => equal(address, ENTRY_POINT)),
    };
    if (result.bundler.supportsEntryPoint) break;
  } catch {
    // A standard RPC endpoint may not also expose the ERC-4337 bundler API.
  }
}

const pimlicoApiKey = process.env.PIMLICO_API_KEY?.trim();
if (!result.bundler.supportsEntryPoint && pimlicoApiKey) {
  try {
    const supported = await rpc.call<unknown>(`https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${encodeURIComponent(pimlicoApiKey)}`, 'eth_supportedEntryPoints', []);
    result.bundler = {
      provider: 'Pimlico',
      configured: true,
      supportsEntryPoint: Array.isArray(supported) && supported.some((address) => equal(address, ENTRY_POINT)),
    };
  } catch {
    result.bundler = { provider: 'Pimlico', configured: true, supportsEntryPoint: false };
  }
}
if (!result.bundler.supportsEntryPoint) result.blockers.push('No configured bundler endpoint confirmed support for EntryPoint v0.7 on Base Sepolia; use an RPC endpoint that also supports eth_supportedEntryPoints or configure PIMLICO_API_KEY.');
const readyAccountEndpoint = result.rpcEndpoints.some((endpoint) => endpoint.chainIdMatches === true && endpoint.trustMatches === true && endpoint.safeModuleReady === true && endpoint.funded === true);
result.submissionPrerequisitesPassed = Boolean(expectedPinsMatch && readyAccountEndpoint && result.bundler.supportsEntryPoint);
if (result.submissionPrerequisitesPassed) result.blockers.push('No concrete Safe UserOperation has been prepared or gas-estimated; verify its maximum native fee is below the Safe balance before wallet signing.');

console.log(JSON.stringify(result, null, 2));
if (!result.readyForSafeObservation || !result.submissionPrerequisitesPassed) process.exitCode = 1;
