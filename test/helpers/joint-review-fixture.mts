import { generateKeyPairSync } from 'node:crypto';
import { concat, encodeAbiParameters, hashTypedData, keccak256, type TypedDataDomain, type TypedDataParameter } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { V3_DOMAIN, V3_TYPES, V3_PRIMARY_TYPE } from 'verify-insight-receipt';
import { EXECUTION_DOMAIN, EXECUTION_PRIMARY_TYPE, EXECUTION_PROFILE_V1_ID, executionTypesForSchemaVersion } from '../../sdk/dist/insight-execution-v5.js';
import { createInsightProtocolTrust } from './insight-protocol-fixture.mjs';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildTransparencyEvidence, buildVerificationBundle, createMemoryStore, hashJson, signReceipt } from '../../src/index.mjs';
import { buildReviewManifest } from '../../sdk/dist/verifier.js';

// Ephemeral test-only keys. No environment, live service, wallet or chain is used.
const insightSigner = privateKeyToAccount(generatePrivateKey());
const authorizer = privateKeyToAccount(generatePrivateKey());
const txHash = `0x${'1'.repeat(64)}`;
export const zeroHash = `0x${'0'.repeat(64)}`;
const executor = `0x${'a'.repeat(40)}`;
export const router = `0x${'b'.repeat(40)}`;
const sourceAssetId = 'eip155:8453/erc20:0x1111111111111111111111111111111111111111';
const destinationAssetId = 'eip155:8453/erc20:0x2222222222222222222222222222222222222222';

type FixtureData = Record<string, unknown>;
type InsightTypes = Record<string, readonly TypedDataParameter[]>;
type JointFixtureOptions = {
  priorChain?: number;
  c4Overrides?: FixtureData | ((source: Awaited<ReturnType<typeof pretrade>>, destination: Awaited<ReturnType<typeof pretrade>>) => FixtureData);
  sourceOverrides?: FixtureData;
  destinationOverrides?: FixtureData;
  c4Version?: number;
  withAnchor?: boolean;
  psExecutedAt?: number;
  commitmentOverride?: `0x${string}`;
};

function defaultData(fields: readonly TypedDataParameter[]): FixtureData {
  return Object.fromEntries(fields.map(({ name, type }) => [name, type === 'bool' ? false : type === 'address' ? executor : type === 'bytes32' ? zeroHash : type.startsWith('uint') || type.startsWith('int') ? 0 : '']));
}
async function signInsight(data: FixtureData, domain: TypedDataDomain, types: InsightTypes, primaryType: string) {
  const message = Object.fromEntries(types[primaryType].map(({ name, type }) => [name, type.startsWith('uint') || type.startsWith('int') ? BigInt(data[name] as string | number | bigint | boolean) : data[name]]));
  const typed = { domain, types, primaryType, message } as Parameters<typeof hashTypedData>[0];
  return { uid: hashTypedData(typed), schemaVersion: data.schemaVersion, data, attester: insightSigner.address, signature: await insightSigner.signTypedData(typed) };
}
async function pretrade(source = true, overrides: FixtureData = {}) {
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
export async function createJointReviewFixture({ priorChain = 8453, c4Overrides = {}, sourceOverrides = {}, destinationOverrides = {}, c4Version = 5, withAnchor = false, psExecutedAt = 1100, commitmentOverride }: JointFixtureOptions = {}) {
  const source = await pretrade(true, sourceOverrides);
  const destination = await pretrade(false, destinationOverrides);
  const types = executionTypesForSchemaVersion(c4Version);
  if (!types) throw new TypeError('Unsupported execution schema version');
  const data = {
    ...defaultData(types[EXECUTION_PRIMARY_TYPE]), schemaVersion: c4Version, bindingMode: 'VERIFIED', claimRole: 'FIRST_PARTY_EXECUTION', subject: executor, taker: executor,
    preTradeUid: source.uid, destinationPreTradeUid: destination.uid, preTradeUidsHash: keccak256(concat([source.uid, destination.uid])),
    requestHash: source.data.requestHash, sourceAssetId, destinationAssetId, subjectChainId: 8453, settlementChainId: 8453, action: 'SWAP',
    quotedPrice: 40000, executedPrice: 40000, priceScale: 8, maxSlippageBps: 50, slippageSatisfied: true, fillStatus: 'FULL', priceExecutionStatus: 'FAITHFUL', executionStatus: 'FAITHFUL',
    txHash, blockNumber: 100, executedAt: 1100, preTradeSignedAt: 900, attestationAgeAtExecSeconds: 200, participantCount: 3, requiredParticipantCount: 3, sourceGroupCount: 2, requiredSourceGroupCount: 2, independenceSatisfied: true, validUntil: 2000, environment: 'production', ...(c4Version === 5 ? { profileId: EXECUTION_PROFILE_V1_ID } : {}), ...(typeof c4Overrides === 'function' ? c4Overrides(source, destination) : c4Overrides),
  };
  const execution = await signInsight(data, EXECUTION_DOMAIN, types, EXECUTION_PRIMARY_TYPE);
  const commitment = { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256', digest: commitmentOverride ?? keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }], [source.uid, destination.uid, source.data.requestHash as `0x${string}`, destination.data.requestHash as `0x${string}`, 50])) };
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
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence as Parameters<typeof buildAuthorizedReceipt>[0]['policyEvidence'], ...(transparency ? { transparency } : {}), execution: psExecution, issuer: key.issuer, keyId: key.keyId, issuedAt: psExecutedAt + 1 }), privateKey);
  const bundle = buildVerificationBundle({ receipt, keyRegistry: { schema: 'priorseal.keys.v1', issuer: key.issuer, keys: [key] }, assembledAt: psExecutedAt + 2 });
  const insightKeyRegistry = { keys: [{ key_id: 'fixture-insight-key', public_key: insightSigner.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' }] };
  const attachments = [source, destination, execution].map((proof, index) => ({ id: ['source', 'destination', 'execution'][index], role: `insight.${['source', 'destination', 'execution'][index]}`, profile: index === 2 ? `insight.execution.v${c4Version}` : 'insight.pretrade.v3', rawJson: JSON.stringify(proof) }));
  const manifest = await buildReviewManifest({ bundle: bundle as Parameters<typeof buildReviewManifest>[0]['bundle'], attachments, expectedTxHash: txHash, assembledAt: psExecutedAt + 2 });
  return { manifest, attachments, bundle, options: { trustedKeys: key, insightKeyRegistry, insightProtocolTrust: createInsightProtocolTrust({ signer: insightSigner, version: c4Version }), expectedAudience: 'joint-review-test', now: psExecutedAt + 3 } };
}
