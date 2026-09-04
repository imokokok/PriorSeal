import { RunProofError } from '../core/errors.mjs';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function assertSafeJson(value, { maxDepth = 16, path = '$' } = {}) {
  function visit(item, depth, itemPath) {
    if (depth > maxDepth) throw new RunProofError('JSON_TOO_DEEP', `JSON exceeds maximum depth of ${maxDepth}`);
    if (item === null || ['string', 'boolean'].includes(typeof item)) return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new RunProofError('INVALID_JSON_VALUE', `Non-finite number at ${itemPath}`);
      return;
    }
    if (Array.isArray(item)) return item.forEach((entry, index) => visit(entry, depth + 1, `${itemPath}[${index}]`));
    if (typeof item !== 'object') throw new RunProofError('INVALID_JSON_VALUE', `Unsupported value at ${itemPath}`);
    for (const [key, entry] of Object.entries(item)) {
      if (FORBIDDEN_KEYS.has(key)) throw new RunProofError('DANGEROUS_JSON_KEY', `Dangerous key at ${itemPath}`);
      visit(entry, depth + 1, `${itemPath}.${key}`);
    }
  }
  visit(value, 0, path);
  return value;
}

export function assertOnlyFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RunProofError('INVALID_REQUEST', `${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new RunProofError('UNKNOWN_FIELD', `${label} contains unsupported field(s)`, { fields: unknown });
  return value;
}
