import { PriorSealError } from '../domain/errors.mjs';
import { hashJson } from '../domain/hashing.mjs';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export type IdempotencyResult<Response> = { replay: boolean; response: Response };
export type IdempotencyStore<Response> = {
  getIdempotency?: (scope: string, key: string) => Promise<{ expiresAt: number; requestHash: string; response: Response } | null | undefined>;
  reserveIdempotency?: (entry: { scope: string; key: string; requestHash: string; response: Response; expiresAt: number }) => Promise<IdempotencyResult<Response>>;
};

type IdempotencyInput<Response> = { scope: string; key?: string | null; request: unknown; store: IdempotencyStore<Response>; now?: () => number };

export async function findIdempotentReplay<Response>({ scope, key, request, store, now = () => Date.now() }: IdempotencyInput<Response>) {
  if (!key) return { requestHash: null, replay: null };
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) throw new PriorSealError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1-128 safe characters');
  const requestHash = hashJson(request);
  if (!store.getIdempotency) return { requestHash, replay: null };
  const existing = await store.getIdempotency(scope, key);
  if (!existing || existing.expiresAt <= now()) return { requestHash, replay: null };
  if (existing.requestHash !== requestHash) throw new PriorSealError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different request');
  return { requestHash, replay: { replay: true, response: existing.response } };
}

export async function reserveIdempotentResponse<Response>({ scope, key, request, requestHash, response, store, now = () => Date.now() }: IdempotencyInput<Response> & { requestHash: string | null; response: Response }): Promise<IdempotencyResult<Response>> {
  if (!key || !store.reserveIdempotency) return { replay: false, response };
  return store.reserveIdempotency({ scope, key, requestHash: requestHash ?? hashJson(request), response, expiresAt: now() + 86_400_000 });
}
