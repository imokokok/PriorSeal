import { Link } from 'react-router-dom'
import { AppShell, Notice, PageHeader } from '../components'
import '../console-api.css'

export function ApiReferencePage() {
 const endpoints = [
  { stage: 'AUTHORITY', method: 'POST', path: '/v1/authorizations/prepare', title: 'Prepare signed authority', fields: 'Canonical intent, principal, authorizer, agent executor, validity window and one-time nonce. The server fixes audience and policyHash.', example: 'POST /v1/authorizations/prepare' },
  { stage: 'AUTHORITY', method: 'POST', path: '/v1/authorizations', title: 'Accept signed authority', fields: 'The prepared authorization plus its EIP-712 or ERC-1271 signature.', example: '{ \"authorizationId\": \"auth_…\", \"signature\": \"0x…\" }' },
  { stage: 'EXECUTION', method: 'POST', path: '/v1/executions/observe', title: 'Observe authorized execution', fields: 'authorizationId, chainId, txHash, confirmations.', example: '{ \"authorizationId\": \"auth_…\", \"chainId\": 8453, \"txHash\": \"0x…\", \"confirmations\": 12 }' },
  { stage: 'EVIDENCE', method: 'GET', path: '/v1/receipts/:receiptId', title: 'Get receipt', fields: 'Path parameter: receiptId.', example: 'GET /v1/receipts/psr_…' },
  { stage: 'EVIDENCE', method: 'GET', path: '/v1/authorizations/:authorizationId/transparency', title: 'Get transparency proof', fields: 'Signed hash-chain checkpoint and a verified external anchor when one covers this authorization.', example: 'GET /v1/authorizations/auth_…/transparency' },
  { stage: 'EVIDENCE', method: 'POST', path: '/v1/receipts/verify', title: 'Convenience verification', fields: 'receipt: complete signed receipt object.', example: '{ \"receipt\": { \"receiptId\": \"psr_…\", \"signature\": \"…\" } }' },
  { stage: 'TRUST', method: 'GET', path: '/.well-known/priorseal-keys.json', title: 'Published key registry', fields: 'No request body.', example: 'GET /.well-known/priorseal-keys.json' },
 ];
 return <AppShell>
  <PageHeader eyebrow="DEVELOPERS" title="API reference" actions={<Link className="button secondary" to="/app/sdk">Use the TypeScript SDK →</Link>}>These are the API endpoints implemented by this project. Requests and responses are JSON.</PageHeader>
  <div className="reference-path" aria-label="API workflow"><div><span>01 / AUTHORITY</span><strong>Prepare and accept</strong></div><div><span>02 / EXECUTION</span><strong>Observe the transaction</strong></div><div><span>03 / EVIDENCE</span><strong>Retrieve and review</strong></div><div><span>04 / TRUST</span><strong>Discover issuer keys</strong></div></div>
  <Notice tone="warning" title="Verification endpoint is convenient, not authoritative">Validate signed receipt JSON locally whenever independent assurance matters. ERC-1271 and external anchors also require chain-state verification.</Notice>
  <div className="reference-heading"><div><span>ENDPOINT DIRECTORY / V1</span><h2>Follow the evidence path.</h2></div><p>Each card shows the request shape or identifier needed at that step. Use the SDK for a typed integration.</p></div>
  <div className="endpoint-list">{endpoints.map((endpoint, index) => <article className="panel endpoint" key={endpoint.path}>
   <div className="endpoint-index"><span>{String(index + 1).padStart(2, '0')} / {endpoint.stage}</span><span>V1 / JSON</span></div>
   <div className="endpoint-route"><span className={'method ' + endpoint.method.toLowerCase()}>{endpoint.method}</span><code>{endpoint.path}</code></div>
   <h2>{endpoint.title}</h2><p>{endpoint.fields}</p>
   <div className="endpoint-example"><span>REQUEST / EXAMPLE</span><pre>{endpoint.example}</pre></div>
  </article>)}</div>
  <p className="reference-errors"><strong>Typical API errors</strong> INVALID_JSON · INVALID_AUTHORIZATION · AUTHORIZATION_EXPIRED · AUTHORIZATION_ALREADY_USED · POLICY_REJECTED · RPC_FAILURE · REQUEST_TIMEOUT</p>
 </AppShell>
}
