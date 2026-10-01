import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { AppShell, CodeValue, CopyButton, Notice, PageHeader, Status } from '../components'
import { downloadJson } from '../lib/download'
import { dateTime } from '../lib/format'
import type { AuthorizationRecord } from '../types'
import '../console-outcomes.css'

export function AuthorizationAcceptedPage({ record }: { record: AuthorizationRecord }) {
  const authorization = record.authorization
  return <AppShell>
    <PageHeader eyebrow="AUTHORIZATION ACCEPTED" title="Authorization accepted">The wallet signature was accepted for this canonical intent. Execution must be submitted and observed separately.</PageHeader>
    <div className="outcome-path" aria-label="Authorization status">
      <div><span>01 / AUTHORITY</span><strong>Signed and accepted</strong></div>
      <div><span>02 / TIME</span><strong>{record.timestampEvidence ? 'Independently stamped' : 'Issuer acceptance only'}</strong></div>
      <div><span>03 / EXECUTION</span><strong>Observe separately</strong></div>
    </div>
    <section className="success-result outcome-authorization">
      <div className="outcome-result-heading"><div><span className="outcome-index">ACCEPTANCE RECORD / 01</span><h2>The authority is recorded.</h2><p>Keep the authorization ID and intent hash with the transaction you plan to observe.</p></div><Status value="AUTHORIZED" /></div>
      {record.timestampEvidence ? <Notice tone="success" title="DigiCert timestamp verified">The signed authorization existed at {dateTime(record.timestampEvidence.timestamp)}. PriorSeal verified the RFC 3161 token before accepting it.</Notice> : <Notice tone="warning" title="Independent timestamp not included">This development authorization has an issuer acceptance statement but no RFC 3161 evidence. Enable the rfc3161 proof mode for independent time.</Notice>}
      <div className="outcome-identifiers">
        <div><span>AUTHORIZATION ID</span><div className="hash-result"><code>{authorization.authorizationId}</code><CopyButton value={authorization.authorizationId} /></div></div>
        <div><span>INTENT HASH</span><div className="hash-result"><code>{authorization.intentHash}</code><CopyButton value={authorization.intentHash} /></div></div>
      </div>
      {record.timestampEvidence && <div className="timestamp-summary"><div><small>Timestamp authority</small><strong>DigiCert RFC 3161</strong></div><div><small>Trusted UTC time</small><strong>{dateTime(record.timestampEvidence.timestamp)}</strong></div><div><small>Token serial</small><CodeValue value={record.timestampEvidence.serialNumber} /></div><div><small>Response hash</small><CodeValue value={record.timestampEvidence.responseHash} /></div></div>}
      <div className="result-actions"><button className="button secondary" onClick={() => downloadJson(record, authorization.authorizationId + '.json')}>Download authorization</button><Link className="button primary" to="/app/observe">Continue to observe execution →</Link></div>
    </section>
  </AppShell>
}

export function ObservationResultFrame({ status, children }: { status: string; children: ReactNode }) {
  return <section className="panel observation-result outcome-observation">
    <div className="panel-head"><div><span className="outcome-index">EXECUTION EVIDENCE / 03</span><h2>Observation result</h2><p>Information returned by the configured chain observer. A signed receipt appears only after a final, verifiable outcome.</p></div><Status value={status} /></div>
    {children}
  </section>
}

export function ReceiptUnavailablePage({ error, receiptId, onRetry }: { error: string; receiptId?: string; onRetry: () => void }) {
  return <AppShell>
    <PageHeader eyebrow="RECEIPT LOOKUP" title="Receipt not available">The requested record could not be opened from this device or the configured API.</PageHeader>
    <section className="outcome-unavailable">
      <div className="outcome-unavailable__marker"><span>RECORD / UNAVAILABLE</span><strong>?</strong></div>
      <div className="outcome-unavailable__content"><span className="outcome-index">RETRIEVAL / NEEDS ATTENTION</span><h2>We could not open this receipt.</h2><p>Check the receipt ID or return to the local collection. If the API is temporarily unavailable, try the same request again.</p>{receiptId && <div className="outcome-requested-id"><span>REQUESTED ID</span><code>{receiptId}</code></div>}<Notice tone="danger" title="Could not retrieve this receipt">{error}</Notice><div className="outcome-actions"><button className="button primary" onClick={onRetry}>Try again</button><Link className="button secondary" to="/app/receipts">Browse local receipts</Link><Link className="text-link" to="/app/verify">Verify a receipt file →</Link></div></div>
    </section>
  </AppShell>
}

export function ConsoleNotFoundPage() {
  return <AppShell>
    <PageHeader eyebrow="CONSOLE / 404" title="Page not found">This address does not match a page in the current PriorSeal console.</PageHeader>
    <section className="outcome-unavailable outcome-missing"><div className="outcome-unavailable__marker"><span>ROUTE / UNKNOWN</span><strong>404</strong></div><div className="outcome-unavailable__content"><span className="outcome-index">NAVIGATION / RECOVERY</span><h2>Return to the collection.</h2><p>Your local evidence remains on this device according to your storage choice. Choose a known workspace page to continue.</p><div className="outcome-actions"><Link className="button primary" to="/app">Open overview</Link><Link className="button secondary" to="/app/receipts">Browse receipts</Link><Link className="text-link" to="/">Public collection →</Link></div></div></section>
  </AppShell>
}

export function PublicNotFoundPage() {
  return <main id="main-content" className="public-document public-missing">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/app">Open console →</Link></header>
    <article><span className="outcome-index">PUBLIC COLLECTION / 404</span><h1 data-route-heading tabIndex={-1}>This page is not in the collection.</h1><p className="public-document__lede">The address may have changed, or the page may no longer be available. You can continue from the public collection or open your local workspace.</p><div className="outcome-actions"><Link className="button primary" to="/">Return to the collection</Link><Link className="button secondary" to="/app">Open console</Link></div><div className="public-missing__footer"><span>PRIORSEAL / AUTHORITY EVIDENCE</span><span>404 / UNKNOWN ADDRESS</span></div></article>
  </main>
}
