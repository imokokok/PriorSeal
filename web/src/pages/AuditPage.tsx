import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, PageHeader, ReceiptSummary } from '../components'
import { downloadJson } from '../lib/download'
import { chains } from '../lib/format'
import { getActivity } from '../lib/storage'

export function AuditPage() {
  const activity = getActivity()
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState('ALL')
  const [chain, setChain] = useState('ALL')
  const outcomes = [...new Set(activity.receipts.map((receipt) => receipt.outcome))].sort()
  const filtered = useMemo(() => activity.receipts.filter((receipt) => {
    const searchable = [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.issuer, ...receipt.reasonCodes].join(' ').toLowerCase()
    return (outcome === 'ALL' || receipt.outcome === outcome) && (chain === 'ALL' || String(receipt.execution.chainId) === chain) && searchable.includes(query.trim().toLowerCase())
  }), [activity.receipts, chain, outcome, query])
  const attention = activity.receipts.filter((receipt) => receipt.outcome !== 'COMPLETED').length

  function exportBundle() {
    const intentHashes = new Set(filtered.map((receipt) => receipt.intentHash))
    const txHashes = new Set(filtered.map((receipt) => receipt.execution.txHash).filter(Boolean))
    downloadJson({ schema: 'runproof.audit-bundle.v1', exportedAt: new Date().toISOString(), scope: { source: 'browser-local-session', filters: { query, outcome, chain } }, summary: { receipts: filtered.length, intents: intentHashes.size, attentionRequired: filtered.filter((receipt) => receipt.outcome !== 'COMPLETED').length }, receipts: filtered, intents: activity.intents.filter((intent) => intent.intentHash && intentHashes.has(intent.intentHash)), observations: activity.observations.filter((observation) => observation.txHash && txHashes.has(observation.txHash)) }, `runproof-audit-${new Date().toISOString().slice(0, 10)}.json`)
  }

  return <AppShell>
    <PageHeader eyebrow="AUDIT WORKSPACE" title="Review local execution evidence." actions={<button className="button secondary" disabled={!filtered.length} onClick={exportBundle}>Export evidence bundle</button>}>Filter signed receipts and export matching evidence with locally available intents and observations. This view is not a server archive.</PageHeader>
    <section className="audit-stats"><article className="panel"><small>Total receipts</small><strong>{activity.receipts.length}</strong></article><article className="panel"><small>Completed</small><strong>{activity.receipts.filter((receipt) => receipt.outcome === 'COMPLETED').length}</strong></article><article className="panel"><small>Needs attention</small><strong>{attention}</strong></article><article className="panel"><small>Filtered result</small><strong>{filtered.length}</strong></article></section>
    <section className="panel audit-panel">
      <div className="audit-filters" aria-label="Receipt filters"><label><span>Search evidence</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Receipt, intent, tx hash, issuer or reason code" /></label><label><span>Outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="ALL">All outcomes</option>{outcomes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Chain</span><select value={chain} onChange={(event) => setChain(event.target.value)}><option value="ALL">All chains</option>{Object.entries(chains).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label></div>
      {filtered.length ? filtered.map((receipt) => <ReceiptSummary key={receipt.receiptId} receipt={receipt} />) : <Empty title={activity.receipts.length ? 'No evidence matches these filters' : 'No local evidence yet'} action={<Link className="button primary" to="/app/quickstart">Open quickstart →</Link>}>{activity.receipts.length ? 'Adjust the search, outcome or chain filters.' : 'Complete the quickstart to create your first local evidence record.'}</Empty>}
    </section>
  </AppShell>
}
