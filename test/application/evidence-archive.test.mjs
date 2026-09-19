import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createArchiveAccess, archiveEntry, archiveQuery } from '../../src/application/archive/evidence-archive.mjs';
import { createMemoryStore } from '../../src/infrastructure/persistence/memory-store.mjs';
import { deploymentCapabilities } from '../../src/application/capabilities.mjs';

const a = { projectId: 'alpha', environment: 'prod', role: 'writer' };
const b = { ...a, projectId: 'beta' };
const token = 'unit-test-only-token-000000000000000000';
const artifact = n => ({ schema: 'priorseal.verification-bundle.v1', receipt: { receiptId: `psr-${n}`, execution: { txHash: `0x${String(n).repeat(64)}`, status: 'CONFIRMED' } } });
const query = (url, access = a) => archiveQuery(new URL(url, 'https://example.test'), access);

test('archive credentials bind project, environment and role; malformed and duplicate credentials fail closed', () => {
  const entry = { ...a, tokenHash: createHash('sha256').update(token).digest('hex') };
  const access = createArchiveAccess([entry]);
  assert.deepEqual(access.authenticate(`Bearer ${token}`), a);
  assert.throws(() => access.authenticate(`Bearer ${token}wrong`), { code: 'ARCHIVE_UNAUTHORIZED' });
  assert.throws(() => access.authenticate(''), { code: 'ARCHIVE_UNAUTHORIZED' });
  assert.throws(() => createArchiveAccess([entry, entry]), /duplicate/);
  for (const value of [undefined, null, 123, true, {}, []]) {
    assert.throws(() => createArchiveAccess([{ ...entry, projectId: value }]), /Invalid/);
    assert.throws(() => createArchiveAccess([{ ...entry, environment: value }]), /Invalid/);
  }
});

test('delimiter-bearing tenant identifiers cannot alias another archive namespace', async () => {
  const store = createMemoryStore();
  const firstTenant = { projectId: 'a:b', environment: 'c', role: 'writer' };
  const otherTenant = { projectId: 'a', environment: 'b:c', role: 'writer' };
  const saved = await store.saveArchiveEntry(archiveEntry(artifact(1), firstTenant));
  assert.equal(await store.getArchiveEntry(otherTenant, saved.id), undefined);
  assert.equal((await store.listArchiveEntries(query('/v1/archive', otherTenant))).items.length, 0);
  await assert.rejects(store.saveArchiveEntry(archiveEntry(artifact(2), otherTenant, { supersedesId: saved.id })), { code: 'NOT_FOUND' });
  const own = await store.saveArchiveEntry(archiveEntry(artifact(1), otherTenant));
  assert.notEqual(own.id, saved.id);
  assert.equal((await store.getArchiveEntry(firstTenant, saved.id)).projectId, 'a:b');
});

test('archive metadata rejects malformed objects and hashes with an explicit request error', () => {
  const replaceReceipt = fields => ({ ...artifact(1), receipt: { ...artifact(1).receipt, ...fields } });
  for (const receiptId of [123, {}, [], '', ' '.repeat(3)]) assert.throws(() => archiveEntry(replaceReceipt({ receiptId }), a), { code: 'INVALID_REQUEST' });
  for (const txHash of [123, {}, [], '0x1234', 'not-a-hash']) assert.throws(() => archiveEntry(replaceReceipt({ execution: { txHash } }), a), { code: 'INVALID_REQUEST' });
  for (const executionStatus of [123, {}, [], '', 'bad status']) assert.throws(() => archiveEntry(replaceReceipt({ executionStatus }), a), { code: 'INVALID_REQUEST' });
  for (const authorizationId of [123, {}, [], '', 'bad id']) assert.throws(() => archiveEntry(replaceReceipt({ authorizationEvidence: { authorization: { authorizationId } } }), a), { code: 'INVALID_REQUEST' });
  const accepted = archiveEntry(replaceReceipt({ execution: { txHash: '0x' + 'A'.repeat(64), status: 'UNKNOWN_CLAIM' } }), a);
  assert.equal(accepted.txHash, '0x' + 'a'.repeat(64));
  assert.equal(accepted.status, 'UNKNOWN_CLAIM');
  assert.equal(accepted.verification, 'NOT_VERIFIED_BY_ARCHIVE');
});

test('private archive isolates same artifact by project, keeps immutable history and pages a stable snapshot', async () => {
  const store = createMemoryStore();
  const first = await store.saveArchiveEntry(archiveEntry(artifact(1), a, { now: 1000 }));
  await store.saveArchiveEntry(archiveEntry(artifact(2), a, { now: 2000, supersedesId: first.id }));
  assert.equal(await store.getArchiveEntry(b, first.id), undefined);
  assert.equal((await store.listArchiveEntries(query('/v1/archive', b))).items.length, 0);
  await assert.rejects(store.saveArchiveEntry(archiveEntry(artifact(1), b, { supersedesId: first.id })), { code: 'NOT_FOUND' });
  const page = await store.listArchiveEntries(query('/v1/archive?limit=1'));
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].artifact, undefined);
  await store.saveArchiveEntry(archiveEntry(artifact(3), a));
  const next = await store.listArchiveEntries(query(`/v1/archive?limit=1&cursor=${page.nextCursor}`));
  assert.equal(next.items[0].id, first.id);
  assert.equal(next.nextCursor, null);
  assert.equal(next.snapshot, page.snapshot);
  assert.throws(() => query(`/v1/archive?status=CONFIRMED&cursor=${page.nextCursor}`), { code: 'INVALID_REQUEST' });
  assert.throws(() => query('/v1/archive?projectId=beta'), { code: 'INVALID_REQUEST' });
  const replay = await store.saveArchiveEntry(archiveEntry(artifact(1), a));
  assert.equal(replay.createdAt, 1);
  await assert.rejects(store.saveArchiveEntry(archiveEntry(artifact(1), a, { supersedesId: page.items[0].id })), { code: 'ARCHIVE_CONFLICT' });
});

test('capabilities never equate an active issuer with workflow readiness and suppress incompatible exact-call policy', async () => {
  const base = { issuer: 'test', audience: 'test-env', keyConfigured: true, policy: { allowedChainIds: [8453], allowedAssets: ['eip155:8453/native'] }, proofMode: 'rfc3161', timestampConfigured: false, rpcChainIds: [8453], store: createMemoryStore(), now: 1000, archiveEnabled: false };
  const missing = await deploymentCapabilities(base);
  assert.equal(missing.workflowReady, false);
  assert.equal(missing.dependencies.timestamp, 'unavailable');
  assert.deepEqual(missing.executionProfiles, ['priorseal.intent.v1']);
  const ready = await deploymentCapabilities({ ...base, timestampConfigured: true });
  assert.equal(ready.workflowReady, true);
  assert.deepEqual(ready.authorizers, ['eip712']);
  assert.deepEqual((await deploymentCapabilities({ ...base, timestampConfigured: true, contractSignatureConfigured: true })).authorizers, ['eip712', 'eip1271']);
  assert.equal((await deploymentCapabilities({ ...base, timestampConfigured: true, rpcChainIds: [] })).workflowReady, false);
  assert.equal((await deploymentCapabilities({ ...base, timestampConfigured: true, store: { health: async () => { throw new Error('down'); } } })).dependencies.storage, 'unavailable');
});

test('capability action matching follows the case-insensitive policy evaluator', async () => {
  const base = { issuer: 'test', audience: 'test-env', keyConfigured: true, proofMode: 'issuer', rpcChainIds: [8453], store: createMemoryStore(), now: 1000, archiveEnabled: false };
  const lower = await deploymentCapabilities({ ...base, policy: { allowedChainIds: [8453], allowedActions: ['transfer', 'contract_call'] } });
  const upper = await deploymentCapabilities({ ...base, policy: { allowedChainIds: [8453], allowedActions: ['TRANSFER', 'CONTRACT_CALL'] } });
  assert.deepEqual(lower.executionProfiles, upper.executionProfiles);
  assert.equal(lower.workflowReady, true);
  const invalid = await deploymentCapabilities({ ...base, policy: { allowedActions: null } });
  assert.deepEqual(invalid.executionProfiles, []);
  assert.equal(invalid.workflowReady, false);
});
