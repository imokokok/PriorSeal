import { handleBaseSepoliaDemoStatusRequest } from './base-sepolia-demo-status.mjs'

const DEMO_STATUS_PATH = '/demo-api/base-sepolia/transaction'

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === DEMO_STATUS_PATH) return handleBaseSepoliaDemoStatusRequest(request)
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  },
}
