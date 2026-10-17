import { useMemo, useState } from 'react'
import {
  assertPreparedGuardedJupiterSwap,
  authorizeGuardedJupiterSwap,
  observeGuardedJupiterSwap,
  reviewGuardedJupiterSwap,
  type GuardedJupiterSwapReview,
  type PreparedGuardedJupiterSwap,
} from 'priorseal-sdk'
import { CodeValue, Field, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities } from '../lib/api'
import { downloadJson } from '../lib/download'
import { base64, decodeTransaction, installedSolanaWallet, messageBytes, sameBytes, sendExactSolanaTransaction, serializeTransaction, type BrowserSolanaWallet, walletAddress } from '../lib/solana-wallet'
import type { ObservationResult } from '../types'
import '../console-jupiter-guarded-swap.css'

type AuthorizationResult = Awaited<ReturnType<typeof authorizeGuardedJupiterSwap>>
type Phase = 'IMPORT' | 'REVIEWED' | 'AUTHORIZED' | 'SUBMITTED' | 'OBSERVED'

const publicRpcDefault = 'https://api.mainnet-beta.solana.com'
const shortMint = (value: string) => value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
const timestamp = (seconds: number) => new Date(seconds * 1000).toLocaleString()

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The guarded-swap action could not be completed.'
  return message.replace(/https?:\/\/\S+/g, '[endpoint hidden]').slice(0, 420)
}

function preparedFromUpload(value: unknown): PreparedGuardedJupiterSwap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The selected file must contain a guarded-swap preparation package.')
  const record = value as Record<string, unknown>
  const prepared = record.schema === 'priorseal.jupiter-guarded-swap-package.v1' ? record.prepared : value
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) throw new Error('The preparation package has no guarded-swap object.')
  return prepared as PreparedGuardedJupiterSwap
}

function phaseIndex(phase: Phase) { return ['IMPORT', 'REVIEWED', 'AUTHORIZED', 'SUBMITTED', 'OBSERVED'].indexOf(phase) }

export function JupiterGuardedSwapPage() {
  const [prepared, setPrepared] = useState<PreparedGuardedJupiterSwap | null>(null)
  const [review, setReview] = useState<GuardedJupiterSwapReview | null>(null)
  const [wallet, setWallet] = useState<BrowserSolanaWallet | null>(null)
  const [account, setAccount] = useState('')
  const [rpcUrl, setRpcUrl] = useState(publicRpcDefault)
  const [authorization, setAuthorization] = useState<AuthorizationResult | null>(null)
  const [signature, setSignature] = useState('')
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [phase, setPhase] = useState<Phase>('IMPORT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const warnings = review?.warnings ?? []
  const active = authorization?.authorizationWindow.active === true
  const canSubmit = Boolean(prepared && wallet && authorization && active && !signature && phaseIndex(phase) === phaseIndex('AUTHORIZED'))
  const evidence = useMemo(() => prepared && review ? {
    schema: 'priorseal.jupiter-guarded-swap-evidence.v1',
    exportedAt: new Date().toISOString(),
    prepared,
    review,
    ...(authorization ? { authorization: authorization.accepted, authorizationPrepared: authorization.prepared } : {}),
    ...(signature ? { submission: { signature, rpcTransport: 'browser-direct-exact-transaction.v1' } } : {}),
    ...(observation ? { observation: observation.observation, receipt: observation.receipt, observationJob: observation.observationJob } : {}),
  } : null, [authorization, observation, prepared, review, signature])

  async function importPackage(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 1_000_000) throw new Error('Use a guarded-swap package smaller than 1 MB.')
      const candidate = preparedFromUpload(JSON.parse(await file.text()) as unknown)
      await assertPreparedGuardedJupiterSwap(candidate)
      const checkedReview = await reviewGuardedJupiterSwap(candidate)
      setPrepared(candidate); setReview(checkedReview); setAuthorization(null); setSignature(''); setObservation(null); setPhase('REVIEWED')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function connectWallet() {
    setBusy(true); setError('')
    try {
      const candidate = installedSolanaWallet()
      if (!candidate) throw new Error('No compatible Solana wallet was found. Install or unlock a wallet that supports message and transaction signing.')
      await candidate.connect()
      setWallet(candidate); setAccount(walletAddress(candidate))
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function authorize() {
    if (!prepared || !wallet || !account) return
    setBusy(true); setError('')
    try {
      await assertPreparedGuardedJupiterSwap(prepared)
      if (prepared.transaction.feePayer !== account) throw new Error('The connected wallet must be the prepared transaction fee payer. Import a package prepared for this wallet.')
      const capabilities = await getCapabilities()
      if (!capabilities.executionProfiles.includes('priorseal.execution-profile.solana-transaction.v2') || !capabilities.authorizers.includes('solana-ed25519') || !capabilities.workflowReady) throw new Error('This PriorSeal deployment is not configured for Solana message authorization.')
      const accepted = await authorizeGuardedJupiterSwap({
        client: api, prepared, wallet: { publicKey: account, signMessage: wallet.signMessage.bind(wallet) },
        principal: { type: 'user', id: `wallet:${account}` },
        agentId: 'console.jupiter-guarded-swap', audience: capabilities.audience,
      })
      if (!accepted.authorizationWindow.active) throw new Error('The accepted authorization is not active. Obtain a fresh guarded-swap package.')
      setAuthorization(accepted); setPhase('AUTHORIZED')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function signAndSubmit() {
    if (!prepared || !wallet || !authorization || !canSubmit) return
    setBusy(true); setError('')
    try {
      await assertPreparedGuardedJupiterSwap(prepared)
      const unsigned = decodeTransaction(prepared.transactionBase64)
      const originalMessage = messageBytes(unsigned)
      const signed = await wallet.signTransaction(unsigned)
      if (!sameBytes(originalMessage, messageBytes(signed))) throw new Error('The wallet changed the prepared message. The transaction was not broadcast; prepare and review a new package.')
      const signedBase64 = base64(await serializeTransaction(signed))
      const submitted = await sendExactSolanaTransaction(rpcUrl, signedBase64)
      setSignature(submitted); setPhase('SUBMITTED')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function observe() {
    if (!authorization || !signature) return
    setBusy(true); setError('')
    try {
      const result = await observeGuardedJupiterSwap({ client: api, authorizationId: authorization.accepted.authorization.authorizationId, signature, confirmations: 0 })
      setObservation(result); setPhase('OBSERVED')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  return <>
    <PageHeader eyebrow="SOLANA / JUPITER" title="Guarded swap console" actions={evidence ? <button className="button secondary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Export evidence</button> : undefined}>
      Review a pre-simulated exact transaction, sign its authority separately, submit its unmodified bytes once, and retain portable proof. This page never receives a signing key or an upstream API key.
    </PageHeader>

    <section className="jupiter-flow" aria-label="Guarded swap workflow">
      {['Import package', 'Review limits', 'Authorize', 'Sign & submit', 'Observe & export'].map((label, index) => <div className={phaseIndex(phase) >= index ? 'complete' : ''} key={label}><span>0{index + 1}</span><strong>{label}</strong></div>)}
    </section>

    {error && <Notice tone="danger" title="Guarded swap needs attention">{error}</Notice>}

    <div className="jupiter-layout">
      <section className="panel jupiter-import">
        <span className="jupiter-index">01 / PREPARED PACKAGE</span>
        <h2>Import a reviewed route</h2>
        <p>Packages are created by your protected integration service with Jupiter routing, Insight simulation and the exact PriorSeal transaction binding. This browser independently rejects an expired or altered package.</p>
        <Field label="Guarded-swap package" hint="Accepts the prepared object itself or a priorseal.jupiter-guarded-swap-package.v1 wrapper. No keys are stored in the file."><input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void importPackage(event.target.files?.[0])} /></Field>
        <div className="jupiter-import__actions"><button className="button secondary" disabled={busy} onClick={() => void connectWallet()}>{account ? `Wallet ${shortMint(account)}` : 'Connect Solana wallet'}</button>{prepared && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.jupiter-guarded-swap-package.v1', prepared }, `${prepared.request.intentId}-prepared.json`)}>Download prepared package</button>}</div>
        <Notice tone="info" title="Why import a package?">Jupiter and Insight credentials stay in the protected service. The browser receives only the exact transaction, its reviewed route and the evidence needed to verify it.</Notice>
      </section>

      <aside className="panel jupiter-state">
        <span className="jupiter-index">SESSION / STATUS</span>
        <h2>Execution boundary</h2>
        <dl>
          <div><dt>Wallet</dt><dd>{account ? <CodeValue value={account} /> : 'Not connected'}</dd></div>
          <div><dt>Route package</dt><dd><Status value={prepared ? 'VALIDATED' : 'REQUIRED'} small /></dd></div>
          <div><dt>Authority</dt><dd><Status value={authorization ? active ? 'AUTHORIZED' : 'EXPIRED' : 'NOT SIGNED'} small /></dd></div>
          <div><dt>Submission</dt><dd>{signature ? <CodeValue value={signature} /> : 'Not broadcast'}</dd></div>
        </dl>
      </aside>
    </div>

    {prepared && review && <>
      <section className="panel jupiter-review">
        <div className="panel-head"><div><span className="jupiter-index">02 / HUMAN REVIEW</span><h2>What this wallet will authorize</h2><p>Atomic quantities and exact cryptographic identifiers govern this flow; display labels are intentionally not trusted.</p></div><Status value="REVIEW REQUIRED" /></div>
        <dl className="jupiter-summary">
          <div><dt>Spend</dt><dd><strong>{review.input.amountAtomic}</strong><CodeValue value={review.input.mint} /></dd></div>
          <div><dt>Receive at least</dt><dd><strong>{review.output.minimumAmountAtomic}</strong><CodeValue value={review.output.mint} /></dd></div>
          <div><dt>Max slippage</dt><dd><strong>{review.slippageBps} bps</strong><span>Route threshold is bound</span></dd></div>
          <div><dt>Valid until</dt><dd><strong>{timestamp(review.validUntil)}</strong><span>Fresh package required after expiry</span></dd></div>
        </dl>
        <div className="jupiter-review-grid">
          <section><h3>Exact transaction binding</h3><dl className="jupiter-details"><div><dt>Message hash</dt><dd><CodeValue value={review.messageHash} /></dd></div><div><dt>Transaction bytes</dt><dd><CodeValue value={review.transactionDigest} /></dd></div><div><dt>Fee payer</dt><dd><CodeValue value={review.feePayer} /></dd></div><div><dt>Instructions</dt><dd>{review.instructionCount}</dd></div></dl></section>
          <section><h3>Route surface</h3><div className="jupiter-tags">{review.programIds.map((program) => <span key={program} title={program}>{shortMint(program)}</span>)}</div><p>{review.addressLookupTables.length ? `${review.addressLookupTables.length} address lookup table(s) are bound.` : 'No address lookup tables.'}</p><dl className="jupiter-details"><div><dt>Compute limit</dt><dd>{review.computeBudget.computeUnitLimit ?? 'Not set'}</dd></div><div><dt>Unit price</dt><dd>{review.computeBudget.computeUnitPriceMicroLamports ?? 'Not set'}</dd></div><div><dt>Max priority fee</dt><dd>{review.computeBudget.maximumPriorityFeeLamports ?? 'Not calculated'}</dd></div></dl></section>
        </div>
        {warnings.length > 0 && <div className="jupiter-warnings">{warnings.map((warning) => <Notice key={warning} tone="warning" title={warning.replaceAll('_', ' ')}>{warning === 'ADDRESS_LOOKUP_TABLES_NOT_PINNED' ? 'The integration did not pin the permitted address lookup tables. Review the route service policy before authorizing.' : warning === 'PRIORITY_FEE_NOT_CAPPED' ? 'The route policy has no maximum priority-fee cap. Do not authorize a customer-facing production route until the policy supplies one.' : 'The output is wrapped SOL, not automatically unwrapped native SOL.'}</Notice>)}</div>}
        <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !wallet || !account || Boolean(authorization)} onClick={() => void authorize()}>{busy ? 'Checking and signing…' : authorization ? 'Authorization accepted' : 'Authorize exact swap'}</button><span>The wallet signs a readable PriorSeal authorization before it is asked to sign the transaction.</span></div>
      </section>

      {authorization && <section className="panel jupiter-submit">
        <span className="jupiter-index">03 / ONE EXACT BROADCAST</span><h2>Sign and submit unchanged bytes</h2>
        <p>Your wallet first signs the exact reviewed transaction. The browser compares its message bytes with the reviewed message and broadcasts only if they are identical. Submission has no automatic retry.</p>
        <div className="jupiter-submit-grid"><Field label="Solana RPC endpoint" hint="Use HTTPS. The default public endpoint is rate-limited; production deployments should use a same-origin RPC proxy rather than exposing a provider credential in browser code."><input value={rpcUrl} disabled={busy || Boolean(signature)} onChange={(event) => setRpcUrl(event.target.value)} /></Field><div className="jupiter-submit-check"><strong>Single-send control</strong><span>Changing quote, blockhash, transaction bytes or route requires a brand-new package, simulation and authorization.</span></div></div>
        <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canSubmit} onClick={() => void signAndSubmit()}>{busy ? 'Waiting for wallet or RPC…' : signature ? 'Transaction submitted' : 'Sign and submit exact transaction'}</button>{signature && <button className="button secondary" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : observation ? 'Observation completed' : 'Observe submitted transaction'}</button>}</div>
        {signature && <div className="jupiter-signature"><Status value={observation?.observation.status ?? 'SUBMITTED'} /><CodeValue value={signature} /></div>}
      </section>}

      {observation && <section className="panel jupiter-evidence">
        <span className="jupiter-index">04 / EVIDENCE</span><h2>{observation.receipt ? 'Evidence package is ready' : 'Observation retained'}</h2>
        <p>{observation.receipt ? 'The export contains the route review, exact bytes digest, authorization, submitted signature, observed execution and signed receipt.' : 'The export preserves the authorization and observation state. A non-final result is not proof of a completed swap.'}</p>
        <div className="jupiter-review-actions"><Status value={observation.observation.status} />{evidence && <button className="button primary" onClick={() => downloadJson(evidence, `${prepared.request.intentId}-evidence.json`)}>Download evidence package</button>}</div>
      </section>}
    </>}
  </>
}
