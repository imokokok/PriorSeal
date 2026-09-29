import { errorCode } from '../../shared/error-code.mjs';
import { mkdir, open, readFile, rename, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashJson } from '../../domain/hashing.mjs';
import { assertRwaAttempt, createRwaReservation, transitionRwaAttempt } from './rwa-attempt-model.mjs';

export type RwaTransaction = { chainId: number; data: string; from: string; nonce: string; to: string; value: string };
export type RwaAttemptStatus = 'RESERVED' | 'SUBMITTING' | 'SUBMITTED' | 'UNCERTAIN' | 'REJECTED' | 'CONFIRMED' | 'REVERTED';
export type RwaAttempt = { authorizationId: string; executionDigest: string; nonceKey: string; status: RwaAttemptStatus; transaction: RwaTransaction; txHash: string | null; updatedAt: number };
type Journal = { schema: 'priorseal.rwa-attempt-journal.v1'; attempts: Record<string, RwaAttempt>; nonces: Record<string, string> };
type Transition = { status: RwaAttemptStatus; txHash?: string | null; updatedAt: number };

const empty = (): Journal => ({ schema: 'priorseal.rwa-attempt-journal.v1', attempts: {}, nonces: {} });
const fail = (code: string): never => { throw new Error(code); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** One durable local journal for ALL callers using a signer. Not a distributed/NFS lock.
 * Claims never expire or auto-release. A crashed lock requires offline operator recovery.
 * Keep the directory private, persistent, backed up, and outside ephemeral deployments.
 */
export function createRwaAttemptStore({ directory }: { directory: string }) {
  if (!isAbsolute(directory) || directory === '/') fail('RWA_STORE_DIRECTORY_REQUIRED');
  const path = join(directory, 'journal.json'), lock = join(directory, 'journal.lock');
  async function load(): Promise<Journal> {
    try {
      const j: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!object(j)) throw new Error('RWA_JOURNAL_INVALID');
      if (Object.keys(j).sort().join(',') !== 'attempts,nonces,schema' || j.schema !== 'priorseal.rwa-attempt-journal.v1' || !object(j.attempts) || !object(j.nonces)) fail('RWA_JOURNAL_INVALID');
      const attempts = j.attempts as Record<string, unknown>;
      const nonces = j.nonces as Record<string, unknown>;
      for (const [id, a] of Object.entries(attempts)) {
        assertRwaAttempt(a);
        if (hashJson(a.authorizationId) !== id || nonces[a.nonceKey] !== id) fail('RWA_JOURNAL_INVALID');
      }
      if (Object.entries(nonces).some(([nonce,id]) => typeof id !== 'string' || (object(attempts[id]) ? attempts[id].nonceKey : undefined) !== nonce)) fail('RWA_JOURNAL_INVALID');
      return j as Journal;
    } catch (e) { if (errorCode(e) === 'ENOENT') return empty(); throw e; }
  }
  async function commit(j: Journal) {
    const tmp = join(directory, 'journal-' + randomUUID() + '.tmp');
    const file = await open(tmp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(j)); await file.sync(); } finally { await file.close(); }
    await rename(tmp, path);
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async function mutate<T>(action: (journal: Journal) => T): Promise<T> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { await mkdir(lock, { mode: 0o700 }); } catch (e) { if (errorCode(e) === 'EEXIST') fail('RWA_STORE_BUSY_OR_RECOVERY_REQUIRED'); throw e; }
    let durable = false, persistStarted = false;
    try {
      const j = await load(), result = action(j);
      persistStarted = true;
      await commit(j); durable = true;
      return structuredClone(result);
    } finally {
      // Persistence errors leave the lock in place: uncertain disk state must not be reused.
      if (durable || !persistStarted) await rmdir(lock);
    }
  }
  return {
    async get(authorizationId: string): Promise<RwaAttempt | null> { return structuredClone((await load()).attempts[hashJson(authorizationId)] ?? null); },
    async reserve({ authorizationId, transaction, executionDigest, now }: { authorizationId: string; transaction: unknown; executionDigest: string; now: number }) {
      const attempt = createRwaReservation({ authorizationId, transaction, executionDigest, now });
      const id = hashJson(authorizationId), nonceKey = attempt.nonceKey;
      return mutate((j) => {
        if (j.attempts[id]) return { claimed: false, attempt: j.attempts[id] };
        if (j.nonces[nonceKey]) return { claimed: false, attempt: j.attempts[j.nonces[nonceKey]], code: 'RWA_NONCE_ALREADY_RESERVED' };
        j.nonces[nonceKey] = id; j.attempts[id] = attempt;
        return { claimed: true, attempt };
      });
    },
    async transition(authorizationId: string, expected: RwaAttemptStatus[], patch: Transition) {
      const changes = structuredClone(patch);
      return mutate((j) => {
        const a = j.attempts[hashJson(authorizationId)];
        if (!a || !expected.includes(a.status)) fail('RWA_ATTEMPT_STATE_CONFLICT');
        const next = transitionRwaAttempt(a, expected, changes);
        j.attempts[hashJson(authorizationId)] = next; return next;
      });
    },
  };
}
