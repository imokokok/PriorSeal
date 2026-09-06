import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, PageHeader, ReceiptSummary } from '../components'
import { downloadJson } from '../lib/download'
import { chains } from '../lib/format'
import { verifyTimestampProofOffline, type TimestampProofResult } from '../lib/offline-verify'
import { getActivity } from '../lib/storage'

export function AuditPage() {
  const activity = getActivity()
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState('ALL')
  const [chain, setChain] = useState('ALL')
  const [timestampFilter, setTimestampFilter] = useState('ALL')
  const [timestampResults, setTimestampResults] = useState<Record<string, TimestampProofResult>>({})
  const outcomes = [...new Set(activity.receipts.map((receipt) => receipt.outcome))].sort()
  const timestampStatus = (receipt: typeof activity.receipts[number]) => timestampResults[receipt.receiptId]?.status ?? (receipt.authorizationEvidence?.policy?.document?.timestampPolicy ? receipt.authorizationEvidence.timestamp ? 'CHECKING' : 'MISSING' : receipt.authorizationEvidence?.timestamp ? 'INVALID' : 'NOT_REQUIRED')
  const filtered = useMemo(() => activity.receipts.filter((receipt) => {
    const searchable = [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.issuer, receipt.authorizationEvidence?.timestamp?.serialNumber, receipt.authorizationEvidence?.timestamp?.profile, ...receipt.reasonCodes].join(' ').toLowerCase()
    return (outcome === 'ALL' || receipt.outcome === outcome) && (chain === 'ALL' || String(receipt.execution.chainId) === chain) && (timestampFilter === 'ALL' || timestampStatus(receipt) === timestampFilter) && searchable.includes(query.trim().toLowerCase())
  }), [activity.receipts, chain, outcome, query, timestampFilter, timestampResults])
  const attention = activity.receipts.filter((receipt) => receipt.outcome !== 'COMPLETED' || ['INVALID', 'MISSING'].includes(timestampStatus(receipt))).length
  const validTimestamps = activity.receipts.filter((receipt) => timestampStatus(receipt) === 'VALID').length

  useEffect(() => {
    let active = true
    Promise.all(activity.receipts.map(async (receipt) => [receipt.receiptId, await verifyTimestampProofOffline(receipt)] as const)).then((entries) => { if (active) setTimestampResults(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [])

  function exportBundle() {
    const intentHashes = new Set(filtered.map((receipt) => receipt.intentHash))
    const txHashes = new Set(filtered.map((receipt) => receipt.execution.txHash).filter(Boolean))
    downloadJson({ schema: 'runproof.audit-bundle.v2', exportedAt: new Date().toISOString(), scope: { source: 'browser-local-session', filters: { query, outcome, chain, timestamp: timestampFilter } }, summary: { receipts: filtered.length, intents: intentHashes.size, authorizations: activity.authorizations.filter((record) => intentHashes.has(record.authorization.intentHash)).length, validTimestamps: filtered.filter((receipt) => timestampStatus(receipt) === 'VALID').length, attentionRequired: filtered.filter((receipt) => receipt.outcome !== 'COMPLETED' || ['INVALID', 'MISSING'].includes(timestampStatus(receipt))).length }, receipts: filtered, authorizations: activity.authorizations.filter((record) => intentHashes.has(record.authorization.intentHash)), intents: activity.intents.filter((intent) => intent.intentHash && intentHashes.has(intent.intentHash)), observations: activity.observations.filter((observation) => observation.txHash && txHashes.has(observation.txHash)) }, `runproof-audit-${new Date().toISOString().slice(0, 10)}.json`)
  }

  return <AppShell>
    <PageHeader eyebrow="AUDIT WORKSPACE" title="Review local execution evidence." actions={<button className="button secondary" disabled={!filtered.length} onClick={exportBundle}>Export evidence bundle</button>}>Filter signed receipts and export matching evidence with locally available intents and observations. This view is not a server archive.</PageHeader>
    <section className="audit-stats"><article className="panel"><small>Total receipts</small><strong>{activity.receipts.length}</strong></article><article className="panel"><small>Completed</small><strong>{activity.receipts.filter((receipt) => receipt.outcome === 'COMPLETED').length}</strong></article><article className="panel"><small>Valid timestamps</small><strong>{validTimestamps}</strong></article><article className="panel"><small>Needs attention</small><strong>{attention}</strong></article><article className="panel"><small>Filtered result</small><strong>{filtered.length}</strong></article></section>
    <section className="panel audit-panel">
      <div className="audit-filters" aria-label="Receipt filters"><label><span>Search evidence</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Receipt, intent, tx hash, timestamp serial or reason code" /></label><label><span>Outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="ALL">All outcomes</option>{outcomes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Chain</span><select value={chain} onChange={(event) => setChain(event.target.value)}><option value="ALL">All chains</option>{Object.entries(chains).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label><span>Timestamp proof</span><select value={timestampFilter} onChange={(event) => setTimestampFilter(event.target.value)}><option value="ALL">All timestamp states</option><option value="VALID">Valid</option><option value="INVALID">Invalid</option><option value="MISSING">Missing</option><option value="NOT_REQUIRED">Not required</option></select></label></div>
      {filtered.length ? filtered.map((receipt) => <ReceiptSummary key={receipt.receiptId} receipt={receipt} timestampStatus={timestampStatus(receipt)} />) : <Empty title={activity.receipts.length ? 'No evidence matches these filters' : 'No local evidence yet'} action={<Link className="button primary" to="/app/quickstart">Open quickstart →</Link>}>{activity.receipts.length ? 'Adjust the search, outcome, chain or timestamp filters.' : 'Complete the quickstart to create your first local evidence record.'}</Empty>}
    </section>
  </AppShell>
}
