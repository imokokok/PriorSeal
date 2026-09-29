import { hashJson } from '../../domain/hashing.mjs';

/** Preserve receipt IDs as immutable links to the same signed evidence. */
export function assertReceiptIdentity(existing: unknown, candidate: unknown): void {
  if (!existing || !candidate || hashJson(existing) === hashJson(candidate)) return;
  const error: Error & { code?: string } = new Error('Receipt ID is already associated with different signed evidence');
  error.code = 'RECEIPT_ID_CONFLICT';
  throw error;
}
