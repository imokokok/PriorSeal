import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeFunctionData, keccak256, toBytes, type Abi } from 'viem';
import { entryPoint07Abi, toPackedUserOperation } from 'viem/account-abstraction';
import { bindERC4337UserOperation, buildERC4337UserOperationIntent, verifyERC4337ExecutionEvidence } from '../../sdk/dist/index.js';
import { observeEvm } from '../../src/infrastructure/blockchain/evm/observer.mjs';

const chainId = 84532;
const entryPoint = `0x${'e'.repeat(40)}` as `0x${string}`;
const sender = `0x${'a'.repeat(40)}` as `0x${string}`;
const delegate = `0x${'d'.repeat(40)}` as `0x${string}`;
const bundler = `0x${'b'.repeat(40)}` as `0x${string}`;
const transactionHash = `0x${'1'.repeat(64)}` as `0x${string}`;
const blockHash = `0x${'2'.repeat(64)}` as `0x${string}`;
const entryPointCode = '0x6003';
const delegateCode = '0x60026000';
const delegatedCode = `0xef0100${delegate.slice(2)}`;
const userOperation = {
  sender,
  nonce: 7n,
  callData: '0x' as `0x${string}`,
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 21_000n,
  maxFeePerGas: 100n,
  maxPriorityFeePerGas: 2n,
  signature: '0x' as `0x${string}`,
};
const operationInput = {
  chainId,
  entryPoint,
  entryPointCodeHash: keccak256(entryPointCode),
  entryPointVersion: '0.7' as const,
  userOperation,
  eip7702: { delegateAddress: delegate, delegateCodeHash: keccak256(delegateCode) },
};
const binding = bindERC4337UserOperation(operationInput);
const packedOperation = toPackedUserOperation(userOperation);
const transactionData = encodeFunctionData({
  abi: entryPoint07Abi as Abi,
  functionName: 'handleOps',
  args: [[packedOperation], bundler],
} as never);
const eventTopic = keccak256(toBytes('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
const addressTopic = (value: string) => `0x${'0'.repeat(24)}${value.slice(2)}`;
const logs = [{
  transactionHash,
  blockHash,
  blockNumber: '0xa',
  address: entryPoint,
  topics: [eventTopic, binding.userOpHash, addressTopic(sender), addressTopic(`0x${'0'.repeat(40)}`)],
  data: encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
    [7n, true, 400n, 300n],
  ),
  logIndex: '0x0',
}];

function rpcFixture(options: { receiptStatus?: '0x0' | '0x1'; delegateEntryPoint?: string; traceUnavailable?: boolean } = {}) {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === 'debug_traceTransaction' && options.traceUnavailable) throw new Error('trace method unavailable');
      const result = method === 'eth_chainId' ? '0x14a34'
        : method === 'eth_getTransactionByHash' ? {
            hash: transactionHash,
            from: bundler,
            to: entryPoint,
            nonce: '0x0',
            value: '0x0',
            gasPrice: '0x2',
            type: '0x2',
            input: transactionData,
            blockNumber: '0xa',
            blockHash,
            authorizationList: [],
          }
          : method === 'eth_getTransactionReceipt' ? {
              transactionHash,
              status: options.receiptStatus ?? '0x1',
              blockNumber: '0xa',
              blockHash,
              gasUsed: '0x5208',
              effectiveGasPrice: '0x2',
              logs: options.receiptStatus === '0x0' ? [] : logs,
            }
            : method === 'eth_blockNumber' ? '0xa'
              : method === 'eth_getBlockByHash' ? { hash: blockHash, number: '0xa', timestamp: '0x64' }
                : method === 'eth_getCode' ? params[0] === entryPoint ? entryPointCode : delegateCode
                  : method === 'eth_call' ? `0x${'0'.repeat(24)}${(options.delegateEntryPoint ?? entryPoint).slice(2)}`
                    : method === 'debug_traceTransaction' && (params[1] as { tracerConfig?: { diffMode?: boolean } }).tracerConfig?.diffMode
                      ? { pre: {}, post: {} }
                      : method === 'debug_traceTransaction'
                        ? { [sender]: { code: delegatedCode }, [delegate]: { code: delegateCode } }
                        : null;
      return result as T;
    },
  };
}

test('Base Sepolia EIP-7702 v0.7 observer binds handleOps, delegate trust and transaction prestate', async () => {
  const observation = await observeEvm({
    chainId,
    txHash: transactionHash,
    confirmations: 1,
    rpcUrls: ['in-memory-rpc'],
    rpcClient: rpcFixture(),
    erc4337EntryPoints: [{ chainId, version: '0.7', address: entryPoint, codeHash: operationInput.entryPointCodeHash }],
    eip7702Delegates: [{ chainId, address: delegate, codeHash: operationInput.eip7702.delegateCodeHash }],
    erc4337: {
      entryPoint,
      entryPointCodeHash: operationInput.entryPointCodeHash,
      entryPointVersion: '0.7',
      userOperationHash: binding.userOpHash,
      eip7702: operationInput.eip7702,
    },
  });

  assert.equal(observation.status, 'CONFIRMED');
  assert.equal(observation.executionDataAvailable, true);
  assert.equal(observation.userOperationHash, binding.userOpHash);
  assert.equal(observation.userOperationSuccess, true);
  assert.deepEqual(observation.eip7702Delegation, {
    schema: 'priorseal.eip7702.delegation-evidence.v1',
    delegateAddress: delegate,
    delegateCodeHash: operationInput.eip7702.delegateCodeHash,
    authorizationTupleHash: null,
    authorizationIncluded: false,
    operationIncluded: true,
    operationSuccess: true,
    outerTransactionStatus: 'SUCCESS',
    outerTransactionGasUsed: '21000',
    outerTransactionFee: '42000',
    stateAtTransactionEnd: 'ACTIVE',
    delegateObservedForExecution: delegate,
    delegateAfter: delegate,
    transition: 'UNCHANGED',
  });

  const intent = buildERC4337UserOperationIntent({
    ...operationInput,
    intentId: 'eip7702-observer-test',
    validUntil: 2_000_000_000,
  });
  const evidence = verifyERC4337ExecutionEvidence({ binding, intent, receipt: observation });
  assert.equal(evidence.success, true);
  assert.equal(evidence.eip7702Delegation?.stateAtTransactionEnd, 'ACTIVE');
});

test('Base Sepolia EIP-7702 v0.7 observer rejects a transaction that does not contain the bound UserOperation', async () => {
  await assert.rejects(() => observeEvm({
    chainId,
    txHash: transactionHash,
    rpcUrls: ['in-memory-rpc'],
    rpcClient: rpcFixture(),
    erc4337EntryPoints: [{ chainId, version: '0.7', address: entryPoint, codeHash: operationInput.entryPointCodeHash }],
    eip7702Delegates: [{ chainId, address: delegate, codeHash: operationInput.eip7702.delegateCodeHash }],
    erc4337: {
      entryPoint,
      entryPointCodeHash: operationInput.entryPointCodeHash,
      entryPointVersion: '0.7',
      userOperationHash: `0x${'f'.repeat(64)}`,
      eip7702: operationInput.eip7702,
    },
  }), (error: unknown) => (error as { code?: string }).code === 'ERC4337_EIP7702_OPERATION_MISMATCH');
});

test('Base Sepolia EIP-7702 v0.7 observer rejects a delegate bound to another EntryPoint', async () => {
  await assert.rejects(() => observeEvm({
    chainId,
    txHash: transactionHash,
    rpcUrls: ['in-memory-rpc'],
    rpcClient: rpcFixture({ delegateEntryPoint: `0x${'f'.repeat(40)}` }),
    erc4337EntryPoints: [{ chainId, version: '0.7', address: entryPoint, codeHash: operationInput.entryPointCodeHash }],
    eip7702Delegates: [{ chainId, address: delegate, codeHash: operationInput.eip7702.delegateCodeHash }],
    erc4337: {
      entryPoint,
      entryPointCodeHash: operationInput.entryPointCodeHash,
      entryPointVersion: '0.7',
      userOperationHash: binding.userOpHash,
      eip7702: operationInput.eip7702,
    },
  }), (error: unknown) => (error as { code?: string }).code === 'ERC4337_EIP7702_UNTRUSTED');
});

test('Base Sepolia EIP-7702 v0.7 observer preserves outer-transaction revert evidence without claiming operation success', async () => {
  const observation = await observeEvm({
    chainId,
    txHash: transactionHash,
    confirmations: 1,
    rpcUrls: ['in-memory-rpc'],
    rpcClient: rpcFixture({ receiptStatus: '0x0' }),
    erc4337EntryPoints: [{ chainId, version: '0.7', address: entryPoint, codeHash: operationInput.entryPointCodeHash }],
    eip7702Delegates: [{ chainId, address: delegate, codeHash: operationInput.eip7702.delegateCodeHash }],
    erc4337: {
      entryPoint,
      entryPointCodeHash: operationInput.entryPointCodeHash,
      entryPointVersion: '0.7',
      userOperationHash: binding.userOpHash,
      eip7702: operationInput.eip7702,
    },
  });

  assert.equal(observation.status, 'REVERTED');
  assert.equal(observation.userOperationSuccess, null);
  assert.equal(observation.eip7702Delegation?.operationIncluded, true);
  assert.equal(observation.eip7702Delegation?.operationSuccess, null);
  assert.equal(observation.eip7702Delegation?.outerTransactionStatus, 'REVERTED');
  assert.equal(observation.eip7702Delegation?.outerTransactionGasUsed, '21000');

  const intent = buildERC4337UserOperationIntent({
    ...operationInput,
    intentId: 'eip7702-outer-revert-test',
    validUntil: 2_000_000_000,
  });
  const evidence = verifyERC4337ExecutionEvidence({ binding, intent, receipt: observation });
  assert.equal(evidence.success, null);
  assert.equal(evidence.actualGasCost, null);
  assert.equal(evidence.eip7702Delegation?.outerTransactionStatus, 'REVERTED');
});

test('Base Sepolia EIP-7702 v0.7 observer fails closed when the RPC lacks transaction prestate tracing', async () => {
  await assert.rejects(() => observeEvm({
    chainId,
    txHash: transactionHash,
    rpcUrls: ['in-memory-rpc'],
    rpcClient: rpcFixture({ traceUnavailable: true }),
    erc4337EntryPoints: [{ chainId, version: '0.7', address: entryPoint, codeHash: operationInput.entryPointCodeHash }],
    eip7702Delegates: [{ chainId, address: delegate, codeHash: operationInput.eip7702.delegateCodeHash }],
    erc4337: {
      entryPoint,
      entryPointCodeHash: operationInput.entryPointCodeHash,
      entryPointVersion: '0.7',
      userOperationHash: binding.userOpHash,
      eip7702: operationInput.eip7702,
    },
  }), (error: unknown) => (error as { code?: string }).code === 'ERC4337_EIP7702_TRACE_UNAVAILABLE');
});
