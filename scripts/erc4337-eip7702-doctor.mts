import { keccak256, toFunctionSelector } from 'viem';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { getRpcUrls } from '../src/infrastructure/blockchain/evm/chains.mjs';
import { createRpcClient } from '../src/infrastructure/blockchain/evm/rpc-client.mjs';

const CHAIN_ID = 84532;
const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const METAMASK_STATELESS_7702 = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';
const ENTRY_POINT_GETTER = toFunctionSelector('entryPoint()');
const equal = (left: unknown, right: string) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const codeHash = (code: unknown) => typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code) && code !== '0x' ? keccak256(code as `0x${string}`).toLowerCase() : null;
const returnedAddress = (value: unknown) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? `0x${value.slice(-40)}` : null;

const config = loadRuntimeConfig();
const httpProxy = process.env.PRIORSEAL_ERC4337_HTTP_PROXY?.trim();
if (httpProxy) setGlobalDispatcher(new ProxyAgent(httpProxy));
const rpcUrls = getRpcUrls(CHAIN_ID) ?? [];
const entryPointPin = config.erc4337EntryPoints.find(entry => entry.chainId === CHAIN_ID && entry.version === '0.7' && equal(entry.address, ENTRY_POINT_V07));
const delegatePin = config.eip7702Delegates.find(entry => entry.chainId === CHAIN_ID && equal(entry.address, METAMASK_STATELESS_7702));
const result: {
  schema: string;
  checkedAt: string;
  scope: string;
  chain: { id: number; name: string };
  entryPoint: { version: '0.7'; address: string; configuredPinMatches: boolean; observedCodeHash: string | null };
  metaMaskDelegate: { address: string; configuredPinMatches: boolean; observedCodeHash: string | null; observedEntryPoint: string | null; entryPointV07Matches: boolean };
  metaMaskBrowserWallet: { upgradePath: 'EIP-5792 wallet_sendCalls'; doctorSubmitsUserOperation: false; freshAuthorizationSigningViaJsonRpcAvailable: false };
  rpcEndpoints: Record<string, unknown>[];
  bundler: { provider: string; configured: boolean; supportsEntryPointV07: boolean | null };
  readyForMetaMaskUserOperation: boolean;
  blockers: string[];
} = {
  schema: 'priorseal.erc4337-eip7702-readiness.v1',
  checkedAt: new Date().toISOString(),
  scope: 'READ_ONLY_BASE_SEPOLIA_CHECKS; DOES_NOT_CONNECT_TO_A_WALLET_SIGN_OR_SUBMIT',
  chain: { id: CHAIN_ID, name: 'Base Sepolia' },
  entryPoint: { version: '0.7', address: ENTRY_POINT_V07, configuredPinMatches: false, observedCodeHash: null },
  metaMaskDelegate: { address: METAMASK_STATELESS_7702, configuredPinMatches: false, observedCodeHash: null, observedEntryPoint: null, entryPointV07Matches: false },
  metaMaskBrowserWallet: { upgradePath: 'EIP-5792 wallet_sendCalls', doctorSubmitsUserOperation: false, freshAuthorizationSigningViaJsonRpcAvailable: false },
  rpcEndpoints: [],
  bundler: { provider: 'unconfigured', configured: false, supportsEntryPointV07: null },
  readyForMetaMaskUserOperation: false,
  blockers: [],
};

if (!entryPointPin) result.blockers.push('Configure a verified Base Sepolia EntryPoint v0.7 address and runtime-code hash in PRIORSEAL_ERC4337_ENTRY_POINTS_JSON.');
if (!delegatePin) result.blockers.push('Configure the verified MetaMask Stateless7702 delegate runtime-code hash in PRIORSEAL_EIP7702_DELEGATE_TRUST_JSON.');
if (!rpcUrls.length) result.blockers.push('PRIORSEAL_RPC_BASE_SEPOLIA is empty.');

const rpc = createRpcClient({ timeoutMs: 12_000, retries: 0 });
for (const [index, url] of rpcUrls.entries()) {
  const endpoint: {
    endpoint: number;
    chainIdMatches: boolean;
    entryPointCodeHashMatches: boolean;
    delegateCodeHashMatches: boolean;
    delegateEntryPointV07Matches: boolean;
    prestateTracer: boolean;
    ok: boolean;
    issues: string[];
  } = { endpoint: index + 1, chainIdMatches: false, entryPointCodeHashMatches: false, delegateCodeHashMatches: false, delegateEntryPointV07Matches: false, prestateTracer: false, ok: false, issues: [] };
  try {
    const chainIdHex = await rpc.call<string>(url, 'eth_chainId', []);
    endpoint.chainIdMatches = Number(BigInt(chainIdHex)) === CHAIN_ID;
    if (!endpoint.chainIdMatches) endpoint.issues.push('RPC_CHAIN_ID_MISMATCH');

    const [entryPointCode, delegateCode] = await Promise.all([
      rpc.call<string>(url, 'eth_getCode', [ENTRY_POINT_V07, 'latest']),
      rpc.call<string>(url, 'eth_getCode', [METAMASK_STATELESS_7702, 'latest']),
    ]);
    let delegateEntryPoint: string | null = null;
    if (codeHash(delegateCode)) {
      try {
        const response = await rpc.call<unknown>(url, 'eth_call', [{ to: METAMASK_STATELESS_7702, data: ENTRY_POINT_GETTER }, 'latest']);
        delegateEntryPoint = returnedAddress(response);
      } catch {
        delegateEntryPoint = null;
      }
    }
    result.entryPoint.observedCodeHash ??= codeHash(entryPointCode);
    result.metaMaskDelegate.observedCodeHash ??= codeHash(delegateCode);
    result.metaMaskDelegate.observedEntryPoint ??= delegateEntryPoint;
    result.metaMaskDelegate.entryPointV07Matches = equal(delegateEntryPoint, ENTRY_POINT_V07);
    endpoint.entryPointCodeHashMatches = Boolean(entryPointPin && codeHash(entryPointCode) === entryPointPin.codeHash.toLowerCase());
    endpoint.delegateCodeHashMatches = Boolean(delegatePin && codeHash(delegateCode) === delegatePin.codeHash.toLowerCase());
    endpoint.delegateEntryPointV07Matches = equal(delegateEntryPoint, ENTRY_POINT_V07);
    if (!codeHash(entryPointCode)) endpoint.issues.push('ENTRYPOINT_CODE_MISSING');
    else if (entryPointPin && !endpoint.entryPointCodeHashMatches) endpoint.issues.push('ENTRYPOINT_CODE_HASH_MISMATCH');
    if (!codeHash(delegateCode)) endpoint.issues.push('METAMASK_DELEGATE_CODE_MISSING');
    else if (delegatePin && !endpoint.delegateCodeHashMatches) endpoint.issues.push('METAMASK_DELEGATE_CODE_HASH_MISMATCH');
    if (!delegateEntryPoint) endpoint.issues.push('METAMASK_DELEGATE_ENTRYPOINT_UNREADABLE');
    else if (!endpoint.delegateEntryPointV07Matches) endpoint.issues.push('METAMASK_DELEGATE_ENTRYPOINT_MISMATCH');

    if (endpoint.chainIdMatches && codeHash(entryPointCode) && codeHash(delegateCode)) {
      try {
        const block = await rpc.call<Record<string, unknown>>(url, 'eth_getBlockByNumber', ['latest', true]);
        const transactions = Array.isArray(block.transactions) ? block.transactions : [];
        const transaction = transactions.find((candidate): candidate is Record<string, unknown> => candidate !== null && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).hash === 'string');
        if (transaction) {
          const prestate = await rpc.call<Record<string, unknown>>(url, 'debug_traceTransaction', [transaction.hash, { tracer: 'prestateTracer', tracerConfig: { diffMode: false } }]);
          endpoint.prestateTracer = prestate !== null && typeof prestate === 'object' && !Array.isArray(prestate) && Object.keys(prestate).some(address => /^0x[0-9a-fA-F]{40}$/.test(address));
        }
      } catch {
        endpoint.prestateTracer = false;
      }
      if (!endpoint.prestateTracer) endpoint.issues.push('PRESTATE_TRACER_UNAVAILABLE');
    }
  } catch {
    endpoint.issues.push('RPC_READ_FAILED');
  }
  endpoint.ok = endpoint.chainIdMatches && endpoint.entryPointCodeHashMatches && endpoint.delegateCodeHashMatches && endpoint.delegateEntryPointV07Matches && endpoint.prestateTracer;
  result.rpcEndpoints.push(endpoint);
}

result.entryPoint.configuredPinMatches = Boolean(entryPointPin && result.entryPoint.observedCodeHash && entryPointPin.codeHash.toLowerCase() === result.entryPoint.observedCodeHash);
result.metaMaskDelegate.configuredPinMatches = Boolean(delegatePin && result.metaMaskDelegate.observedCodeHash && delegatePin.codeHash.toLowerCase() === result.metaMaskDelegate.observedCodeHash);
if (!result.metaMaskDelegate.entryPointV07Matches) {
  result.blockers.push(result.metaMaskDelegate.observedEntryPoint
    ? 'The MetaMask Stateless7702 delegate is bound to a different EntryPoint and cannot be used for the selected v0.7 profile.'
    : 'The MetaMask Stateless7702 entryPoint() getter could not be verified for the selected v0.7 profile.');
}
if (rpcUrls.length && !result.rpcEndpoints.some(endpoint => endpoint.ok === true)) result.blockers.push('No Base Sepolia RPC passed chain identity, runtime hash, and Geth prestateTracer checks.');

const dedicatedBundlerUrl = process.env.PRIORSEAL_ERC4337_BUNDLER_BASE_SEPOLIA?.trim();
const bundlerUrls = [...new Set([...(dedicatedBundlerUrl ? [dedicatedBundlerUrl] : []), ...rpcUrls])];
for (const url of bundlerUrls) {
  try {
    const supported = await rpc.call<unknown>(url, 'eth_supportedEntryPoints', []);
    result.bundler = {
      provider: dedicatedBundlerUrl && url === dedicatedBundlerUrl ? 'dedicated Base Sepolia bundler endpoint' : 'same Base Sepolia RPC endpoint',
      configured: true,
      supportsEntryPointV07: Array.isArray(supported) && supported.some(address => equal(address, ENTRY_POINT_V07)),
    };
    if (result.bundler.supportsEntryPointV07) break;
  } catch {
    // The RPC may not expose ERC-4337 bundler methods.
  }
}
if (!result.bundler.configured && bundlerUrls.length) {
  result.bundler = {
    provider: dedicatedBundlerUrl ? 'dedicated Base Sepolia bundler endpoint' : 'same Base Sepolia RPC endpoint',
    configured: true,
    supportsEntryPointV07: false,
  };
}
if (!result.bundler.supportsEntryPointV07 && process.env.PIMLICO_API_KEY?.trim()) {
  try {
    const apiKey = process.env.PIMLICO_API_KEY.trim();
    const supported = await rpc.call<unknown>(`https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${encodeURIComponent(apiKey)}`, 'eth_supportedEntryPoints', []);
    result.bundler = { provider: 'Pimlico', configured: true, supportsEntryPointV07: Array.isArray(supported) && supported.some(address => equal(address, ENTRY_POINT_V07)) };
  } catch {
    result.bundler = { provider: 'Pimlico', configured: true, supportsEntryPointV07: false };
  }
}
if (!result.bundler.supportsEntryPointV07) result.blockers.push('No configured bundler confirmed EntryPoint v0.7 support on Base Sepolia.');

result.readyForMetaMaskUserOperation = Boolean(
  result.entryPoint.configuredPinMatches
  && result.metaMaskDelegate.configuredPinMatches
  && result.metaMaskDelegate.entryPointV07Matches
  && result.rpcEndpoints.some(endpoint => endpoint.ok === true)
  && result.bundler.supportsEntryPointV07,
);
if (result.readyForMetaMaskUserOperation) result.blockers.push('A wallet must already be delegated to the pinned MetaMask implementation; account state, test ETH balance, and the exact UserOperation fee still require a wallet-connected preflight.');

console.log(JSON.stringify(result, null, 2));
if (!result.readyForMetaMaskUserOperation) process.exitCode = 1;
