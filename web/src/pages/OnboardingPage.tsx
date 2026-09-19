import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, CodeValue, Field, Notice, PageHeader, Status } from '../components'
import { getCapabilities, type Capabilities } from '../lib/api'
import { chains, dateTime } from '../lib/format'
import { getActivity } from '../lib/storage'

export function OnboardingPage() {
  const activity = getActivity()
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [error, setError] = useState('')
  const [chain, setChain] = useState(8453)
  const [profile, setProfile] = useState('priorseal.execution-profile.exact-call.v1')
  const [reload, setReload] = useState(0)
  const hasTerminalObservation = activity.observations.some((observation) => ['CONFIRMED', 'REVERTED', 'REORGED'].includes(observation.status))
  useEffect(() => { let active = true; setError(''); getCapabilities().then((value) => { if (active) setCapabilities(value) }).catch((caught) => { if (active) { setCapabilities(null); setError(caught.message) } }); return () => { active = false } }, [reload])
  const supported = capabilities?.chains.includes(chain) && capabilities.executionProfiles.includes(profile) && capabilities.authorizers.includes('eip712')
  const chainRpc = capabilities?.chainReadiness?.find((entry) => entry.chainId === chain)?.rpc
  const configured = supported && capabilities?.workflowReady && (chainRpc === undefined || chainRpc === 'configured')
  const steps = [
    { title: 'Sign and timestamp a bounded intent', done: activity.authorizations.length > 0, copy: 'Choose a transfer or import an exact call, review canonical fields and sign the authorization with your wallet. Timestamp availability depends on this deployment.', action: '/app/intents/new', label: 'Sign intent' },
    { title: 'Observe one transaction', done: hasTerminalObservation, copy: 'Submit an EVM transaction hash. Pending and unavailable results remain explicitly uncertain and resume automatically.', action: '/app/observe', label: 'Observe execution' },
    { title: 'Inspect and verify evidence', done: activity.receipts.length > 0, copy: 'Import a receipt or verification bundle with independently obtained issuer and audience configuration. Review any external chain checks.', action: activity.receipts[0] ? `/app/receipts/${encodeURIComponent(activity.receipts[0].receiptId)}` : '/app/verify', label: activity.receipts.length ? 'Open receipt' : 'Open verifier' },
  ]
  return <AppShell><PageHeader eyebrow="WORKFLOW QUICKSTART" title="Create your first execution proof.">This walkthrough uses the local console. It asks for an authorization signature, never a transaction signature, and does not move funds.</PageHeader>
    <section className="panel"><div className="panel-head"><div><h2>Selected workflow configuration</h2><p>Capabilities describe configured support; they do not certify live RPC or timestamp-provider health.</p></div><Status value={error ? 'UNAVAILABLE' : !capabilities ? 'CHECKING' : configured ? 'CONFIGURED' : 'NEEDS CONFIGURATION'} /></div><div className="form-grid"><Field label="Workflow chain"><select value={chain} onChange={(event) => setChain(Number(event.target.value))}>{[...new Set([1, 8453, 84532, 42161, ...(capabilities?.chains ?? [])])].map((id) => <option key={id} value={id}>{chains[id] ?? `Chain ${id}`}</option>)}</select></Field><Field label="Execution profile"><select value={profile} onChange={(event) => setProfile(event.target.value)}><option value="priorseal.execution-profile.exact-call.v1">Exact call</option>{capabilities?.executionProfiles.filter((entry) => entry !== 'priorseal.execution-profile.exact-call.v1').map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></Field></div>
    {capabilities && <><dl className="data-grid"><div><dt>Audience</dt><dd>{capabilities.audience}</dd></div><div><dt>Issuer</dt><dd>{capabilities.issuer}</dd></div><div><dt>Proof mode</dt><dd>{capabilities.proofMode}</dd></div><div><dt>Minimum confirmations</dt><dd>{capabilities.minConfirmations}</dd></div><div><dt>Policy hash</dt><dd><CodeValue value={capabilities.policyHash} /></dd></div><div><dt>Configuration checked</dt><dd>{dateTime(capabilities.checkedAt)}</dd></div>{Object.entries(capabilities.dependencies).map(([name, status]) => <div key={name}><dt>{name}</dt><dd>{status.replaceAll('_', ' ')}</dd></div>)}</dl>{!supported && <Notice tone="warning" title="Selected workflow is not supported">Choose a supported chain and execution profile, or ask the deployment operator to configure this workflow before requesting a wallet signature.</Notice>}{supported && (!capabilities.workflowReady || chainRpc !== undefined && chainRpc !== 'configured') && <Notice tone="warning" title="Required configuration is missing">Resolve the dependency statuses above. Selected-chain RPC: {chainRpc ?? capabilities.dependencies.rpc}. A published key alone does not make this workflow ready.</Notice>}{capabilities.archive.enabled && <Link className="text-link" to="/app/archive">Open private project archive →</Link>}</>}
    {error && <Notice tone="warning" title="Capabilities unavailable">{error} Local verification remains available. This page cannot establish the deployment's supported workflow.</Notice>}<button className="button secondary" onClick={() => setReload((value) => value + 1)}>Refresh capabilities</button></section>
    <ol className="onboarding-steps">{steps.map((step, index) => <li className="panel" key={step.title}><span className={step.done ? 'step-number done' : 'step-number'}>{step.done ? '✓' : index + 1}</span><div><h2>{step.title}</h2><p>{step.copy}</p></div><Link className={step.done ? 'button secondary' : 'button primary'} to={step.action}>{step.done ? 'Review' : step.label} →</Link></li>)}</ol>
    <Notice tone="info" title="What completion means">A completed walkthrough demonstrates the evidence workflow. It does not certify economic safety, live dependency availability or the absolute correctness of an RPC source. Public deployment capabilities do not activate a partnership scope.</Notice>
  </AppShell>
}
