import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVerificationBundle } from '../../src/domain/verification-bundle.mjs';

test('migrated verification bundle preserves its pre-migration hash and validation', () => {
  const receipt = { receiptId: 'psr_fixture', schema: 'priorseal.execution-receipt.v1' };
  const keyRegistry = { schema: 'priorseal.keys.v1', keys: [] };
  const bundle = buildVerificationBundle({ receipt, keyRegistry, assembledAt: 123 });
  assert.equal(bundle.bundleHash, '1e7caf4c166ca435fac4936bd33ec4bbc0a2e99f32d8c20ad88d91968ff22f79');
  assert.throws(() => buildVerificationBundle({ receipt: null, keyRegistry, assembledAt: 123 }), /receipt must be an object/);
  assert.throws(() => buildVerificationBundle({ receipt, keyRegistry: {}, assembledAt: 123 }), /keyRegistry must be a PriorSeal key registry/);
  assert.throws(() => buildVerificationBundle({ receipt, keyRegistry, assembledAt: -1 }), /assembledAt must be a non-negative integer/);
});
