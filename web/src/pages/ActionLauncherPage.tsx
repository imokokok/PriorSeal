import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, LoadingState, Notice, PageHeader, Status, useDeploymentCapabilities } from '../components'
import { actionCapabilityFeatures } from '../features/capabilities/feature-registry'
import '../console-action-launcher.css'

export function ActionLauncherPage() {
  const { capabilities, capabilitiesState, capabilitiesError, refreshCapabilities } = useDeploymentCapabilities()
  const actions = useMemo(() => actionCapabilityFeatures(capabilities), [capabilities])

  return <AppShell>
    <PageHeader eyebrow="ACTION / AUTHORITY" title="Choose the action boundary." actions={capabilities ? <Status value={capabilities.workflowReady ? 'CONFIGURED' : 'CONFIGURATION REVIEW'} /> : undefined}>Begin only after the proposal is understood and any required decision evidence has been evaluated. This console records one bounded authorization; it never submits the transaction.</PageHeader>
    <section className="action-launcher-intro" aria-label="Authorization boundary"><span>BEFORE EXECUTION</span><p>Select the form that matches the action you need to constrain. The console shows canonical fields before a wallet is asked to sign; the configured proof mode records ordering evidence when the authorization is accepted. Your wallet or Agent runtime remains responsible for enforcing any required decision gate before submission.</p></section>
    {capabilitiesState === 'loading' && <LoadingState label="Checking published execution profiles…" />}
    {capabilitiesState === 'unavailable' && <Notice tone="warning" title="Published capabilities are unavailable">{capabilitiesError} The console will not guess which authorization flows this deployment supports. <button type="button" className="text-link" onClick={refreshCapabilities}>Try again</button></Notice>}
    {capabilities && actions.length > 0 && <section className="action-choice-grid" aria-label="Available authorization workflows">{actions.map((item, index) => <article className="panel action-choice" key={item.to}><div className="action-choice__head"><span>{String(index + 1).padStart(2, '0')} / AVAILABLE NOW</span><Status value="READY" small /></div><h2>{item.title}</h2><p>{item.description}</p><dl><div><dt>Binding</dt><dd>{item.establishes}</dd></div><div><dt>Signature</dt><dd>Authorization data only</dd></div></dl><Link className="button primary" to={item.to}>{item.action} <span aria-hidden="true">→</span></Link></article>)}</section>}
    {capabilities && !actions.length && <Empty title="No authorization workflow is published">This deployment did not advertise a console-compatible authorization profile. Check the configuration with the deployment operator, or use local receipt verification.</Empty>}
    <section className="action-launcher-note"><div><span>NEXT / OBSERVE</span><h2>Observe the submitted action.</h2></div><p>When your independently controlled executor has submitted the approved transaction, pair its hash with the signed authorization. PriorSeal records the result as evidence; it does not hold a transaction-signing key. Finish by verifying the resulting receipt locally.</p><Link className="text-link" to="/app/observe">Observe execution →</Link></section>
  </AppShell>
}
