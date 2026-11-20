import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyReceiptLocally } from 'priorseal-sdk/verifier'
import { getStoragePreference, storagePreferenceEvent } from '../lib/storage'
import evidenceBundle from '../../../examples/payment-draft-base-sepolia-v1/evidence-bundle.json'
import { fetchDemoTransactionStatus, type DemoTransactionStatus } from '../lib/transaction-status-demo'
import './transaction-recovery-demo.css'

const STORAGE_KEY = 'priorseal:transaction-recovery-demo:v1'
const EXPLORER_URL = `https://sepolia.basescan.org/tx/${evidenceBundle.chain.txHash}`
const EVIDENCE_URL = 'https://github.com/imokokok/PriorSeal/tree/main/examples/payment-draft-base-sepolia-v1'

type DemoSession = {
  schema: 'priorseal.transaction-recovery-demo-session.v1'
  mode: 'active' | 'closed'
  operationId: string
  transactionHash: string
  startedAt: string
}

type ReceiptProof = { valid: boolean; code: string; scope: string } | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readSession(): DemoSession | null {
  if (getStoragePreference() !== 'granted') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw || raw.length > 2_000) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)
      || value.schema !== 'priorseal.transaction-recovery-demo-session.v1'
      || (value.mode !== 'active' && value.mode !== 'closed')
      || value.operationId !== evidenceBundle.draft.initial.id
      || value.transactionHash !== evidenceBundle.chain.txHash
      || typeof value.startedAt !== 'string'
      || !Number.isFinite(Date.parse(value.startedAt))) return null
    return value as DemoSession
  } catch {
    return null
  }
}

function persistSession(session: DemoSession | null) {
  try {
    if (!session) window.localStorage.removeItem(STORAGE_KEY)
    else if (getStoragePreference() === 'granted') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else return false
    return true
  } catch {
    return false
  }
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function shortAddress(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function formatTime(value: string) {
  try { return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)) }
  catch { return value }
}

export function TransactionRecoveryDemoPage() {
  const [session, setSession] = useState<DemoSession | null>(() => readSession())
  const [storageAllowed, setStorageAllowed] = useState(() => getStoragePreference() === 'granted')
  const [status, setStatus] = useState<DemoTransactionStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [checking, setChecking] = useState(false)
  const [proof, setProof] = useState<ReceiptProof>(null)
  const [proofChecking, setProofChecking] = useState(false)
  const [saved, setSaved] = useState(() => getStoragePreference() === 'granted' && Boolean(readSession()))
  const [restored, setRestored] = useState(() => Boolean(readSession()))
  const [copied, setCopied] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    setStatusError('')
    try {
      setStatus(await fetchDemoTransactionStatus())
    } catch (error) {
      setStatus(null)
      setStatusError(error instanceof Error ? error.message : 'STATUS_UNAVAILABLE')
    } finally {
      setChecking(false)
    }
  }, [])

  const verifyReceipt = useCallback(async () => {
    setProofChecking(true)
    try {
      const bundle = evidenceBundle as unknown as {
        priorSeal: { receipt: unknown; keyRegistry: unknown }
        testRecord: { observedAt: number }
      }
      const verifierOptions = {
        trustedKeys: bundle.priorSeal.keyRegistry as Parameters<typeof verifyReceiptLocally>[1] extends { trustedKeys?: infer T } ? T : never,
        now: bundle.testRecord.observedAt,
        expectedAudience: 'priorseal',
      }
      const result = await verifyReceiptLocally(bundle.priorSeal.receipt, verifierOptions)
      setProof({ valid: result.valid, code: result.code, scope: result.verificationScope })
    } catch {
      setProof({ valid: false, code: 'VERIFIER_UNAVAILABLE', scope: 'LOCAL_COMPLETE' })
    } finally {
      setProofChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!session || session.mode !== 'active') return
    void refreshStatus()
  }, [session?.mode, session?.operationId, refreshStatus])

  useEffect(() => { void verifyReceipt() }, [verifyReceipt])

  useEffect(() => {
    const syncPreference = () => {
      const allowed = getStoragePreference() === 'granted'
      setStorageAllowed(allowed)
      if (allowed) setSession((current) => current ?? readSession())
    }
    window.addEventListener(storagePreferenceEvent, syncPreference)
    return () => window.removeEventListener(storagePreferenceEvent, syncPreference)
  }, [])

  useEffect(() => {
    setSaved(persistSession(session))
  }, [session, storageAllowed])

  function startWalkthrough() {
    setRestored(false)
    setSession({
      schema: 'priorseal.transaction-recovery-demo-session.v1',
      mode: 'active',
      operationId: evidenceBundle.draft.initial.id,
      transactionHash: evidenceBundle.chain.txHash,
      startedAt: new Date().toISOString(),
    })
    window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
  }

  function closeConversation() {
    setSession((current) => current ? { ...current, mode: 'closed' } : null)
    setStatus(null)
    setStatusError('')
  }

  function reopenConversation() {
    if (!session) return
    setRestored(true)
    setSession({ ...session, mode: 'active' })
  }

  function resetDemo() {
    setSession(null)
    setStatus(null)
    setStatusError('')
    setRestored(false)
  }

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(evidenceBundle.chain.txHash)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch { setCopied(false) }
  }

  const currentState = status?.state ?? (checking ? 'CHECKING' : statusError ? 'UNAVAILABLE' : 'AWAITING_LOOKUP')
  const statusTone = currentState === 'CONFIRMED' ? 'success' : ['PENDING', 'CHECKING', 'AWAITING_LOOKUP'].includes(currentState) ? 'pending' : 'attention'

  return <main id="main-content" className="tx-recovery-demo">
    <header className="tx-recovery-demo__nav">
      <a className="tx-recovery-demo__brand" href="https://priorseal.xyz/" aria-label="PriorSeal home">
        <span className="tx-recovery-demo__brand-mark">P</span><span>PriorSeal<small>TRANSACTION RECOVERY DEMO</small></span>
      </a>
      <div className="tx-recovery-demo__nav-meta"><span className="tx-recovery-demo__live-dot" />BASE SEPOLIA / READ ONLY</div>
    </header>

    <section className="tx-recovery-demo__hero">
      <div>
        <p className="tx-recovery-demo__eyebrow">A CHAT CAN CLOSE. THE OPERATION CONTINUES.</p>
        <h1 ref={headingRef} data-route-heading tabIndex={-1}>The app closed.<br /><em>The payment didn’t disappear.</em></h1>
        <p className="tx-recovery-demo__lede">A user starts a USDC transfer in chat, approves it in a wallet, then closes the app before confirmation. Reopen the same conversation, recover the operation, and check what the chain and signed evidence can prove.</p>
        <div className="tx-recovery-demo__hero-facts"><span><b>01</b> persist operation ID</span><span><b>02</b> re-query chain status</span><span><b>03</b> verify execution evidence</span></div>
      </div>
      <aside className="tx-recovery-demo__transfer-preview" aria-label="Recorded transfer summary">
        <div className="tx-recovery-demo__preview-top"><span>RECORDED TESTNET RUN</span><span>84532</span></div>
        <div className="tx-recovery-demo__preview-amount"><strong>{evidenceBundle.draft.initial.amountFormatted}</strong><span>USDC</span></div>
        <div className="tx-recovery-demo__preview-route"><span>FROM</span><code>{shortAddress(evidenceBundle.derivedCall.payer)}</code><span>TO</span><code>{shortAddress(evidenceBundle.draft.initial.receiverAddress)}</code></div>
        <div className="tx-recovery-demo__preview-bottom"><span>Base Sepolia</span><span className="tx-recovery-demo__recorded-status">● RECORDED</span></div>
      </aside>
    </section>

    <div className="tx-recovery-demo__notice"><strong>Testnet walkthrough</strong><span>This replays a recorded Base Sepolia USDC transfer. No wallet connection, new transaction, or real funds are required.</span><a href={EXPLORER_URL} target="_blank" rel="noreferrer">Open transaction ↗</a></div>

    <section className="tx-recovery-demo__workspace" aria-label="Interactive transaction recovery walkthrough">
      <div className="tx-recovery-demo__chat-column">
        <div className="tx-recovery-demo__section-head"><div><p className="tx-recovery-demo__eyebrow">01 / APPLICATION EXPERIENCE</p><h2>Conversation recovery</h2></div><span className="tx-recovery-demo__session-state">{session?.mode === 'closed' ? 'CLOSED' : session ? 'SAVED SESSION' : 'READY'}</span></div>
        <div className={`tx-recovery-demo__chat ${session?.mode === 'closed' ? 'is-closed' : ''}`}>
          <div className="tx-recovery-demo__chat-head"><div className="tx-recovery-demo__assistant-avatar">A</div><div><strong>Atlas assistant</strong><small>Consumer AI app · wallet connected in the original session</small></div><span>BASE SEPOLIA</span></div>
          {!session && <div className="tx-recovery-demo__empty-chat"><span className="tx-recovery-demo__empty-icon">↻</span><h3>Start the recovery walkthrough</h3><p>The operation stays in this tab and, if local saving is allowed, survives a refresh. Close the chat, reopen the same conversation, and check the recorded Base Sepolia transaction.</p><button className="tx-recovery-demo__button tx-recovery-demo__button--primary" onClick={startWalkthrough}>Start walkthrough <span>→</span></button></div>}
          {session?.mode === 'closed' && <div className="tx-recovery-demo__closed-chat"><span className="tx-recovery-demo__closed-icon">Ⅱ</span><h3>Conversation closed</h3><p>{saved ? 'The browser saved the operation ID and transaction hash before this view closed.' : 'The operation ID and transaction hash remain in this tab.'}</p><button className="tx-recovery-demo__button tx-recovery-demo__button--primary" onClick={reopenConversation}>Reopen same conversation <span>↗</span></button><small>{saved ? 'Refresh this page to see the saved session restored automatically.' : 'Choose Allow local saving if you want the session to survive a page refresh.'}</small></div>}
          {session?.mode === 'active' && <div className="tx-recovery-demo__messages">
            <div className="tx-recovery-demo__date-divider"><span>TRANSFER REQUEST</span><time>{formatTime(evidenceBundle.draft.initial.createdAt)}</time></div>
            <div className="tx-recovery-demo__message tx-recovery-demo__message--user"><p>Send <strong>{evidenceBundle.draft.initial.amountFormatted} USDC</strong> on Base to <code>{shortAddress(evidenceBundle.draft.initial.receiverAddress)}</code>.</p><time>Wallet review required</time></div>
            <div className="tx-recovery-demo__message tx-recovery-demo__message--assistant"><span>ATLAS</span><p>I prepared the transfer. The wallet reviewed the amount and recipient, then submitted it. I’ll keep tracking this operation until the chain reports an outcome.</p></div>
            <div className="tx-recovery-demo__operation-card">
              <div className="tx-recovery-demo__operation-head"><span className={`tx-recovery-demo__status-dot ${statusTone}`} /><div><strong>{currentState === 'CONFIRMED' ? 'Transfer confirmed' : currentState === 'FAILED' ? 'Transfer failed' : currentState === 'PENDING' || checking ? 'Waiting for chain receipt' : currentState === 'REORGED' ? 'Block reorganized' : currentState === 'INCONSISTENT' ? 'Transfer evidence mismatch' : currentState === 'UNAVAILABLE' ? 'Status check unavailable' : 'Transaction submitted'}</strong><small>{checking ? 'Re-querying Base Sepolia…' : status?.checkedAt ? `Checked ${formatTime(status.checkedAt)}` : 'Restore the operation to query the chain'}</small></div><b>{currentState === 'CONFIRMED' ? 'CONFIRMED' : currentState}</b></div>
              <div className="tx-recovery-demo__operation-hash"><span>TRANSACTION</span><code>{shortHash(session.transactionHash)}</code><button aria-label="Copy transaction hash" onClick={() => void copyHash()}>{copied ? 'COPIED' : 'COPY'}</button></div>
              {status?.state === 'CONFIRMED' && <div className="tx-recovery-demo__operation-facts"><span>Block <b>{status.blockNumber}</b></span><span>Confirmations <b>{status.confirmations ?? 1}</b></span><span>USDC transfer <b>{status.transferMatched ? 'MATCHED' : 'CHECKING'}</b></span></div>}
              {statusError && <p className="tx-recovery-demo__inline-error">The live Base Sepolia status lookup is temporarily unavailable ({statusError}). The saved operation remains available; retry the lookup.</p>}
              <a className="tx-recovery-demo__explorer-link" href={EXPLORER_URL} target="_blank" rel="noreferrer">Inspect on Base Sepolia explorer <span>↗</span></a>
            </div>
            {restored && <div className="tx-recovery-demo__recovery-note"><span>↻</span><p><strong>Operation restored.</strong> The same saved ID was loaded and its status was looked up again.</p></div>}
            <div className="tx-recovery-demo__chat-actions"><button className="tx-recovery-demo__button tx-recovery-demo__button--quiet" onClick={closeConversation}>Close chat before checking</button><button className="tx-recovery-demo__button tx-recovery-demo__button--outline" disabled={checking} onClick={() => void refreshStatus()}>{checking ? 'Checking…' : 'Refresh transaction status'}</button></div>
            <div className="tx-recovery-demo__saved-indicator"><span className={saved ? 'saved' : 'unsaved'} />{saved ? 'Operation ID and transaction hash saved in this browser' : storageAllowed ? 'Browser storage unavailable; this session may not survive a reload' : 'This tab only; allow local saving to restore after refresh'}</div>
          </div>}
        </div>
      </div>

      <aside className="tx-recovery-demo__evidence-column">
        <div className="tx-recovery-demo__section-head"><div><p className="tx-recovery-demo__eyebrow">02 / SERVICE + EVIDENCE</p><h2>What can be verified</h2></div></div>
        <section className="tx-recovery-demo__panel tx-recovery-demo__api-panel">
          <div className="tx-recovery-demo__panel-label"><span>READ-ONLY STATUS API</span><span className="tx-recovery-demo__api-method">GET</span></div>
          <code className="tx-recovery-demo__endpoint">/demo-api/base-sepolia/transaction</code>
          <p>The service checks Base Sepolia through public RPC. If that node has pruned the old block, it checks the indexed transaction and canonical block instead, then matches the USDC transfer.</p>
          <div className="tx-recovery-demo__api-result"><div><span>CHAIN RESULT</span><b className={status?.state === 'CONFIRMED' ? 'is-ok' : ''}>{status?.state ?? (checking ? 'CHECKING…' : 'NOT QUERIED')}</b></div><div><span>CANONICAL BLOCK</span><b>{status?.canonical === undefined ? '—' : status.canonical ? 'YES' : 'NO'}</b></div><div><span>TRANSFER MATCH</span><b>{status?.transferMatched === undefined ? '—' : status.transferMatched ? 'YES' : 'NO'}</b></div></div>
          {status && <p className="tx-recovery-demo__indexer-note">Status source: {status.source === 'base-sepolia-blockscout-index' ? 'Base Sepolia explorer index · indexed confirmations' : 'Base Sepolia public RPC'}.</p>}
        </section>

        <section className="tx-recovery-demo__panel tx-recovery-demo__proof-panel">
          <div className="tx-recovery-demo__panel-label"><span>PRIORSEAL EXECUTION RECEIPT</span><span className={`tx-recovery-demo__proof-badge ${proof?.valid ? 'is-valid' : proof ? 'is-invalid' : ''}`}>{proofChecking ? 'VERIFYING' : proof ? proof.valid ? 'SIGNATURE VALID' : 'CHECK FAILED' : 'READY'}</span></div>
          <p>The recorded receipt binds the wallet authorization to the observed transaction fields and outcome.</p>
          <div className="tx-recovery-demo__proof-checks"><div><span>Authorization signature</span><b>{proofChecking ? 'Checking…' : proof?.valid ? 'Valid' : proof ? 'Invalid' : '—'}</b></div><div><span>Transaction binding</span><b>{proofChecking ? 'Checking…' : proof?.valid ? 'Bound' : proof ? 'Not verified' : '—'}</b></div><div><span>Execution outcome</span><b>{evidenceBundle.priorSeal.receipt.outcome}</b></div></div>
          <div className="tx-recovery-demo__key-note">Verified locally against the public key included in this test fixture. The demo key is not a production issuer trust root.</div>
          <button className="tx-recovery-demo__text-button" onClick={() => void verifyReceipt()} disabled={proofChecking}>{proofChecking ? 'Verifying receipt…' : 'Verify receipt again ↻'}</button>
        </section>

        <section className="tx-recovery-demo__panel tx-recovery-demo__persist-panel">
          <div className="tx-recovery-demo__panel-label"><span>RECOVERY RECORD</span><span>LOCAL DEMO</span></div>
          <dl><div><dt>Operation ID</dt><dd>{shortAddress(evidenceBundle.draft.initial.id)}</dd></div><div><dt>{saved ? 'Persisted fields' : 'In-tab fields'}</dt><dd>Operation ID · transaction hash</dd></div><div><dt>After reopen</dt><dd>Query chain; never resubmit</dd></div></dl>
          <p>{saved ? 'The conversation state survives a page refresh in this browser.' : 'The conversation state stays in this tab unless local saving is allowed.'} The API is read-only and cannot submit or replace a transaction.</p>
        </section>
      </aside>
    </section>

    <section className="tx-recovery-demo__boundary">
      <div><p className="tx-recovery-demo__eyebrow">EVIDENCE BOUNDARY</p><h2>A verifiable testnet example,<br /><em>with the limits stated.</em></h2></div>
      <div><p>This is a recorded Base Sepolia transfer with an independent PriorSeal authorization and receipt fixture. The status endpoint reads public chain data; the receipt is checked locally. It is a demo, not a production service or an integration claim for the payment application.</p><div className="tx-recovery-demo__boundary-links"><a href={EXPLORER_URL} target="_blank" rel="noreferrer">Transaction explorer ↗</a><a href={EVIDENCE_URL} target="_blank" rel="noreferrer">Source and verification notes ↗</a><button onClick={resetDemo}>Reset this browser demo</button></div></div>
    </section>

    <footer className="tx-recovery-demo__footer"><a href="https://priorseal.xyz/">PriorSeal</a><span>Recorded Base Sepolia evidence · No new transaction is broadcast</span><a href="https://github.com/imokokok/PriorSeal">GitHub ↗</a></footer>
  </main>
}
