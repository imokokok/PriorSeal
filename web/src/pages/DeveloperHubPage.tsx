import { Link } from 'react-router-dom'
import { AppShell, PageHeader } from '../components'
import '../console-developer-hub.css'

const resources = [
  { index: '01', title: 'TypeScript SDK', copy: 'Prepare authorization, collect a wallet signature, observe execution and verify receipts in one typed client.', to: '/app/sdk', action: 'Open SDK guide' },
  { index: '02', title: 'HTTP API', copy: 'Use the stable `/v1` surface, published capabilities and OpenAPI index for service-to-service integrations.', to: '/app/api', action: 'Open API reference' },
  { index: '03', title: 'MCP integration', copy: 'Give a compatible agent client explicit access to PriorSeal authorization, observation and evidence tools.', to: '/integrations/mcp', action: 'Open MCP guide' },
  { index: '04', title: 'Verified Action quickstart', copy: 'Start with one high-value execution path, then complete its Seal, Witness, Match and Review journey with independently verifiable evidence.', to: '/app/onboarding?start=verified-action', action: 'Start a Verified Action' },
]

export function DeveloperHubPage() {
  return <AppShell>
    <PageHeader eyebrow="BUILD / VERIFIED ACTION" title="Integrate one provable action.">Choose the interface that owns your integration. Every surface keeps authorization, pre-execution proof, execution matching and review explicit rather than hiding them behind a transaction-signing service.</PageHeader>
    <section className="developer-path" aria-label="Verified Action integration path"><div><span>01 / SEAL</span><strong>Request bounded authority</strong></div><div><span>02 / WITNESS</span><strong>Record proof before execution</strong></div><div><span>03 / MATCH</span><strong>Attach submitted execution</strong></div><div><span>04 / REVIEW</span><strong>Keep evidence portable</strong></div></section>
    <section className="developer-resource-grid">{resources.map((resource) => <article className="panel developer-resource" key={resource.to}><span>{resource.index} / INTERFACE</span><h2>{resource.title}</h2><p>{resource.copy}</p><Link className="text-link" to={resource.to}>{resource.action} →</Link></article>)}</section>
    <section className="developer-boundary panel"><div><span>INTEGRATION BOUNDARY</span><h2>PriorSeal proves the action; your system executes it.</h2></div><p>Your application or Agent submits its own transaction through its own wallet or executor. A Verified Action does not create a signing key or an unrestricted mandate. Build independent trust into receipt verification by pinning issuer keys and audience configuration through a separate trusted channel.</p><div><Link className="button primary" to="/app/verify">Open local verifier</Link><Link className="button secondary" to="/app/trust/keys">Inspect issuer key directory</Link></div></section>
  </AppShell>
}
