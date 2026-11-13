import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { archiveEntry, type ArchiveAccess, type ArchiveQuery } from '../../src/application/archive/evidence-archive.mjs';
import { createD1Store } from '../../src/infrastructure/persistence/d1-store.mjs';
import { evidenceObjectKey, encodeEvidenceArtifact, reconcileEvidenceArchiveOutbox } from '../../src/infrastructure/persistence/evidence-r2.mjs';
import { testD1 } from '../support/d1.mjs';
import { testR2 } from '../support/r2.mjs';

const access: ArchiveAccess = { projectId: 'project', environment: 'test', role: 'reviewer' };
const artifact = (value: unknown) => ({
  authorization: { schema: 'priorseal.authorization.v2', authorizationId: 'auth-1' },
  acceptance: { accepted: true },
  status: 'ACCEPTED',
  value,
});
const entryFor = (value: unknown, now = 1_700_000_000_000) => archiveEntry(artifact(value), access, { now });
const query = (includeArtifacts: boolean): ArchiveQuery => ({
  projectId: 'project', environment: 'test', role: 'reviewer',
  filters: { txHash: null, authorizationId: null, status: null, from: null, to: null },
  filterHash: 'test', cursor: null, limit: 10, includeArtifacts,
});
const code = (expected: string) => (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === expected;

test('R2 archive keeps only a content-addressed index in D1 and verifies reads', async () => {
  const fixture = testD1();
  try {
    const r2 = testR2();
    const store = createD1Store(fixture.database, { evidenceBucket: r2.bucket });
    const entry = entryFor({ nested: true });
    const saved = await store.saveArchiveEntry(entry);
    const key = `evidence/project/test/sha256/${entry.artifactHash}.json`;
    assert.equal(saved.id, entry.id);
    assert.equal(saved.artifactHash, entry.artifactHash);
    assert.ok(r2.objects.has(key));
    const row = fixture.sqlite.prepare('SELECT storage,r2_key,content_type,size,written_at,object_version,entry_json FROM project_evidence_archive').get() as Record<string, unknown>;
    assert.equal(row.storage, 'r2');
    assert.equal(row.r2_key, key);
    assert.equal(row.content_type, 'application/json; charset=utf-8');
    assert.ok(Number(row.size) > 0);
    assert.equal(row.object_version, 1);
    assert.deepEqual(JSON.parse(String(row.entry_json)), { schema: 'priorseal.archive-index-pointer.v1', r2Key: key });
    const read = await store.getArchiveEntry(access, entry.id);
    assert.deepEqual(read?.artifact, entry.artifact);
  } finally {
    fixture.sqlite.close();
  }
});

test('archive falls back to D1 when R2 is unconfigured and fails closed on damaged rows', async () => {
  const fixture = testD1();
  try {
    const unconfigured = createD1Store(fixture.database);
    const fallback = entryFor('d1-fallback');
    const saved = await unconfigured.saveArchiveEntry(fallback);
    assert.deepEqual(saved?.artifact, fallback.artifact);
    const fallbackRow = fixture.sqlite.prepare('SELECT storage,entry_json,size,r2_key FROM project_evidence_archive WHERE entry_id=?').get(fallback.id) as { storage: string; entry_json: string; size: number | null; r2_key: string | null };
    assert.equal(fallbackRow.storage, 'd1');
    assert.equal(fallbackRow.r2_key, null);
    assert.equal(fallbackRow.size, null);
    assert.deepEqual(JSON.parse(fallbackRow.entry_json), fallback);
    assert.equal((fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM project_evidence_archive_outbox').get() as { count: number }).count, 0);
    assert.deepEqual((await unconfigured.getArchiveEntry(access, fallback.id))?.artifact, fallback.artifact);

    const r2 = testR2();
    const store = createD1Store(fixture.database, { evidenceBucket: r2.bucket });
    const entry = entryFor('verifiable');
    await store.saveArchiveEntry(entry);
    assert.equal(await store.getArchiveEntry(access, '0'.repeat(64)), null);

    const key = evidenceObjectKey({ projectId: entry.projectId, environment: entry.environment, artifactHash: entry.artifactHash });
    r2.tamper(key, new TextEncoder().encode('{"tampered":true}'));
    await assert.rejects(store.getArchiveEntry(access, entry.id), code('ARCHIVE_INTEGRITY_FAILURE'));
    r2.objects.delete(key);
    await assert.rejects(store.getArchiveEntry(access, entry.id), code('ARCHIVE_OBJECT_MISSING'));

    const unbound = createD1Store(fixture.database);
    await assert.rejects(unbound.getArchiveEntry(access, entry.id), code('ARCHIVE_STORAGE_NOT_CONFIGURED'));
  } finally {
    fixture.sqlite.close();
  }
});

test('existing D1 entry_json rows stay readable and are hash-checked', async () => {
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    const legacy = entryFor('legacy');
    fixture.sqlite.prepare('INSERT INTO project_evidence_archive (project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(legacy.projectId, legacy.environment, legacy.id, legacy.artifactHash, legacy.kind, legacy.createdAt, legacy.txHash, legacy.authorizationId, legacy.status, legacy.supersedesId, JSON.stringify(legacy));
    const read = await store.getArchiveEntry(access, legacy.id);
    assert.deepEqual(read?.artifact, legacy.artifact);
    fixture.sqlite.prepare('UPDATE project_evidence_archive SET artifact_hash=? WHERE entry_id=?').run('f'.repeat(64), legacy.id);
    await assert.rejects(store.getArchiveEntry(access, legacy.id), code('ARCHIVE_INTEGRITY_FAILURE'));
  } finally {
    fixture.sqlite.close();
  }
});

test('export verifies every R2 object while metadata reads never touch R2', async () => {
  const fixture = testD1();
  try {
    const r2 = testR2();
    const store = createD1Store(fixture.database, { evidenceBucket: r2.bucket });
    const first = entryFor('first', 1_700_000_000_000);
    const second = entryFor('second', 1_700_000_001_000);
    await store.saveArchiveEntry(first);
    await store.saveArchiveEntry(second);
    const exported = await store.listArchiveEntries(query(true));
    assert.equal(exported.items.length, 2);
    assert.deepEqual(new Set(exported.items.map((item) => item.artifactHash)), new Set([first.artifactHash, second.artifactHash]));

    const metadata = await store.listArchiveEntries(query(false));
    assert.equal(metadata.items.length, 2);
    assert.ok(metadata.items.every((item) => item.artifact === undefined));

    r2.objects.delete(evidenceObjectKey({ projectId: second.projectId, environment: second.environment, artifactHash: second.artifactHash }));
    await assert.rejects(store.listArchiveEntries(query(true)), code('ARCHIVE_OBJECT_MISSING'));
    const afterMissing = await store.listArchiveEntries(query(false));
    assert.equal(afterMissing.items.length, 2);
  } finally {
    fixture.sqlite.close();
  }
});

test('reconciliation removes only stale R2 objects without a committed index', async () => {
  const fixture = testD1();
  try {
    const r2 = testR2();
    const entry = entryFor('orphan');
    const failingDatabase = {
      prepare: fixture.database.prepare.bind(fixture.database),
      batch: async () => { throw new Error('simulated D1 index commit failure'); },
    } as unknown as D1Database;
    const failingStore = createD1Store(failingDatabase, { evidenceBucket: r2.bucket });
    await assert.rejects(failingStore.saveArchiveEntry(entry), /simulated D1 index commit failure/);

    const key = evidenceObjectKey({ projectId: entry.projectId, environment: entry.environment, artifactHash: entry.artifactHash });
    assert.ok(r2.objects.has(key));
    assert.equal((fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM project_evidence_archive').get() as { count: number }).count, 0);
    const outbox = fixture.sqlite.prepare('SELECT r2_key,attempts,lease_token,last_error FROM project_evidence_archive_outbox').get() as { r2_key: string; attempts: number; lease_token: string | null; last_error: string | null };
    assert.equal(outbox.r2_key, key);
    assert.equal(outbox.attempts, 1);
    assert.equal(outbox.lease_token, null);
    assert.match(outbox.last_error ?? '', /simulated D1 index commit failure/);

    const summary = await reconcileEvidenceArchiveOutbox({ database: fixture.database, bucket: r2.bucket, now: Date.now() + 10 * 60_000, staleAfterMs: 60_000 });
    assert.deepEqual(summary, { examined: 1, deletedObjects: 1, discardedIntents: 1, failed: 0 });
    assert.equal(r2.objects.size, 0);
    assert.equal((fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM project_evidence_archive_outbox').get() as { count: number }).count, 0);
    assert.deepEqual(await reconcileEvidenceArchiveOutbox({ database: fixture.database, bucket: r2.bucket, now: Date.now() + 20 * 60_000 }), { examined: 0, deletedObjects: 0, discardedIntents: 0, failed: 0 });
  } finally {
    fixture.sqlite.close();
  }
});

test('reconciliation keeps objects that already have a committed index', async () => {
  const fixture = testD1();
  try {
    const r2 = testR2();
    const store = createD1Store(fixture.database, { evidenceBucket: r2.bucket });
    const entry = entryFor('committed');
    await store.saveArchiveEntry(entry);
    const key = evidenceObjectKey({ projectId: entry.projectId, environment: entry.environment, artifactHash: entry.artifactHash });
    fixture.sqlite.prepare('INSERT INTO project_evidence_archive_outbox (r2_key,project_id,environment,artifact_hash,size,content_type,object_version,attempts,created_at,updated_at,lease_token,lease_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)')
      .run(key, entry.projectId, entry.environment, entry.artifactHash, 1, 'application/json; charset=utf-8', 1, 1, Date.now() - 3_600_000, Date.now() - 3_600_000);
    const summary = await reconcileEvidenceArchiveOutbox({ database: fixture.database, bucket: r2.bucket, now: Date.now(), staleAfterMs: 60_000 });
    assert.deepEqual(summary, { examined: 1, deletedObjects: 0, discardedIntents: 0, failed: 0 });
    assert.ok(r2.objects.has(key));
    assert.equal((fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM project_evidence_archive_outbox').get() as { count: number }).count, 0);
  } finally {
    fixture.sqlite.close();
  }
});

test('rollback restores the pre-R2 capability and removes the outbox', async () => {
  const fixture = testD1();
  try {
    fixture.sqlite.exec(readFileSync(new URL('../../d1/rollback/0012_evidence_archive_r2_index.sql', import.meta.url), 'utf8'));
    assert.equal((fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE name=?').get('project_evidence_archive_outbox') as { count: number }).count, 0);
    assert.equal((fixture.sqlite.prepare("SELECT version FROM priorseal_schema_capabilities WHERE capability='cloudflare-runtime'").get() as { version: number }).version, 11);
  } finally {
    fixture.sqlite.close();
  }
});

test('an existing verified object is reused by the conditional write without creating a duplicate', async () => {
  const fixture = testD1();
  try {
    const r2 = testR2();
    const entry = entryFor('already-written');
    const encoded = encodeEvidenceArtifact(entry.artifact);
    const key = evidenceObjectKey({ projectId: entry.projectId, environment: entry.environment, artifactHash: entry.artifactHash });
    await r2.bucket.put(key, encoded.bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: entry.artifactHash });
    const store = createD1Store(fixture.database, { evidenceBucket: r2.bucket });
    const saved = await store.saveArchiveEntry(entry);
    assert.equal(saved.id, entry.id);
    assert.equal(r2.objects.size, 1);
    assert.equal(r2.stats.puts, 2);
    assert.deepEqual((await store.getArchiveEntry(access, entry.id))?.artifact, entry.artifact);
  } finally {
    fixture.sqlite.close();
  }
});

test('migration 0012 backfills legacy rows as storage=d1 without touching entry_json', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../../d1/migrations/0001_initial.sql', import.meta.url), 'utf8'));
    const legacy = entryFor('pre-migration');
    const legacyJson = JSON.stringify(legacy);
    sqlite.prepare('INSERT INTO project_evidence_archive (project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(legacy.projectId, legacy.environment, legacy.id, legacy.artifactHash, legacy.kind, legacy.createdAt, legacy.txHash, legacy.authorizationId, legacy.status, legacy.supersedesId, legacyJson);
    sqlite.exec(readFileSync(new URL('../../d1/migrations/0011_runtime_schema_capability.sql', import.meta.url), 'utf8'));
    sqlite.exec(readFileSync(new URL('../../d1/migrations/0012_evidence_archive_r2_index.sql', import.meta.url), 'utf8'));
    const row = sqlite.prepare('SELECT storage,r2_key,size,written_at,object_version,entry_json FROM project_evidence_archive').get() as Record<string, unknown>;
    assert.equal(row.storage, 'd1');
    assert.equal(row.r2_key, null);
    assert.equal(row.size, null);
    assert.equal(row.written_at, null);
    assert.equal(row.object_version, 1);
    assert.equal(row.entry_json, legacyJson);
  } finally {
    sqlite.close();
  }
});

test('object keys reject unsafe scope segments', () => {
  assert.throws(() => evidenceObjectKey({ projectId: '../escape', environment: 'test', artifactHash: 'a'.repeat(64) }), code('ARCHIVE_HASH_MISMATCH'));
  assert.throws(() => evidenceObjectKey({ projectId: 'project', environment: 'test', artifactHash: 'not-a-hash' }), code('ARCHIVE_HASH_MISMATCH'));
});
