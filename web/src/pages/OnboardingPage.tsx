import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Notice, PageHeader, Status } from '../components'
import { api } from '../lib/api'
import { getActivity } from '../lib/storage'

type Readiness = 'checking' | 'ready' | 'unsigned' | 'offline'

export function OnboardingPage() {
  const activity = getActivity()
  const [readiness, setReadiness] = useState<Readiness>('checking')

  useEffect(() => {
    api.keys().then((registry) => setReadiness(registry.keys.some((key) => key.status === 'active') ? 'ready' : 'unsigned')).catch(() => setReadiness('offline'))
  }, [])

  const steps = [
    { title: 'Sign and timestamp a bounded intent', done: activity.authorizations.length > 0, copy: 'Choose exact constraints, authorize them with EIP-712, then let PriorSeal obtain the independent RFC 3161 timestamp.', action: '/app/intents/new', label: 'Sign intent' },
    { title: 'Observe one transaction', done: activity.observations.length > 0, copy: 'Submit an EVM transaction hash. Pending and unavailable results remain explicitly uncertain.', action: '/app/observe', label: 'Observe execution' },
    { title: 'Inspect and verify evidence', done: activity.receipts.length > 0, copy: 'Recompute authorization, DigiCert timestamp, hashes, binding and issuer signatures locally.', action: activity.receipts[0] ? `/app/receipts/${encodeURIComponent(activity.receipts[0].receiptId)}` : '/app/verify', label: activity.receipts.length ? 'Open receipt' : 'Open verifier' },
  ]

  return <AppShell>
    <PageHeader eyebrow="3-MINUTE QUICKSTART" title="Create your first execution proof.">This walkthrough uses the local console. It asks for an authorization signature, never a transaction signature, and does not move funds.</PageHeader>
    <section className="readiness-card panel"><div><h2>Environment readiness</h2><p>API and issuer signing availability</p></div><Status value={readiness === 'ready' ? 'READY' : readiness === 'checking' ? 'CHECKING' : readiness === 'unsigned' ? 'UNSIGNED' : 'OFFLINE'} /></section>
    {readiness === 'unsigned' && <Notice tone="warning" title="Issuer signing is not configured">You can create intents and inspect the product, but observations will not produce signed receipts until an issuer key is configured.</Notice>}
    {readiness === 'offline' && <Notice tone="danger" title="The local API is unavailable">Start the API on port 3000, then reload this page.</Notice>}
    <ol className="onboarding-steps">
      {steps.map((step, index) => <li className="panel" key={step.title}><span className={step.done ? 'step-number done' : 'step-number'}>{step.done ? '✓' : index + 1}</span><div><h2>{step.title}</h2><p>{step.copy}</p></div><Link className={step.done ? 'button secondary' : 'button primary'} to={step.action}>{step.done ? 'Review' : step.label} →</Link></li>)}
    </ol>
    <Notice tone="info" title="What completion means">A completed walkthrough proves the evidence workflow works. It does not certify the transaction’s economic safety or the absolute correctness of its RPC source.</Notice>
  </AppShell>
}
