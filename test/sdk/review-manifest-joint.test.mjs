import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { concat, encodeAbiParameters, hashTypedData, keccak256 } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { V3_DOMAIN, V3_TYPES, V3_PRIMARY_TYPE, EXECUTION_DOMAIN, EXECUTION_PRIMARY_TYPE, executionTypesForSchemaVersion } from 'verify-insight-receipt';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildTransparencyEvidence, buildVerificationBundle, createMemoryStore, hashJson, signReceipt } from '../../src/index.mjs';
import { buildReviewManifest, verifyReviewManifestLocally } from '../../sdk/dist/verifier.js';

// Ephemeral test-only keys. No environment, live service, wallet or chain is used.
const insightSigner = privateKeyToAccount(generatePrivateKey());
const authorizer = privateKeyToAccount(generatePrivateKey());
const txHash = `0x${'1'.repeat(64)}`;
const zeroHash = `0x${'0'.repeat(64)}`;
const executor = `0x${'a'.repeat(40)}`;
const router = `0x${'b'.repeat(40)}`;
const sourceAssetId = 'eip155:8453/erc20:0x1111111111111111111111111111111111111111';
const destinationAssetId = 'eip155:8453/erc20:0x2222222222222222222222222222222222222222';

function defaultData(fields) {
  return Object.fromEntries(fields.map(({ name, type }) => [name, type === 'bool' ? false : type === 'address' ? executor : type === 'bytes32' ? zeroHash : type.startsWith('uint') || type.startsWith('int') ? 0 : '']));
}
async function signInsight(data, domain, types, primaryType) {
  const message = Object.fromEntries(types[primaryType].map(({ name, type }) => [name, type.startsWith('uint') || type.startsWith('int') ? BigInt(data[name]) : data[name]]));
  const typed = { domain, types, primaryType, message };
  return { uid: hashTypedData(typed), schemaVersion: data.schemaVersion, data, attester: insightSigner.address, signature: await insightSigner.signTypedData(typed) };
}
async function pretrade(source = true, overrides = {}) {
  const data = {
    ...defaultData(V3_TYPES[V3_PRIMARY_TYPE]),
    schemaVersion: 3, verdict: 'PASS', sourceAssetId: source ? sourceAssetId : destinationAssetId, destinationAssetId: source ? destinationAssetId : sourceAssetId,
    subjectChainId: 8453, action: 'swap', tradeAmountUsd: 100000000000, consensusPrice: source ? 100000000 : 250000000000,
    checkedAt: 900, validUntil: 1600, participantCount: 3, requiredParticipantCount: 3, sourceGroupCount: 2, requiredSourceGroupCount: 2,
    coverageStatus: 'SUFFICIENT', independenceStatus: 'ASSESSED', evaluationScope: 'SOURCE_ASSET_ONLY', requestHash: `0x${(source ? '2' : '3').repeat(64)}`,
    ...overrides,
  };
  return signInsight(data, V3_DOMAIN, V3_TYPES, V3_PRIMARY_TYPE);
}
async function fixture({ priorChain = 8453, c4Overrides = {}, sourceOverrides = {}, destinationOverrides = {}, c4Version = 4, withAnchor = false, psExecutedAt = 1100, commitmentOverride } = {}) {
  const source = await pretrade(true, sourceOverrides);
  const destination = await pretrade(false, destinationOverrides);
  const types = executionTypesForSchemaVersion(c4Version);
  const data = {
    ...defaultData(types[EXECUTION_PRIMARY_TYPE]), schemaVersion: c4Version, bindingMode: 'VERIFIED', claimRole: 'FIRST_PARTY_EXECUTION', subject: executor, taker: executor,
    preTradeUid: source.uid, destinationPreTradeUid: destination.uid, preTradeUidsHash: keccak256(concat([source.uid, destination.uid])),
    requestHash: source.data.requestHash, sourceAssetId, destinationAssetId, subjectChainId: 8453, settlementChainId: 8453, action: 'SWAP',
    quotedPrice: 40000, executedPrice: 40000, priceScale: 8, maxSlippageBps: 50, slippageSatisfied: true, fillStatus: 'FILLED', priceExecutionStatus: 'FAITHFUL', executionStatus: 'FAITHFUL',
    txHash, blockNumber: 100, executedAt: 1100, preTradeSignedAt: 900, attestationAgeAtExecSeconds: 200, participantCount: 3, requiredParticipantCount: 3, sourceGroupCount: 2, requiredSourceGroupCount: 2, independenceSatisfied: true, validUntil: 2000, environment: 'fixture', ...(typeof c4Overrides === 'function' ? c4Overrides(source, destination) : c4Overrides),
  };
  const execution = await signInsight(data, EXECUTION_DOMAIN, types, EXECUTION_PRIMARY_TYPE);
  const commitment = { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256', digest: commitmentOverride ?? keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }], [source.uid, destination.uid, source.data.requestHash, destination.data.requestHash, 50])) };
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const key = { issuer: 'joint-test', keyId: 'joint-key', algorithm: 'Ed25519', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), status: 'active', validFrom: null, validUntil: null };
  const intent = { schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1', intentId: 'joint-review', chainId: priorChain, action: 'CONTRACT_CALL', asset: sourceAssetId.replace('8453', String(priorChain)), amount: '1000', sender: executor, recipient: router, validUntil: 1500, nonce: '7', callTarget: router, calldataHash: keccak256('0x1234'), transactionValue: '0', contextCommitments: [commitment] };
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'fixture-user', account: authorizer.address }, authorizer: { type: 'eip712', address: authorizer.address }, delegate: { agentId: 'fixture-agent', executor }, issuedAt: 1000, notBefore: 1000, expiresAt: 1500, authorizationNonce: `0x${'9'.repeat(64)}`, maxUses: '1', audience: 'joint-review-test', policyHash: zeroHash });
  const authorization = buildAuthorization({ ...draft, signature: await authorizer.signTypedData(authorizationTypedData(draft)) });
  const store = createMemoryStore({ clock: () => 1001000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem: privateKey, issuer: key.issuer, keyId: key.keyId, audience: 'joint-review-test', now: () => 1001000 });
  const psExecution = { chainId: priorChain, txHash, status: 'CONFIRMED', action: 'CONTRACT_CALL', sender: executor, recipient: router, target: router, calldataHash: intent.calldataHash, nativeValue: '0', asset: intent.asset, amount: intent.amount, nonce: '7', executedAt: psExecutedAt, observedAt: psExecutedAt + 1, confirmations: 12, gasUsed: '100000', transfers: [], finalityState: 'CONFIRMED' };
  const entries = await store.listAuthorizationLog();
  const transparency = withAnchor ? buildTransparencyEvidence({ entries, acceptance: accepted.response.acceptance, issuer: key.issuer, keyId: key.keyId, privateKeyPem: privateKey, issuedAt: 1099, before: psExecutedAt, anchor: { type: 'eip155', chainId: priorChain, contract: router, txHash: `0x${'8'.repeat(64)}`, blockNumber: 99, anchoredAt: 1099, size: 1, headEntryHash: entries[0].entryHash } }) : undefined;
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence, ...(transparency ? { transparency } : {}), execution: psExecution, issuer: key.issuer, keyId: key.keyId, issuedAt: psExecutedAt + 1 }), privateKey);
  const bundle = buildVerificationBundle({ receipt, keyRegistry: { schema: 'priorseal.keys.v1', issuer: key.issuer, keys: [key] }, assembledAt: psExecutedAt + 2 });
  const insightKeyRegistry = { keys: [{ key_id: 'fixture-insight-key', public_key: insightSigner.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' }] };
  const attachments = [source, destination, execution].map((proof, index) => ({ id: ['source', 'destination', 'execution'][index], role: `insight.${['source', 'destination', 'execution'][index]}`, profile: index === 2 ? `insight.execution.v${c4Version}` : 'insight.pretrade.v3', rawJson: JSON.stringify(proof) }));
  const manifest = await buildReviewManifest({ bundle, attachments, expectedTxHash: txHash, assembledAt: psExecutedAt + 2 });
  return { manifest, attachments, bundle, options: { trustedKeys: key, insightKeyRegistry, expectedAudience: 'joint-review-test', now: psExecutedAt + 3 } };
}

test('joint review verifies real Insight pair and C4 signatures plus exact-call authorization locally', async () => {
  const f = await fixture();
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.verificationOrigin, 'local');
  assert(result.artifacts.every(row => row.signatureValid && row.trusted));
  assert.equal(result.relations.insightPair, true);
  assert.equal(result.relations.insightAuthorizationBinding, true);
});

test('joint review rejects a rehashed payload mutation without a corresponding signature', async () => {
  const f = await fixture();
  const source = JSON.parse(f.attachments[0].rawJson); source.data.tradeAmountUsd++;
  f.attachments[0].rawJson = JSON.stringify(source);
  const changed = await buildReviewManifest({ bundle: f.bundle, attachments: f.attachments });
  const result = await verifyReviewManifestLocally(changed, f.options);
  assert.equal(result.valid, false); assert.equal(result.artifacts[0].code, 'uid_mismatch');
});

for (const scenario of [
  { name: 'cross-chain transaction hash collision', options: { priorChain: 42161 } },
  { name: 'different execution time for the same transaction', options: { c4Overrides: { executedAt: 1200 } } },
  { name: 'different executor for the same transaction', options: { c4Overrides: { taker: router, subject: router } } },
  { name: 'legacy C4 v2 without a signed destination binding', options: { c4Version: 2 } },
  { name: 'C4 v4 with zero destination UID and source-only UID hash', options: { c4Overrides: source => ({ destinationPreTradeUid: zeroHash, preTradeUidsHash: keccak256(source.uid) }) } },
  { name: 'destination assessed after authorization', options: { destinationOverrides: { checkedAt: 1050 } } },
  { name: 'authorization outliving a decision', options: { sourceOverrides: { validUntil: 1400 } } },
  { name: 'incorrect pair commitment', options: { commitmentOverride: zeroHash } },
]) {
  test(`joint review cannot report complete for ${scenario.name}`, async () => {
    const f = await fixture(scenario.options);
    const result = await verifyReviewManifestLocally(f.manifest, f.options);
    assert.equal(result.valid, false, JSON.stringify(result));
  });
}

test('missing attachments and independent Insight trust prevent complete verification', async () => {
  const f = await fixture();
  for (const attachments of [[], f.attachments.slice(0, 2)]) {
    const manifest = await buildReviewManifest({ bundle: f.bundle, attachments });
    const result = await verifyReviewManifestLocally(manifest, f.options);
    assert.equal(result.valid, false); assert(result.unverified.includes('insight.complete_pair'));
  }
  const untrusted = await verifyReviewManifestLocally(f.manifest, { ...f.options, insightKeyRegistry: undefined });
  assert.equal(untrusted.valid, false);
  assert(untrusted.artifacts.every(row => row.trusted === false));
  const sample = structuredClone(f.options); sample.insightKeyRegistry.keys[0].role = 'sample';
  assert.equal((await verifyReviewManifestLocally(f.manifest, sample)).valid, false);
});

test('a valid local anchor proof still requires the external chain check', async () => {
  const f = await fixture({ withAnchor: true });
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.priorSeal.valid, true, JSON.stringify(result));
  assert.equal(result.valid, false);
  assert.deepEqual(result.requiredExternalChecks.map(check => check.type), ['EVM_ANCHOR']);
});


test('omitting the expected transaction hint never disables cross-artifact checks', async () => {
  const f = await fixture({ priorChain: 42161 });
  f.manifest.expectedTxHash = null;
  const { manifestHash: _hash, ...content } = f.manifest;
  f.manifest.manifestHash = hashJson(content);
  const result = await verifyReviewManifestLocally(f.manifest, f.options);
  assert.equal(result.valid, false, JSON.stringify(result));
});
