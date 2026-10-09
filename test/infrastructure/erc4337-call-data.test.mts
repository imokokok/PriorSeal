import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes, type Abi } from 'viem';
import { entryPoint07Abi, toPackedUserOperation } from 'viem/account-abstraction';
import { buildERC4337UserOperationIntent, bindERC4337UserOperation, parseERC4337UserOperationInput, verifyERC4337ExecutionEvidence } from '../../sdk/dist/index.js';
import { decodeSafe4337CallFromBundlerTransaction, decodeSafe4337CallData } from '../../src/infrastructure/blockchain/evm/erc4337-call-data.mjs';
import { observeEvm } from '../../src/infrastructure/blockchain/evm/observer.mjs';

const ep = `0x${'e'.repeat(40)}` as `0x${string}`;
const account = `0x${'a'.repeat(40)}` as `0x${string}`;
const target = `0x${'b'.repeat(40)}` as `0x${string}`;
const moduleAddress = `0x${'f'.repeat(40)}` as `0x${string}`;
const singletonAddress = `0x${'9'.repeat(40)}` as `0x${string}`;
const accountData = encodeFunctionData({ abi: parseAbi(['function transfer(address to,uint256 amount)']), functionName: 'transfer', args: [`0x${'c'.repeat(40)}`, 42n] });
const safeCallData = encodeFunctionData({ abi: parseAbi(['function executeUserOp(address to,uint256 value,bytes data,uint8 operation)']), functionName: 'executeUserOp', args: [target, 3n, accountData, 0] });
const userOperation = {
  sender: account,
  nonce: 7n,
  callData: safeCallData,
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 21_000n,
  maxFeePerGas: 100n,
  maxPriorityFeePerGas: 2n,
  signature: '0x' as `0x${string}`,
};
const packedOperation = toPackedUserOperation(userOperation);
const bundlerData = encodeFunctionData({ abi: entryPoint07Abi as Abi, functionName: 'handleOps', args: [[packedOperation], target] } as never);

test('Safe ERC-4337 intent, included handleOps call and signed-observation evidence share one canonical call binding', () => {
  const input = {
    chainId: 8453,
    entryPoint: ep,
    entryPointCodeHash: `0x${'d'.repeat(64)}` as `0x${string}`,
    entryPointVersion: '0.7' as const,
    accountCallProfile: 'safe-4337.v1' as const,
    userOperation,
  };
  const binding = bindERC4337UserOperation(input);
  const intent = buildERC4337UserOperationIntent({ ...input, intentId: 'safe-4337-test', validUntil: 2_000 });
  const decoded = decodeSafe4337CallFromBundlerTransaction({ transactionData: bundlerData, entryPointVersion: '0.7', sender: account, nonce: '7' });
  assert.deepEqual(decoded, binding.accountCall);
  assert.equal(intent.accountCallTarget, target);
  assert.equal(intent.accountCallValue, '3');
  assert.equal(intent.accountCallDataHash, binding.accountCall?.dataHash);
  const evidence = verifyERC4337ExecutionEvidence({
    binding,
    intent,
    receipt: {
      schema: 'priorseal.execution-observation.v1', chainId: 8453, status: 'CONFIRMED', finalityState: 'FINALIZED', executionDataAvailable: true,
      userOperationSuccess: true, actualGasCost: '5000', gasUsed: '4000', txHash: `0x${'1'.repeat(64)}`, blockNumber: 42,
      blockHash: `0x${'2'.repeat(64)}`, sender: account, nonce: '7', entryPoint: ep, entryPointCodeHash: input.entryPointCodeHash,
      entryPointVersion: '0.7', userOperationHash: binding.userOpHash, accountCallProfile: 'safe-4337.v1',
      accountCallTarget: decoded.target, accountCallValue: decoded.value, accountCallDataHash: decoded.dataHash,
    },
  });
  assert.deepEqual(evidence.accountCall, binding.accountCall);
});

test('Safe ERC-4337 decoder rejects delegatecall and ambiguous sender/nonce matches', () => {
  const delegateCall = encodeFunctionData({ abi: parseAbi(['function executeUserOp(address to,uint256 value,bytes data,uint8 operation)']), functionName: 'executeUserOp', args: [target, 0n, '0x', 1] });
  assert.throws(() => decodeSafe4337CallData(delegateCall), /delegatecall/);
  const duplicateBundle = encodeFunctionData({ abi: entryPoint07Abi as Abi, functionName: 'handleOps', args: [[packedOperation, packedOperation], target] } as never);
  assert.throws(() => decodeSafe4337CallFromBundlerTransaction({ transactionData: duplicateBundle, entryPointVersion: '0.7', sender: account, nonce: '7' }), /Expected one UserOperation/);
});

test('ERC-4337 input parser rejects fields that are not part of the selected EntryPoint version', () => {
  const base = { chainId: 8453, entryPoint: ep, entryPointCodeHash: `0x${'d'.repeat(64)}`, entryPointVersion: '0.7' as const, userOperation };
  assert.throws(() => parseERC4337UserOperationInput({ ...base, userOperation: { ...userOperation, initCode: '0x' } }), /unsupported 0.7 field: initCode/);
  assert.throws(() => parseERC4337UserOperationInput({ ...base, userOperation: { ...userOperation, arbitraryBundlerMetadata: true } }), /unsupported 0.7 field: arbitraryBundlerMetadata/);
});

test('EVM observer verifies EntryPoint code and Safe semantics from the included handleOps transaction', async () => {
  const code = '0x6000';
  const codeHash = keccak256(code);
  const moduleCode = '0x6001';
  const singletonCode = '0x6002';
  const proxyCode = '0x6003';
  const moduleCodeHash = keccak256(moduleCode);
  const safeSingletonCodeHash = keccak256(singletonCode);
  const moduleMappingSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [moduleAddress, 1n]));
  const fallbackSlot = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';
  const addressWord = (value: string) => `0x${'0'.repeat(24)}${value.slice(2)}`;
  const input = {
    chainId: 8453,
    entryPoint: ep,
    entryPointCodeHash: codeHash,
    entryPointVersion: '0.7' as const,
    accountCallProfile: 'safe-4337.v1' as const,
    userOperation,
  };
  const binding = bindERC4337UserOperation(input);
  const txHash = `0x${'1'.repeat(64)}`;
  const blockHash = `0x${'2'.repeat(64)}`;
  const eventTopic = keccak256(toBytes('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
  const addressTopic = (value: string) => `0x${'0'.repeat(24)}${value.slice(2)}`;
  const logs = [{
    transactionHash: txHash,
    blockHash,
    blockNumber: '0xa',
    address: ep,
    topics: [eventTopic, binding.userOpHash, addressTopic(account), addressTopic(`0x${'0'.repeat(40)}`)],
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [7n, true, 5_000n, 4_000n]),
    logIndex: '0x0',
  }];
  const rpcClient = {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      const result = method === 'eth_chainId' ? '0x2105'
        : method === 'eth_getTransactionByHash' ? { hash: txHash, from: target, to: ep, nonce: '0x0', value: '0x0', input: bundlerData, blockNumber: '0xa', blockHash }
          : method === 'eth_getTransactionReceipt' ? { transactionHash: txHash, status: '0x1', blockNumber: '0xa', blockHash, gasUsed: '0x5208', effectiveGasPrice: '0x1', logs }
            : method === 'eth_getCode' ? params[0] === ep ? code : params[0] === moduleAddress ? moduleCode : singletonCode
              : method === 'debug_traceTransaction' ? ({
                [account]: { code: proxyCode, storage: { [`0x${'0'.repeat(64)}`]: addressWord(singletonAddress), [moduleMappingSlot]: addressWord(`0x${'0'.repeat(39)}1`), [fallbackSlot]: addressWord(moduleAddress) } },
                [singletonAddress]: { code: singletonCode }, [moduleAddress]: { code: moduleCode },
              })
                : method === 'eth_call' ? String((params[0] as { data: string }).data).startsWith('0x') && String((params[0] as { data: string }).data).length > 10 ? `0x${'0'.repeat(63)}1` : `0x${'0'.repeat(24)}${ep.slice(2)}`
              : method === 'eth_blockNumber' ? '0xa'
                : method === 'eth_getBlockByHash' ? { hash: blockHash, number: '0xa', timestamp: '0x64' }
                  : null;
      return result as T;
    },
  };
  const observation = await observeEvm({
    chainId: 8453, txHash, rpcUrls: ['rpc'], rpcClient,
    erc4337EntryPoints: [{ chainId: 8453, version: '0.7', address: ep, codeHash }],
    safe4337Trust: [{ chainId: 8453, version: '0.7', entryPointAddress: ep, moduleAddress, moduleCodeHash, safeProxyCodeHash: keccak256(proxyCode), safeSingletonCodeHash }],
    erc4337: { entryPoint: ep, entryPointCodeHash: codeHash, entryPointVersion: '0.7', userOperationHash: binding.userOpHash, accountCallProfile: 'safe-4337.v1', accountCallTarget: binding.accountCall!.target, accountCallValue: binding.accountCall!.value, accountCallDataHash: binding.accountCall!.dataHash },
  });
  assert.equal(observation.status, 'CONFIRMED');
  assert.equal(observation.userOperationHash, binding.userOpHash);
  assert.equal(observation.accountCallTarget, target);
  assert.equal(observation.accountCallValue, '3');
  assert.equal(observation.accountCallDataHash, binding.accountCall!.dataHash);
});

test('Safe ERC-4337 observer fails closed without an explicit chain/version trust profile', async () => {
  await assert.rejects(() => observeEvm({ chainId: 8453, txHash: `0x${'1'.repeat(64)}`, rpcUrls: ['rpc'], rpcClient: { async call() { return null; } } as never, erc4337: { entryPoint: ep, entryPointCodeHash: `0x${'d'.repeat(64)}`, entryPointVersion: '0.7', userOperationHash: `0x${'1'.repeat(64)}`, accountCallProfile: 'safe-4337.v1' }, erc4337EntryPoints: [{ chainId: 8453, version: '0.7', address: ep, codeHash: `0x${'d'.repeat(64)}` }] }), (error: unknown) => (error as { code?: string }).code === 'ERC4337_SAFE_ACCOUNT_UNTRUSTED');
});
