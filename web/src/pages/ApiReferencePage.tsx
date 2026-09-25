import { Link } from 'react-router-dom'
import { AppShell, Notice, PageHeader } from '../components'

export function ApiReferencePage() {
 const endpoints = [
  { method: 'POST', path: '/v1/authorizations/prepare', title: 'Prepare signed authority', fields: 'Canonical intent, principal, authorizer, agent executor, validity window and one-time nonce. The server fixes audience and policyHash.', example: 'POST /v1/authorizations/prepare' },
  { method: 'POST', path: '/v1/authorizations', title: 'Accept signed authority', fields: 'The prepared authorization plus its EIP-712 or ERC-1271 signature.', example: '{ \"authorizationId\": \"auth_…\", \"signature\": \"0x…\" }' },
  { method: 'GET', path: '/v1/authorizations/:authorizationId/transparency', title: 'Get transparency proof', fields: 'Signed hash-chain checkpoint and a verified external anchor when one covers this authorization.', example: 'GET /v1/authorizations/auth_…/transparency' },
  { method: 'POST', path: '/v1/executions/observe', title: 'Observe authorized execution', fields: 'authorizationId, chainId, txHash, confirmations.', example: '{ \"authorizationId\": \"auth_…\", \"chainId\": 8453, \"txHash\": \"0x…\", \"confirmations\": 12 }' },
  { method: 'GET', path: '/v1/receipts/:receiptId', title: 'Get receipt', fields: 'Path parameter: receiptId.', example: 'GET /v1/receipts/psr_…' },
  { method: 'POST', path: '/v1/receipts/verify', title: 'Convenience verification', fields: 'receipt: complete signed receipt object.', example: '{ \"receipt\": { \"receiptId\": \"psr_…\", \"signature\": \"…\" } }' },
  { method: 'GET', path: '/.well-known/priorseal-keys.json', title: 'Published key registry', fields: 'No request body.', example: 'GET /.well-known/priorseal-keys.json' },
 ];
 return <AppShell><PageHeader eyebrow="DEVELOPERS" title="API reference" actions={<Link className="button secondary" to="/app/sdk">Use the TypeScript SDK →</Link>}>These are the API endpoints implemented by this project. Requests and responses are JSON.</PageHeader><Notice tone="warning" title="Verification endpoint is convenient, not authoritative">Validate signed receipt JSON locally whenever independent assurance matters. ERC-1271 and external anchors also require chain-state verification.</Notice><div className="endpoint-list">{endpoints.map((endpoint) => <article className="panel endpoint" key={endpoint.path}><div><span className={'method ' + endpoint.method.toLowerCase()}>{endpoint.method}</span><code>{endpoint.path}</code></div><h2>{endpoint.title}</h2><p>{endpoint.fields}</p><pre>{endpoint.example}</pre><small>Typical errors: INVALID_JSON, INVALID_AUTHORIZATION, AUTHORIZATION_EXPIRED, AUTHORIZATION_ALREADY_USED, POLICY_REJECTED, RPC_FAILURE, REQUEST_TIMEOUT.</small></article>)}</div></AppShell>
}
