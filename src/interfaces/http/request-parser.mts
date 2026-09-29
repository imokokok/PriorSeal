import { PriorSealError } from '../../domain/errors.mjs';
import { assertSafeJson } from '../../shared/safe-json.mjs';
import type { IncomingMessage } from 'node:http';

export async function readJsonBody(req: IncomingMessage, maxBodyBytes: number, signal?: AbortSignal) {
  const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new PriorSealError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (signal?.aborted) throw new PriorSealError('REQUEST_ABORTED', 'Request was aborted');
    size += chunk.length;
    if (size > maxBodyBytes) throw new PriorSealError('REQUEST_TOO_LARGE', 'Request body exceeds limit');
    chunks.push(chunk);
  }
  if (signal?.aborted) throw new PriorSealError('REQUEST_ABORTED', 'Request was aborted');
  let body: unknown;
  try {
    // JSON on this HTTP boundary is UTF-8. Replacement characters could change signed data.
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new PriorSealError('INVALID_JSON', 'Malformed JSON');
  }
  assertSafeJson(body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PriorSealError('INVALID_REQUEST', 'JSON body must be an object');
  }
  return body as Record<string, unknown>;
}
export function requestPath(req: IncomingMessage) { return new URL(req.url ?? '/', 'http://priorseal.local').pathname; }
