import { hashJson } from '../../domain/hashing.mjs';
import type { RwaAttempt, RwaAttemptStatus, RwaTransaction } from './rwa-attempt-store.mjs';

export type RwaReservation = { authorizationId: string; transaction: unknown; executionDigest: string; now: number };
export type RwaTransition = { status: RwaAttemptStatus; txHash?: string | null; updatedAt: number };
export interface RwaAttemptStore {
  get(authorizationId: string): Promise<RwaAttempt | null>;
  reserve(input: RwaReservation): Promise<{ claimed: boolean; attempt: RwaAttempt; code?: string }>;
  transition(authorizationId: string, expected: RwaAttemptStatus[], patch: RwaTransition): Promise<RwaAttempt>;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const authorizationId = (v: unknown): v is string => typeof v === 'string' && /^auth_[0-9a-f]{32}$/.test(v);
const nonceKey = (tx: RwaTransaction): string => hashJson({ chainId: tx.chainId, sender: tx.from, nonce: tx.nonce });
export function assertRwaAuthorizationId(id: unknown): asserts id is string {
  if (!authorizationId(id)) throw new Error('RWA_RESERVATION_INVALID');
}
function transaction(v: unknown): v is RwaTransaction {
  return object(v) && Object.keys(v).sort().join(',') === 'chainId,data,from,nonce,to,value' &&
    typeof v.chainId === 'number' && Number.isSafeInteger(v.chainId) && v.chainId > 0 &&
    [v.from, v.to].every(a => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a)) &&
    typeof v.data === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(v.data) && uint(v.nonce) && uint(v.value);
}
export function createRwaReservation(input: RwaReservation): RwaAttempt {
  const v = structuredClone(input);
  assertRwaAuthorizationId(v.authorizationId);
  if (!hash(v.executionDigest) || !time(v.now) || !transaction(v.transaction)) throw new Error('RWA_RESERVATION_INVALID');
  return { authorizationId: v.authorizationId, executionDigest: v.executionDigest,
    nonceKey: nonceKey(v.transaction),
    transaction: v.transaction, status: 'RESERVED', txHash: null, updatedAt: v.now };
}
/** Validate a stored attempt without cloning it, so a file journal is checked in one pass. */
export function assertRwaAttempt(value: unknown, reservationErrorCode = 'RWA_JOURNAL_INVALID'): asserts value is RwaAttempt {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'authorizationId,executionDigest,nonceKey,status,transaction,txHash,updatedAt') throw new Error('RWA_JOURNAL_INVALID');
  if (!authorizationId(value.authorizationId) || !hash(value.executionDigest) || !time(value.updatedAt) || !transaction(value.transaction)) throw new Error(reservationErrorCode);
  if (value.nonceKey !== nonceKey(value.transaction) || typeof value.status !== 'string' ||
    !['RESERVED','SUBMITTING','SUBMITTED','UNCERTAIN','REJECTED','CONFIRMED','REVERTED'].includes(value.status) ||
    (['SUBMITTED','CONFIRMED','REVERTED'].includes(value.status) ? !hash(value.txHash) : value.txHash !== null)) throw new Error('RWA_JOURNAL_INVALID');
}
/** Validate database JSON and its separately indexed identities before any use. */
export function persistedRwaAttempt(value: unknown, authorizationId: unknown, indexedNonceKey: unknown): RwaAttempt {
  assertRwaAttempt(value, 'RWA_RESERVATION_INVALID');
  if (value.authorizationId !== authorizationId || value.nonceKey !== indexedNonceKey) throw new Error('RWA_JOURNAL_INVALID');
  return structuredClone(value) as RwaAttempt;
}
export function transitionRwaAttempt(attempt: RwaAttempt, expected: RwaAttemptStatus[], patch: RwaTransition): RwaAttempt {
  const changes = structuredClone(patch);
  if (!Array.isArray(expected) || !expected.includes(attempt.status)) throw new Error('RWA_ATTEMPT_STATE_CONFLICT');
  if (!time(changes.updatedAt) || changes.updatedAt < attempt.updatedAt) throw new Error('RWA_ATTEMPT_TIME_INVALID');
  const allowed: Partial<Record<RwaAttemptStatus, RwaAttemptStatus[]>> = { RESERVED: ['SUBMITTING','REJECTED'], SUBMITTING: ['SUBMITTED','UNCERTAIN','CONFIRMED','REVERTED'], SUBMITTED: ['CONFIRMED','REVERTED'], UNCERTAIN: ['CONFIRMED','REVERTED'] };
  if (!allowed[attempt.status]?.includes(changes.status) || Object.keys(changes).some(k => !['status','txHash','updatedAt'].includes(k))) throw new Error('RWA_ATTEMPT_TRANSITION_INVALID');
  if (changes.txHash != null && !hash(changes.txHash)) throw new Error('RWA_TX_HASH_INVALID');
  if (['SUBMITTED','CONFIRMED','REVERTED'].includes(changes.status) && !hash(changes.txHash ?? attempt.txHash)) throw new Error('RWA_TX_HASH_REQUIRED');
  if (['REJECTED','SUBMITTING','UNCERTAIN'].includes(changes.status) && changes.txHash != null) throw new Error('RWA_TX_HASH_UNEXPECTED');
  if (attempt.txHash && changes.txHash !== undefined && attempt.txHash !== changes.txHash) throw new Error('RWA_TX_HASH_CONFLICT');
  return { ...attempt, ...changes };
}
