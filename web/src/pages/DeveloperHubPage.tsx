import { Link } from 'react-router-dom'
import { AppShell, PageHeader } from '../components'
import '../console-developer-hub.css'

const resources = [
  { index: '01', title: 'TypeScript SDK', copy: 'Prepare authorization, collect a wallet signature, observe execution and verify receipts in one typed client.', to: '/app/sdk', action: 'Open SDK guide' },
  { index: '02', title: 'HTTP API', copy: 'Use the stable `/v1` surface, published capabilities and OpenAPI index for service-to-service integrations.', to: '/app/api', action: 'Open API reference' },
  { index: '03', title: 'MCP integration', copy: 'Give a compatible agent client explicit access to PriorSeal authorization, observation and evidence tools.', to: '/integrations/mcp', action: 'Open MCP guide' },
]

export function DeveloperHubPage() {
  return <AppShell>
    <PageHeader eyebrow="BUILD" title="Integrate the evidence workflow.">Choose the interface that owns your integration. Every surface keeps authorization, execution and verification explicit rather than hiding them behind a transaction-signing service.</PageHeader>
    <section className="developer-path" aria-label="Developer integration path"><div><span>01 / PREPARE</span><strong>Request bounded authority</strong></div><div><span>02 / OBSERVE</span><strong>Attach submitted execution</strong></div><div><span>03 / VERIFY</span><strong>Keep evidence portable</strong></div></section>
    <section className="developer-resource-grid">{resources.map((resource) => <article className="panel developer-resource" key={resource.to}><span>{resource.index} / INTERFACE</span><h2>{resource.title}</h2><p>{resource.copy}</p><Link className="text-link" to={resource.to}>{resource.action} →</Link></article>)}</section>
    <section className="developer-boundary panel"><div><span>INTEGRATION BOUNDARY</span><h2>PriorSeal authorizes and proves; your system executes.</h2></div><p>Your application or agent submits its own transaction through its own wallet or executor. Build independent trust into receipt verification by pinning issuer keys and audience configuration through a separate trusted channel.</p><div><Link className="button primary" to="/app/verify">Open local verifier</Link><Link className="button secondary" to="/app/trust/keys">Inspect issuer key directory</Link></div></section>
  </AppShell>
}
