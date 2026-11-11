import { Link } from 'react-router-dom'
import { AppShell, CodeValue, CopyButton, Notice, PageHeader, Status } from '../components'
import { downloadJson } from '../lib/download'
import { dateTime } from '../lib/format'
import type { AuthorizationRecord } from '../types'
import '../console-outcomes.css'

export function TreasuryPilotOutcomePage({ record }: { record: AuthorizationRecord }) {
  const { authorization } = record
  const witness = record.timestampEvidence
    ? `RFC 3161 timestamp recorded at ${dateTime(record.timestampEvidence.timestamp)}.`
    : record.witnessEvidence
      ? `${record.witnessEvidence.attestations.length} witness attestation${record.witnessEvidence.attestations.length === 1 ? '' : 's'} recorded.`
      : 'The deployment accepted this authorization with its configured proof mode; retain the acceptance record with the payment evidence.'
  const observeTarget = `/app/observe?authorizationId=${encodeURIComponent(authorization.authorizationId)}&pilot=base-usdc-treasury`

  return <AppShell>
    <PageHeader eyebrow="TREASURY PILOT / WITNESS" title="Base USDC authorization accepted.">The payment has not been executed. Give the authorization ID to the customer-controlled executor, then Match the exact submitted Base transaction.</PageHeader>
    <div className="outcome-path" aria-label="Treasury pilot status"><div><span>01 / SEAL</span><strong>Signed boundary</strong></div><div><span>02 / WITNESS</span><strong>Acceptance recorded</strong></div><div><span>03 / MATCH</span><strong>Awaiting customer submission</strong></div><div><span>04 / REVIEW</span><strong>Receipt after finality</strong></div></div>
    <section className="success-result outcome-authorization"><div className="outcome-result-heading"><div><span className="outcome-index">BASE USDC PILOT / ACCEPTED</span><h2>Now submit through your own controls.</h2><p>PriorSeal has not broadcast a transfer or acquired a transaction-signing key. Use the organization’s existing wallet, Safe, agent or payment system to submit only the approved payment.</p></div><Status value="AUTHORIZED" /></div>
      <Notice tone="success" title="Witness-stage evidence">{witness}</Notice>
      <div className="outcome-identifiers"><div><span>AUTHORIZATION ID</span><div className="hash-result"><code>{authorization.authorizationId}</code><CopyButton value={authorization.authorizationId} /></div></div><div><span>INTENT HASH</span><div className="hash-result"><code>{authorization.intentHash}</code><CopyButton value={authorization.intentHash} /></div></div></div>
      <div className="data-grid"><div><dt>Chain</dt><dd>Base (8453)</dd></div><div><dt>Asset</dt><dd><CodeValue value={authorization.intent.asset} /></dd></div><div><dt>Amount</dt><dd>{authorization.intent.amount} atomic USDC units</dd></div><div><dt>Recipient</dt><dd><CodeValue value={authorization.intent.recipient} /></dd></div><div><dt>Executor</dt><dd><CodeValue value={authorization.delegate.executor} /></dd></div><div><dt>Expires</dt><dd>{dateTime(authorization.expiresAt)}</dd></div></div>
      <Notice tone="warning" title="Before you continue">Use the exact approved recipient, atomic amount, executor and nonce. If the payment boundary changes, stop and create a newly reviewed authorization; do not reuse this one.</Notice>
      <div className="result-actions"><button className="button secondary" onClick={() => downloadJson(record, authorization.authorizationId + '.json')}>Download acceptance record</button><Link className="button primary" to={observeTarget}>Match the submitted Base payment →</Link><Link className="text-link" to="/app/treasury-pilot">Return to pilot checklist</Link></div>
    </section>
  </AppShell>
}
