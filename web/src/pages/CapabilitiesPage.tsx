import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { publishedCapabilityFeatures, verifiedActionLayers } from '../features/capabilities/feature-registry'
import { getCapabilities, type Capabilities } from '../lib/api'
import { chains, dateTime } from '../lib/format'
import '../landing/landing.css'
import './capabilities-page.css'

function PublicMark() {
  return <Link className="museum-mark" to="/" aria-label="PriorSeal home"><span className="museum-mark__symbol"><PriorSealMark /></span><span className="museum-mark__name">PriorSeal<small>Verified Action</small></span></Link>
}

export function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    setCapabilities(null)
    setError('')
    getCapabilities().then((value) => { if (active) setCapabilities(value) }).catch((caught: Error) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [refresh])

  const features = useMemo(() => publishedCapabilityFeatures(capabilities), [capabilities])
  const networkNames = capabilities?.chains.map((chainId) => chains[Number(chainId)] ?? (Number(chainId) === 0 ? 'Solana' : `Chain ${chainId}`)) ?? []

  return <div className="priorseal-museum capabilities-public">
    <header className="museum-nav">
      <PublicMark />
      <nav aria-label="Capabilities navigation"><Link to="/">Product</Link><Link to="/integrations/mcp">MCP integration</Link><Link to="/support">Support</Link></nav>
      <Link className="museum-nav__entry" to="/app">Open console <span>↗</span></Link>
    </header>
    <main id="main-content">
      <section className="capabilities-hero">
        <div>
          <p className="museum-kicker">DEPLOYMENT CAPABILITIES / CURRENT</p>
          <h1 data-route-heading tabIndex={-1}>Verified Action,<br /><em>only where configured.</em></h1>
        </div>
        <p>PriorSeal separates supported authorization, observation and verification capabilities from future plans. Every item below is derived from the deployment capability document; no unavailable workflow is presented as ready.</p>
      </section>

      <section className="capabilities-state" aria-live="polite">
        {!capabilities && !error && <p>Reading the published deployment capability document…</p>}
        {error && <div><strong>Published capabilities are unavailable.</strong><p>{error} No deployment-specific capability claim is displayed until the document can be read.</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>}
        {capabilities && <><div><span>CAPABILITY DOCUMENT</span><strong>{capabilities.issuer}</strong><small>Checked {dateTime(capabilities.checkedAt)}</small></div><div><span>WORKFLOW STATE</span><strong>{capabilities.workflowReady ? 'Configured' : 'Configuration review'}</strong><small>{capabilities.workflowReady ? 'Published profiles may be prepared subject to request policy.' : 'Profiles are listed, but a required dependency is not ready.'}</small></div><div><span>NETWORK SCOPE</span><strong>{networkNames.join(' · ') || 'No published network'}</strong><small>Availability is specific to this deployment.</small></div></>}
      </section>

      {capabilities && <section className="capability-register" aria-labelledby="capability-register-title">
        <header><div className="museum-section-id"><span>01</span><p>Capability register</p></div><div><p className="museum-kicker">PUBLISHED, NOT PLANNED</p><h2 id="capability-register-title">Available surfaces<br />and their limits.</h2></div></header>
        <div className="capability-register__list">{features.map((feature, index) => <article key={feature.id}><div className="capability-register__index">{String(index + 1).padStart(2, '0')}<span>PUBLISHED</span></div><div><h3>{feature.title}</h3><p>{feature.description}</p><dl><div><dt>Use when</dt><dd>{feature.useCase}</dd></div><div><dt>Evidence scope</dt><dd>{feature.establishes}</dd></div><div><dt>Does not establish</dt><dd>{feature.doesNotEstablish}</dd></div></dl></div><Link className="museum-text-link" to={feature.to}>{feature.action} <span>→</span></Link></article>)}</div>
      </section>}

      <section className="capability-register" aria-labelledby="verified-action-layers-title">
        <header><div className="museum-section-id"><span>02</span><p>Product architecture</p></div><div><p className="museum-kicker">ONE OUTCOME / FOUR RESPONSIBILITIES</p><h2 id="verified-action-layers-title">Seal, Witness,<br />Match, Review.</h2></div></header>
        <div className="capability-register__list">{verifiedActionLayers.map((layer, index) => <article key={layer.id}><div className="capability-register__index">{String(index + 1).padStart(2, '0')}<span>{layer.label.toUpperCase()}</span></div><div><h3>{layer.title}</h3><p>{layer.copy}</p><dl><div><dt>Boundary</dt><dd>{layer.boundary}</dd></div></dl></div></article>)}</div>
      </section>

      <section className="capabilities-boundary">
        <div><p className="museum-kicker">OPERATING BOUNDARY</p><h2>Published does not mean<br /><em>unbounded.</em></h2></div>
        <p>The four responsibilities form one Verified Action; they are not four independent promises that this deployment makes. Each remains subject to deployment policy, trusted configuration and the exact request being evaluated. PriorSeal records and verifies explicit evidence; it does not custody assets, hold transaction-signing keys or certify economic safety.</p>
      </section>
    </main>
  </div>
}
