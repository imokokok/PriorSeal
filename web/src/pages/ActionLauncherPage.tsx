import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, LoadingState, Notice, PageHeader, Status, useDeploymentCapabilities } from '../components'
import { actionCapabilityFeatures } from '../features/capabilities/feature-registry'
import '../console-action-launcher.css'

export function ActionLauncherPage() {
  const { capabilities, capabilitiesState, capabilitiesError, refreshCapabilities } = useDeploymentCapabilities()
  const actions = useMemo(() => actionCapabilityFeatures(capabilities), [capabilities])

  return <AppShell>
    <PageHeader eyebrow="EXECUTE" title="Choose an authorization." actions={capabilities ? <Status value={capabilities.workflowReady ? 'CONFIGURED' : 'CONFIGURATION REVIEW'} /> : undefined}>Only workflows published by this deployment appear here. An authorization records what an agent may do; submitting a transaction remains a separate action.</PageHeader>
    <section className="action-launcher-intro" aria-label="Authorization boundary"><span>AUTHORITY / BEFORE EXECUTION</span><p>Select the form that matches the binding you need. The console will still show the canonical fields before a wallet is asked to sign.</p></section>
    {capabilitiesState === 'loading' && <LoadingState label="Checking published execution profiles…" />}
    {capabilitiesState === 'unavailable' && <Notice tone="warning" title="Published capabilities are unavailable">{capabilitiesError} The console will not guess which authorization flows this deployment supports. <button type="button" className="text-link" onClick={refreshCapabilities}>Try again</button></Notice>}
    {capabilities && actions.length > 0 && <section className="action-choice-grid" aria-label="Available authorization workflows">{actions.map((item, index) => <article className="panel action-choice" key={item.to}><div className="action-choice__head"><span>{String(index + 1).padStart(2, '0')} / AVAILABLE NOW</span><Status value="READY" small /></div><h2>{item.title}</h2><p>{item.description}</p><dl><div><dt>Binding</dt><dd>{item.establishes}</dd></div><div><dt>Signature</dt><dd>Authorization data only</dd></div></dl><Link className="button primary" to={item.to}>{item.action} <span aria-hidden="true">→</span></Link></article>)}</section>}
    {capabilities && !actions.length && <Empty title="No authorization workflow is published">This deployment did not advertise a console-compatible authorization profile. Check the configuration with the deployment operator, or use local receipt verification.</Empty>}
    <section className="action-launcher-note"><div><span>AFTER SIGNING</span><h2>Observe execution separately.</h2></div><p>When an independently submitted transaction is ready, pair its hash with a signed authorization. PriorSeal records the result as evidence; it does not hold a transaction-signing key.</p><Link className="text-link" to="/app/observe">Observe an execution →</Link></section>
  </AppShell>
}
