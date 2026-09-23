import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStore } from '../../src/infrastructure/persistence/memory-store.mjs';
import { createPostgresStore } from '../../src/infrastructure/persistence/postgres-store.mjs';
import { backfillAuthorizationMerkleIndex } from '../../src/infrastructure/persistence/backfill-merkle-index.mjs';
import { pgliteClient, pglitePool } from '../support/postgres.mjs';

test('Postgres migration backfill gives the same compact proof as the memory log', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE authorization_log (sequence BIGINT PRIMARY KEY, authorization_hash TEXT, accepted_at BIGINT, previous_entry_hash TEXT, entry_hash TEXT NOT NULL)');
    await db.exec(await readFile(new URL('../../migrations/010_authorization_merkle_index.sql', import.meta.url), 'utf8'));
    const memory = createMemoryStore();
    let acceptance: Awaited<ReturnType<typeof memory.appendAuthorizationLog>> | undefined;
    for (let sequence = 1; sequence <= 250; sequence += 1) {
      const entry = await memory.appendAuthorizationLog({ authorizationHash: sequence.toString(16).padStart(64, '0'), acceptedAt: 100 + sequence });
      if (sequence === 1) acceptance = entry;
      await db.query('INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES ($1,$2,$3,$4,$5)', [entry.sequence, entry.authorizationHash, entry.acceptedAt, entry.previousEntryHash, entry.entryHash]);
    }
    assert.ok(acceptance);
    await backfillAuthorizationMerkleIndex(pgliteClient(db));
    const expected = await memory.getAuthorizationMerkleSnapshot(acceptance);
    const actual = await createPostgresStore(pglitePool(db)).getAuthorizationMerkleSnapshot(acceptance);
    assert.deepEqual(actual, expected);
    assert.equal(actual.proof.length, 8);
    assert.equal((await db.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM authorization_log_merkle_nodes')).rows[0]?.count, 494);
    const postgres = createPostgresStore(pglitePool(db));
    const next = { authorizationHash: 'f'.repeat(64), acceptedAt: 500 };
    assert.deepEqual(await postgres.appendAuthorizationLog(next), await memory.appendAuthorizationLog(next));
    assert.deepEqual(await postgres.getAuthorizationMerkleSnapshot(acceptance), await memory.getAuthorizationMerkleSnapshot(acceptance));
  } finally {
    await db.close();
  }
});
