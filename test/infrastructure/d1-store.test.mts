import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Store } from '../../src/infrastructure/persistence/d1-store.mjs';
import { createMemoryStore } from '../../src/infrastructure/persistence/memory-store.mjs';
import { archiveQuery, type ArchiveAccess } from '../../src/application/archive/evidence-archive.mjs';
import type { ObservationJob } from '../../src/application/observations/observation-worker.mjs';
import { testD1 } from '../support/d1.mjs';

const txHash = `0x${'a'.repeat(64)}`;

test('D1 preserves receipt identity across direct and atomic observation writes', async () => {
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    const receipt = { receiptId: 'psr_same', intentHash: 'intent', execution: { txHash }, schema: 'v1', issuer: 'test', keyId: 'k1', outcome: 'COMPLETED', signature: 'original' };
    const conflict = { ...receipt, signature: 'different' };
    assert.deepEqual(await store.saveReceipt(receipt), receipt);
    assert.deepEqual(await store.saveReceipt(structuredClone(receipt)), receipt);
    await assert.rejects(() => store.saveReceipt(conflict), { code: 'RECEIPT_ID_CONFLICT' });
    await assert.rejects(() => store.saveObservationReceipt({
      claimAuthorization: false,
      observation: { chainId: 8453, txHash, status: 'CONFIRMED', observedAt: 1, finalityState: 'CONFIRMED' },
      receipt: conflict,
    }), { code: 'RECEIPT_ID_CONFLICT' });
    assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS total FROM execution_observations').get()?.total, 0);
  } finally { fixture.sqlite.close(); }
});

test('D1 archive filters use existing indexes and retain snapshot, tenancy and export semantics', async () => {
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    const access: ArchiveAccess = { projectId: 'project', environment: 'test', role: 'reviewer' };
    const entries: Parameters<typeof store.saveArchiveEntry>[0][] = [];
    for (let index = 0; index < 90; index++) {
      const entry = {
        id: `entry-${index}`, projectId: index % 7 === 0 ? 'other-project' : access.projectId,
        environment: index % 11 === 0 ? 'other-environment' : access.environment,
        kind: 'authorization', createdAt: index, artifactHash: String(index), supersedesId: null,
        txHash: index % 3 === 0 ? txHash : null, authorizationId: index % 2 === 0 ? 'auth-1' : null,
        status: index % 4 === 0 ? 'BOUND' : 'ACCEPTED', artifact: { value: index }, verification: 'NOT_VERIFIED_BY_ARCHIVE',
      };
      await store.saveArchiveEntry(entry);
      entries.push(entry);
    }
    const cases = ['', `txHash=${txHash}`, 'authorizationId=auth-1', 'status=BOUND', 'from=0&to=40', `txHash=${txHash}&authorizationId=auth-1&status=BOUND&from=20&to=80`];
    for (const includeArtifacts of [false, true]) {
      for (const filters of cases) {
        const query = archiveQuery(new URL(`https://example.test/v1/archive?limit=3&${filters}`), access);
        query.includeArtifacts = includeArtifacts;
        const expected = entries.filter((entry) => entry.projectId === access.projectId && entry.environment === access.environment
          && (query.filters.txHash === null || entry.txHash === query.filters.txHash)
          && (query.filters.authorizationId === null || entry.authorizationId === query.filters.authorizationId)
          && (query.filters.status === null || entry.status === query.filters.status)
          && (query.filters.from === null || entry.createdAt >= query.filters.from)
          && (query.filters.to === null || entry.createdAt <= query.filters.to)).reverse();
        const actual = [];
        let cursor: string | null = null;
        let snapshot: number | undefined;
        do {
          const url = new URL(`https://example.test/v1/archive?limit=3&${filters}`);
          if (cursor) url.searchParams.set('cursor', cursor);
          const page = await store.listArchiveEntries({ ...archiveQuery(url, access), includeArtifacts });
          snapshot ??= page.snapshot;
          assert.equal(page.snapshot, snapshot);
          assert.equal(page.role, 'reviewer');
          assert.equal(page.retention, 'until_operator_deletion');
          actual.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(actual.map((entry) => entry.id), expected.map((entry) => entry.id));
        assert.deepEqual(actual.map((entry) => entry.artifact), expected.map((entry) => includeArtifacts ? entry.artifact : undefined));
      }
    }
    for (const [filter, index] of [[`txHash=${txHash}`, 'project_archive_tx_idx'], ['authorizationId=auth-1', 'project_archive_authorization_idx']]) {
      await store.listArchiveEntries(archiveQuery(new URL(`https://example.test/v1/archive?${filter}`), access));
      const call = fixture.calls.at(-1)!;
      const plan = fixture.sqlite.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).all(...call.values);
      assert.match(JSON.stringify(plan), new RegExp(index));
    }
    const first = await store.listArchiveEntries(archiveQuery(new URL('https://example.test/v1/archive?limit=3'), access));
    assert.ok(first.nextCursor);
    const newest = { ...entries[1], id: 'inserted-after-snapshot', createdAt: 100 };
    await store.saveArchiveEntry(newest);
    const next = archiveQuery(new URL(`https://example.test/v1/archive?limit=3&cursor=${first.nextCursor}`), access);
    const remainder = await store.listArchiveEntries(next);
    assert.equal(remainder.snapshot, first.snapshot);
    assert.equal(remainder.items.some((item) => item.id === newest.id), false);
    // Bound values cannot turn a filter into SQL or cross tenant boundaries.
    const malicious = { ...next, cursor: null, filters: { ...next.filters, authorizationId: "auth-1' OR 1=1 --" } };
    assert.deepEqual((await store.listArchiveEntries(malicious)).items, []);
  } finally { fixture.sqlite.close(); }
});

test('D1 batches Merkle reads without changing current or historical proofs and fails closed on corruption', async () => {
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    const memory = createMemoryStore();
    const entries: Awaited<ReturnType<typeof memory.appendAuthorizationLog>>[] = [];
    for (let sequence = 1; sequence <= 65; sequence++) {
      const input = { authorizationHash: sequence.toString(16).padStart(64, '0'), acceptedAt: sequence };
      const expected = await memory.appendAuthorizationLog(input);
      assert.deepEqual(await store.appendAuthorizationLog(input), expected);
      entries.push(expected);
    }
    for (const size of [1, 16, 33, 64, 65]) {
      for (const sequence of new Set([1, Math.ceil(size / 2), size])) {
        const acceptance = entries[sequence - 1];
        fixture.batches.length = 0;
        const actual = await store.getAuthorizationMerkleSnapshot(acceptance, size);
        assert.deepEqual(actual, await memory.getAuthorizationMerkleSnapshot(acceptance, size));
        assert.ok(fixture.batches.length <= 1, 'proof node retrieval takes at most one D1 batch');
      }
    }
    await assert.rejects(() => store.getAuthorizationMerkleSnapshot({ ...entries[0], entryHash: 'f'.repeat(64) }), /does not match/);
    fixture.sqlite.exec('DELETE FROM authorization_log_merkle_nodes WHERE start_sequence=33 AND level=5');
    await assert.rejects(() => store.getAuthorizationMerkleSnapshot(entries[0], 64), /incomplete/);
  } finally { fixture.sqlite.close(); }
});

test('D1 targeted claims keep retry times, recover expired leases and reject stale or duplicate owners', async () => {
  const fixture = testD1();
  try {
    const store = createD1Store(fixture.database);
    const job: ObservationJob = { jobId: 'target', idempotencyKey: 'target-key', input: { chainId: 8453, txHash }, state: 'QUEUED', attempts: 0, nextAttemptAt: 1000, createdAt: 0, observation: null, result: null, error: null };
    await store.enqueueJob(job);
    await store.enqueueJob({ ...job, jobId: 'other', idempotencyKey: 'other-key' });
    assert.equal(await store.claimJob(job.jobId, 999, 100), undefined);
    assert.equal(await store.claimJob('missing', 1000), undefined);
    const claims = await Promise.all([store.claimJob(job.jobId, 1000, 100), store.claimJob(job.jobId, 1000, 100)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const original = claims.find((claim) => claim !== undefined)!;
    assert.equal(original.attempts, 1);
    assert.equal((await store.getJob('other'))?.state, 'QUEUED');
    assert.equal(await store.claimJob(job.jobId, 1099, 100), undefined);
    const recovered = await store.claimJob(job.jobId, 1100, 100);
    assert.ok(recovered);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.leaseToken, original.leaseToken);
    assert.equal(await store.saveJob({ ...original, state: 'COMPLETED' }), undefined);
    await store.saveJob({ ...recovered, state: 'RETRY_WAIT', nextAttemptAt: 2000 });
    assert.equal(await store.claimJob(job.jobId, 1999), undefined);
    const retry = await store.claimJob(job.jobId, 2000);
    assert.ok(retry);
    await store.saveJob({ ...retry, state: 'COMPLETED' });
    assert.equal(await store.claimJob(job.jobId, 3000), undefined);
  } finally { fixture.sqlite.close(); }
});
