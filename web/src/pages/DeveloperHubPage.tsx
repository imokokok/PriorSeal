import { Link } from 'react-router-dom'
import { AppShell, PageHeader } from '../components'
import '../console-developer-hub.css'

const resources = [
  { index: '01', title: 'Define the action', copy: 'Use the TypeScript SDK to make an Agent proposal precise: principal, executor, target, validity window and supported constraints.', to: '/app/sdk', action: 'Open SDK guide' },
  { index: '02', title: 'Own the execution gate', copy: 'Your wallet, Safe, policy service or Agent runtime decides whether assessment and authorization checks are mandatory before submission.', to: '/app/api', action: 'Open API reference' },
  { index: '03', title: 'Connect the decision', copy: 'Bind an independently verified Insight assessment as a commitment without merging risk intelligence, authorization or custody.', to: '/integrations/mcp', action: 'Open integration guide' },
  { index: '04', title: 'Deliver the proof', copy: 'Observe the submitted transaction, export a portable receipt and give the user or reviewer local verification tools.', to: '/app/onboarding?start=verified-action', action: 'Start a Verified Action' },
]

export function DeveloperHubPage() {
  return <AppShell>
    <PageHeader eyebrow="BUILD / TRUSTED AGENT EXECUTION" title="Integrate one controlled action.">Keep the decision, execution gate and evidence responsibilities distinct. Your integration decides whether an Insight assessment and a PriorSeal authorization are required before it submits a transaction.</PageHeader>
    <section className="developer-path" aria-label="Trusted Agent Execution integration path"><div><span>01 / DECISION</span><strong>Inspect the action input</strong></div><div><span>02 / CONTROL</span><strong>Own the submission gate</strong></div><div><span>03 / AUTHORITY</span><strong>Request bounded approval</strong></div><div><span>04 / EVIDENCE</span><strong>Review what happened</strong></div></section>
    <section className="developer-resource-grid">{resources.map((resource) => <article className="panel developer-resource" key={resource.to}><span>{resource.index} / INTERFACE</span><h2>{resource.title}</h2><p>{resource.copy}</p><Link className="text-link" to={resource.to}>{resource.action} →</Link></article>)}</section>
    <section className="developer-boundary panel"><div><span>INTEGRATION BOUNDARY</span><h2>Your system controls execution; PriorSeal proves its supported boundary.</h2></div><p>A Valid Insight assessment is decision evidence, not transaction authority. A Valid PriorSeal authorization is a bounded permission, not an execution service. Place both checks on the submission path you own, then pin issuer keys and audience configuration through a separate trusted channel before relying on exported evidence.</p><div><Link className="button primary" to="/app/verify">Open local verifier</Link><Link className="button secondary" to="/app/trust/keys">Inspect issuer key directory</Link><Link className="text-link" to="/monad">Read a technical proof case →</Link></div></section>
  </AppShell>
}
