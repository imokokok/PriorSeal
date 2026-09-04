import { RunProofError } from './errors.mjs';

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const UINT_RE = /^(0|[1-9][0-9]*)$/;
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function chainId(value) {
  const normalized = typeof value === 'string' && /^eip155:[1-9][0-9]*$/.test(value)
    ? value.slice('eip155:'.length)
    : value;
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < 1) throw new RunProofError('INVALID_CHAIN_ID', 'chainId must be a positive EIP-155 chain ID');
  return result;
}

export function evmAddress(value, field = 'address') {
  if (typeof value !== 'string' || !EVM_ADDRESS_RE.test(value)) throw new RunProofError('INVALID_ADDRESS', `${field} must be a 20-byte EVM address`);
  return value.toLowerCase();
}

export function txHash(value) {
  if (typeof value !== 'string' || !TX_HASH_RE.test(value)) throw new RunProofError('INVALID_TX_HASH', 'txHash must be a 32-byte hex hash');
  return value.toLowerCase();
}

export function uintString(value, field) {
  const result = String(value);
  if (!UINT_RE.test(result)) throw new RunProofError('INVALID_UINT', `${field} must be an unsigned base-10 integer string`);
  return result;
}

export function protocolId(value, field) {
  const result = String(value);
  if (!ID_RE.test(result)) throw new RunProofError('INVALID_IDENTIFIER', `${field} contains unsupported characters`);
  return result;
}

export function unixSeconds(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new RunProofError('INVALID_TIME', `${field} must be a positive Unix timestamp in seconds`);
  return result;
}
