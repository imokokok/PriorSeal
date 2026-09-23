import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { authorizationTypedData, buildAuthorization } from '../../src/index.mjs';
import { createPriorSealClient, type AuthorizationCheckpoint, type Eip1193Provider, type WalletAuthorizationInput } from '../../sdk/dist/index.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasCode = (error: unknown, code: string) => record(error) && error.code === code;
const hasDetails = (error: unknown, code: string, predicate: (details: Record<string, unknown>) => boolean) => {
  if (!record(error) || error.code !== code || !record(error.details)) return false;
  return predicate(error.details);
};
const requestBody = (init: Parameters<typeof fetch>[1]): Record<string, unknown> => {
  if (typeof init?.body !== 'string') throw new TypeError('Expected a JSON request body');
  const value: unknown = JSON.parse(init.body);
  if (!record(value)) throw new TypeError('Expected a JSON object request body');
  return value;
};
const isCheckpoint = (value: unknown): value is AuthorizationCheckpoint => record(value)
  && value.schema === 'priorseal.authorization-checkpoint.v1'
  && ['PREPARED', 'SIGNED', 'ACCEPTED'].includes(String(value.stage))
  && typeof value.account === 'string'
  && record(value.request)
  && record(value.prepared)
  && typeof value.acceptIdempotencyKey === 'string';
const typedDataMessage = (checkpoint: AuthorizationCheckpoint): Record<string, unknown> => {
  const message = checkpoint.prepared.typedData.message;
  if (!record(message)) throw new TypeError('Expected typed-data message');
  return message;
};

function setup({ expire = false }: { expire?: boolean } = {}) {
  const signer = privateKeyToAccount(generatePrivateKey());
  const account = signer.address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const intent = { intentId: 'checkpoint-test', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: account, recipient: `0x${'b'.repeat(40)}`, validUntil: expire ? now - 1 : now + 600, nonce: '1' };
  const input: WalletAuthorizationInput = { intent, principal: { type: 'user', id: 'user:1' }, delegate: { agentId: 'agent:1', executor: account }, account, issuedAt: expire ? now - 600 : now, authorizationNonce: `0x${'4'.repeat(64)}` };
  let failAccept = true, signs = 0, prepares = 0;
  const acceptedKeys: Array<string | null> = [];
  const client = createPriorSealClient({ fetch: async (url, init) => {
    const body = requestBody(init);
    if (String(url).endsWith('/prepare')) { prepares++; const authorization = buildAuthorization(body); return new Response(JSON.stringify({ authorization, typedData: authorizationTypedData(authorization) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value), { headers: { 'content-type': 'application/json' } }); }
    acceptedKeys.push(new Headers(init?.headers).get('idempotency-key'));
    if (failAccept) { failAccept = false; throw new Error('accept response lost'); }
    const authorization = buildAuthorization(body);
    return Response.json({ authorization, acceptance: { authorizationId: authorization.authorizationId, status: 'ACCEPTED' }, policy: { allowed: true, reasonCodes: [], policyId: null } });
  } });
  const provider: Eip1193Provider = { request: async ({ params }) => {
    signs++;
    if (!Array.isArray(params) || typeof params[1] !== 'string') throw new TypeError('Expected serialized typed data');
    const typedData: unknown = JSON.parse(params[1]);
    if (!record(typedData)) throw new TypeError('Expected typed-data object');
    return signer.signTypedData(typedData as Parameters<typeof signer.signTypedData>[0]);
  } };
  return { client, input, provider, stats: () => ({ signs, prepares, acceptedKeys }) };
}

test('signed checkpoint resumes lost acceptance with the same bytes and idempotency key, without another wallet signature', async () => {
  const f = setup();
  let checkpoint: AuthorizationCheckpoint | undefined;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }), error => hasDetails(error, 'NETWORK_ERROR', details => record(details.checkpoint) && details.checkpoint.stage === 'SIGNED'));
  assert.ok(checkpoint);
  const roundTripValue: unknown = JSON.parse(JSON.stringify(checkpoint));
  assert.ok(isCheckpoint(roundTripValue));
  const roundTrip = roundTripValue;
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
  const job = { jobId: 'job-1', input: { authorizationId: 'auth-1', txHash: `0x${'1'.repeat(64)}` }, state: 'RETRY_WAIT', nextAttemptAt: Date.now() + 60_000 };
  const client = createPriorSealClient({ fetch: async () => Response.json(job) });
  await assert.rejects(client.waitForObservationJob('job-1', { timeoutMs: 1, pollIntervalMs: 10 }), error => hasDetails(error, 'OBSERVATION_WAIT_TIMEOUT', details => details.jobId === 'job-1' && details.authorizationId === 'auth-1'));
});

const checkpointMutations: Array<[string, (state: AuthorizationCheckpoint) => void]> = [
  ['audience', state => { state.prepared.authorization.audience = 'other-deployment'; }],
  ['expiry', state => { state.prepared.authorization.expiresAt -= 1; }],
  ['notBefore', state => { state.prepared.authorization.notBefore += 1; }],
  ['issuedAt', state => { state.prepared.authorization.issuedAt -= 1; }],
  ['nonce', state => { state.prepared.authorization.authorizationNonce = `0x${'5'.repeat(64)}`; }],
  ['uses', state => { state.prepared.authorization.maxUses = '2'; }],
  ['type', state => { state.prepared.authorization.authorizer.type = 'eip1271'; }],
  ['typed data', state => { typedDataMessage(state).audience = 'other-deployment'; }],
  ['opaque intent hash', state => { state.prepared.authorization.intentHash = '6'.repeat(64); }],
  ['stage/signature contradiction', state => { state.stage = 'PREPARED'; }],
];
for (const [name, mutate] of checkpointMutations) {
  test(`checkpoint rejects altered ${name} before accepting or asking for another signature`, async () => {
    const f = setup(); let checkpoint: AuthorizationCheckpoint | undefined;
    await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
    assert.ok(checkpoint);
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
  const f = setup(); let checkpoint: AuthorizationCheckpoint | undefined;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
  assert.ok(checkpoint);
  time += 601000;
  const resumed = await f.client.authorizeWithWallet(f.input, f.provider, { checkpoint });
  assert.equal(resumed.authorizationWindow.active, false);
  assert.equal(resumed.nextAction, 'REVIEW_ACCEPTED_HISTORY_DO_NOT_EXECUTE');
  assert.equal(f.stats().signs, 1);
  assert.equal(f.stats().acceptedKeys[0], f.stats().acceptedKeys[1]);
});

test('checkpoint with a different valid signer signature never reaches acceptance', async () => {
  const f = setup(); let checkpoint: AuthorizationCheckpoint | undefined;
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { onCheckpoint: value => { checkpoint = value; } }));
  assert.ok(checkpoint);
  const otherSigner = privateKeyToAccount(generatePrivateKey());
  checkpoint.signature = await otherSigner.signTypedData(checkpoint.prepared.typedData as Parameters<typeof otherSigner.signTypedData>[0]);
  await assert.rejects(f.client.authorizeWithWallet(f.input, f.provider, { checkpoint }), { code: 'AUTHORIZATION_SIGNATURE_MISMATCH' });
  assert.equal(f.stats().acceptedKeys.length, 1);
});
