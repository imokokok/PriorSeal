import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, Empty, PageHeader, ReceiptSummary } from '../components'
import { downloadJson } from '../lib/download'
import { chains } from '../lib/format'
import { verifyTimestampProofOffline, type TimestampProofResult } from '../lib/offline-verify'
import { getActivity } from '../lib/storage'
import type { Receipt } from '../types'

const timestampProofCache = new Map<string, Promise<TimestampProofResult>>()

async function timestampProofKey(receipt: Receipt) {
  const evidence = receipt.authorizationEvidence
  const payload = JSON.stringify({
    receiptId: receipt.receiptId,
    authorizationHash: receipt.authorizationHash,
    executionHash: receipt.executionHash,
    executedAt: receipt.execution.executedAt,
    observedAt: receipt.execution.observedAt,
    authorization: evidence?.authorization,
    acceptance: evidence?.acceptance,
    policy: evidence?.policy?.document?.timestampPolicy,
    timestamp: evidence?.timestamp,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyTimestampCached(receipt: Receipt) {
  const key = await timestampProofKey(receipt)
  const cached = timestampProofCache.get(key)
  if (cached) return cached
  const pending = verifyTimestampProofOffline(receipt)
  timestampProofCache.set(key, pending)
  return pending
}

export function AuditPage() {
  const [activity] = useState(getActivity)
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState('ALL')
  const [chain, setChain] = useState('ALL')
  const [timestampFilter, setTimestampFilter] = useState('ALL')
  const [timestampResults, setTimestampResults] = useState<Record<string, TimestampProofResult>>({})
  const outcomes = useMemo(() => [...new Set(activity.receipts.map((receipt) => receipt.outcome))].sort(), [activity.receipts])
  const timestampStatus = useCallback((receipt: Receipt) => timestampResults[receipt.receiptId]?.status ?? (receipt.authorizationEvidence?.policy?.document?.timestampPolicy ? receipt.authorizationEvidence.timestamp ? 'CHECKING' : 'MISSING' : receipt.authorizationEvidence?.timestamp ? 'INVALID' : 'NOT_REQUIRED'), [timestampResults])
  const filtered = useMemo(() => activity.receipts.filter((receipt) => {
    const searchable = [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.issuer, receipt.authorizationEvidence?.timestamp?.serialNumber, receipt.authorizationEvidence?.timestamp?.profile, ...receipt.reasonCodes].join(' ').toLowerCase()
    return (outcome === 'ALL' || receipt.outcome === outcome) && (chain === 'ALL' || String(receipt.execution.chainId) === chain) && (timestampFilter === 'ALL' || timestampStatus(receipt) === timestampFilter) && searchable.includes(query.trim().toLowerCase())
  }), [activity.receipts, chain, outcome, query, timestampFilter, timestampStatus])
  const { attention, validTimestamps } = useMemo(() => ({
    attention: activity.receipts.filter((receipt) => receipt.outcome !== 'COMPLETED' || ['INVALID', 'MISSING'].includes(timestampStatus(receipt))).length,
    validTimestamps: activity.receipts.filter((receipt) => timestampStatus(receipt) === 'VALID').length,
  }), [activity.receipts, timestampStatus])

  useEffect(() => {
    let active = true
    async function verifyInBatches() {
      for (let index = 0; index < activity.receipts.length; index += 4) {
        const batch = activity.receipts.slice(index, index + 4)
        const entries = await Promise.all(batch.map(async (receipt) => [receipt.receiptId, await verifyTimestampCached(receipt)] as const))
        if (!active) return
        setTimestampResults((current) => ({ ...current, ...Object.fromEntries(entries) }))
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
    }
    void verifyInBatches()
    return () => { active = false }
  }, [activity.receipts])

  function exportBundle() {
    const intentHashes = new Set(filtered.map((receipt) => receipt.intentHash))
    const txHashes = new Set(filtered.map((receipt) => receipt.execution.txHash).filter(Boolean))
    downloadJson({ schema: 'priorseal.audit-bundle.v2', exportedAt: new Date().toISOString(), scope: { source: 'browser-local-session', filters: { query, outcome, chain, timestamp: timestampFilter } }, summary: { receipts: filtered.length, intents: intentHashes.size, authorizations: activity.authorizations.filter((record) => intentHashes.has(record.authorization.intentHash)).length, validTimestamps: filtered.filter((receipt) => timestampStatus(receipt) === 'VALID').length, attentionRequired: filtered.filter((receipt) => receipt.outcome !== 'COMPLETED' || ['INVALID', 'MISSING'].includes(timestampStatus(receipt))).length }, receipts: filtered, authorizations: activity.authorizations.filter((record) => intentHashes.has(record.authorization.intentHash)), intents: activity.intents.filter((intent) => intent.intentHash && intentHashes.has(intent.intentHash)), observations: activity.observations.filter((observation) => observation.txHash && txHashes.has(observation.txHash)) }, `priorseal-audit-${new Date().toISOString().slice(0, 10)}.json`)
  }

  return <AppShell>
    <PageHeader eyebrow="EVIDENCE" title="Evidence audit" actions={<button className="button secondary" disabled={!filtered.length} onClick={exportBundle}>Export evidence bundle</button>}>Search, filter and export signed evidence stored on this device. Server-side history is not included.</PageHeader>
    <section className="audit-stats"><article className="panel"><small>Total receipts</small><strong>{activity.receipts.length}</strong></article><article className="panel"><small>Completed</small><strong>{activity.receipts.filter((receipt) => receipt.outcome === 'COMPLETED').length}</strong></article><article className="panel"><small>Valid timestamps</small><strong>{validTimestamps}</strong></article><article className="panel"><small>Needs attention</small><strong>{attention}</strong></article><article className="panel"><small>Filtered result</small><strong>{filtered.length}</strong></article></section>
    <section className="panel audit-panel">
      <div className="audit-filters" aria-label="Receipt filters"><label><span>Search evidence</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Receipt, intent, tx hash, timestamp serial or reason code" /></label><label><span>Outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="ALL">All outcomes</option>{outcomes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Chain</span><select value={chain} onChange={(event) => setChain(event.target.value)}><option value="ALL">All chains</option>{Object.entries(chains).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label><span>Timestamp proof</span><select value={timestampFilter} onChange={(event) => setTimestampFilter(event.target.value)}><option value="ALL">All timestamp states</option><option value="VALID">Valid</option><option value="INVALID">Invalid</option><option value="MISSING">Missing</option><option value="NOT_REQUIRED">Not required</option></select></label></div>
      {filtered.length ? filtered.map((receipt) => <ReceiptSummary key={receipt.receiptId} receipt={receipt} timestampStatus={timestampStatus(receipt)} />) : <Empty title={activity.receipts.length ? 'No evidence matches these filters' : 'No local evidence yet'} action={<Link className="button primary" to="/app/quickstart">Open quickstart →</Link>}>{activity.receipts.length ? 'Adjust the search, outcome, chain or timestamp filters.' : 'Complete the quickstart to create your first local evidence record.'}</Empty>}
    </section>
  </AppShell>
}
