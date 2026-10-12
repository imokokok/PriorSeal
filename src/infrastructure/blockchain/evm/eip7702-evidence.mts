import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256 } from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import { entryPoint07Abi, entryPoint08Abi, entryPoint09Abi, getUserOperationHash, toUserOperation } from 'viem/account-abstraction';
import type { SignedAuthorization, UserOperation } from 'viem';
import { PriorSealError } from '../../../domain/errors.mjs';

const EIP7702_FACTORY_MARKER = `0x7702${'0'.repeat(36)}`;
const EIP7702_DELEGATION_PREFIX = '0xef0100';
const PAYMASTER_SIGNATURE_MAGIC = '0x22e325a297439656';
const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

type EntryPointVersion = '0.7' | '0.8' | '0.9';
type ExpectedEip7702 = { delegateAddress: string; delegateCodeHash: string; authorizationTupleHash?: string };
type RpcAuthorization = { address: string; chainId: bigint; nonce: bigint; yParity: number; r: `0x${string}`; s: `0x${string}`; authority: string | null; tupleHash: string };
type DelegationState = { state: 'ACTIVE' | 'UNDELEGATED' | 'OTHER_DELEGATE' | 'NON_DELEGATED_CODE'; address: string | null };

export type Eip7702DelegationEvidence = {
  schema: 'priorseal.eip7702.delegation-evidence.v1';
  delegateAddress: string;
  delegateCodeHash: string;
  authorizationTupleHash: string | null;
  authorizationIncluded: boolean;
  operationIncluded: true;
  operationSuccess: boolean | null;
  outerTransactionStatus: 'SUCCESS' | 'REVERTED';
  outerTransactionGasUsed: string;
  outerTransactionFee: string | null;
  stateAtTransactionEnd: DelegationState['state'];
  delegateObservedForExecution: string | null;
  delegateAfter: string | null;
  transition: 'SET' | 'REPLACED' | 'UNCHANGED' | 'REVOKED' | 'OTHER';
};

export async function verifyEip7702Bundle(input: {
  chainId: number;
  entryPoint: string;
  entryPointVersion: EntryPointVersion;
  userOperationHash: string;
  expected: ExpectedEip7702;
  transactionType: unknown;
  transactionData: unknown;
  authorizationList: unknown;
  receiptStatus: '0x0' | '0x1';
  logs: unknown[];
  entryPointAddress: string;
  transactionHash: string;
  outerTransactionGasUsed: string;
  outerTransactionFee: string | null;
  readCode: (account: string, blockNumber: string) => Promise<string>;
  traceTransaction: (transactionHash: string, diffMode: boolean) => Promise<unknown>;
  blockNumber: string;
  readDelegateEntryPoint: (delegate: string, blockNumber: string) => Promise<string>;
}): Promise<{ sender: string; nonce: string; userOperationSuccess: boolean | null; evidence: Eip7702DelegationEvidence }> {
  const expectedDelegate = normalizeAddress(input.expected.delegateAddress, 'trusted EIP-7702 delegate');
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.expected.delegateCodeHash)) throw untrusted('EIP-7702 delegate code hash is invalid');

  const delegateCode = await input.readCode(expectedDelegate, input.blockNumber);
  if (!isBytecode(delegateCode) || delegateCode === '0x' || clean(keccak256(delegateCode as `0x${string}`)) !== clean(input.expected.delegateCodeHash)) {
    throw untrusted('EIP-7702 delegate runtime code does not match the configured trust hash');
  }
  if (input.entryPointVersion === '0.7') {
    const delegateEntryPoint = normalizeAddress(await input.readDelegateEntryPoint(expectedDelegate, input.blockNumber), 'EIP-7702 delegate EntryPoint');
    if (clean(delegateEntryPoint) !== clean(input.entryPoint)) throw untrusted('EIP-7702 delegate is bound to a different EntryPoint');
  }

  const operation = findMatchingPackedOperation({
    transactionData: input.transactionData,
    entryPointVersion: input.entryPointVersion,
    chainId: input.chainId,
    entryPoint: input.entryPoint,
    userOperationHash: input.userOperationHash,
    delegateAddress: expectedDelegate,
  });
  const authorizationList = await parseAuthorizationList(input.authorizationList);
  const matchingAuthorizations = authorizationList.filter((authorization) => clean(authorization.authority) === clean(operation.sender));
  if (matchingAuthorizations.length > 1) throw authorizationMismatch('Transaction contains multiple EIP-7702 authorizations for the UserOperation sender');
  const authorization = matchingAuthorizations[0];
  const expectedAuthorizationTupleHash = input.expected.authorizationTupleHash == null ? null : normalizeHash(input.expected.authorizationTupleHash, 'expected EIP-7702 authorization tuple hash');
  if (expectedAuthorizationTupleHash === null && authorization) throw authorizationMismatch('Transaction unexpectedly authorizes the UserOperation sender');
  if (expectedAuthorizationTupleHash !== null && (!authorization || authorization.tupleHash !== expectedAuthorizationTupleHash || clean(authorization.address) !== clean(expectedDelegate))) {
    throw authorizationMismatch('Transaction authorization tuple does not match the signed EIP-7702 intent');
  }
  if (expectedAuthorizationTupleHash !== null && !isSetCodeTransaction(input.transactionType)) throw authorizationMismatch('EIP-7702 authorization is not in a type-4 set-code transaction');
  const matchingEvents = input.logs.filter((log) => isMatchingUserOperationEvent(log, input.entryPointAddress, input.userOperationHash));
  if (input.receiptStatus === '0x1' && matchingEvents.length !== 1) {
    throw operationMismatch(`Successful handleOps transaction must contain exactly one matching UserOperationEvent, found ${matchingEvents.length}`);
  }
  if (input.receiptStatus === '0x0' && matchingEvents.length !== 0) {
    throw operationMismatch('Reverted handleOps transaction cannot retain a matching UserOperationEvent');
  }

  const trace = await getTransactionStateTrace(input.traceTransaction, input.transactionHash);
  const tracedDelegateCode = traceCode(trace.prestate, expectedDelegate);
  if (tracedDelegateCode === '0x' || clean(keccak256(tracedDelegateCode as `0x${string}`)) !== clean(input.expected.delegateCodeHash)) {
    throw untrusted('EIP-7702 delegate runtime code in the transaction trace does not match the configured trust hash');
  }
  const codeDuringExecution = traceCode(trace.prestate, operation.sender);
  const after = traceStateAfter(trace, operation.sender, codeDuringExecution);
  const during = delegationState(codeDuringExecution);
  const current = delegationState(after);

  let userOperationSuccess: boolean | null = null;
  if (input.receiptStatus === '0x1') {
    userOperationSuccess = readUserOperationEventSuccess(matchingEvents[0]);
    if (userOperationSuccess === null) throw operationMismatch('Matching UserOperationEvent has an invalid success value');
    if (during.address !== expectedDelegate) throw untrusted('A successful EIP-7702 UserOperation was not observed executing through its trusted delegate');
  }
  if (authorization === undefined && during.address !== expectedDelegate) {
    throw untrusted('An EIP-7702 UserOperation without a fresh authorization must already use the trusted delegate during execution');
  }
  const transition = delegationTransition(during.address, current.address, current.state);
  return {
    sender: operation.sender,
    nonce: operation.nonce,
    userOperationSuccess,
    evidence: {
      schema: 'priorseal.eip7702.delegation-evidence.v1',
      delegateAddress: expectedDelegate,
      delegateCodeHash: clean(input.expected.delegateCodeHash)!,
      authorizationTupleHash: expectedAuthorizationTupleHash,
      authorizationIncluded: authorization !== undefined,
      operationIncluded: true,
      operationSuccess: userOperationSuccess,
      outerTransactionStatus: input.receiptStatus === '0x1' ? 'SUCCESS' : 'REVERTED',
      outerTransactionGasUsed: input.outerTransactionGasUsed,
      outerTransactionFee: input.outerTransactionFee,
      stateAtTransactionEnd: current.address === expectedDelegate ? 'ACTIVE' : current.address ? 'OTHER_DELEGATE' : current.state,
      delegateObservedForExecution: during.address,
      delegateAfter: current.address,
      transition,
    },
  };
}

function findMatchingPackedOperation(input: {
  transactionData: unknown;
  entryPointVersion: EntryPointVersion;
  chainId: number;
  entryPoint: string;
  userOperationHash: string;
  delegateAddress: string;
}) {
  if (typeof input.transactionData !== 'string' || !/^0x[0-9a-fA-F]+$/.test(input.transactionData)) throw operationMismatch('EIP-7702 transaction calldata is missing or invalid');
  const abi = input.entryPointVersion === '0.7' ? entryPoint07Abi : input.entryPointVersion === '0.8' ? entryPoint08Abi : entryPoint09Abi;
  let decoded: ReturnType<typeof decodeFunctionData<typeof abi>>;
  try { decoded = decodeFunctionData({ abi, data: input.transactionData as `0x${string}` }); }
  catch { throw operationMismatch(`EntryPoint ${input.entryPointVersion} transaction is not a supported ABI call`); }
  if (decoded.functionName !== 'handleOps') throw operationMismatch('Only EntryPoint handleOps bundles are supported for EIP-7702 evidence');
  try {
    if (encodeFunctionData({ abi, functionName: 'handleOps', args: decoded.args }).toLowerCase() !== input.transactionData.toLowerCase()) throw new Error();
  } catch { throw operationMismatch('EntryPoint handleOps calldata is not canonical ABI encoding'); }
  const packedOperations = decoded.args?.[0];
  if (!Array.isArray(packedOperations)) throw operationMismatch('EntryPoint handleOps calldata has no operation array');

  const matching: Array<{ sender: string; nonce: string }> = [];
  for (const packed of packedOperations) {
    if (!isRecord(packed)) continue;
    const rawInitCode = packed.initCode;
    const parsedMarker = input.entryPointVersion === '0.7' ? null : parseEip7702InitCode(rawInitCode);
    if (input.entryPointVersion === '0.7' ? rawInitCode !== '0x' : !parsedMarker) continue;
    try {
      const normalizedPacked = input.entryPointVersion === '0.9' ? splitPaymasterSignature(packed) : { packed, paymasterSignature: undefined };
      const userOperation = toUserOperation(normalizedPacked.packed as never) as UserOperation<'0.7' | '0.8' | '0.9'>;
      const operationWithDelegate = input.entryPointVersion === '0.7'
        ? userOperation
        : {
            ...userOperation,
            factory: EIP7702_FACTORY_MARKER as `0x${string}`,
            ...(parsedMarker!.factoryData !== '0x' ? { factoryData: parsedMarker!.factoryData } : {}),
            ...(normalizedPacked.paymasterSignature ? { paymasterSignature: normalizedPacked.paymasterSignature } : {}),
            authorization: syntheticAuthorization(input.delegateAddress),
          } as UserOperation<'0.8' | '0.9'>;
      const hash = getUserOperationHash({
        chainId: input.chainId,
        entryPointAddress: input.entryPoint as `0x${string}`,
        entryPointVersion: input.entryPointVersion,
        userOperation: operationWithDelegate,
      });
      if (clean(hash) === clean(input.userOperationHash)) matching.push({ sender: normalizeAddress(operationWithDelegate.sender, 'UserOperation sender'), nonce: BigInt(operationWithDelegate.nonce).toString(10) });
    } catch (error) {
      if (error instanceof PriorSealError) throw error;
      throw operationMismatch('EntryPoint UserOperation could not be canonically reconstructed');
    }
  }
  if (matching.length !== 1) throw operationMismatch(`Expected exactly one EIP-7702 UserOperation matching the signed hash, found ${matching.length}`);
  return matching[0];
}

function parseEip7702InitCode(value: unknown): { factoryData: `0x${string}` } | null {
  if (!isBytecode(value) || value.length < 6) return null;
  const firstTwentyBytes = value.slice(0, 42).padEnd(42, '0').toLowerCase();
  if (firstTwentyBytes !== EIP7702_FACTORY_MARKER) return null;
  if (value.length > 42 && value.length % 2 !== 0) throw operationMismatch('EIP-7702 initCode contains an incomplete byte');
  return { factoryData: (value.length > 42 ? value.slice(42) : '0x') as `0x${string}` };
}

function syntheticAuthorization(address: string) {
  return { address: address as `0x${string}`, chainId: 0, nonce: 0, yParity: 0, r: `0x${'0'.repeat(64)}` as `0x${string}`, s: `0x${'0'.repeat(64)}` as `0x${string}` };
}

function splitPaymasterSignature(packed: Record<string, unknown>): { packed: Record<string, unknown>; paymasterSignature?: `0x${string}` } {
  const paymasterAndData = packed.paymasterAndData;
  if (!isBytecode(paymasterAndData) || paymasterAndData === '0x' || !paymasterAndData.toLowerCase().endsWith(PAYMASTER_SIGNATURE_MAGIC)) return { packed };
  const byteLength = (paymasterAndData.length - 2) / 2;
  if (byteLength < 10) throw operationMismatch('EntryPoint 0.9 paymaster signature suffix is truncated');
  const encodedLength = BigInt(`0x${paymasterAndData.slice(-20, -16)}`);
  const signatureLength = Number(encodedLength);
  if (!Number.isSafeInteger(signatureLength) || signatureLength < 1 || signatureLength > byteLength - 10) throw operationMismatch('EntryPoint 0.9 paymaster signature length is invalid');
  const signatureEnd = byteLength - 10;
  const signatureStart = signatureEnd - signatureLength;
  const signature = `0x${paymasterAndData.slice(2 + signatureStart * 2, 2 + signatureEnd * 2)}` as `0x${string}`;
  const basePaymasterAndData = `0x${paymasterAndData.slice(2, 2 + signatureStart * 2)}`;
  return { packed: { ...packed, paymasterAndData: basePaymasterAndData }, paymasterSignature: signature };
}

async function parseAuthorizationList(value: unknown): Promise<RpcAuthorization[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 256) throw authorizationMismatch('Transaction authorizationList is invalid');
  return Promise.all(value.map(async (entry, index) => {
    if (!isRecord(entry)) throw authorizationMismatch(`Transaction authorizationList[${index}] is invalid`);
    const address = normalizeAddress(entry.address, `authorizationList[${index}].address`);
    const authorizationChainId = parseQuantity(entry.chainId, `authorizationList[${index}].chainId`, 256);
    const nonce = parseQuantity(entry.nonce, `authorizationList[${index}].nonce`, 64);
    const yParity = Number(parseQuantity(entry.yParity, `authorizationList[${index}].yParity`, 8));
    if (yParity > 1) throw authorizationMismatch(`Transaction authorizationList[${index}].yParity must be 0 or 1`);
    const r = normalizeScalar(entry.r, `authorizationList[${index}].r`);
    const s = normalizeScalar(entry.s, `authorizationList[${index}].s`);
    const rValue = BigInt(r);
    const sValue = BigInt(s);
    if (rValue === 0n || rValue >= SECP256K1_N || sValue === 0n || sValue > SECP256K1_N / 2n) {
      return { address, chainId: authorizationChainId, nonce, yParity, r, s, authority: null, tupleHash: hashAuthorizationTuple(authorizationChainId, address, nonce, yParity, r, s) };
    }
    if (authorizationChainId > BigInt(Number.MAX_SAFE_INTEGER) || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { address, chainId: authorizationChainId, nonce, yParity, r, s, authority: null, tupleHash: hashAuthorizationTuple(authorizationChainId, address, nonce, yParity, r, s) };
    }
    const tuple: SignedAuthorization<number> = { address: address as `0x${string}`, chainId: Number(authorizationChainId), nonce: Number(nonce), yParity, r, s };
    const recovered = await recoverAuthorizationAddress({ authorization: tuple }).catch(() => null);
    return {
      address, chainId: authorizationChainId, nonce, yParity, r, s,
      authority: recovered ? normalizeAddress(recovered, `authorizationList[${index}] signer`) : null,
      tupleHash: hashAuthorizationTuple(authorizationChainId, address, nonce, yParity, r, s),
    };
  }));
}

function hashAuthorizationTuple(chainId: bigint, address: string, nonce: bigint, yParity: number, r: string, s: string): string {
  return keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [chainId, address as `0x${string}`, nonce, yParity, r as `0x${string}`, s as `0x${string}`],
  )).toLowerCase();
}

function parseQuantity(value: unknown, field: string, bits: number): bigint {
  try {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error();
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error();
    const parsed = BigInt(value);
    if (parsed < 0n || parsed >= 1n << BigInt(bits)) throw new Error();
    return parsed;
  } catch { throw authorizationMismatch(`${field} is outside its EIP-7702 integer range`); }
}

function normalizeScalar(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw authorizationMismatch(`${field} must be a 256-bit hex scalar`);
  return `0x${value.slice(2).padStart(64, '0').toLowerCase()}`;
}

async function getTransactionStateTrace(readTrace: (transactionHash: string, diffMode: boolean) => Promise<unknown>, transactionHash: string) {
  let prestate: unknown;
  let diff: unknown;
  try {
    [prestate, diff] = await Promise.all([readTrace(transactionHash, false), readTrace(transactionHash, true)]);
  } catch (error) {
    if (error instanceof PriorSealError) throw error;
    throw new PriorSealError('ERC4337_EIP7702_TRACE_UNAVAILABLE', 'RPC endpoint must provide debug_traceTransaction prestateTracer for exact EIP-7702 transaction state');
  }
  if (!isRecord(prestate) || !isRecord(diff) || !isRecord(diff.pre) || !isRecord(diff.post)) throw new PriorSealError('ERC4337_EIP7702_TRACE_UNAVAILABLE', 'RPC endpoint returned malformed EIP-7702 transaction state trace');
  return { prestate, diffPre: diff.pre, post: diff.post };
}

function traceCode(prestate: Record<string, unknown>, account: string): string {
  const state = findAccount(prestate, account);
  if (!isRecord(state) || !isBytecode(state.code)) throw new PriorSealError('ERC4337_EIP7702_TRACE_UNAVAILABLE', 'EIP-7702 transaction trace is missing the UserOperation sender code');
  return state.code.toLowerCase();
}

function traceStateAfter(trace: { prestate: Record<string, unknown>; diffPre: Record<string, unknown>; post: Record<string, unknown> }, account: string, codeBefore: string): string {
  const preEntry = findAccount(trace.diffPre, account);
  const postEntry = findAccount(trace.post, account);
  if (isRecord(postEntry) && postEntry.code !== undefined) {
    if (!isBytecode(postEntry.code)) throw new PriorSealError('ERC4337_EIP7702_TRACE_UNAVAILABLE', 'EIP-7702 transaction trace returned invalid sender post-state code');
    return postEntry.code.toLowerCase();
  }
  if (isRecord(preEntry) && !postEntry) return '0x';
  return codeBefore;
}

function delegationState(code: string): DelegationState {
  if (code === '0x') return { state: 'UNDELEGATED', address: null };
  if (code.startsWith(EIP7702_DELEGATION_PREFIX) && /^0xef0100[0-9a-fA-F]{40}$/.test(code)) {
    const address = `0x${code.slice(8)}`.toLowerCase();
    return address === '0x0000000000000000000000000000000000000000'
      ? { state: 'UNDELEGATED', address: null }
      : { state: 'ACTIVE', address };
  }
  return { state: 'NON_DELEGATED_CODE', address: null };
}

function delegationTransition(before: string | null, after: string | null, afterState: DelegationState['state']): Eip7702DelegationEvidence['transition'] {
  if (before === after) return 'UNCHANGED';
  if (afterState === 'NON_DELEGATED_CODE') return 'OTHER';
  if (!before && after) return 'SET';
  if (before && after && before !== after) return 'REPLACED';
  if (before && !after && afterState === 'UNDELEGATED') return 'REVOKED';
  return 'OTHER';
}

function isMatchingUserOperationEvent(value: unknown, entryPoint: string, userOperationHash: string): boolean {
  const topic = keccak256(new TextEncoder().encode('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'));
  return isRecord(value) && clean(String(value.address ?? '')) === clean(entryPoint)
    && Array.isArray(value.topics) && value.topics.length === 4
    && typeof value.topics[0] === 'string' && clean(value.topics[0]) === clean(topic)
    && typeof value.topics[1] === 'string' && clean(value.topics[1]) === clean(userOperationHash);
}

function readUserOperationEventSuccess(value: unknown): boolean | null {
  if (!isRecord(value) || typeof value.data !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(value.data)) return null;
  const words = value.data.slice(2).match(/.{64}/g);
  if (!words || (words[1] !== '0'.repeat(64) && words[1] !== `${'0'.repeat(63)}1`)) return null;
  return BigInt(`0x${words[1]}`) === 1n;
}

function clean(value: string | null | undefined) { return value?.toLowerCase(); }
function normalizeAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw authorizationMismatch(`${field} must be a 20-byte address`);
  return value.toLowerCase();
}
function normalizeHash(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw authorizationMismatch(`${field} must be a 32-byte hash`);
  return value.toLowerCase();
}
function isBytecode(value: unknown): value is `0x${string}` { return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function findAccount(states: Record<string, unknown>, account: string): unknown { return Object.entries(states).find(([candidate]) => clean(candidate) === clean(account))?.[1]; }
function isSetCodeTransaction(value: unknown): boolean { return value === '0x4' || value === '0x04' || value === 4; }
function untrusted(message: string) { return new PriorSealError('ERC4337_EIP7702_UNTRUSTED', message); }
function authorizationMismatch(message: string) { return new PriorSealError('ERC4337_EIP7702_AUTH_MISMATCH', message); }
function operationMismatch(message: string) { return new PriorSealError('ERC4337_EIP7702_OPERATION_MISMATCH', message); }
