import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createReceiptV1, verifyReceiptV1Serialized, type ReceiptV1 } from 'agent-passport-system';
import type { Intent } from 'priorseal-sdk';
import { authorizeFromAps, checkIntent, evaluateConstraints, loadApsCase, verifyAps, verifyPair, verifySourceIntegrity } from './adapter.mjs';
import { EXECUTOR, makeTestReceipt } from './generate-priorseal.mjs';
import { APS_KEYS, PRIORSEAL_KEY, resolveApsKey } from './trust.mjs';
import { runExample } from './verify.mjs';

test('committed source bytes and all six offline outcomes', async () => {
  assert.equal(verifySourceIntegrity().files, 17);
  assert.equal((await runExample()).cases.length, 6);
});

for (const [name, code, valid] of [['deny', 'APS_GATE_REJECTED', false], ['expired', 'APS_EXPIRED_AT_REFERENCE', true]] as const) {
  test(`${name} rejects before any principal signing callback`, async () => {
    let calls = 0;
    const result = await authorizeFromAps(loadApsCase(name), { executor: EXECUTOR, nonce: '7', intentId: name,
      onAuthorize: () => { calls++; throw new Error('must not sign'); } });
    assert.equal(result.code, code);
    assert.equal(result.authorizationCreated, false);
    assert.ok(result.aps.composite);
    assert.equal(result.aps.composite.valid, valid);
    assert.equal(calls, 0);
    if (name === 'deny') assert.deepEqual(result.aps.composite.errors, ['valid_until_absent']);
  });
}

test('unknown and incorrect receipt keys fail independently of PriorSeal', async () => {
  const receipt = await makeTestReceipt();
  for (const resolveKey of [() => undefined, () => APS_KEYS.agent]) {
    const result = await verifyPair(loadApsCase('permit'), receipt, { resolveKey });
    assert.equal(result.aps.code, 'APS_RECEIPT_INVALID');
    assert.equal(result.priorSeal.valid, true);
    assert.equal(result.composition.ok, false);
  }
});

test('wrong delegation key fails the separately verified authority chain', () => {
  assert.equal(verifyAps(loadApsCase('permit'), { principalKey: APS_KEYS.agent }).code, 'APS_DELEGATION_INVALID');
});

test('wrong PriorSeal issuer key preserves valid APS evidence', async () => {
  const key = { ...PRIORSEAL_KEY, publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA//////////////////////////////////////////8=\n-----END PUBLIC KEY-----\n' };
  const result = await verifyPair(loadApsCase('permit'), await makeTestReceipt(), { priorSealKey: key });
  assert.equal(result.aps.ok, true);
  assert.equal(result.priorSeal.valid, false);
  assert.equal(result.composition.code, 'PRIORSEAL_VERIFICATION_FAILED');
});

test('duplicate members reject from raw bytes before parsing them into an object', () => {
  const input = loadApsCase('permit');
  input.decisionBytes = input.decisionBytes.replace('{', '{"profile":"aps-receipt-v1",');
  const result = verifyAps(input);
  assert.equal(result.code, 'APS_RECEIPT_INVALID');
  assert.ok(result.decisionSignature);
  assert.equal(result.decisionSignature.errors[0], 'parse_error');
});

test('valid generic receipt signatures cannot bypass receipt-type and prev-link rules', () => {
  // In-memory negative envelopes only. Preserve the producer's existing decision_ref;
  // never call a decision-ref builder or rewrite committed APS input bytes.
  const private_key = createHash('sha256').update('aps-163-priorseal-fixture:boundary:v1').digest('hex');
  for (const edit of [
    (fields: Omit<ReceiptV1, 'receipt_id' | 'signatures'>) => { fields.receipt_type = 'fixture:unrelated:v1'; },
    (fields: Omit<ReceiptV1, 'receipt_id' | 'signatures'>) => { fields.prev = 'f'.repeat(64); },
  ]) {
    const input = loadApsCase('permit');
    const parsed = JSON.parse(input.decisionBytes) as ReceiptV1;
    const { receipt_id, signatures, ...fields } = parsed;
    edit(fields);
    input.decisionBytes = JSON.stringify(createReceiptV1(fields, [{ signer: 'did:example:boundary', key_id: 'key-1', private_key }]));
    assert.equal(verifyReceiptV1Serialized(input.decisionBytes, resolveApsKey).valid, true);
    const result = verifyAps(input);
    assert.ok(result.composite);
    assert.equal(result.composite.valid, true);
    assert.equal(result.code, 'APS_RECEIPT_TYPE_RULES');
  }
});

test('swapped evidence and modified committed call cannot pass composition', () => {
  const swapped = loadApsCase('permit');
  swapped.evidence = loadApsCase('narrow').evidence;
  assert.equal(verifyAps(swapped).ok, false);
  const modified = loadApsCase('permit');
  modified.evidence.policy_input.requested_call.value_wei = '2';
  const result = verifyAps(modified);
  assert.equal(result.code, 'APS_GATE_REJECTED');
  assert.ok(result.composite);
  assert.ok(result.composite.errors.includes('decision_ref_mismatch'));
});

const intentMutations: ReadonlyArray<readonly [string, (intent: Intent) => void, string]> = [
  ['missing commitment', (i) => { delete i.contextCommitments; }, 'CONTEXT_COMMITMENT_MISSING'],
  ['changed digest', (i) => { assert.ok(i.contextCommitments?.[0]); i.contextCommitments[0].digest = `0x${'f'.repeat(64)}`; }, 'CONTEXT_COMMITMENT_DIGEST_MISMATCH'],
  ['duplicate namespace', (i) => { assert.ok(i.contextCommitments?.[0]); i.contextCommitments.push({ ...i.contextCommitments[0], digest: `0x${'f'.repeat(64)}` }); }, 'CONTEXT_COMMITMENT_AMBIGUOUS'],
  ['wrong algorithm', (i) => { assert.ok(i.contextCommitments?.[0]); i.contextCommitments[0].algorithm = 'keccak256'; }, 'CONTEXT_COMMITMENT_ALGORITHM_MISMATCH'],
  ['overlong validity', (i) => { i.validUntil += 1; }, 'PRIORSEAL_WINDOW_REJECTED'],
  ['changed call value', (i) => { i.transactionValue = '2'; }, 'EXACT_CALL_MISMATCH'],
  ['changed target', (i) => { i.callTarget = '0x3333333333333333333333333333333333333333'; }, 'EXACT_CALL_MISMATCH'],
  ['changed calldata', (i) => { i.calldataHash = `0x${'b'.repeat(64)}`; }, 'EXACT_CALL_MISMATCH'],
  ['changed chain', (i) => { i.chainId = 1; i.asset = 'eip155:1/native'; }, 'EXACT_CALL_MISMATCH'],
];
for (const [name, edit, code] of intentMutations) {
  test(`validly signed PriorSeal receipt with ${name} fails the composition boundary`, async () => {
    const receipt = await makeTestReceipt({ name: code, editIntent: (intent) => { edit(intent); return intent; } });
    const result = await verifyPair(loadApsCase('permit'), receipt);
    assert.equal(result.aps.ok, true);
    assert.equal(result.priorSeal.valid, true, JSON.stringify(result.priorSeal));
    assert.equal(result.composition.code, code);
  });
}

test('modified principal signature is rejected even when APS evidence remains valid', async () => {
  const receipt = await makeTestReceipt();
  receipt.authorizationEvidence.authorization.signature = `0x${'0'.repeat(130)}`;
  const result = await verifyPair(loadApsCase('permit'), receipt);
  assert.equal(result.aps.ok, true);
  assert.equal(result.priorSeal.valid, false);
});

test('unrelated execution cannot be described as correlated execution', async () => {
  const receipt = await makeTestReceipt({ name: 'unrelated',
    executionEdits: { sender: '0x3333333333333333333333333333333333333333' } });
  const result = await verifyPair(loadApsCase('permit'), receipt);
  assert.equal(result.priorSeal.valid, true);
  assert.equal(result.priorSeal.complianceStatus, 'NOT_ASSESSABLE');
  assert.equal(result.composition.code, 'EXECUTION_NOT_ASSESSABLE');
});

test('narrow predicates fail on unknown, missing, wrong-target and over-limit inputs', () => {
  const aps = verifyAps(loadApsCase('narrow'));
  assert.ok(aps.ok);
  const constraints = loadApsCase('narrow').evidence.decision_output.constraints;
  assert.equal(evaluateConstraints(constraints, aps.call).ok, true);
  assert.equal(evaluateConstraints([...constraints, 'unmapped:limit'], aps.call).code, 'NARROW_CONSTRAINT_UNMAPPED');
  assert.equal(evaluateConstraints([], aps.call).code, 'NARROW_CONSTRAINTS_MISSING');
  assert.equal(evaluateConstraints(constraints, { ...aps.call, to: EXECUTOR }).code, 'NARROW_TARGET_REJECTED');
  assert.equal(evaluateConstraints(constraints, { ...aps.call, value_wei: '1000000000000001' }).code, 'NARROW_VALUE_REJECTED');
});

test('reference time is required to be canonical and rejects before issuance and at expiry', () => {
  for (const [referenceTime, code] of [
    ['not-a-time', 'REFERENCE_TIME_INVALID'],
    ['2026-09-19T10:00:00.000Z', 'APS_NOT_YET_ISSUED'],
    ['2026-09-19T10:10:00.000Z', 'APS_EXPIRED_AT_REFERENCE'],
  ] as const) assert.equal(verifyAps(loadApsCase('permit'), { referenceTime }).code, code);
});

test('an overlong PriorSeal window never invokes signing', async () => {
  let calls = 0;
  const result = await authorizeFromAps(loadApsCase('permit'), { executor: EXECUTOR,
    nonce: '7', intentId: 'window-negative', validUntil: 1789812601, onAuthorize: () => calls++ });
  assert.equal(result.code, 'PRIORSEAL_WINDOW_REJECTED');
  assert.equal(calls, 0);
});

test('checkIntent also rejects an already-expired authorization window', async () => {
  const receipt = await makeTestReceipt();
  const intent = structuredClone(receipt.authorizationEvidence.authorization.intent);
  intent.validUntil = 1789812300;
  assert.equal(checkIntent(verifyAps(loadApsCase('permit')), intent).code, 'PRIORSEAL_WINDOW_REJECTED');
});
