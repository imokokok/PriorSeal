import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (value === undefined) throw new TypeError('undefined is not valid canonical JSON');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number is not valid canonical JSON');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value) {
  return sha256Hex(canonicalize(value));
}
