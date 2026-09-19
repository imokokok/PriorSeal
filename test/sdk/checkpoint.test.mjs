import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { authorizationTypedData, buildAuthorization } from '../../src/index.mjs';
import { createPriorSealClient } from '../../sdk/dist/index.js';

function setup({ expire = false } = {}) {
  const signer = privateKeyToAccount(generatePrivateKey());
  const account = signer.address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const intent = { intentId: 'checkpoint-test', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: account, recipient: `0x${'b'.repeat(40)}`, validUntil: expire ? now - 1 : now + 600, nonce: '1' };
  const input = { intent, principal: { type: 'user', id: 'user:1' }, delegate: { agentId: 'agent:1', executor: account }, account, issuedAt: expire ? now - 600 : now, authorizationNonce: `0x${'4'.repeat(64)}` };
  let failAccept = true, signs = 0, prepares = 0;
  const acceptedKeys = [];
  const client = createPriorSealClient({ fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith('/prepare')) { prepares++; const authorization = buildAuthorization(body); return new Response(JSON.stringify({ authorization, typedData: authorizationTypedData(authorization) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value), { headers: { 'content-type': 'application/json' } }); }
    acceptedKeys.push(new Headers(init.headers).get('idempotency-key'));
    if (failAccept) { failAccept = false; throw new Error('accept response lost'); }
    return Response.json({ authorization: body, acceptance: { authorizationId: body.authorizationId, status: 'ACCEPTED' }, policy: { allowed: true, reasonCodes: [], policyId: null } });
  } });
  const provider = { request: async ({ params }) => { signs++; return signer.signTypedData(JSON.parse(params[1])); } };
  return { client, input, provider, stats: () => ({ signs, prepares, acceptedKeys }) };
}

test('signed checkpoint resumes lost acceptance with the same bytes and idempotency key, without another wallet signature', async () => {
  const f = setup();
  let checkpoint;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }), error => error.code === 'NETWORK_ERROR' && error.details.checkpoint.stage === 'SIGNED');
  const roundTrip = JSON.parse(JSON.stringify(checkpoint));
  const result = await f.client.authorizeWithWallet(f.input, f.provider, { checkpoint: roundTrip });
  assert.equal(result.checkpoint.stage, 'ACCEPTED');
  assert.equal(f.stats().signs, 1);
  assert.equal(f.stats().prepares, 1);
  assert.equal(f.stats().acceptedKeys[0], f.stats().acceptedKeys[1]);
  await assert.rejects(f.client.authorizeWithWallet({ ...f.input, intent: { ...f.input.intent, amount: '2' } }, f.provider, { checkpoint: roundTrip }), { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' });
  const mutated = structuredClone(roundTrip);
  mutated.prepared.authorization.intent.recipient = `0x${'c'.repeat(40)}`;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { checkpoint: mutated }), { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' });
});

test('expired prepare never opens wallet signing and observation timeout preserves a resumable job', async () => {
  const f = setup({ expire: true });
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider), { code: 'AUTHORIZATION_EXPIRED' });
  assert.equal(f.stats().signs, 0);
  const job = { jobId: 'job-1', input: { authorizationId: 'auth-1', txHash: `0x${'1'.repeat(64)}` }, state: 'RETRY_WAIT' };
  const client = createPriorSealClient({ fetch: async () => Response.json(job) });
  await assert.rejects(client.waitForObservationJob('job-1', { timeoutMs: 1, pollIntervalMs: 10 }), error => error.code === 'OBSERVATION_WAIT_TIMEOUT' && error.details.jobId === 'job-1' && error.details.authorizationId === 'auth-1');
});

for (const [name, mutate] of [
  ['audience', state => { state.prepared.authorization.audience = 'other-deployment'; }],
  ['expiry', state => { state.prepared.authorization.expiresAt -= 1; }],
  ['notBefore', state => { state.prepared.authorization.notBefore += 1; }],
  ['issuedAt', state => { state.prepared.authorization.issuedAt -= 1; }],
  ['nonce', state => { state.prepared.authorization.authorizationNonce = `0x${'5'.repeat(64)}`; }],
  ['uses', state => { state.prepared.authorization.maxUses = '2'; }],
  ['type', state => { state.prepared.authorization.authorizer.type = 'eip1271'; }],
  ['typed data', state => { state.prepared.typedData.message.audience = 'other-deployment'; }],
  ['opaque intent hash', state => { state.prepared.authorization.intentHash = '6'.repeat(64); }],
  ['stage/signature contradiction', state => { state.stage = 'PREPARED'; }],
]) {
  test(`checkpoint rejects altered ${name} before accepting or asking for another signature`, async () => {
    const f = setup(); let checkpoint;
    await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
    const before = f.stats();
    mutate(checkpoint);
    await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { checkpoint }), { code: 'AUTHORIZATION_CHECKPOINT_MISMATCH' });
    assert.equal(f.stats().signs, before.signs);
    assert.equal(f.stats().acceptedKeys.length, before.acceptedKeys.length);
  });
}

test('signed acceptance replay after expiry remains history and never reports a live execution window', async t => {
  const realNow = Date.now(); let time = realNow;
  t.mock.method(Date, 'now', () => time);
  const f = setup(); let checkpoint;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
  time += 601000;
  const resumed = await f.client.authorizeWithWallet(f.input, f.provider, { checkpoint });
  assert.equal(resumed.authorizationWindow.active, false);
  assert.equal(resumed.nextAction, 'REVIEW_ACCEPTED_HISTORY_DO_NOT_EXECUTE');
  assert.equal(f.stats().signs, 1);
  assert.equal(f.stats().acceptedKeys[0], f.stats().acceptedKeys[1]);
});

test('checkpoint with a different valid signer signature never reaches acceptance', async () => {
  const f = setup(); let checkpoint;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
  checkpoint.signature = await privateKeyToAccount(generatePrivateKey()).signTypedData(checkpoint.prepared.typedData);
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { checkpoint }), { code: 'AUTHORIZATION_SIGNATURE_MISMATCH' });
  assert.equal(f.stats().acceptedKeys.length, 1);
});
