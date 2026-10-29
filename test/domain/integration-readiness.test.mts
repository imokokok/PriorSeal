import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildIntegrationReadiness, signIntegrationReadiness, verifyIntegrationReadiness } from '../../src/domain/integration-readiness.mjs';

const subjectAddress = `0x${'a'.repeat(40)}`;
const input = {
  chainId: 8453,
  subjectAddress,
  inspection: {
    chain: { support: 'SUPPORTED' as const, rpc: 'AVAILABLE' as const, observedChainId: 8453, source: 'evm-json-rpc' as const },
    subject: { kind: 'CONTRACT' as const, codeHash: `0x${'b'.repeat(64)}`, codeBytes: 12 },
  },
  issuer: 'priorseal.test',
  keyId: 'test-1',
  issuedAt: 1_000,
  expiresAt: 1_300,
  keyRegistry: { schema: 'priorseal.keys.v1', hash: 'c'.repeat(64), url: 'https://priorseal.test/.well-known/priorseal-keys.json' },
  payment: { protocol: 'x402' as const, method: 'GET' as const, path: '/v1/integration-readiness' as const, price: '$0.02' },
};

test('integration-readiness statement is deterministic, signed, and bounded to public read-only facts', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const report = buildIntegrationReadiness(input);
  const signed = signIntegrationReadiness(report, privateKeyPem);
  assert.equal(signed.schema, 'priorseal.integration-readiness.v1');
  assert.equal(signed.input.subjectAddress, subjectAddress);
  assert.equal(signed.inspection.subject.kind, 'CONTRACT');
  assert.equal(signed.expiresAt, 1_300);
  assert.equal(signed.workflow.stage, 'TARGET_INSPECTED');
  assert.equal(signed.workflow.nextActions.some((action) => action.rel === 'read_capabilities'), true);
  assert.equal(signed.workflow.nextActions.some((action) => action.rel === 'run_real_target'), false);
  assert.equal(verifyIntegrationReadiness(signed, publicKeyPem), true);
  assert.equal(verifyIntegrationReadiness({ ...signed, inspection: { ...signed.inspection, subject: { ...signed.inspection.subject, kind: 'EOA' } } }, publicKeyPem), false);
  assert.ok(signed.limitations.some((item) => item.includes('does not submit transactions')));
});

test('integration-readiness rejects unbounded reports and inconsistent read-only probe facts', () => {
  assert.throws(() => buildIntegrationReadiness({ ...input, expiresAt: 5_000 }), /within one hour/);
  assert.throws(() => buildIntegrationReadiness({ ...input, subjectAddress: 'not-an-address' }), /EVM address/);
  assert.throws(() => buildIntegrationReadiness({ ...input, inspection: { ...input.inspection, subject: { kind: 'NOT_OBSERVED', codeHash: `0x${'d'.repeat(64)}`, codeBytes: 1 } } }), /Unobserved/);
  assert.throws(() => buildIntegrationReadiness({ ...input, inspection: { ...input.inspection, subject: { kind: 'EOA', codeHash: null, codeBytes: null } } }), /Observed/);
});

test('integration-readiness labels the published zero-address request as a smoke test and gives a safe real-target follow-up', () => {
  const report = buildIntegrationReadiness({
    ...input,
    subjectAddress: '0x0000000000000000000000000000000000000000',
  });
  assert.equal(report.workflow.stage, 'SMOKE_TEST');
  assert.deepEqual(report.workflow.nextActions[0], {
    rel: 'run_real_target',
    method: 'GET',
    href: 'https://priorseal.test/v1/integration-readiness?chainId=8453&subjectAddress={publicEvmAddress}',
    description: 'Replace {publicEvmAddress} with the public EOA or contract that you actually intend to integrate. The zero-address smoke test only verifies discovery, payment, and signed delivery.',
  });
});
