// Generated from request-parser.mts by npm run core:build. Do not edit directly.
import { PriorSealError } from "../../domain/errors.mjs";
import { assertSafeJson } from "../../shared/safe-json.mjs";
async function readJsonBody(req, maxBodyBytes, signal) {
  const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new PriorSealError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if (signal?.aborted) throw new PriorSealError("REQUEST_ABORTED", "Request was aborted");
    size += chunk.length;
    if (size > maxBodyBytes) throw new PriorSealError("REQUEST_TOO_LARGE", "Request body exceeds limit");
    chunks.push(chunk);
  }
  if (signal?.aborted) throw new PriorSealError("REQUEST_ABORTED", "Request was aborted");
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new PriorSealError("INVALID_JSON", "Malformed JSON");
  }
  assertSafeJson(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PriorSealError("INVALID_REQUEST", "JSON body must be an object");
  }
  return body;
}
function requestPath(req) {
  return new URL(req.url ?? "/", "http://priorseal.local").pathname;
}
export {
  readJsonBody,
  requestPath
};
