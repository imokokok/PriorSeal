// Generated from transaction-recovery-worker.mts by npm run core:build. Do not edit directly.
import { handleBaseSepoliaDemoStatusRequest } from "./base-sepolia-demo-status.mjs";
const DEMO_STATUS_PATH = "/demo-api/base-sepolia/transaction";
var stdin_default = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === DEMO_STATUS_PATH) return handleBaseSepoliaDemoStatusRequest(request);
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
};
export {
  stdin_default as default
};
