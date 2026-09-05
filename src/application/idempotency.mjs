import { RunProofError } from '../domain/errors.mjs';
import { hashJson } from '../domain/hashing.mjs';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export async function findIdempotentReplay({ scope, key, request, store, now = () => Date.now() }) {
  if (!key) return { requestHash: null, replay: null };
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) throw new RunProofError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1-128 safe characters');
  const requestHash = hashJson(request);
  if (!store.getIdempotency) return { requestHash, replay: null };
  const existing = await store.getIdempotency(scope, key);
  if (!existing || existing.expiresAt <= now()) return { requestHash, replay: null };
  if (existing.requestHash !== requestHash) throw new RunProofError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different request');
  return { requestHash, replay: { replay: true, response: existing.response } };
}

export async function reserveIdempotentResponse({ scope, key, request, requestHash, response, store, now = () => Date.now() }) {
  if (!key || !store.reserveIdempotency) return { replay: false, response };
  return store.reserveIdempotency({ scope, key, requestHash: requestHash ?? hashJson(request), response, expiresAt: now() + 86_400_000 });
}
