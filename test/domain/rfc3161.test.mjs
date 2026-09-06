import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import * as asn1js from 'asn1js';
import { TimeStampReq } from 'pkijs';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizationTypedData, authorizeIntent, buildAuthorization, buildTimestampEvidence, buildTimestampPolicy, createMemoryStore, createTimestampRequest, hashJson, verifyTimestampEvidence } from '../../src/index.mjs';

const inputUrl = new URL('../fixtures/rfc3161-input.txt', import.meta.url);
const responseUrl = new URL('../fixtures/digicert-rfc3161-response.base64', import.meta.url);
const timestamp = 1_788_685_922;
const nonce = '2f1f6f319a5ae5c9dc7df19f75ae1316';
const authorizationHash = '91440011bdbd8eb6fc6669639cf68c8cc78459f933658bd61f0e4801ddd700bb';

test('DigiCert RFC 3161 evidence verifies offline against pinned roots', async () => {
  const data = new Uint8Array(await readFile(inputUrl));
  const response = Buffer.from((await readFile(responseUrl, 'utf8')).replace(/\s/g, ''), 'base64');
  const policy = buildTimestampPolicy({ maxClockSkewSeconds: 300 });
  const evidence = await buildTimestampEvidence({ response, authorizationHash, requestedAt: timestamp, nonce });
  const result = await verifyTimestampEvidence(evidence, data, policy, { authorizationHash, requestedAt: timestamp, before: timestamp + 1 });
  assert.deepEqual(result, { valid: true, code: 'OK', timestamp: 1_788_685_922, serialNumber: '009efe6bb23356d66cf73c0924a34f4db3', profile: 'digicert-rfc3161-v1' });
});

test('RFC 3161 evidence rejects changed data, metadata, and post-execution time', async () => {
  const data = new Uint8Array(await readFile(inputUrl));
  const response = Buffer.from((await readFile(responseUrl, 'utf8')).replace(/\s/g, ''), 'base64');
  const policy = buildTimestampPolicy({ maxClockSkewSeconds: 300 });
  const evidence = await buildTimestampEvidence({ response, authorizationHash, requestedAt: timestamp, nonce });
  assert.equal((await verifyTimestampEvidence(evidence, new TextEncoder().encode('changed'), policy, { authorizationHash, requestedAt: timestamp })).code, 'INVALID_TIMESTAMP_SIGNATURE');
  assert.equal((await verifyTimestampEvidence({ ...evidence, serialNumber: '01' }, data, policy, { authorizationHash, requestedAt: timestamp })).code, 'TIMESTAMP_METADATA_MISMATCH');
  assert.equal((await verifyTimestampEvidence(evidence, data, policy, { authorizationHash, requestedAt: timestamp, before: timestamp - 1 })).code, 'TIMESTAMP_AFTER_EXECUTION');
});

test('timestamp requests use SHA-256, include a nonce, and request certificates', async () => {
  const { body, nonce: requestNonce } = await createTimestampRequest(new TextEncoder().encode('authorization'));
  const parsed = asn1js.fromBER(body.buffer);
  const request = new TimeStampReq({ schema: parsed.result });
  assert.equal(request.version, 1);
  assert.equal(request.certReq, true);
  assert.equal(request.messageImprint.hashAlgorithm.algorithmId, '2.16.840.1.101.3.4.2.1');
  assert.equal(requestNonce.length, 32);
});

test('timestamp policy rejects untrusted profiles and unreasonable clock skew', () => {
  assert.throws(() => buildTimestampPolicy({ profile: 'untrusted' }), /Only the DigiCert/);
  assert.throws(() => buildTimestampPolicy({ maxClockSkewSeconds: 3601 }), /between 0 and 3600/);
});

test('a timestamp policy fails closed when no TSA provider is configured', async () => {
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  const issuer = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const policy = { policyId: 'timestamp-required', timestampPolicy: buildTimestampPolicy() };
  const draft = buildAuthorization({
    intent: { intentId: 'timestamp-required-1', chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '1', sender: `0x${'a'.repeat(40)}`, recipient: `0x${'b'.repeat(40)}`, validUntil: 2_000, nonce: '1' },
    principal: { type: 'user', id: 'user-1', account: account.address }, authorizer: { type: 'eip712', address: account.address }, delegate: { agentId: 'agent-1', executor: `0x${'a'.repeat(40)}` },
    issuedAt: 1_000, notBefore: 1_000, expiresAt: 2_000, authorizationNonce: `0x${'2'.repeat(64)}`, maxUses: '1', audience: 'priorseal', policyHash: `0x${hashJson(policy)}`,
  });
  const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
  await assert.rejects(() => authorizeIntent({ input: authorization, store: createMemoryStore({ clock: () => 1_001_000 }), privateKeyPem: issuer, issuer: 'test', keyId: 'key-1', policy, requireTimestamp: true, now: () => 1_001_000 }), (error) => error.code === 'TIMESTAMP_NOT_CONFIGURED');
});
