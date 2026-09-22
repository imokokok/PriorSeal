import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOnlyFields, assertSafeJson } from '../../src/shared/safe-json.mjs';

test('migrated JSON guards preserve identity and reject unsafe input', () => {
  const value = { child: [1, true, null] };
  assert.equal(assertSafeJson(value), value);
  assert.equal(assertOnlyFields(value, ['child'], 'sample'), value);
  assert.throws(() => assertSafeJson({ value: Infinity }), (error) => error.code === 'INVALID_JSON_VALUE');
  assert.throws(() => assertSafeJson(JSON.parse('{"__proto__":1}')), (error) => error.code === 'DANGEROUS_JSON_KEY');
  assert.throws(() => assertOnlyFields({ extra: true }, ['child'], 'sample'), (error) => error.code === 'UNKNOWN_FIELD' && error.details.fields[0] === 'extra');
});
