import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { privateKeyToAccount } from 'viem/accounts';
import {
  authorizationTypedData,
  authorizeIntent,
  buildAuthorization,
  buildAuthorizedReceipt,
  buildWitnessAttestation,
  buildWitnessEvidence,
  createHttpWitnessProvider,
  createMemoryStore,
  createWitnessHttpServer,
  hashJson,
  signWitnessAttestation,
  verifyAuthorizedReceipt,
  verifyWitnessEvidence,
  witnessRequestForAuthorization,
} from '../../src/index.mjs';
import { signReceipt } from '../../src/domain/receipt.mjs';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function witnessPolicy(entries) {
  return {
    schema: 'priorseal.witness-policy.v1',
    threshold: 2,
    maxClockSkewSeconds: 60,
    witnesses: entries.map((entry, index) => ({ witnessId: `witness-${index + 1}`, keyId: 'key-1', algorithm: 'Ed25519', publicKey: entry.publicKey })),
  };
}

test('2-of-3 witness evidence is portable and rejects duplicate or mutated attestations', () => {
  const witnessKeys = [keys(), keys(), keys()];
  const policy = witnessPolicy(witnessKeys);
  const authorization = { authorizationId: 'auth_test', intentHash: '1'.repeat(64), issuedAt: 1_000, expiresAt: 2_000 };
  const request = witnessRequestForAuthorization(authorization, { requester: 'priorseal-test', requestedAt: 1_001 });
  const attestations = witnessKeys.slice(0, 2).map((entry, index) => signWitnessAttestation(buildWitnessAttestation({ request, witnessId: `witness-${index + 1}`, keyId: 'key-1', observedAt: 1_002 + index }), entry.privateKey));
  const evidence = buildWitnessEvidence({ request, attestations, policy });
  assert.equal(verifyWitnessEvidence(evidence, authorization, policy, { expectedRequestedAt: 1_001, before: 1_100 }).valid, true);
  assert.equal(verifyWitnessEvidence({ ...evidence, attestations: [attestations[0], attestations[0]] }, authorization, policy, { expectedRequestedAt: 1_001, before: 1_100 }).code, 'WITNESS_QUORUM_NOT_MET');
  assert.equal(verifyWitnessEvidence({ ...evidence, attestations: [attestations[0], { ...attestations[1], observedAt: 999 }] }, authorization, policy, { expectedRequestedAt: 1_001, before: 1_100 }).code, 'WITNESS_QUORUM_NOT_MET');
});

test('HTTP witness nodes collect a verified quorum and replay the same request safely', async () => {
  const witnessKeys = [keys(), keys(), keys()];
  const policy = witnessPolicy(witnessKeys);
  const servers = witnessKeys.map((entry, index) => createWitnessHttpServer({ witnessId: `witness-${index + 1}`, keyId: 'key-1', privateKeyPem: entry.privateKey, publicKeyPem: entry.publicKey, bearerToken: 'secret', now: () => 1_002_000 }));
  const endpoints = servers.map((_, index) => ({ witnessId: `witness-${index + 1}`, url: `http://witness-${index + 1}.test`, bearerToken: 'secret' }));
  const provider = createHttpWitnessProvider({ policy, endpoints, requester: 'priorseal-test', fetchImpl: async (url, options) => invokeServer(servers[Number(new URL(url).hostname.match(/\d+/)[0]) - 1], new URL(url).pathname, options) });
  const authorization = { authorizationId: 'auth_http_test', intentHash: '2'.repeat(64), issuedAt: 1_000, expiresAt: 2_000 };
  const acceptance = { acceptedAt: 1_001 };
  const first = await provider({ authorization, acceptance });
  const replay = await provider({ authorization, acceptance });
  assert.equal(first.attestations.length, 3);
  assert.deepEqual(replay.attestations, first.attestations);
  assert.equal(verifyWitnessEvidence(first, authorization, policy, { expectedRequestedAt: 1_001, before: 1_100 }).valid, true);
});

async function invokeServer(server, path, options) {
  const req = Readable.from([Buffer.from(options.body)]);
  Object.assign(req, { method: options.method, url: path, headers: options.headers, socket: { remoteAddress: '127.0.0.1' } });
  const res = new EventEmitter();
  res.writableEnded = false; res.destroyed = false;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; return res; };
  res.end = (value) => { res.writableEnded = true; res.body = value; res.emit('finish'); res.emit('close'); };
  const done = new Promise((resolve) => res.once('finish', resolve));
  server.emit('request', req, res);
  await done;
  return new Response(res.body, { status: res.status, headers: res.headers });
}

test('signed authorization policy binds witness keys and receipt verification enforces pre-execution quorum', async () => {
  const issuer = keys();
  const witnessKeys = [keys(), keys(), keys()];
  const witnessQuorum = witnessPolicy(witnessKeys);
  const policy = { policyId: 'witness-policy-1', witnessQuorum };
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const executor = `0x${'a'.repeat(40)}`;
  const intent = { intentId: 'witnessed-intent-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '10', sender: executor, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000, nonce: '1' };
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor }, issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'9'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${hashJson(policy)}` });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  const witnessProvider = async ({ authorization: value, acceptance }) => {
    const request = witnessRequestForAuthorization(value, { requester: 'test', requestedAt: acceptance.acceptedAt });
    const attestations = witnessKeys.slice(0, 2).map((entry, index) => signWitnessAttestation(buildWitnessAttestation({ request, witnessId: `witness-${index + 1}`, keyId: 'key-1', observedAt: 1_002 }), entry.privateKey));
    return buildWitnessEvidence({ request, attestations, policy: witnessQuorum });
  };
  const store = createMemoryStore({ clock: () => 1_001_000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem: issuer.privateKey, issuer: 'test', keyId: 'issuer-1', policy, witnessProvider, requireWitnessQuorum: true, now: () => 1_001_000 });
  assert.equal(accepted.response.witnessEvidence.attestations.length, 2);
  const execution = { chainId: 8453, txHash: `0x${'3'.repeat(64)}`, status: 'CONFIRMED', action: 'TRANSFER', sender: executor, recipient: intent.recipient, asset: intent.asset, amount: intent.amount, nonce: intent.nonce, executedAt: 1_100, observedAt: 1_101, confirmations: 12, gasUsed: '21000', transfers: [], finalityState: 'CONFIRMED' };
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, witnessEvidence: accepted.response.witnessEvidence, execution, issuer: 'test', keyId: 'issuer-1', issuedAt: 1_101 }), issuer.privateKey);
  assert.equal((await verifyAuthorizedReceipt(receipt, issuer.publicKey)).valid, true);
  const tampered = structuredClone(receipt);
  tampered.authorizationEvidence.witnesses.attestations.pop();
  assert.equal((await verifyAuthorizedReceipt(tampered, issuer.publicKey)).code, 'WITNESS_QUORUM_NOT_MET');
});
