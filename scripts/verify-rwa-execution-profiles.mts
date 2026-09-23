import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http, keccak256, parseAbi, type Address } from 'viem';
import type { RwaCallProfileV2, RwaInstrument } from '../sdk/src/index.js';

import * as sdk from '../sdk/dist/index.js';

const root = resolve(new URL('..', import.meta.url).pathname);
type RegistryStatus = 'SHADOW' | 'ACTIVE' | 'RETIRED';
type ExecutionProfileEntry = { symbol: string; status: RegistryStatus; tokenAddress: Address; profile: RwaCallProfileV2 };
type ExecutionRegistry = { schema: string; version: string; chainId: number; verifiedAtBlock: string; profiles: ExecutionProfileEntry[] };
type InstrumentRegistry = { entries: { issuerBinding: { symbol: string }; status: RegistryStatus; instrument: RwaInstrument; instrumentId: string }[] };

const executionRegistry = JSON.parse(
  await readFile(resolve(root, 'protocol/rwa-execution-profiles.v1.json'), 'utf8')
) as ExecutionRegistry;
assert.equal(executionRegistry.schema, 'insight.rwa-execution-profile-registry.v1');
assert.equal(executionRegistry.chainId, sdk.ROBINHOOD_RWA_SWAP_DEPLOYMENT.chainId);
assert.match(executionRegistry.verifiedAtBlock, /^(0|[1-9][0-9]*)$/);
assert.ok(Array.isArray(executionRegistry.profiles) && executionRegistry.profiles.length > 0);

let instrumentRegistry: InstrumentRegistry | null = null;
const instrumentRegistryPath = resolve(root, 'protocol/rwa-instrument-registry.v1.json');
try {
  await access(instrumentRegistryPath);
  const validator = (sdk as unknown as { validateRwaInstrumentRegistry?: (value: unknown) => InstrumentRegistry }).validateRwaInstrumentRegistry;
  if (!validator) throw new Error('Installed SDK does not expose validateRwaInstrumentRegistry');
  instrumentRegistry = validator(JSON.parse(await readFile(instrumentRegistryPath, 'utf8')));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

const seen = new Set();
for (const entry of executionRegistry.profiles) {
  assert.deepEqual(Object.keys(entry).sort(), ['profile', 'status', 'symbol', 'tokenAddress']);
  assert.match(entry.symbol, /^[A-Z][A-Z0-9.-]{0,15}$/);
  assert.ok(['SHADOW', 'ACTIVE', 'RETIRED'].includes(entry.status));
  assert.match(entry.tokenAddress, /^0x[0-9a-f]{40}$/);
  assert.ok(!seen.has(entry.symbol));
  seen.add(entry.symbol);
  sdk.rwaCallProfileId(entry.profile);
  assert.equal(entry.profile.chainId, executionRegistry.chainId);
  if (instrumentRegistry) {
    const instrument = instrumentRegistry.entries.find(
      (candidate) => candidate.issuerBinding.symbol === entry.symbol
    );
    assert.ok(instrument, 'RWA_EXECUTION_INSTRUMENT_NOT_FOUND: ' + entry.symbol);
    assert.equal(entry.status, instrument.status);
    assert.equal(entry.tokenAddress, instrument.instrument.tokenAddress);
    assert.equal(entry.profile.instrumentId, instrument.instrumentId);
  }
}

const online = process.argv.includes('--online');
if (online) {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
  const client = createPublicClient({ transport: http(rpcUrl) });
  assert.equal(await client.getChainId(), executionRegistry.chainId);
  const blockNumber = await client.getBlockNumber();
  assert.ok(blockNumber >= BigInt(executionRegistry.verifiedAtBlock));

  const codeHash = async (address: Address) => {
    const code = await client.getCode({ address });
    assert.ok(code && code !== '0x', 'RWA_EXECUTION_CODE_MISSING: ' + address);
    return keccak256(code);
  };
  const deployment = sdk.ROBINHOOD_RWA_SWAP_DEPLOYMENT;
  assert.equal(await codeHash(deployment.target), deployment.targetCodeHash);
  assert.equal(await codeHash(deployment.factory), deployment.factoryCodeHash);
  assert.equal(await codeHash(deployment.quoteToken), deployment.quoteTokenCodeHash);

  const poolAbi = parseAbi([
    'function getPool(address,address,uint24) view returns (address)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function fee() view returns (uint24)',
    'function liquidity() view returns (uint128)',
  ]);
  for (const entry of executionRegistry.profiles) {
    for (const pool of entry.profile.pools) {
      const actualPool = await client.readContract({
        address: entry.profile.factory as Address,
        abi: poolAbi,
        functionName: 'getPool',
        args: [entry.tokenAddress, entry.profile.quoteToken as Address, pool.fee],
      });
      assert.equal(actualPool.toLowerCase(), pool.address);
      const [token0, token1, fee, liquidity, actualCodeHash] = await Promise.all([
        client.readContract({
          address: pool.address as Address,
          abi: poolAbi,
          functionName: 'token0',
        }),
        client.readContract({
          address: pool.address as Address,
          abi: poolAbi,
          functionName: 'token1',
        }),
        client.readContract({
          address: pool.address as Address,
          abi: poolAbi,
          functionName: 'fee',
        }),
        client.readContract({
          address: pool.address as Address,
          abi: poolAbi,
          functionName: 'liquidity',
        }),
        codeHash(pool.address as Address),
      ]);
      assert.deepEqual(
        [token0.toLowerCase(), token1.toLowerCase()].sort(),
        [entry.tokenAddress, entry.profile.quoteToken].sort()
      );
      assert.equal(fee, pool.fee);
      assert.ok(liquidity > 0n, 'RWA_EXECUTION_POOL_EMPTY: ' + pool.address);
      assert.equal(actualCodeHash, pool.codeHash);
    }
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      mode: 'online',
      chainId: executionRegistry.chainId,
      blockNumber: blockNumber.toString(),
      profiles: executionRegistry.profiles.map(({ symbol, status }) => ({
        symbol,
        status,
      })),
    })
  );
} else {
  console.log(
    JSON.stringify({
      status: 'PASS',
      mode: 'offline',
      chainId: executionRegistry.chainId,
      profiles: executionRegistry.profiles.map(({ symbol, status }) => ({
        symbol,
        status,
      })),
    })
  );
}
