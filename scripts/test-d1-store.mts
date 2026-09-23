import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createD1Store } from '../src/infrastructure/persistence/d1-store.mjs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;');
sqlite.exec(readFileSync(new URL('../d1/migrations/0001_initial.sql', import.meta.url), 'utf8'));
type MockStatement = D1PreparedStatement & { execute(): { results: unknown[]; meta?: { changes: number | bigint } } };
const prepared = (sql: string, values: SQLInputValue[] = []): MockStatement => ({
  bind: (...next: unknown[]) => prepared(sql, next as SQLInputValue[]),
  async first() { return sqlite.prepare(sql).get(...values) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  async run() { const result = sqlite.prepare(sql).run(...values); return { results: [], meta: { changes: result.changes } }; },
  execute() { const statement = sqlite.prepare(sql); return /^(SELECT|UPDATE.*RETURNING|INSERT.*RETURNING)/is.test(sql) ? { results: statement.all(...values) } : { results: [], meta: statement.run(...values) }; },
} as unknown as MockStatement);
const d1 = {
  prepare: (sql: string) => prepared(sql),
  async batch(statements: D1PreparedStatement[]) {
    sqlite.exec('BEGIN');
    try { const results = statements.map((statement) => (statement as MockStatement).execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
} as unknown as D1Database;
const store = createD1Store(d1);
const intent = { intentId: 'test-intent', intentHash: 'test-intent-hash', schema: 'priorseal.intent.v1', chainId: 1, action: 'TRANSFER', sender: 'sender', recipient: 'recipient', asset: 'ETH', amount: '1', nonce: 'n1', validUntil: 2_000_000_000 };
assert.equal((await store.saveIntent(intent)).intentId, intent.intentId);
assert.deepEqual(await store.getIntent(intent.intentId), intent);
assert.equal((await store.reserveIdempotency({ scope: 'test', key: 'key', requestHash: 'hash', response: { ok: 1 }, expiresAt: Date.now() + 30_000 })).replay, false);
assert.equal((await store.reserveIdempotency({ scope: 'test', key: 'key', requestHash: 'hash', response: { ok: 2 }, expiresAt: Date.now() + 30_000 })).replay, true);
type SaveAcceptedInput = Parameters<typeof store.saveAcceptedAuthorization>[0];
const authorization = { authorizationId: 'test-authorization', intentHash: intent.intentHash, intent, principal: { id: 'principal', account: 'account' }, authorizer: { address: 'address', type: 'eip712' }, delegate: { executor: 'executor' }, authorizationNonce: 'auth-nonce', expiresAt: 2_000_000_000, maxUses: 1 } as unknown as SaveAcceptedInput['authorization'];
const accepted = await store.saveAcceptedAuthorization({ authorization, acceptedAt: 1_700_000_000, createRecord: (log) => ({ authorization, acceptance: { ...log } as ReturnType<SaveAcceptedInput['createRecord']>['acceptance'], policy: { allowed: true, reasonCodes: [], policyId: null }, status: 'ACCEPTED', boundTxHash: null, uses: 0 }) });
assert.equal(accepted.acceptance.sequence, 1);
assert.equal((await store.getAuthorization(authorization.authorizationId))!.acceptance.entryHash, accepted.acceptance.entryHash);
assert.equal((await store.getAuthorizationMerkleSnapshot(accepted.acceptance)).size, 1);
const observation = { intentHash: intent.intentHash, chainId: 1, txHash: '0x' + 'a'.repeat(64), status: 'SUCCESS', blockNumber: 10, observedAt: 1_700_000_010, finalityState: 'FINAL' };
const receipt = { receiptId: 'test-receipt', intentHash: intent.intentHash, execution: { txHash: observation.txHash }, schema: 'test-receipt', issuer: 'test', keyId: 'test', outcome: 'SUCCESS' };
assert.equal((await store.saveObservationReceipt({ authorizationId: authorization.authorizationId, claimAuthorization: true, observation, receipt })).ok, true);
assert.equal((await store.getAuthorization(authorization.authorizationId))!.boundTxHash, observation.txHash);
assert.equal((await store.getReceipt(receipt.receiptId))!.receiptId, receipt.receiptId);
assert.equal((await store.getObservation(1, observation.txHash))!.status, 'SUCCESS');
const job = { jobId: 'job-1', idempotencyKey: 'job-key', input: { chainId: 1, txHash: observation.txHash }, state: 'QUEUED', attempts: 0, nextAttemptAt: Date.now() - 1000, createdAt: Date.now(), observation: null, result: null, error: null };
await store.enqueueJob(job);
const [claimed] = await store.claimDueJobs(Date.now(), 1);
assert.ok(claimed);
assert.equal(claimed.state, 'RUNNING');
assert.equal(claimed.attempts, 1);
assert.equal((await store.saveJob({ ...claimed, state: 'COMPLETED', result: { observation } }))!.state, 'COMPLETED');
assert.equal((await store.getJob(job.jobId))!.state, 'COMPLETED');
const entry = { id: 'test-entry', projectId: 'project', environment: 'test', kind: 'authorization', createdAt: 1_700_000_000, artifactHash: 'artifact-hash', supersedesId: null, txHash: observation.txHash, authorizationId: authorization.authorizationId, status: 'ACCEPTED', artifact: { hello: 'world' }, verification: 'NOT_VERIFIED_BY_ARCHIVE' };
assert.equal((await store.saveArchiveEntry(entry)).id, entry.id);
const page = await store.listArchiveEntries({ projectId: 'project', environment: 'test', role: 'reviewer', filters: { txHash: null, authorizationId: null, status: null, from: null, to: null }, filterHash: 'test', cursor: null, limit: 10 });
assert.equal(page.items.length, 1);
assert.equal(page.items[0].artifact, undefined);
console.log('D1 adapter synthetic persistence test passed');
sqlite.close();
