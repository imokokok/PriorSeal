import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, LoadingState, Notice, PageHeader, Status } from '../components'
import { getCapabilities, type Capabilities } from '../lib/api'
import '../console-action-launcher.css'

type Action = {
  index: string
  title: string
  description: string
  scope: string
  to: string
  action: string
}

function availableActions(capabilities: Capabilities): Action[] {
  const profiles = new Set(capabilities.executionProfiles)
  return [
    ...(profiles.has('priorseal.intent.v1') ? [{
      index: '01',
      title: 'Standard authorization',
      description: 'Define an agent, amount, recipient and time boundary before the wallet signs the canonical intent.',
      scope: 'Bounded transfer-style intent',
      to: '/app/actions/standard',
      action: 'Create authorization',
    }] : []),
    ...(profiles.has('priorseal.execution-profile.exact-call.v1') ? [{
      index: '02',
      title: 'Exact EVM call',
      description: 'Import a constructed transaction and bind its chain, executor, nonce, target, calldata hash and native value.',
      scope: 'Exact call envelope',
      to: '/app/actions/exact-call',
      action: 'Import exact call',
    }] : []),
  ]
}

export function ActionLauncherPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setError('')
    getCapabilities().then((value) => { if (active) setCapabilities(value) }).catch((caught: Error) => { if (active) setError(caught.message) })
    return () => { active = false }
  }, [reload])

  const actions = useMemo(() => capabilities ? availableActions(capabilities) : [], [capabilities])

  return <AppShell>
    <PageHeader eyebrow="EXECUTE" title="Choose an authorization." actions={capabilities ? <Status value={capabilities.workflowReady ? 'CONFIGURED' : 'CONFIGURATION REVIEW'} /> : undefined}>Only workflows published by this deployment appear here. An authorization records what an agent may do; submitting a transaction remains a separate action.</PageHeader>
    <section className="action-launcher-intro" aria-label="Authorization boundary"><span>AUTHORITY / BEFORE EXECUTION</span><p>Select the form that matches the binding you need. The console will still show the canonical fields before a wallet is asked to sign.</p></section>
    {!capabilities && !error && <LoadingState label="Checking published execution profiles…" />}
    {error && <Notice tone="warning" title="Published capabilities are unavailable">{error} The console will not guess which authorization flows this deployment supports. <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Try again</button></Notice>}
    {capabilities && actions.length > 0 && <section className="action-choice-grid" aria-label="Available authorization workflows">{actions.map((item) => <article className="panel action-choice" key={item.to}><div className="action-choice__head"><span>{item.index} / AVAILABLE NOW</span><Status value="READY" small /></div><h2>{item.title}</h2><p>{item.description}</p><dl><div><dt>Binding</dt><dd>{item.scope}</dd></div><div><dt>Signature</dt><dd>Authorization data only</dd></div></dl><Link className="button primary" to={item.to}>{item.action} <span aria-hidden="true">→</span></Link></article>)}</section>}
    {capabilities && !actions.length && <Empty title="No authorization workflow is published">This deployment did not advertise a console-compatible authorization profile. Check the configuration with the deployment operator, or use local receipt verification.</Empty>}
    <section className="action-launcher-note"><div><span>AFTER SIGNING</span><h2>Observe execution separately.</h2></div><p>When an independently submitted transaction is ready, pair its hash with a signed authorization. PriorSeal records the result as evidence; it does not hold a transaction-signing key.</p><Link className="text-link" to="/app/observe">Observe an execution →</Link></section>
  </AppShell>
}
