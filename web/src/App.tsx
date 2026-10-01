import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { generateAuthorizationNonce } from 'priorseal-sdk'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { AppShell, CodeValue, CopyButton, Empty, Field, LoadingState, Notice, PageHeader, ReceiptSummary, Status, receiptPrimaryStatus } from './components'
import { api, getCapabilities, type Capabilities } from './lib/api'
import { downloadJson } from './lib/download'
import { chains, dateTime, fromUnix, reasonText, short, toUnix } from './lib/format'
import { activityChangeEvent, getActivity, getStoragePreference, session, storagePreferenceEvent } from './lib/storage'
import type { ApiError, AuthorizationRecord, Eip1193Provider, Execution, Intent, ObservationJob, ObservationResult, Receipt } from './types'
import './console-collection.css'
import './console-operations.css'
import './console-receipts.css'

const AuditPage = lazy(() => import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })))
const SdkPage = lazy(() => import('./pages/SdkPage').then((module) => ({ default: module.SdkPage })))
const ExactCallPage = lazy(() => import('./pages/ExactCallPage').then((module) => ({ default: module.ExactCallPage })))
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((module) => ({ default: module.ArchivePage })))
const VerifyPage = lazy(() => import('./pages/VerifyPage').then((module) => ({ default: module.VerifyPage })))
const EvidenceRelationshipView = lazy(() => import('./EvidenceRelationshipView').then((module) => ({ default: module.EvidenceRelationshipView })))
const KeysPage = lazy(() => import('./pages/KeysPage').then((module) => ({ default: module.KeysPage })))
const ApiReferencePage = lazy(() => import('./pages/ApiReferencePage').then((module) => ({ default: module.ApiReferencePage })))

const makeId = () => 'intent_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16)
const futureInput = () => fromUnix(Math.floor(Date.now() / 1000) + 86400)
const blankIntent = (): Intent => ({ intentId: makeId(), chainId: 8453, action: 'TRANSFER', asset: 'eip155:8453/native', amount: '', sender: '', recipient: '', validUntil: Math.floor(Date.now() / 1000) + 86400, nonce: '', constraints: { minConfirmations: 12 } })
const errorMessage = (error: unknown) => { const e = error as ApiError; return (e.code ? e.code + ': ' : '') + (e.message ?? 'Something went wrong.') }

type OverviewActivity = {
  id: string
  type: 'Authorization' | 'Observation' | 'Receipt'
  status: string
  reference: string
  chainId?: number | string
  timestamp: number
  to: string
}

function Overview() {
  const [activity, setActivity] = useState(getActivity())
  const [storagePreference, setStoragePreferenceState] = useState(getStoragePreference())
  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'offline'>('checking')
  useEffect(() => {
    const refresh = () => setActivity(getActivity())
    let active = true
    const syncStorage = () => { refresh(); setStoragePreferenceState(getStoragePreference()) }
    window.addEventListener('focus', refresh)
    window.addEventListener(activityChangeEvent, refresh)
    window.addEventListener(storagePreferenceEvent, syncStorage)
    api.readiness().then(() => { if (active) setReadiness('ready') }).catch(() => { if (active) setReadiness('offline') })
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener(activityChangeEvent, refresh); window.removeEventListener(storagePreferenceEvent, syncStorage) }
  }, [])

  const now = Math.floor(Date.now() / 1000)
  const activeAuthorizations = activity.authorizations.filter((record) => (record.status ?? 'ACCEPTED') === 'ACCEPTED' && !record.boundTxHash && Number(record.authorization.expiresAt) >= now)
  const pendingObservations = activity.observations.filter((observation) => observation.status === 'PENDING').length
  const attentionObservations = activity.observations.filter((observation) => ['REVERTED', 'REORGED', 'NOT_FOUND', 'RPC_ERROR', 'UNSUPPORTED_CHAIN'].includes(observation.status))
  const attentionReceipts = activity.receipts.filter((receipt) => receipt.compliance ? receipt.compliance.status !== 'COMPLIANT' : receipt.outcome !== 'COMPLETED' || !receipt.binding.bound)
  const attentionCount = attentionObservations.length + attentionReceipts.length
  const recent: OverviewActivity[] = [
    ...activity.authorizations.map((record) => ({ id: `authorization-${record.authorization.authorizationId}`, type: 'Authorization' as const, status: record.boundTxHash ? 'BOUND' : record.status ?? 'ACCEPTED', reference: record.authorization.authorizationId, chainId: record.authorization.intent.chainId, timestamp: record.acceptance.acceptedAt, to: record.boundTxHash ? '/app/audit' : '/app/observe' })),
    ...activity.observations.map((observation, index) => ({ id: `observation-${observation.txHash ?? index}-${observation.observedAt ?? index}`, type: 'Observation' as const, status: observation.status, reference: observation.txHash ?? 'No transaction hash', chainId: observation.chainId, timestamp: observation.observedAt ?? observation.executedAt ?? 0, to: '/app/audit' })),
    ...activity.receipts.map((receipt) => ({ id: `receipt-${receipt.receiptId}`, type: 'Receipt' as const, status: receiptPrimaryStatus(receipt), reference: receipt.receiptId, chainId: receipt.execution.chainId, timestamp: receipt.issuedAt, to: `/app/receipts/${encodeURIComponent(receipt.receiptId)}` })),
  ].sort((left, right) => right.timestamp - left.timestamp).slice(0, 8)

  return <AppShell>
    <header className="console-feature">
      <div className="console-feature__copy">
        <p className="console-feature__index">PRIORSEAL / LOCAL COLLECTION <span>001 — WORKSPACE</span></p>
        <h1 data-route-heading tabIndex={-1}>Evidence,<br /><em>in view.</em></h1>
        <p>Monitor signed authority, observed execution and portable evidence on this device.</p>
        <div className="console-feature__actions"><Link className="button primary" to="/app/intents/new">New authorization <span aria-hidden="true">→</span></Link><Link className="button secondary" to="/app/verify">Verify receipt <span aria-hidden="true">↗</span></Link></div>
      </div>
      <div className="console-feature__visual" aria-hidden="true">
        <div className="console-feature__visual-top"><span>THE EVIDENCE PATH</span><span>FIG. 01 / 03</span></div>
        <div className="console-feature__flow"><div><span>01</span><strong>Authorize</strong><small>Before action</small></div><div><span>02</span><strong>Observe</strong><small>On chain</small></div><div><span>03</span><strong>Verify</strong><small>Beyond the service</small></div></div>
        <p>What was permitted <span>↗</span> what happened</p>
      </div>
    </header>

    <section className="metric-grid" aria-label="Workspace metrics">
      <Link to="/app/observe" className="metric-card"><span className="metric-card__index">01 / AUTHORITY <b aria-hidden="true">↗</b></span><span>Active authorizations</span><strong>{activeAuthorizations.length}</strong><small>Accepted and available to bind</small></Link>
      <Link to="/app/audit" className="metric-card"><span className="metric-card__index">02 / EXECUTION <b aria-hidden="true">↗</b></span><span>Pending observations</span><strong>{pendingObservations}</strong><small>Awaiting execution finality</small></Link>
      <Link to="/app/receipts" className="metric-card"><span className="metric-card__index">03 / EVIDENCE <b aria-hidden="true">↗</b></span><span>Signed receipts</span><strong>{activity.receipts.length}</strong><small>Portable evidence on this device</small></Link>
      <Link to="/app/audit" className={`metric-card ${attentionCount ? 'attention' : ''}`}><span className="metric-card__index">04 / REVIEW <b aria-hidden="true">↗</b></span><span>Needs attention</span><strong>{attentionCount}</strong><small>{attentionCount ? 'Review failed or unbound evidence' : 'No local evidence exceptions'}</small></Link>
    </section>

    <div className="overview-grid">
      <section className="panel recent-activity">
        <div className="panel-head"><div><h2>Recent activity</h2><p>Newest authorizations, observations and receipts in this local workspace.</p></div><Link className="text-link" to="/app/audit">Open evidence audit →</Link></div>
        {recent.length ? <div className="activity-table" role="table" aria-label="Recent evidence activity"><div className="activity-table-head" role="row"><span>Status</span><span>Type</span><span>Reference</span><span>Network</span><span>Recorded</span><span /></div>{recent.map((item) => <Link className="activity-table-row" role="row" to={item.to} key={item.id}><span><Status value={item.status} small /></span><strong>{item.type}</strong><code title={item.reference}>{short(item.reference, 12, 6)}</code><span>{item.chainId ? chains[Number(item.chainId)] ?? `Chain ${item.chainId}` : '—'}</span><time>{dateTime(item.timestamp)}</time><b aria-hidden="true">→</b></Link>)}</div> : <Empty title="No local activity yet" action={<Link className="button primary" to="/app/intents/new">Create authorization</Link>}>Create a signed authorization to start an auditable execution trail.</Empty>}
      </section>

      <aside className="overview-side">
        <section className="panel attention-panel">
          <div className="panel-head"><div><h2>Attention</h2><p>Evidence that may require review.</p></div><Status value={attentionCount ? `${attentionCount} OPEN` : 'CLEAR'} small /></div>
          {attentionCount ? <div className="attention-list">{attentionObservations.slice(0, 3).map((observation, index) => <Link to="/app/audit" key={`${observation.txHash}-${index}`}><Status value={observation.status} small /><span><strong>Observation exception</strong><small>{short(observation.txHash, 11, 6)}</small></span><b>→</b></Link>)}{attentionReceipts.slice(0, Math.max(0, 3 - attentionObservations.length)).map((receipt) => <Link to={`/app/receipts/${encodeURIComponent(receipt.receiptId)}`} key={receipt.receiptId}><Status value={receiptPrimaryStatus(receipt)} small /><span><strong>Receipt requires review</strong><small>{short(receipt.receiptId, 11, 6)}</small></span><b>→</b></Link>)}</div> : <div className="attention-clear"><span>✓</span><div><strong>No local exceptions</strong><p>Failed observations and non-compliant receipts will appear here.</p></div></div>}
        </section>

        <section className="panel infrastructure-panel">
          <div className="panel-head"><div><h2>Infrastructure</h2><p>Current workspace dependencies.</p></div></div>
          <dl className="health-list"><div><dt><span className={`live-dot ${readiness}`} />PriorSeal API</dt><dd>{readiness === 'ready' ? 'Ready' : readiness === 'offline' ? 'Unavailable' : 'Checking'}</dd></div><div><dt><span className={"live-dot " + (storagePreference === 'granted' ? 'online' : 'checking')} />Local saving</dt><dd>{storagePreference === 'granted' ? 'Allowed' : 'Session only'}</dd></div><div><dt><span className="live-dot online" />Offline verifier</dt><dd>Available</dd></div></dl>
          <Link className="text-link" to="/app/keys">Inspect key registry →</Link>
        </section>
      </aside>
    </div>

    <p className="scope-note"><strong>Local workspace:</strong> this overview reflects evidence from this page session or, with permission, this browser &mdash;not an organization-wide server history. <Link to="/app/quickstart">Review workspace scope</Link></p>
  </AppShell>
}

function CreateIntent() {
 const navigate = useNavigate(); const [intent, setIntent] = useState(blankIntent); const [date, setDate] = useState(futureInput); const [result, setResult] = useState<AuthorizationRecord | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [advanced, setAdvanced] = useState(false); const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
 useEffect(() => { getCapabilities().then((value) => { setCapabilities(value); setIntent((current) => ({ ...current, constraints: { ...current.constraints, minConfirmations: Math.max(current.constraints?.minConfirmations ?? 0, value.minConfirmations), ...(value.maxToleratedReorgDepth == null ? {} : { maxToleratedReorgDepth: Math.max(current.constraints?.maxToleratedReorgDepth ?? 0, value.maxToleratedReorgDepth) }), ...(value.finalityRequirement === 'RPC_FINALIZED' ? { finalityRequirement: 'RPC_FINALIZED' as const } : {}) } })) }).catch(() => { /* Preparation remains blocked until deployment scope is known. */ }) }, [])
 const update = <K extends keyof Intent>(key: K, value: Intent[K]) => setIntent((current) => ({ ...current, [key]: value }))
 const validation = useMemo(() => ({ sender: intent.sender && !/^0x[a-fA-F0-9]{40}$/.test(intent.sender) ? 'Use a 0x-prefixed 40-character EVM address.' : '', recipient: intent.recipient && !/^0x[a-fA-F0-9]{40}$/.test(intent.recipient) ? 'Use a 0x-prefixed 40-character EVM address.' : '', amount: intent.amount && !/^(0|[1-9]\d*)$/.test(intent.amount) ? 'Use an unsigned atomic-unit integer without decimals or leading zeroes.' : '', nonce: intent.nonce && !/^(0|[1-9]\d*)$/.test(intent.nonce) ? 'Use the exact unsigned transaction nonce.' : '' }), [intent])
 async function submit(event: FormEvent) {
  event.preventDefault()
  setError('')
  const validUntil = toUnix(date)
  if (!intent.intentId || !intent.action || !intent.asset || !intent.amount || !intent.sender || !intent.recipient || !intent.nonce || !Number.isFinite(validUntil) || validUntil <= Math.floor(Date.now() / 1000) || Object.values(validation).some(Boolean)) {
   setError('Complete every field, including the exact nonce and a future expiry.')
   return
  }
  if (!capabilities) {
   setError('Load deployment capabilities before creating authorization. Check Quickstart and reload this page.')
   return
  }
  if (!capabilities.chains.includes(Number(intent.chainId)) || !capabilities.authorizers.includes('eip712') || !capabilities.executionProfiles.includes('priorseal.intent.v1') || capabilities.chainReadiness?.find((entry) => entry.chainId === Number(intent.chainId))?.rpc === 'unavailable' || !capabilities.workflowReady) {
   setError('This deployment is not configured for the selected chain and authorization workflow. Check Quickstart before requesting a wallet signature.')
   return
  }
  if ((capabilities.finalityRequirement === 'RPC_FINALIZED' && intent.constraints?.finalityRequirement !== 'RPC_FINALIZED') || (capabilities.maxToleratedReorgDepth != null && (intent.constraints?.maxToleratedReorgDepth ?? -1) < capabilities.maxToleratedReorgDepth)) {
   setError('The signed finality criterion and reorg buffer must meet the deployment policy.')
   return
  }
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!ethereum) {
   setError('An EIP-1193 wallet is required to authorize this intent.')
   return
  }
  const reviewDeclined = new Error('Canonical intent review declined')
  setBusy(true)
  try {
   const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[]
   const account = accounts[0]?.toLowerCase()
   if (!account) throw new Error('The wallet did not return an account.')
   const now = Math.floor(Date.now() / 1000)
   const { accepted } = await api.authorizeWithWallet({
    intent: { ...intent, sender: intent.sender.toLowerCase(), recipient: intent.recipient.toLowerCase(), validUntil },
    principal: { type: 'user', id: `wallet:${account.slice(2)}` },
    delegate: { agentId: `agent:${intent.sender.toLowerCase().slice(2)}`, executor: intent.sender.toLowerCase() },
    account,
    issuedAt: now,
    notBefore: now,
    expiresAt: validUntil,
    authorizationNonce: generateAuthorizationNonce(),
    maxUses: '1',
    audience: capabilities.audience,
   }, ethereum, {
    onCheckpoint(checkpoint) {
     if (checkpoint.stage === 'PREPARED' && !window.confirm('Review canonical intent:\n\n' + JSON.stringify({ ...checkpoint.prepared.authorization.intent, intentHash: checkpoint.prepared.authorization.intentHash }, null, 2))) throw reviewDeclined
    },
   })
   const record: AuthorizationRecord = { authorization: accepted.authorization, acceptance: accepted.acceptance, policyEvidence: accepted.policyEvidence, timestampEvidence: accepted.timestampEvidence, witnessEvidence: accepted.witnessEvidence, status: 'ACCEPTED', boundTxHash: null, uses: 0 }
   session.saveIntent(accepted.authorization.intent)
   session.saveAuthorization(record)
   setResult(record)
  } catch (caught) {
   if (caught !== reviewDeclined) setError(errorMessage(caught))
  } finally {
   setBusy(false)
  }
 }

 if (result) return <AppShell><PageHeader eyebrow="AUTHORIZATION ACCEPTED" title="Authorization accepted">The wallet signature proves who authorized the canonical intent. Independent timestamp status is shown below.</PageHeader><section className="success-result"><Status value="AUTHORIZED" />{result.timestampEvidence ? <Notice tone="success" title="DigiCert timestamp verified">The signed authorization existed at {dateTime(result.timestampEvidence.timestamp)}. PriorSeal verified the RFC 3161 token before accepting it.</Notice> : <Notice tone="warning" title="Independent timestamp not included">This development authorization has an issuer acceptance statement but no RFC 3161 evidence. Enable the rfc3161 proof mode for independent time.</Notice>}<h2>Authorization ID</h2><div className="hash-result"><code>{result.authorization.authorizationId}</code><CopyButton value={result.authorization.authorizationId} /></div><h2>Intent hash</h2><div className="hash-result"><code>{result.authorization.intentHash}</code><CopyButton value={result.authorization.intentHash} /></div>{result.timestampEvidence && <div className="timestamp-summary"><div><small>Timestamp authority</small><strong>DigiCert RFC 3161</strong></div><div><small>Trusted UTC time</small><strong>{dateTime(result.timestampEvidence.timestamp)}</strong></div><div><small>Token serial</small><CodeValue value={result.timestampEvidence.serialNumber} /></div><div><small>Response hash</small><CodeValue value={result.timestampEvidence.responseHash} /></div></div>}<div className="result-actions"><button className="button secondary" onClick={() => downloadJson(result, result.authorization.authorizationId + '.json')}>Download authorization</button><button className="button primary" onClick={() => navigate('/app/observe')}>Continue to observe execution →</button></div></section></AppShell>
 return <AppShell><PageHeader eyebrow="AUTHORIZATION" title="New authorization" actions={<Link className="button secondary" to="/app/intents/exact-call">Import an exact call →</Link>}>The agent proposes the fields below. Your wallet signs the canonical intent; PriorSeal never receives a transaction-signing key.</PageHeader><div className="operation-sequence" aria-label="Authorization workflow"><div><span>01 / DEFINE</span><strong>Set the boundaries</strong></div><div><span>02 / REVIEW</span><strong>Inspect canonical intent</strong></div><div><span>03 / AUTHORIZE</span><strong>Sign with your wallet</strong></div></div><div className="form-layout"><form className="panel intent-form operation-form" onSubmit={submit} aria-busy={busy}><div className="operation-form-intro"><span>AUTHORITY / 01</span><h2>Define this permission</h2><p>Specify exactly what the agent may execute before reviewing the canonical record.</p></div>{error && <Notice tone="danger" title="Authorization was not created">{error}</Notice>}<div className="form-section-heading"><span>01A / INTENT</span><strong>Transaction identity</strong></div><div className="form-grid"><Field label="Intent ID" hint="Generated locally; editable before signing."><input value={intent.intentId} onChange={(e) => update('intentId', e.target.value)} /></Field><Field label="Chain"><select value={intent.chainId} onChange={(e) => { const chainId = Number(e.target.value) as 1 | 8453 | 42161; setIntent((current) => ({ ...current, chainId, asset: 'eip155:' + chainId + '/native' })) }}>{(capabilities?.chains ?? [1, 8453, 42161]).map((chain) => <option key={chain} value={chain}>{chains[chain] ?? `Chain ${chain}`}</option>)}</select></Field><Field label="Action"><input value={intent.action} onChange={(e) => update('action', e.target.value)} /></Field><Field label="Asset"><input value={intent.asset} onChange={(e) => update('asset', e.target.value)} /></Field><Field label="Amount" error={validation.amount} hint="Atomic unsigned integer string."><input inputMode="numeric" value={intent.amount} onChange={(e) => update('amount', e.target.value)} placeholder="1000000" /></Field><Field label="Transaction nonce" error={validation.nonce} hint="Required: exact nonce of the submitted transaction."><input inputMode="numeric" value={intent.nonce ?? ''} onChange={(e) => update('nonce', e.target.value)} placeholder="17" /></Field></div><div className="form-section-heading"><span>01B / SCOPE</span><strong>Who, where and when</strong></div><Field label="Agent execution wallet" error={validation.sender} hint="This executor is included in the signed authorization."><input value={intent.sender} onChange={(e) => update('sender', e.target.value)} placeholder="0x…" /></Field><Field label="Authorized recipient" error={validation.recipient}><input value={intent.recipient} onChange={(e) => update('recipient', e.target.value)} placeholder="0x…" /></Field><Field label="Valid until"><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></Field><button type="button" className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>Advanced constraints <span>{advanced ? '−' : '+'}</span></button>{advanced && <div className="form-grid advanced"><Field label="Minimum confirmations"><input type="number" min="0" value={intent.constraints?.minConfirmations ?? ''} onChange={(e) => setIntent((current) => ({ ...current, constraints: { ...current.constraints, minConfirmations: e.target.value === '' ? undefined : Number(e.target.value) } }))} /></Field><Field label="Maximum gas used"><input inputMode="numeric" value={intent.constraints?.maxGasUsed ?? ''} onChange={(e) => setIntent((current) => ({ ...current, constraints: { ...current.constraints, maxGasUsed: e.target.value || undefined } }))} /></Field><Field label="Finality criterion" hint="RPC finalized waits for the endpoint’s finalized block to cover this transaction."><select value={intent.constraints?.finalityRequirement ?? 'CONFIRMATIONS'} onChange={(e) => setIntent((current) => ({ ...current, constraints: { ...current.constraints, finalityRequirement: e.target.value as 'CONFIRMATIONS' | 'RPC_FINALIZED' } }))}><option value="CONFIRMATIONS" disabled={capabilities?.finalityRequirement === 'RPC_FINALIZED'}>Confirmation count</option><option value="RPC_FINALIZED">RPC finalized block</option></select></Field><Field label="Reorg buffer (blocks)" hint="N requires at least N + 1 confirmations; it is not a finality guarantee."><input type="number" min={capabilities?.maxToleratedReorgDepth ?? 0} max="9999" value={intent.constraints?.maxToleratedReorgDepth ?? ''} onChange={(e) => setIntent((current) => ({ ...current, constraints: { ...current.constraints, maxToleratedReorgDepth: e.target.value === '' ? undefined : Number(e.target.value) } }))} /></Field><Field label="v1 call target" hint="For an exact call, use the import action above."><input value={intent.callTarget ?? ''} onChange={(e) => update('callTarget', e.target.value || undefined)} placeholder="0x…" /></Field><Field label="Calldata keccak256"><input value={intent.calldataHash ?? ''} onChange={(e) => update('calldataHash', e.target.value || undefined)} placeholder="0x…" /></Field><Field label="Transaction value"><input value={intent.transactionValue ?? ''} onChange={(e) => update('transactionValue', e.target.value || undefined)} placeholder="0" /></Field></div>}<div className="form-footer"><span>Your wallet signs authorization data only; no transaction is submitted.</span><button className="button primary" disabled={busy}>{busy ? 'Waiting for authorization…' : 'Review canonical intent →'}</button></div></form><IntentPreview intent={{ ...intent, validUntil: toUnix(date) }} /></div></AppShell>
}
function IntentPreview({ intent }: { intent: Intent }) { return <aside className="preview panel operation-preview"><div className="panel-head"><div><h2>Intent preview</h2><p>Proposed fields before server canonicalization</p></div><Status value="DRAFT" small /></div><dl><dt>Chain</dt><dd>{chains[Number(intent.chainId)] ?? intent.chainId}</dd><dt>Action</dt><dd>{intent.action || '—'}</dd><dt>Asset</dt><dd><CodeValue value={intent.asset} /></dd><dt>Amount</dt><dd className="mono">{intent.amount || '—'}</dd><dt>Executor</dt><dd><CodeValue value={intent.sender} /></dd><dt>Recipient</dt><dd><CodeValue value={intent.recipient} /></dd><dt>Transaction nonce</dt><dd className="mono">{intent.nonce || 'Required'}</dd><dt>Finality criterion</dt><dd>{intent.constraints?.finalityRequirement === 'RPC_FINALIZED' ? 'RPC finalized block' : 'Confirmation count'}</dd><dt>Reorg buffer</dt><dd>{intent.constraints?.maxToleratedReorgDepth ?? 0} blocks</dd><dt>Expires</dt><dd>{dateTime(intent.validUntil)}</dd></dl><Notice tone="info" title="Canonical review">Confirm the canonical JSON and hash before your wallet opens.</Notice></aside> }

function Observe() {
 const activity = getActivity()
 const resumableJob = activity.observationJobs.find((job) => !['COMPLETED', 'UNDETERMINED', 'FAILED'].includes(job.state))
 const [authorizationId, setAuthorizationId] = useState(resumableJob?.input.authorizationId ?? activity.authorizations[0]?.authorization.authorizationId ?? '')
 const [txHash, setTxHash] = useState(resumableJob?.input.txHash ?? '')
 const [confirmations, setConfirmations] = useState(String(resumableJob?.input.confirmations ?? 12))
 const [result, setResult] = useState<ObservationResult | null>(() => resumableJob?.result ?? (resumableJob?.observation ? { observation: resumableJob.observation, receipt: null, observationJob: resumableJob } : null))
 const [job, setJob] = useState<ObservationJob | null>(resumableJob ?? null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const navigate = useNavigate()
 const selected = activity.authorizations.find((candidate) => candidate.authorization.authorizationId === authorizationId)
 const linkedIntent = selected?.authorization.intent
 const jobPending = Boolean(job && !['COMPLETED', 'UNDETERMINED', 'FAILED'].includes(job.state))

 function saveResult(observed: ObservationResult) {
  session.saveObservation(observed.observation)
  if (observed.receipt) session.saveReceipt(observed.receipt)
  if (observed.observationJob) session.saveObservationJob(observed.observationJob)
  setResult(observed)
 }

 async function resumeJob(jobId: string, signal?: AbortSignal) {
  setBusy(true)
  setError('')
  try {
   const completed = await api.waitForObservationJob(jobId, { signal, timeoutMs: 120_000 })
   session.saveObservationJob(completed)
   setJob(completed)
   if (completed.result) saveResult({ ...completed.result, observationJob: completed })
   else if (completed.observation) saveResult({ observation: completed.observation, receipt: null, observationJob: completed })
  } catch (caught) {
   if (!signal?.aborted) setError(errorMessage(caught))
  } finally {
   if (!signal?.aborted) setBusy(false)
  }
 }

 useEffect(() => {
  if (!resumableJob) return
  const controller = new AbortController()
  void resumeJob(resumableJob.jobId, controller.signal)
  return () => controller.abort()
 }, [resumableJob?.jobId])

 async function submit(event: FormEvent) {
  event.preventDefault()
  setError('')
  if (!authorizationId || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) { setError('Choose an accepted authorization and enter a valid transaction hash.'); return }
  const chainId = Number(linkedIntent?.chainId ?? 0)
  if (!Number.isSafeInteger(chainId) || chainId < 1) { setError('The authorization must contain a supported EVM chain ID.'); return }
  setBusy(true)
  try {
   const observed = await api.observe({ authorizationId, chainId, txHash, confirmations: Number(confirmations) || 0 })
   saveResult(observed)
   if (observed.observationJob) {
   setJob(observed.observationJob)
   session.saveObservationJob(observed.observationJob)
   }
  } catch (caught) {
   setError(errorMessage(caught))
  } finally {
   setBusy(false)
  }
 }

 return <AppShell><PageHeader eyebrow="EXECUTION" title="Observe execution">Only accepted, signed authorizations are shown. Pending transactions remain candidates; a single authorization is consumed only by a final transaction.</PageHeader><div className="operation-sequence" aria-label="Observation workflow"><div><span>01 / SELECT</span><strong>Signed authority</strong></div><div><span>02 / MATCH</span><strong>Transaction hash</strong></div><div><span>03 / RESOLVE</span><strong>Finality and receipt</strong></div></div><div className="form-layout"><form className="panel intent-form operation-form" onSubmit={submit} aria-busy={busy}><div className="operation-form-intro"><span>EXECUTION / 02</span><h2>Match the execution</h2><p>Pair one signed authorization with the exact chain transaction you want to observe.</p></div>{error && <Notice tone="danger" title="Observation could not be completed">{error}</Notice>}<div className="form-section-heading"><span>02A / AUTHORITY</span><strong>Choose a signed record</strong></div><Field label="Signed authorization"><select value={authorizationId} onChange={(e) => setAuthorizationId(e.target.value)}><option value="">Choose an accepted authorization</option>{activity.authorizations.map((record) => <option key={record.authorization.authorizationId} value={record.authorization.authorizationId}>{record.authorization.authorizationId} · {chains[Number(record.authorization.intent.chainId)]}</option>)}</select></Field>{!activity.authorizations.length && <Notice tone="warning" title="No signed authorization">Create and sign an intent before observing execution.</Notice>}<div className="form-section-heading"><span>02B / CHAIN EVENT</span><strong>Identify the submitted transaction</strong></div><Field label="Transaction hash"><input className="mono" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x…" /></Field><Field label="Required confirmations"><input type="number" min="0" value={confirmations} onChange={(e) => setConfirmations(e.target.value)} /></Field><div className="form-footer"><span>The authorization remains available while a transaction is pending.</span><button className="button primary" disabled={busy || !selected}>{busy ? 'Waiting for finality…' : 'Observe authorized execution →'}</button></div></form><aside className="preview panel operation-preview"><div className="panel-head"><div><h2>Signed authority</h2><p>User-approved execution constraints</p></div></div>{selected && linkedIntent ? <div className="intent-mini"><dl><dt>Authorizer</dt><dd><CodeValue value={selected.authorization.authorizer.address} /></dd><dt>Agent</dt><dd>{selected.authorization.delegate.agentId}</dd><dt>Executor</dt><dd><CodeValue value={selected.authorization.delegate.executor} /></dd><dt>Asset</dt><dd><CodeValue value={linkedIntent.asset} /></dd><dt>Amount</dt><dd>{linkedIntent.amount}</dd><dt>Expires</dt><dd>{dateTime(selected.authorization.expiresAt)}</dd></dl></div> : <Empty title="Select an authorization">Only cryptographically signed authorizations can enter the authorization-bound evidence flow.</Empty>}</aside></div>{result && <section className="panel observation-result"><div className="panel-head"><div><h2>Observation result</h2><p>Information returned by the configured chain observer.</p></div><Status value={jobPending ? job!.state : result.observation.status} /></div><ExecutionDetails execution={result.observation} /><TemporalDetails execution={result.observation} />{job && <div className="data-grid"><div><dt>Observation job</dt><dd><CodeValue value={job.jobId} /></dd></div><div><dt>Background state</dt><dd>{job.state}</dd></div><div><dt>Attempts</dt><dd>{job.attempts}</dd></div><div><dt>Next background check</dt><dd>{jobPending ? dateTime(Math.floor(job.nextAttemptAt / 1000)) : "No automatic attempt scheduled"}</dd></div></div>}{job?.state === "UNDETERMINED" && <Notice tone="warning" title="Reconciliation required">Automatic observation attempts ended without a determinate outcome. Preserve this authorization and transaction hash, ask the original submitter to reconcile chain state, and retry observation only. No new execution permission has been issued.</Notice>}{jobPending ? <Notice tone="info" title="Observation continues in the background">PriorSeal is waiting for the requested finality. Job {job!.jobId} is {getStoragePreference() === "granted" ? "saved on this device and resumes automatically after a refresh" : "kept in this page session; copy its ID or allow local saving before refreshing"}.{!busy && <button className="text-link" onClick={() => void resumeJob(job!.jobId)}>Check again</button>}</Notice> : result.receipt ? <div className="result-banner"><div><Status value={receiptPrimaryStatus(result.receipt)} /><strong>A v3 authorization-bound compliance receipt was issued.</strong></div><button className="button primary" onClick={() => navigate('/app/receipts/' + encodeURIComponent(result.receipt!.receiptId))}>Open receipt detail →</button></div> : job?.state === 'FAILED' ? <Notice tone="danger" title="Observation job failed">{job.error?.message ?? 'The background observer could not complete this job.'} Check the original transaction with its submitter. You may retry observation for the same authorization and transaction hash; this is not permission to sign or broadcast another transaction.</Notice> : ['PENDING', 'NOT_FOUND', 'RPC_ERROR', 'RPC_TIMEOUT'].includes(result.observation.status) ? <Notice tone="warning" title="No final receipt yet">The execution did not reach a final, verifiable state. Its uncertainty is preserved and no completed proof was issued. Recheck the same transaction hash; do not infer that the transaction failed or broadcast it again.</Notice> : <Notice tone="warning" title="Receipt unavailable">The observation reached a terminal state, but the API did not issue a signed receipt. Check issuer signing and server logs.</Notice>}</section>}</AppShell>
}
function TemporalDetails({ execution }: { execution: Execution }) {
 const evidence = execution.temporalEvidence
 if (!evidence) return null
 const rows: [string, string | number | null][] = [
  ['Criterion', evidence.criterion],
  ['Required confirmations', evidence.requiredConfirmations],
  ['Reorg buffer', evidence.maxToleratedReorgDepth],
  ['Observed head', evidence.observedHeadNumber],
  ['Observed head hash', evidence.observedHeadHash],
  ['RPC finalized block', evidence.finalizedBlock?.number ?? null],
  ['RPC finalized hash', evidence.finalizedBlock?.hash ?? null],
 ]
 return <div className="temporal-evidence"><h3>Frozen temporal evidence</h3><p>The signed observation records what the configured RPC reported at observation time. Verify the receipt before relying on this claim.</p><dl className="data-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'string' && value.startsWith('0x') ? <CodeValue value={value} /> : String(value ?? '—')}</dd></div>)}</dl></div>
}
function ExecutionDetails({ execution }: { execution: Execution }) { const rows: [string, string | number | null | undefined][] = [['Chain', chains[Number(execution.chainId)] ?? String(execution.chainId)], ['Action', execution.action], ['Block', execution.blockNumber ?? '—'], ['Block hash', execution.blockHash], ['Executed at', execution.executedAt ? dateTime(execution.executedAt) : '—'], ['Observed at', execution.observedAt ? dateTime(execution.observedAt) : '—'], ['Sender', execution.sender], ['Recipient', execution.recipient], ['Call target', execution.target], ['Calldata hash', execution.calldataHash], ['Asset', execution.asset], ['Amount', execution.amount], ['Transaction value', execution.nativeValue], ['Gas used', execution.gasUsed], ['Fee', execution.fee], ['Confirmations', execution.confirmations], ['Finality', execution.finalityState], ['Source', execution.observationSource], ['Data availability', execution.executionDataAvailable ? 'Available' : 'Unavailable']]; return <dl className="data-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'string' && (value.startsWith('0x') || value.includes(':')) ? <CodeValue value={value} /> : String(value ?? '—')}</dd></div>)}</dl> }
function Receipts() {
 const [activity, setActivity] = useState(getActivity()); const [preference, setPreference] = useState(getStoragePreference()); const navigate = useNavigate()
 useEffect(() => { const refresh = () => { setActivity(getActivity()); setPreference(getStoragePreference()) }; window.addEventListener(activityChangeEvent, refresh); window.addEventListener(storagePreferenceEvent, refresh); return () => { window.removeEventListener(activityChangeEvent, refresh); window.removeEventListener(storagePreferenceEvent, refresh) } }, [])
 const persistent = preference === 'granted'
 return <AppShell>
  <PageHeader eyebrow="EVIDENCE" title="Receipts">{persistent ? 'This list is saved in this browser only.' : 'This list is available only for the current page session.'} It is not a complete server-side transaction or receipt history.</PageHeader>
  <section className="receipt-index-hero" aria-label="Local receipt overview">
   <div><span>LOCAL RECEIPT INDEX / 05</span><strong>{activity.receipts.length.toString().padStart(2, '0')}</strong><p>{persistent ? 'Receipts saved on this device' : 'Receipts in this page session'}</p></div>
   <div className="receipt-index-hero__path"><span>THE EVIDENCE PATH</span><p>Issued receipts are portable records. Open one to inspect its claims, then verify it with independently trusted keys.</p><div><Link className="button secondary" to="/app/audit">Explore evidence audit →</Link><Link className="button secondary" to="/app/verify">Verify a receipt ↗</Link></div></div>
  </section>
  <section className="panel receipt-index-panel">
   <div className="panel-head"><div><span className="receipt-section-index">COLLECTION / THIS DEVICE</span><h2>Local receipts</h2><p>{activity.receipts.length} {persistent ? 'saved on this device' : 'in this page session'}</p></div><div className="header-actions"><Link className="button secondary" to="/app/archive">Project archive</Link><button className="button secondary" onClick={() => downloadJson(JSON.parse(session.export()), 'priorseal-local-session.json')}>Export</button><button className="button secondary" onClick={() => { if (window.confirm('Clear local activity? This cannot be undone.')) { session.clear(); navigate('/app/receipts', { replace: true }) } }}>Clear local activity</button></div></div>
   {activity.receipts.length ? activity.receipts.map((receipt) => <ReceiptSummary key={receipt.receiptId} receipt={receipt} />) : <Empty title="No local receipt activity" action={<Link className="button primary" to="/app/intents/new">Create an authorization &rarr;</Link>}>Observe an execution after creating an authorization, and any returned receipt will remain {persistent ? 'in the local archive' : 'until this page session ends'}.</Empty>}
  </section>
 </AppShell>
}
function ReceiptDetail() {
 const { receiptId } = useParams(); const [receipt, setReceipt] = useState<Receipt | null>(() => getActivity().receipts.find((candidate) => candidate.receiptId === receiptId) ?? null); const [error, setError] = useState(''); const [reload, setReload] = useState(0); const [open, setOpen] = useState(false); const navigate = useNavigate(); const receiptJson = useMemo(() => receipt ? JSON.stringify(receipt, null, 2) : '', [receipt])
 useEffect(() => { if (!receipt && receiptId) { setError(''); api.receipt(receiptId).then((found) => { setReceipt(found); session.saveReceipt(found) }).catch((caught) => setError(errorMessage(caught))) } }, [receipt, receiptId, reload])
 if (error) return <AppShell><PageHeader title="Receipt not available" /><Notice tone="danger" title="Could not retrieve this receipt">{error}</Notice><button className="button secondary retry-button" onClick={() => setReload((value) => value + 1)}>Try again</button></AppShell>
 if (!receipt) return <AppShell><div className="loading">Loading receipt evidence…</div></AppShell>
 const localIntent = receipt.authorizationEvidence?.authorization.intent ?? getActivity().intents.find((intent) => intent.intentHash === receipt.intentHash)
 return <AppShell><PageHeader eyebrow="RECEIPT DETAIL" title="Receipt detail" actions={<><CopyButton value={receipt.receiptId} /><button className="button secondary" onClick={() => downloadJson(receipt, receipt.receiptId + '.json')}>Download JSON</button><button className="button primary" onClick={() => navigate('/app/verify', { state: { receipt } })}>Verify this receipt →</button></>}><span className="receipt-detail-meta"><code>{receipt.receiptId}</code><span className="header-status"><Status value={receiptPrimaryStatus(receipt)} /> Issued {dateTime(receipt.issuedAt)} · {receipt.issuer} · key {receipt.keyId}</span></span></PageHeader><div className="receipt-reading-guide" aria-label="How to read this receipt"><div><span>01 / CLAIM</span><strong>{receiptPrimaryStatus(receipt)}</strong><small>Outcome reported by this receipt</small></div><div><span>02 / ISSUER</span><strong>{receipt.issuer}</strong><small>Issuer and key details are recorded below</small></div><div><span>03 / TRUST</span><strong>Verify locally</strong><small>Check signature, policy and independent trust</small></div></div><EvidenceRelationshipView receipt={receipt} />{receipt.authorizationEvidence && <section className="panel receipt-authority"><div className="panel-head"><div><h2>Signed authority</h2><p>Receipt claim: user or organization approval accepted before execution. Independently verify this receipt to establish its signatures and trust.</p></div><Status value="AUTHORIZED" /></div><dl className="data-grid"><div><dt>Principal</dt><dd>{receipt.authorizationEvidence.authorization.principal.id}</dd></div><div><dt>Authorizer</dt><dd><CodeValue value={receipt.authorizationEvidence.authorization.authorizer.address} /></dd></div><div><dt>Agent</dt><dd>{receipt.authorizationEvidence.authorization.delegate.agentId}</dd></div><div><dt>Executor</dt><dd><CodeValue value={receipt.authorizationEvidence.authorization.delegate.executor} /></dd></div><div><dt>Accepted</dt><dd>{dateTime(receipt.authorizationEvidence.acceptance.acceptedAt)}</dd></div><div><dt>RFC 3161 timestamp</dt><dd>{receipt.authorizationEvidence.timestamp ? `${dateTime(receipt.authorizationEvidence.timestamp.timestamp)} · DigiCert` : 'Not included'}</dd></div><div><dt>Timestamp serial</dt><dd><CodeValue value={receipt.authorizationEvidence.timestamp?.serialNumber} /></dd></div><div><dt>Single-use nonce</dt><dd><CodeValue value={receipt.authorizationEvidence.authorization.authorizationNonce} /></dd></div><div><dt>Transparency</dt><dd>{receipt.authorizationEvidence.transparency?.checkpoint.anchor ? `Anchored on eip155:${receipt.authorizationEvidence.transparency.checkpoint.anchor.chainId}` : receipt.authorizationEvidence.transparency ? 'Issuer-signed hash-chain checkpoint' : receipt.authorizationEvidence.timestamp ? 'DigiCert RFC 3161' : 'Acceptance statement only'}</dd></div></dl></section>}<div className="receipt-layout"><div><section className="panel receipt-compliance"><div className="panel-head"><div><h2>Compliance</h2><p>Claims contained in this receipt. Use Verify this receipt to recompute them locally with your independent trust configuration.</p></div><div className="receipt-badges"><Status value={receiptPrimaryStatus(receipt)} />{receipt.executionStatus && <Status value={receipt.executionStatus} small />}</div></div><Notice tone={receipt.compliance?.status === 'NON_COMPLIANT' ? 'danger' : receiptPrimaryStatus(receipt) === 'COMPLIANT' ? 'success' : 'warning'} title={receipt.compliance?.status === 'NON_COMPLIANT' ? 'Receipt claims non-compliance' : receiptPrimaryStatus(receipt) === 'COMPLIANT' ? 'Receipt claims compliance' : 'Receipt could not assess compliance'}>{receipt.compliance?.status === 'NON_COMPLIANT' ? 'The confirmed execution was correlated to the authorized executor and nonce, but one or more signed constraints were violated.' : receiptPrimaryStatus(receipt) === 'COMPLIANT' ? 'The final execution matched the signed authorization constraints.' : 'Review the execution state and reason codes before relying on this evidence.'}</Notice><div className="reason-list">{receipt.reasonCodes.length ? receipt.reasonCodes.map((code) => <div key={code}><Status value={code} small /><span>{reasonText[code] ?? code}</span></div>) : <span className="muted">No binding mismatches returned.</span>}</div></section><section className="panel receipt-comparison"><h2>Intent and observed execution</h2><p className="panel-copy">Only profile-bound fields are compared below. This page displays evidence claims; it has not independently verified the issuer or signature.</p><Comparison intent={localIntent} execution={receipt.execution} reasons={receipt.reasonCodes} /><TemporalDetails execution={receipt.execution} /></section></div><aside><section className="panel proof"><h2>Cryptographic proof</h2><dl><dt>Schema</dt><dd>{receipt.schema}</dd><dt>Domain</dt><dd>{receipt.domain}</dd><dt>Execution</dt><dd>{receipt.executionStatus ?? receipt.execution.status}</dd><dt>Compliance</dt><dd>{receipt.compliance?.status ?? 'Legacy outcome'}</dd><dt>Algorithm</dt><dd>{receipt.algorithm}</dd><dt>Key ID</dt><dd>{receipt.keyId}</dd><dt>Timestamp proof</dt><dd>{receipt.authorizationEvidence?.timestamp?.profile ?? '—'}</dd><dt>Verifier</dt><dd>{receipt.verifierVersion}</dd><dt>Signature</dt><dd><CodeValue value={receipt.signature} /></dd></dl></section><Notice tone="warning" title="Important limitation">Authorization validity and execution compliance do not prove economic safety or token legitimacy.</Notice></aside></div><section className="panel raw"><div className="panel-head"><div><h2>Raw receipt JSON</h2><p>Portable, signed evidence document.</p></div><div><CopyButton value={receiptJson} label="Copy JSON" /><button className="text-link" onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button></div></div>{open && <pre>{receiptJson}</pre>}</section></AppShell>
}
function Comparison({ intent, execution, reasons }: { intent?: Intent; execution: Execution; reasons: string[] }) { const exactCall = intent?.executionProfile === 'priorseal.execution-profile.exact-call.v1'; const rows: [string, string, string, string][] = [['Chain', intent ? chains[Number(intent.chainId)] ?? String(intent.chainId) : 'Local intent unavailable', chains[Number(execution.chainId)] ?? String(execution.chainId), 'CHAIN_MISMATCH'], ['Action', intent?.action ?? 'Local intent unavailable', execution.action ?? '—', 'ACTION_MISMATCH'], ['Sender', intent?.sender ?? 'Local intent unavailable', execution.sender ?? '—', 'SENDER_MISMATCH'], ['Recipient', intent?.recipient ?? 'Local intent unavailable', execution.recipient ?? '—', 'RECIPIENT_MISMATCH'], ['Call target', intent?.callTarget ?? 'Not constrained', execution.target ?? '—', 'CALL_TARGET_MISMATCH'], ['Calldata hash', intent?.calldataHash ?? 'Not constrained', execution.calldataHash ?? '—', 'CALLDATA_MISMATCH'], ['Transaction value', intent?.transactionValue ?? 'Not constrained', execution.nativeValue ?? '—', 'TRANSACTION_VALUE_MISMATCH'], ['Asset', intent?.asset ?? 'Local intent unavailable', execution.asset ?? '—', 'ASSET_MISMATCH'], ['Amount', intent?.amount ?? 'Local intent unavailable', execution.amount ?? '—', 'AMOUNT_MISMATCH'], ['Nonce', intent?.nonce ?? 'Local intent unavailable', execution.nonce ?? '—', 'NONCE_MISMATCH']]; return <>{exactCall && <Notice tone="info" title="Exact-call binding scope">Asset and amount are descriptive context: {intent?.asset} / {intent?.amount}. This profile binds the call envelope; it does not verify token settlement, output amount, price or slippage.</Notice>}<div className="comparison"><div className="compare-head"><span>Field</span><span>Authorized intent</span><span>Observed execution</span></div>{rows.filter(([field]) => !exactCall || !['Action', 'Recipient', 'Asset', 'Amount'].includes(field)).map(([field, left, right, code]) => <div className={reasons.includes(code) ? 'different' : ''} key={field}><strong>{field}</strong><span className={left.startsWith('0x') ? 'mono' : ''}>{left.startsWith('0x') ? short(left) : left}</span><span className={right.startsWith('0x') ? 'mono' : ''}>{right.startsWith('0x') ? short(right) : right}</span></div>)}</div>{intent?.contextCommitments?.length ? <div className="context-review"><h3>Signed context commitments</h3>{intent.contextCommitments.map((entry) => <p key={`${entry.namespace}:${entry.digest}`}><strong>{entry.namespace}</strong> · {entry.algorithm} · <CodeValue value={entry.digest} /></p>)}<p>Binding a digest does not verify the attached provider's claims or trust.</p></div> : null}</> }

export default function Console() { return <AppShell><Suspense fallback={<LoadingState label="Loading page…" />}><Routes><Route index element={<Overview />} /><Route path="sdk" element={<SdkPage />} /><Route path="quickstart" element={<OnboardingPage />} /><Route path="intents/new" element={<CreateIntent />} /><Route path="intents/exact-call" element={<ExactCallPage />} /><Route path="archive" element={<ArchivePage />} /><Route path="observe" element={<Observe />} /><Route path="audit" element={<AuditPage />} /><Route path="receipts" element={<Receipts />} /><Route path="receipts/:receiptId" element={<ReceiptDetail />} /><Route path="verify" element={<VerifyPage />} /><Route path="keys" element={<KeysPage />} /><Route path="api" element={<ApiReferencePage />} /></Routes></Suspense></AppShell> }
