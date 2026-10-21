import { FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import './jupiter-pilot-intake.css'

type PilotBrief = {
  organisation: string
  offer: 'PriorSeal' | 'Insight' | 'Insight + PriorSeal'
  agent: string
  userControl: string
  workflow: string
  assetBand: string
  approver: string
  evidenceConsumer: string
  monthlyVolume: string
  timeline: string
}

const EMPTY_BRIEF: PilotBrief = {
  organisation: '',
  offer: 'Insight + PriorSeal',
  agent: '',
  userControl: 'One exact wallet authorization and one exact transaction signature per swap',
  workflow: '',
  assetBand: 'One small, separately approved mainnet transaction',
  approver: '',
  evidenceConsumer: '',
  monthlyVolume: '1–10 guarded executions',
  timeline: 'Exploring scope',
}

const SENSITIVE_CONTENT = /\b(?:private[ _-]?key|seed[ _-]?phrase|api[ _-]?key|credential|bearer(?:\s+token)?)\b|\b0x[a-fA-F0-9]{40,}\b|\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/i
const SENSITIVE_CONTENT_ERROR = 'Remove wallet addresses, transaction or signature data, private keys and credentials before generating or copying this brief.'

function pilotBriefMarkdown(brief: PilotBrief) {
  return [
    '# Jupiter verified agent-swap pilot brief',
    '',
    `- Organisation or team: ${brief.organisation}`,
    `- Requested offer: ${brief.offer}`,
    '- Network: Solana mainnet-beta',
    `- Agent or application: ${brief.agent}`,
    `- End-user control model: ${brief.userControl}`,
    `- Workflow and decision boundary: ${brief.workflow}`,
    `- Asset and maximum-value band: ${brief.assetBand}`,
    `- Authorizing role: ${brief.approver}`,
    `- Evidence consumer: ${brief.evidenceConsumer}`,
    `- Expected monthly guarded-execution band: ${brief.monthlyVolume}`,
    `- Decision timeline: ${brief.timeline}`,
    '',
    '## Pilot success criterion',
    'A separately approved, small ExactIn swap is proposed by the named Agent or application, explicitly authorized by its wallet principal, relayed once, independently verified, and closed with documented exceptions. This does not establish Agent identity or performance, token safety, price quality, profit, custody, gas sponsorship, repeatable automated authority, or multi-party approval support.',
    '',
    '## Redaction confirmation',
    'This brief intentionally excludes wallet addresses, transaction payloads, token mint addresses, private keys, API credentials, customer personal data, and confidential commercial terms.',
  ].join('\n')
}

export function JupiterPilotIntakePage() {
  const [brief, setBrief] = useState<PilotBrief>(EMPTY_BRIEF)
  const [copied, setCopied] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [sensitiveContentError, setSensitiveContentError] = useState<string | null>(null)
  const markdown = useMemo(() => pilotBriefMarkdown(brief), [brief])

  function hasSensitiveContent() {
    return Object.values(brief).some((value) => SENSITIVE_CONTENT.test(value))
  }

  function update<Key extends keyof PilotBrief>(key: Key, value: PilotBrief[Key]) {
    setBrief((current) => ({ ...current, [key]: value }))
    setCopied(false)
    setSensitiveContentError(null)
  }

  async function copyBrief() {
    if (hasSensitiveContent()) {
      setSensitiveContentError(SENSITIVE_CONTENT_ERROR)
      return
    }
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (hasSensitiveContent()) {
      setSensitiveContentError(SENSITIVE_CONTENT_ERROR)
      setSubmitted(false)
      return
    }
    setSubmitted(true)
  }

  return <main id="main-content" className="jupiter-pilot-intake">
    <header className="jupiter-pilot-intake__nav">
      <Link className="jupiter-pilot-intake__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
      <div><Link to="/jupiter">Agent swaps</Link><Link to="/app">Console</Link></div>
    </header>

    <section className="jupiter-pilot-intake__hero">
      <p className="jupiter-pilot-intake__eyebrow">SOLANA / AGENT-EXECUTION QUALIFICATION</p>
      <h1 data-route-heading tabIndex={-1}>Define the agent pilot<br /><em>before any wallet connects.</em></h1>
      <p>Turn a commercial conversation into a bounded, user-controlled pilot brief. This page does not submit, store, transmit, or analyse what you enter. It is deliberately unsuitable for wallet addresses, transaction data, credentials, or private keys.</p>
    </section>

    <section className="jupiter-pilot-intake__content" aria-label="Jupiter pilot brief form">
      <form onSubmit={submit}>
        <div className="jupiter-pilot-intake__form-heading"><span>01 / QUALIFY</span><h2>Describe the Agent, user boundary and proof owner.</h2></div>
        <label>Organisation or team<input required value={brief.organisation} onChange={(event) => update('organisation', event.target.value)} maxLength={120} autoComplete="organization" /></label>
        <label>Offer being evaluated<select value={brief.offer} onChange={(event) => update('offer', event.target.value as PilotBrief['offer'])}><option>PriorSeal</option><option>Insight</option><option>Insight + PriorSeal</option></select></label>
        <label>Agent or application name<input required value={brief.agent} onChange={(event) => update('agent', event.target.value)} maxLength={120} placeholder="For example: wallet rebalancing assistant or trading copilot" /></label>
        <label>End-user control model<select value={brief.userControl} onChange={(event) => update('userControl', event.target.value)}><option>One exact wallet authorization and one exact transaction signature per swap</option><option>Operator review and signature for each proposed swap</option><option>Other bounded model (requires separate protocol review)</option></select></label>
        <label>Workflow and decision boundary<textarea required value={brief.workflow} onChange={(event) => update('workflow', event.target.value)} maxLength={600} placeholder="For example: an Agent proposes a bounded USDC-to-SOL ExactIn swap; a wallet owner reviews and signs the exact compiled message." /></label>
        <div className="jupiter-pilot-intake__fields"><label>Asset and maximum-value band<select value={brief.assetBand} onChange={(event) => update('assetBand', event.target.value)}><option>One small, separately approved mainnet transaction</option><option>Up to US$1,000 equivalent</option><option>US$1,000–10,000 equivalent</option><option>Above US$10,000 equivalent (requires separate scope review)</option></select></label><label>Expected monthly execution band<select value={brief.monthlyVolume} onChange={(event) => update('monthlyVolume', event.target.value)}><option>1–10 guarded executions</option><option>11–100 guarded executions</option><option>More than 100 guarded executions</option></select></label></div>
        <div className="jupiter-pilot-intake__fields"><label>Authorizing role<input required value={brief.approver} onChange={(event) => update('approver', event.target.value)} maxLength={120} placeholder="Treasury operator, wallet owner or approved delegate" /></label><label>Evidence consumer<input required value={brief.evidenceConsumer} onChange={(event) => update('evidenceConsumer', event.target.value)} maxLength={120} placeholder="Internal controls, auditor or customer reviewer" /></label></div>
        <label>Decision timeline<select value={brief.timeline} onChange={(event) => update('timeline', event.target.value)}><option>Exploring scope</option><option>Pilot decision within 30 days</option><option>Pilot decision within this quarter</option></select></label>
        <p className="jupiter-pilot-intake__notice"><strong>Do not include:</strong> wallet addresses, token mint addresses, transaction or signature data, API keys, private keys, confidential counterparties, or personal customer data. An Agent name is not proof of its identity or performance.</p>
        {sensitiveContentError && <p className="jupiter-pilot-intake__error" role="alert">{sensitiveContentError}</p>}
        <button type="submit">Generate pilot brief <span>→</span></button>
      </form>

      <aside className="jupiter-pilot-intake__guide">
        <span>02 / RUN THE RIGHT PATH</span>
        <dl><div><dt>PriorSeal</dt><dd>Explicit user authority, one-time relay controls and portable execution evidence.</dd></div><div><dt>Insight</dt><dd>Simulation and decision inputs; it is not an economic-safety verdict.</dd></div><div><dt>Combined</dt><dd>Agent proposal → risk or simulation input → exact user authorization → execution → independently reviewable evidence.</dd></div></dl>
        <p>A pilot becomes live only after its scope is agreed and a separate funded GO authorizes one named wallet, Agent/application, route boundary, maximum amount, fees, expiry, support owner and evidence viewers.</p>
      </aside>
    </section>

    {submitted && <section className="jupiter-pilot-intake__result" aria-live="polite">
      <div><span>03 / HAND OFF SAFELY</span><h2>Your brief is ready. It remains in this browser until you copy it or leave the page.</h2><p>Share it through an agreed private business channel. Use the public GitHub form only for redacted developer collaboration; it is not a confidential lead channel.</p></div>
      <div className="jupiter-pilot-intake__result-actions"><button type="button" onClick={copyBrief}>{copied ? 'Copied agent-pilot brief' : 'Copy agent-pilot brief'}</button><a href="https://github.com/imokokok/PriorSeal/issues/new?template=pilot.yml" target="_blank" rel="noreferrer">Open public developer form ↗</a></div>
      {!copied && <textarea aria-label="Generated non-sensitive pilot brief" readOnly value={markdown} />}
    </section>}

    <footer className="jupiter-pilot-intake__footer"><Link to="/jupiter">← Agent-swap boundary</Link><Link to="/privacy">Privacy and storage →</Link></footer>
  </main>
}
