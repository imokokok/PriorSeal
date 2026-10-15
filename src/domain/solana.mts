import { PriorSealError } from './errors.mjs';
import { uintString } from './values.mjs';

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_TRANSACTION_PROFILE = 'priorseal.execution-profile.solana-transaction.v2';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58].map((character, index) => [character, index]));

export type SolanaInstruction = { programIdIndex: number; accountIndexes: number[]; data: string };
export type SolanaAddressTableLookup = { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] };
export type SolanaTransactionVersion = 'legacy' | 'v0' | 'v1';
export type SolanaTransactionConfig = {
  computeUnitLimit: number | null;
  heapSize: number | null;
  loadedAccountsDataSizeLimit: number | null;
  priorityFeeLamports: string | null;
};
export type SolanaTransactionMessage = {
  network: 'mainnet-beta';
  messageVersion: SolanaTransactionVersion;
  transactionConfig?: SolanaTransactionConfig;
  feePayer: string;
  recentBlockhash: string;
  header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
  accountKeys: string[];
  addressTableLookups: SolanaAddressTableLookup[];
  loadedAddresses: { writable: string[]; readonly: string[] };
  instructions: SolanaInstruction[];
};

export function decodeBase58(value: string): Uint8Array {
  if (typeof value !== 'string' || (value.length > 0 && ![...value].every((character) => BASE58_MAP.has(character)))) {
    throw new PriorSealError('INVALID_SOLANA_BASE58', 'Solana base58 value contains an invalid character');
  }
  if (value === '') return new Uint8Array();
  let integer = 0n;
  for (const character of value) integer = integer * 58n + BigInt(BASE58_MAP.get(character)!);
  const body: number[] = [];
  while (integer > 0n) {
    body.push(Number(integer & 0xffn));
    integer >>= 8n;
  }
  body.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1;
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...body]);
}

export function isSolanaPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try { return decodeBase58(value).length === 32; } catch { return false; }
}

export function normalizeSolanaTransactionMessage(value: unknown): SolanaTransactionMessage {
  if (!isRecord(value)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'solanaTransaction must be an object');
  assertOnlyKeys(value, ['network', 'messageVersion', 'transactionConfig', 'feePayer', 'recentBlockhash', 'header', 'accountKeys', 'addressTableLookups', 'loadedAddresses', 'instructions'], 'solanaTransaction');
  if (value.network !== 'mainnet-beta') throw new PriorSealError('INVALID_SOLANA_NETWORK', 'Only Solana mainnet-beta is enabled for issuance');
  if (!['legacy', 'v0', 'v1'].includes(String(value.messageVersion))) throw new PriorSealError('INVALID_SOLANA_INTENT', 'messageVersion must be legacy, v0, or v1');
  const messageVersion = value.messageVersion as SolanaTransactionVersion;
  let transactionConfig: SolanaTransactionConfig | undefined;
  if (messageVersion === 'v1') {
    if (!isRecord(value.transactionConfig)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 transactions require transactionConfig');
    assertOnlyKeys(value.transactionConfig, ['computeUnitLimit', 'heapSize', 'loadedAccountsDataSizeLimit', 'priorityFeeLamports'], 'solanaTransaction.transactionConfig');
    const config = value.transactionConfig;
    const nullableU32 = (entry: unknown, field: string) => entry === null ? null : safeU32(entry, field);
    const priorityFeeLamports = config.priorityFeeLamports === null ? null : uintString(config.priorityFeeLamports, 'transactionConfig.priorityFeeLamports');
    if (priorityFeeLamports !== null && BigInt(priorityFeeLamports) > 0xffff_ffff_ffff_ffffn) throw new PriorSealError('INVALID_SOLANA_INTENT', 'transactionConfig.priorityFeeLamports must fit in uint64');
    transactionConfig = {
      computeUnitLimit: nullableU32(config.computeUnitLimit, 'transactionConfig.computeUnitLimit'),
      heapSize: nullableU32(config.heapSize, 'transactionConfig.heapSize'),
      loadedAccountsDataSizeLimit: nullableU32(config.loadedAccountsDataSizeLimit, 'transactionConfig.loadedAccountsDataSizeLimit'),
      priorityFeeLamports,
    };
    if (transactionConfig.computeUnitLimit === null || transactionConfig.computeUnitLimit === 0 || transactionConfig.loadedAccountsDataSizeLimit === null || transactionConfig.loadedAccountsDataSizeLimit === 0) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 transactions must explicitly bind positive computeUnitLimit and loadedAccountsDataSizeLimit');
  } else if (value.transactionConfig !== undefined) {
    throw new PriorSealError('INVALID_SOLANA_INTENT', 'transactionConfig is only valid for v1 transactions');
  }
  if (!isSolanaPublicKey(value.feePayer) || !isSolanaPublicKey(value.recentBlockhash)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'feePayer and recentBlockhash must be 32-byte base58 values');
  if (!isRecord(value.header)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Solana message header is required');
  assertOnlyKeys(value.header, ['numRequiredSignatures', 'numReadonlySignedAccounts', 'numReadonlyUnsignedAccounts'], 'solanaTransaction.header');
  const header = {
    numRequiredSignatures: safeIndex(value.header.numRequiredSignatures, 'numRequiredSignatures'),
    numReadonlySignedAccounts: safeIndex(value.header.numReadonlySignedAccounts, 'numReadonlySignedAccounts'),
    numReadonlyUnsignedAccounts: safeIndex(value.header.numReadonlyUnsignedAccounts, 'numReadonlyUnsignedAccounts'),
  };
  if (!Array.isArray(value.accountKeys) || value.accountKeys.length < 1 || value.accountKeys.length > 256 || !value.accountKeys.every(isSolanaPublicKey)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'accountKeys must contain 1 to 256 base58 public keys');
  const accountKeys = [...value.accountKeys] as string[];
  if (messageVersion === 'v1' && accountKeys.length > 96) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 transactions support at most 96 inline addresses');
  if (accountKeys[0] !== value.feePayer) throw new PriorSealError('INVALID_SOLANA_INTENT', 'The fee payer must be the first static account key');
  if (new Set(accountKeys).size !== accountKeys.length) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Static account keys must be unique');
  if (header.numRequiredSignatures < 1 || header.numRequiredSignatures > accountKeys.length || header.numReadonlySignedAccounts >= header.numRequiredSignatures || header.numReadonlyUnsignedAccounts > accountKeys.length - header.numRequiredSignatures) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Solana message header account counts are inconsistent');
  if (!Array.isArray(value.addressTableLookups) || value.addressTableLookups.length > 32) throw new PriorSealError('INVALID_SOLANA_INTENT', 'addressTableLookups must be an array with at most 32 entries');
  if (messageVersion !== 'v0' && value.addressTableLookups.length !== 0) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Address table lookups are only valid for v0 transactions');
  const addressTableLookups = value.addressTableLookups.map((entry, index) => {
    if (!isRecord(entry)) throw new PriorSealError('INVALID_SOLANA_INTENT', `addressTableLookups[${index}] must be an object`);
    assertOnlyKeys(entry, ['accountKey', 'writableIndexes', 'readonlyIndexes'], `addressTableLookups[${index}]`);
    if (!isSolanaPublicKey(entry.accountKey)) throw new PriorSealError('INVALID_SOLANA_INTENT', `addressTableLookups[${index}].accountKey is invalid`);
    return {
      accountKey: entry.accountKey,
      writableIndexes: byteIndexes(entry.writableIndexes, `addressTableLookups[${index}].writableIndexes`),
      readonlyIndexes: byteIndexes(entry.readonlyIndexes, `addressTableLookups[${index}].readonlyIndexes`),
    };
  });
  if (!isRecord(value.loadedAddresses)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'loadedAddresses must contain resolved address-table entries');
  assertOnlyKeys(value.loadedAddresses, ['writable', 'readonly'], 'solanaTransaction.loadedAddresses');
  const writable = publicKeyList(value.loadedAddresses.writable, 'loadedAddresses.writable');
  const readonly = publicKeyList(value.loadedAddresses.readonly, 'loadedAddresses.readonly');
  const expectedWritable = addressTableLookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length, 0);
  const expectedReadonly = addressTableLookups.reduce((sum, lookup) => sum + lookup.readonlyIndexes.length, 0);
  if (writable.length !== expectedWritable || readonly.length !== expectedReadonly) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Resolved address-table entries do not match lookup indexes');
  const loadedCount = writable.length + readonly.length;
  if (accountKeys.length + loadedCount > 256) throw new PriorSealError('INVALID_SOLANA_INTENT', 'Resolved account list exceeds the supported transaction account limit');
  if (!Array.isArray(value.instructions) || value.instructions.length < 1 || value.instructions.length > 128) throw new PriorSealError('INVALID_SOLANA_INTENT', 'instructions must contain 1 to 128 compiled instructions');
  if (messageVersion === 'v1' && value.instructions.length > 64) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 transactions support at most 64 instructions');
  const totalAccounts = accountKeys.length + loadedCount;
  const instructions = value.instructions.map((entry, index) => {
    if (!isRecord(entry)) throw new PriorSealError('INVALID_SOLANA_INTENT', `instructions[${index}] must be an object`);
    assertOnlyKeys(entry, ['programIdIndex', 'accountIndexes', 'data'], `instructions[${index}]`);
    const programIdIndex = safeIndex(entry.programIdIndex, `instructions[${index}].programIdIndex`);
    if (programIdIndex >= totalAccounts) throw new PriorSealError('INVALID_SOLANA_INTENT', `instructions[${index}].programIdIndex is out of range`);
    if (!Array.isArray(entry.accountIndexes) || entry.accountIndexes.length > 256) throw new PriorSealError('INVALID_SOLANA_INTENT', `instructions[${index}].accountIndexes must be an array`);
    const accountIndexes = entry.accountIndexes.map((item, accountIndex) => {
      const parsed = safeIndex(item, `instructions[${index}].accountIndexes[${accountIndex}]`);
      if (parsed >= totalAccounts) throw new PriorSealError('INVALID_SOLANA_INTENT', `instructions[${index}].accountIndexes[${accountIndex}] is out of range`);
      return parsed;
    });
    if (messageVersion === 'v1' && accountIndexes.length > 255) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 instruction account counts must fit in one byte');
    if (typeof entry.data !== 'string' || entry.data.length > 8192) throw new PriorSealError('INVALID_SOLANA_INTENT', `instructions[${index}].data must be a bounded base58 string`);
    decodeBase58(entry.data);
    return { programIdIndex, accountIndexes, data: entry.data };
  });
  if (messageVersion === 'v1' && (writable.length !== 0 || readonly.length !== 0)) throw new PriorSealError('INVALID_SOLANA_INTENT', 'v1 transactions do not support address lookup tables');
  return { network: 'mainnet-beta', messageVersion, ...(transactionConfig ? { transactionConfig } : {}), feePayer: value.feePayer, recentBlockhash: value.recentBlockhash, header, accountKeys, addressTableLookups, loadedAddresses: { writable, readonly }, instructions };
}

export function solanaAuthorizationMessage(authorization: Record<string, unknown>): string {
  const { signature: _signature, ...unsigned } = authorization;
  return `PriorSeal Solana authorization v2\n${canonicalJson(unsigned)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeIndex(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 255) throw new PriorSealError('INVALID_SOLANA_INTENT', `${field} must be an integer between 0 and 255`);
  return value;
}
function safeU32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new PriorSealError('INVALID_SOLANA_INTENT', String(field) + ' must be a uint32');
  return value;
}
function byteIndexes(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length > 256) throw new PriorSealError('INVALID_SOLANA_INTENT', `${field} must be an array`);
  const indexes = value.map((item, index) => safeIndex(item, `${field}[${index}]`));
  if (new Set(indexes).size !== indexes.length) throw new PriorSealError('INVALID_SOLANA_INTENT', `${field} must not contain duplicates`);
  return indexes;
}
function publicKeyList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 256 || !value.every(isSolanaPublicKey)) throw new PriorSealError('INVALID_SOLANA_INTENT', `${field} must contain valid 32-byte base58 public keys`);
  return [...value] as string[];
}
function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], field: string) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new PriorSealError('INVALID_SOLANA_INTENT', `${field} contains unsupported field ${extra}`);
}
