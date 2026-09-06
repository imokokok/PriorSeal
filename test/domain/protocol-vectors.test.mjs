import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, hashJson, buildIntent } from '../../src/index.mjs';

test('protocol golden vectors preserve canonical bytes and intent hash', () => {
  assert.equal(canonicalize({ z: [true, null, 'x'], a: 1 }), '{"a":1,"z":[true,null,"x"]}');
  assert.equal(hashJson({ a: 1, z: [true, null, 'x'] }), 'c4daf0b418c0d35fcffde36252dc87538a868217bc2db0a1e3f8937d1884abfb');
  const intent = buildIntent({ intentId: 'vector-1', chainId: 'eip155:1', action: 'TRANSFER', asset: 'eip155:1/native', amount: '1', sender: `0x${'1'.repeat(40)}`, recipient: `0x${'2'.repeat(40)}`, validUntil: 2_000_000_000 });
  assert.equal(intent.intentHash, 'ba70a6c04516736b508a6cd19435bc6a3a867f055f47688e55ab9aa83bcd58b1');
});
