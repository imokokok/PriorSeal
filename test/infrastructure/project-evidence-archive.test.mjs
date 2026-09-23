// Generated from project-evidence-archive.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createPostgresStore } from "../../src/infrastructure/persistence/postgres-store.mjs";
import { archiveEntry, archiveQuery } from "../../src/application/archive/evidence-archive.mjs";
import { rotationImpact } from "../../scripts/rotation-impact.mjs";
import { pglitePool, testPostgresPool } from "../support/postgres.mjs";
const hasCode = (error, code) => typeof error === "object" && error !== null && "code" in error && error.code === code;
test("PostgreSQL archive migration enforces immutable, scoped evidence and stable pagination", async () => {
  const db = new PGlite();
  try {
    const sql = await readFile(new URL("../../migrations/009_project_evidence_archive.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const queries = [];
    const store = createPostgresStore(testPostgresPool({ query: async (statement, parameters) => {
      queries.push(statement);
      return db.query(statement, parameters);
    } }));
    const a = { projectId: "alpha", environment: "test", role: "writer" }, b = { ...a, projectId: "beta" };
    const artifact = (n) => ({ schema: "priorseal.verification-bundle.v1", receipt: { receiptId: `psr-${n}`, execution: { txHash: `0x${String(n).repeat(64)}`, status: "CONFIRMED" } } });
    const query = (url, access = a) => archiveQuery(new URL(url, "https://local.invalid"), access);
    const first = await store.saveArchiveEntry(archiveEntry(artifact(1), a, { now: 1e3 }));
    const largeArtifact = { ...artifact(2), payload: "x".repeat(64e3) };
    const second = await store.saveArchiveEntry(archiveEntry(largeArtifact, a, { now: 2e3, supersedesId: first.id }));
    assert.equal((await store.saveArchiveEntry(archiveEntry(artifact(1), a))).sequence, first.sequence);
    assert.equal(await store.getArchiveEntry(b, first.id), void 0);
    assert.equal((await store.listArchiveEntries(query("/v1/archive", b))).items.length, 0);
    const page = await store.listArchiveEntries(query("/v1/archive?limit=1"));
    const listSql = queries.at(-1);
    assert.ok(listSql);
    assert.match(listSql, /^SELECT sequence,project_id,environment,entry_id,/);
    assert.doesNotMatch(listSql, /entry_json/);
    const { artifact: _artifact, sequence: _sequence, ...expectedListEntry } = second;
    assert.deepEqual(page.items[0], expectedListEntry);
    const exported = await store.listArchiveEntries({ ...query("/v1/archive?limit=1"), includeArtifacts: true });
    const exportSql = queries.at(-1);
    assert.ok(exportSql);
    assert.match(exportSql, /^SELECT entry_json,sequence/);
    assert.deepEqual(exported.items[0], { ...expectedListEntry, artifact: largeArtifact });
    await store.saveArchiveEntry(archiveEntry(artifact(3), a, { now: 3e3 }));
    const next = await store.listArchiveEntries(query(`/v1/archive?limit=1&cursor=${page.nextCursor}`));
    assert.ok(next.items[0]);
    assert.equal(next.items[0].id, first.id);
    assert.equal(next.nextCursor, null);
    assert.equal((await store.listArchiveEntries(query(`/v1/archive?txHash=${second.txHash}&from=2&to=2`))).items.length, 1);
    await assert.rejects(store.saveArchiveEntry(archiveEntry(artifact(2), b, { supersedesId: first.id })), (error) => hasCode(error, "23503"));
    await assert.rejects(store.saveArchiveEntry(archiveEntry(artifact(1), a, { supersedesId: second.id })), (error) => hasCode(error, "ARCHIVE_CONFLICT"));
  } finally {
    await db.close();
  }
});
test("rotation diagnostics include expired unresolved authorizations and flag truncation without writes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE authorizations (authorization_id TEXT PRIMARY KEY, expires_at BIGINT, bound_tx_hash TEXT, acceptance_json JSONB);
      INSERT INTO authorizations SELECT 'old-' || n, n, NULL, '{"keyId":"old"}'::jsonb FROM generate_series(1,1001) AS n;
      INSERT INTO authorizations VALUES ('new-key', 1, NULL, '{"keyId":"next"}'), ('bound-old', 1, '0xtx', '{"keyId":"old"}');`);
    const report = await rotationImpact(pglitePool(db), "next", 500);
    assert.equal(report.affectedUnresolvedAuthorizations, 1001);
    assert.equal(report.truncated, true);
    assert.equal(report.items.length, 1e3);
    assert.equal(report.items[0]?.expired, true);
    assert.equal(report.items.at(-1)?.expired, false);
    assert.equal(report.items.some((row) => ["new-key", "bound-old"].includes(row.authorizationId)), false);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM authorizations")).rows[0]?.count, 1003);
    await assert.rejects(rotationImpact(pglitePool(db), "key'; DELETE FROM authorizations; --"), /Usage/);
  } finally {
    await db.close();
  }
});
