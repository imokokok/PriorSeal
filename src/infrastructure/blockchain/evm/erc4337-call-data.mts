import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, type Abi } from 'viem';
import { entryPoint06Abi, entryPoint07Abi, entryPoint08Abi, entryPoint09Abi } from 'viem/account-abstraction';
import { PriorSealError } from '../../../domain/errors.mjs';

const SAFE_4337_ABI = parseAbi([
  'function executeUserOp(address to,uint256 value,bytes data,uint8 operation)',
  'function executeUserOpWithErrorString(address to,uint256 value,bytes data,uint8 operation)',
]);
const clean = (value: unknown) => typeof value === 'string' ? value.toLowerCase() : '';

export type Safe4337Call = { profile: 'safe-4337.v1'; target: string; value: string; dataHash: string };

/** Extract the one bundled operation matching the confirmed EntryPoint event's sender and nonce. */
export function decodeSafe4337CallFromBundlerTransaction(input: { transactionData: unknown; entryPointVersion: '0.6' | '0.7' | '0.8' | '0.9'; sender: string; nonce: string }): Safe4337Call {
  if (typeof input.transactionData !== 'string' || !/^0x[0-9a-fA-F]+$/.test(input.transactionData)) throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Bundler transaction data is missing or invalid');
  const abi = ({ '0.6': entryPoint06Abi, '0.7': entryPoint07Abi, '0.8': entryPoint08Abi, '0.9': entryPoint09Abi } as const)[input.entryPointVersion] as Abi;
  let decoded;
  try { decoded = decodeFunctionData({ abi, data: input.transactionData as `0x${string}` }); }
  catch { throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'EntryPoint transaction is not a supported handleOps call'); }
  if (decoded.functionName !== 'handleOps') throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Only EntryPoint handleOps bundles are supported for Safe call decoding');
  const ops = decoded.args?.[0];
  if (!Array.isArray(ops)) throw new PriorSealError('RPC_INVALID_RESPONSE', 'EntryPoint handleOps did not contain an operation array');
  const matches = ops.filter((entry) => entry !== null && typeof entry === 'object' && clean((entry as Record<string, unknown>).sender) === clean(input.sender) && toUint((entry as Record<string, unknown>).nonce) === input.nonce);
  if (matches.length !== 1) throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', `Expected one UserOperation matching event sender and nonce, found ${matches.length}`);
  const callData = (matches[0] as Record<string, unknown>).callData;
  return decodeSafe4337CallData(callData);
}

export function decodeSafe4337CallData(callData: unknown): Safe4337Call {
  if (typeof callData !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(callData)) throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Safe UserOperation callData is missing or invalid');
  let decoded;
  try { decoded = decodeFunctionData({ abi: SAFE_4337_ABI, data: callData as `0x${string}` }); }
  catch { throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Safe UserOperation callData is not a supported execution function'); }
  if (decoded.functionName !== 'executeUserOp' && decoded.functionName !== 'executeUserOpWithErrorString') throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Safe UserOperation callData function is unsupported');
  const [target, value, data, operation] = decoded.args;
  if (operation !== 0) throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Safe delegatecall execution is unsupported');
  const canonical = encodeFunctionData({ abi: SAFE_4337_ABI, functionName: decoded.functionName, args: [target, value, data, 0] });
  if (canonical.toLowerCase() !== callData.toLowerCase()) throw new PriorSealError('ERC4337_ACCOUNT_CALL_UNSUPPORTED', 'Safe callData is not canonical ABI encoding');
  return { profile: 'safe-4337.v1', target: target.toLowerCase(), value: value.toString(10), dataHash: keccak256(data) };
}

function toUint(value: unknown): string | null {
  try { if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null; return BigInt(value).toString(10); } catch { return null; }
}
