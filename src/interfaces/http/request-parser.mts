import { PriorSealError } from '../../domain/errors.mjs';
import { assertSafeJson } from '../../shared/safe-json.mjs';
import type { IncomingMessage } from 'node:http';

export async function readJsonBody(req: IncomingMessage, maxBodyBytes: number, signal?: AbortSignal) {
  const type = String(req.headers['content-type'] ?? ''); if (!type.toLowerCase().startsWith('application/json')) throw new PriorSealError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { if (signal?.aborted) throw new PriorSealError('REQUEST_ABORTED', 'Request was aborted'); size += chunk.length; if (size > maxBodyBytes) throw new PriorSealError('REQUEST_TOO_LARGE', 'Request body exceeds limit'); chunks.push(chunk); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PriorSealError('INVALID_JSON', 'Malformed JSON'); }
  return assertSafeJson(body);
}
export function requestPath(req: IncomingMessage) { return new URL(req.url ?? '/', 'http://priorseal.local').pathname; }
