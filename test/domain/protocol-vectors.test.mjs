import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, hashJson, buildIntent } from '../../src/index.mjs';

test('protocol golden vectors preserve canonical bytes and intent hash', () => {
  assert.equal(canonicalize({ z: [true, null, 'x'], a: 1 }), '{"a":1,"z":[true,null,"x"]}');
  assert.equal(hashJson({ a: 1, z: [true, null, 'x'] }), 'c4daf0b418c0d35fcffde36252dc87538a868217bc2db0a1e3f8937d1884abfb');
  const intent = buildIntent({ intentId: 'vector-1', chainId: 'eip155:1', action: 'TRANSFER', asset: 'eip155:1/native', amount: '1', sender: `0x${'1'.repeat(40)}`, recipient: `0x${'2'.repeat(40)}`, validUntil: 2_000_000_000 });
  assert.equal(intent.intentHash, 'ba70a6c04516736b508a6cd19435bc6a3a867f055f47688e55ab9aa83bcd58b1');
});

test('canonical JSON rejects values that cannot be encoded', () => {
  assert.throws(() => canonicalize(Symbol('invalid')), /unsupported canonical JSON value/);
  assert.throws(() => canonicalize({ value: undefined }), /undefined is not valid canonical JSON/);
});

test('exact-call intent retains its pre-migration hash and commitment order', () => {
  const intent = buildIntent({
    schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1', intentId: 'typed-migration-vector',
    chainId: 8453, action: 'CONTRACT_CALL', asset: 'eip155:8453/native', amount: '0',
    sender: `0x${'a'.repeat(40)}`, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000_000_000, nonce: '7',
    callTarget: `0x${'b'.repeat(40)}`, calldataHash: `0x${'c'.repeat(64)}`, transactionValue: '0',
    contextCommitments: [
      { namespace: 'zeta', algorithm: 'sha256', digest: `0x${'2'.repeat(64)}` },
      { namespace: 'alpha', algorithm: 'keccak256', digest: `0x${'1'.repeat(64)}` },
    ],
    constraints: { minConfirmations: 3, maxGasUsed: '100000' },
  });
  assert.equal(intent.intentHash, '0004b28763141ddde69e78a445ed0f97a770a8fcd1d1266945b967144d7ab77c');
  assert.deepEqual(intent.contextCommitments.map((entry) => entry.namespace), ['alpha', 'zeta']);
});
