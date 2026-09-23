import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOnlyFields, assertSafeJson } from '../../src/shared/safe-json.mjs';

function hasCode(error: unknown, code: string): error is { code: string; details?: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

test('migrated JSON guards preserve identity and reject unsafe input', () => {
  const value = { child: [1, true, null] };
  assert.equal(assertSafeJson(value), value);
  assert.equal(assertOnlyFields(value, ['child'], 'sample'), value);
  assert.throws(() => assertSafeJson({ value: Infinity }), (error) => hasCode(error, 'INVALID_JSON_VALUE'));
  assert.throws(() => assertSafeJson(JSON.parse('{"__proto__":1}')), (error) => hasCode(error, 'DANGEROUS_JSON_KEY'));
  assert.throws(() => assertOnlyFields({ extra: true }, ['child'], 'sample'), (error) => hasCode(error, 'UNKNOWN_FIELD')
    && typeof error.details === 'object' && error.details !== null && 'fields' in error.details
    && Array.isArray(error.details.fields) && error.details.fields[0] === 'extra');
});
