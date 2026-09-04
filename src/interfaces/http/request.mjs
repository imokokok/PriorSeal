import { RunProofError } from '../../core/errors.mjs';
import { assertSafeJson } from '../../shared/safe-json.mjs';
export async function readJsonBody(req, maxBodyBytes, signal) {
  const type = String(req.headers['content-type'] ?? ''); if (!type.toLowerCase().startsWith('application/json')) throw new RunProofError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  const chunks = []; let size = 0;
  for await (const chunk of req) { if (signal?.aborted) throw new RunProofError('REQUEST_ABORTED', 'Request was aborted'); size += chunk.length; if (size > maxBodyBytes) throw new RunProofError('REQUEST_TOO_LARGE', 'Request body exceeds limit'); chunks.push(chunk); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RunProofError('INVALID_JSON', 'Malformed JSON'); }
  return assertSafeJson(body);
}
export function requestPath(req) { return new URL(req.url ?? '/', 'http://runproof.local').pathname; }
