export function sendJson(res, status, body, requestId, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'x-request-id': requestId, ...headers });
  res.end(JSON.stringify(body));
}
export function errorBody(code, message, requestId, details = undefined) { return { error: { code, message, ...(details && Object.keys(details).length ? { details } : {}), requestId } }; }
