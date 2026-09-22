import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown, requestId: string, headers: OutgoingHttpHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-request-id': requestId, ...headers });
  res.end(JSON.stringify(body));
}
export function errorBody(code: string, message: string, requestId: string, details?: Record<string, unknown>) { return { error: { code, message, ...(details && Object.keys(details).length ? { details } : {}), requestId } }; }
