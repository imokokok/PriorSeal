import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not valid canonical JSON');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number is not valid canonical JSON');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('unsupported canonical JSON value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('canonical JSON requires a plain object');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('unsafe canonical JSON key');
    return `${JSON.stringify(key)}:${canonicalize(object[key])}`;
  }).join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
