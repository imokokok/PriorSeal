import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  assertPreparedGuardedZeroExSwap,
  authorizeGuardedZeroExSwap,
  observeGuardedZeroExSwap,
  type GuardedZeroExSwapReview,
  type PreparedGuardedZeroExSwap,
} from 'priorseal-sdk'
import { CodeValue, Field, LoadingState, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, prepareGuardedZeroExSwap, submitGuardedZeroExSwap } from '../lib/api'
import { downloadJson } from '../lib/download'
import { base64, decodeTransaction, installedSolanaWallet, messageBytes, sameBytes, serializeTransaction, type BrowserSolanaWallet, walletAddress } from '../lib/solana-wallet'
import type { ObservationResult } from '../types'
import '../console-jupiter-guarded-swap.css'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'
const shorten = (value: string) => value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'The guarded 0x swap could not be completed.').replace(/https?:\/\/\S+/g, '[endpoint hidden]').slice(0, 420)

export function ZeroExGuardedSwapPage() {
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof getCapabilities>> | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [wallet, setWallet] = useState<BrowserSolanaWallet | null>(null)
  const [account, setAccount] = useState('')
  const [input, setInput] = useState({ inputMint: USDC, outputMint: WRAPPED_SOL, amount: '', minimumOutputAmountAtomic: '', slippageBps: '50' })
  const [prepared, setPrepared] = useState<PreparedGuardedZeroExSwap | null>(null)
  const [review, setReview] = useState<GuardedZeroExSwapReview | null>(null)
  const [authorization, setAuthorization] = useState<Awaited<ReturnType<typeof authorizeGuardedZeroExSwap>> | null>(null)
  const [signature, setSignature] = useState('')
  const [submission, setSubmission] = useState<'SUBMITTED' | 'UNKNOWN' | null>(null)
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getCapabilities().then((value) => { if (active) setCapabilities(value) }).catch((caught) => { if (active) setCapabilitiesError(errorText(caught)) })
    return () => { active = false }
  }, [])

  const integration = capabilities?.integrations?.guardedZeroEx
  const ready = integration?.enabled === true
  const authorizationActive = authorization?.authorizationWindow.active === true
  const canSubmit = Boolean(prepared && wallet && authorization && authorizationActive && !signature)
  const evidence = useMemo(() => prepared && review ? {
    schema: 'priorseal.zeroex-guarded-swap-evidence.v1', exportedAt: new Date().toISOString(), prepared, review,
    ...(authorization ? { authorization: authorization.accepted, authorizationPrepared: authorization.prepared } : {}),
    ...(signature ? { submission: { signature, status: submission, rpcTransport: 'priorseal-guarded-zeroex-relay.v1' } } : {}),
    ...(observation ? { observation: observation.observation, receipt: observation.receipt, observationJob: observation.observationJob } : {}),
  } : null, [authorization, observation, prepared, review, signature, submission])

  async function connectWallet() {
    setBusy(true); setError('')
    try {
      const candidate = installedSolanaWallet()
      if (!candidate) throw new Error('No compatible Solana wallet was found. Install or unlock a wallet that supports message and transaction signing.')
      await candidate.connect(); setWallet(candidate); setAccount(walletAddress(candidate))
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function prepare() {
    if (!account) { setError('Connect the self-paying wallet before requesting a guarded 0x route.'); return }
    setBusy(true); setError('')
    try {
      const slippageBps = Number(input.slippageBps)
      if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error('Enter a positive input amount in atomic units.')
      if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new Error('Slippage must be a whole number of basis points.')
      const result = await prepareGuardedZeroExSwap({ inputMint: input.inputMint.trim(), outputMint: input.outputMint.trim(), amount: input.amount, taker: account, slippageBps, ...(input.minimumOutputAmountAtomic ? { minimumOutputAmountAtomic: input.minimumOutputAmountAtomic } : {}) })
      await assertPreparedGuardedZeroExSwap(result.prepared)
      setPrepared(result.prepared); setReview(result.review); setAuthorization(null); setSignature(''); setSubmission(null); setObservation(null)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function authorize() {
    if (!prepared || !wallet || !account) return
    setBusy(true); setError('')
    try {
      await assertPreparedGuardedZeroExSwap(prepared)
      if (prepared.transaction.feePayer !== account) throw new Error('The connected wallet must be the fee payer in the prepared transaction.')
      const latest = await getCapabilities()
      if (!latest.integrations?.guardedZeroEx?.enabled || !latest.workflowReady || !latest.executionProfiles.includes('priorseal.execution-profile.solana-transaction.v2') || !latest.authorizers.includes('solana-ed25519')) throw new Error('This deployment is no longer ready for guarded Solana authorization.')
      const accepted = await authorizeGuardedZeroExSwap({
        client: api, prepared, wallet: { publicKey: account, signMessage: wallet.signMessage.bind(wallet) },
        principal: { type: 'user', id: `wallet:${account}` }, agentId: 'console.zeroex-guarded-swap', audience: latest.audience,
      })
      if (!accepted.authorizationWindow.active) throw new Error('The accepted authorization is not active. Prepare a fresh route.')
      setAuthorization(accepted)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function signAndSubmit() {
    if (!prepared || !wallet || !authorization || !canSubmit) return
    setBusy(true); setError('')
    try {
      await assertPreparedGuardedZeroExSwap(prepared)
      const unsigned = decodeTransaction(prepared.transactionBase64)
      const originalMessage = messageBytes(unsigned)
      const signed = await wallet.signTransaction(unsigned)
      if (!sameBytes(originalMessage, messageBytes(signed))) throw new Error('The wallet changed the reviewed message. The transaction was not broadcast.')
      const result = await submitGuardedZeroExSwap({ authorizationId: authorization.accepted.authorization.authorizationId, prepared, signedTransactionBase64: base64(await serializeTransaction(signed)) })
      setSignature(result.signature); setSubmission(result.submission)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function observe() {
    if (!authorization || !signature) return
    setBusy(true); setError('')
    try { setObservation(await observeGuardedZeroExSwap({ client: api, authorizationId: authorization.accepted.authorization.authorizationId, signature, confirmations: 0 })) } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  if (!capabilities && !capabilitiesError) return <><PageHeader eyebrow="SOLANA / 0X" title="Checking guarded swap availability">PriorSeal checks the deployment before connecting a wallet or requesting a route.</PageHeader><LoadingState label="Checking guarded 0x configuration…" /></>
  if (capabilitiesError || !ready) return <><PageHeader eyebrow="SOLANA / 0X" title="Guarded swap unavailable">0x access is opt-in. A deployment must publish complete Solana authorization, observation and protected route services before this page can prepare a swap.</PageHeader><Notice tone="warning" title={capabilitiesError ? 'Deployment capabilities could not be read' : 'This deployment is not configured for guarded 0x swaps'}>{capabilitiesError || `Deployment status: ${integration?.reason ?? 'NOT_CONFIGURED'}.`}</Notice><div className="header-actions"><Link className="button primary" to="/app/quickstart">Review available workflow →</Link><Link className="button secondary" to="/app/sdk">Use the SDK integration →</Link></div></>

  return <>
    <PageHeader eyebrow="SOLANA / 0X" title="Guarded 0x swap console" actions={evidence ? <button className="button secondary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Export evidence</button> : undefined}>The protected service requests raw 0x instructions, fixes a deployment-owned compute budget and any disclosed server-owned fee, simulates the final transaction through Insight, and relays only wallet-signed unchanged bytes.</PageHeader>
    {error && <Notice tone="danger" title="Guarded 0x swap needs attention">{error}</Notice>}
    <div className="jupiter-layout">
      <section className="panel jupiter-import"><span className="jupiter-index">01 / PROTECTED ROUTE</span><h2>Connect, prepare and review</h2><p>The browser never receives an 0x API key, Insight API key, or RPC credential. Atomic amounts are the binding values.</p>
        <div className="jupiter-prepare-grid">
          <Field label="Input mint" hint="Solana mint address"><input value={input.inputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, inputMint: event.target.value })} /></Field>
          <Field label="Output mint" hint="Solana mint address"><input value={input.outputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, outputMint: event.target.value })} /></Field>
          <Field label="Input amount" hint="Atomic units"><input inputMode="numeric" value={input.amount} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, amount: event.target.value })} /></Field>
          <Field label="Slippage" hint="Basis points"><input inputMode="numeric" value={input.slippageBps} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, slippageBps: event.target.value })} /></Field>
          <Field label="Independent output floor" hint="Optional atomic minimum"><input inputMode="numeric" value={input.minimumOutputAmountAtomic} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, minimumOutputAmountAtomic: event.target.value })} /></Field>
        </div>
        <div className="jupiter-import__actions"><button className="button secondary" disabled={busy} onClick={() => void connectWallet()}>{account ? `Wallet ${shorten(account)}` : 'Connect Solana wallet'}</button><button className="button primary" disabled={busy || !account || Boolean(prepared)} onClick={() => void prepare()}>{busy ? 'Preparing guarded route…' : 'Get guarded 0x route'}</button>{prepared && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.zeroex-guarded-swap-package.v1', prepared }, `${prepared.request.intentId}-prepared.json`)}>Download package</button>}</div>
      </section>
      <aside className="panel jupiter-state"><span className="jupiter-index">SESSION / STATUS</span><h2>Execution boundary</h2><dl><div><dt>Wallet</dt><dd>{account ? <CodeValue value={account} /> : 'Not connected'}</dd></div><div><dt>Route package</dt><dd><Status value={prepared ? 'VALIDATED' : 'REQUIRED'} small /></dd></div><div><dt>Authority</dt><dd><Status value={authorization ? authorizationActive ? 'AUTHORIZED' : 'EXPIRED' : 'NOT SIGNED'} small /></dd></div><div><dt>Submission</dt><dd>{signature ? <><Status value={submission ?? 'SUBMITTED'} small /><CodeValue value={signature} /></> : 'Not broadcast'}</dd></div></dl></aside>
    </div>
    {prepared && review && <section className="panel jupiter-review"><div className="panel-head"><div><span className="jupiter-index">02 / EXACT REVIEW</span><h2>What the wallet will authorize</h2><p>The route ID is trace data; the transaction message hash, unsigned-byte digest, mints, output floor and deployed program controls determine the authorization.</p></div><Status value="REVIEW REQUIRED" /></div>
      <dl className="jupiter-summary"><div><dt>Spend</dt><dd><strong>{review.input.amountAtomic}</strong><CodeValue value={review.input.mint} /></dd></div><div><dt>Receive at least</dt><dd><strong>{review.output.minimumAmountAtomic}</strong><CodeValue value={review.output.mint} /></dd></div><div><dt>Estimated output</dt><dd><strong>{review.output.estimatedAmountAtomic}</strong><span>Not a settlement guarantee</span></dd></div><div><dt>Valid until</dt><dd><strong>{new Date(review.validUntil * 1000).toLocaleString()}</strong><span>Fresh route required after expiry</span></dd></div></dl>
      <div className="jupiter-review-grid"><section><h3>Transaction binding</h3><dl className="jupiter-details"><div><dt>0x route ID</dt><dd><CodeValue value={review.provider.zid} /></dd></div><div><dt>Message hash</dt><dd><CodeValue value={review.messageHash} /></dd></div><div><dt>Transaction bytes</dt><dd><CodeValue value={review.transactionDigest} /></dd></div><div><dt>Fee payer</dt><dd><CodeValue value={review.feePayer} /></dd></div></dl></section><section><h3>Policy-bound route surface</h3><div className="jupiter-tags">{review.programIds.map((program) => <span key={program} title={program}>{shorten(program)}</span>)}</div><dl className="jupiter-details"><div><dt>Compute limit</dt><dd>{review.computeBudget.computeUnitLimit ?? 'Not set'}</dd></div><div><dt>Unit price</dt><dd>{review.computeBudget.computeUnitPriceMicroLamports ?? 'Not set'}</dd></div><div><dt>Max priority fee</dt><dd>{review.computeBudget.maximumPriorityFeeLamports ?? 'Not calculated'}</dd></div></dl></section></div>
      <section className="jupiter-review-grid"><section><h3>Commercial terms</h3><dl className="jupiter-details"><div><dt>Tenant</dt><dd>{review.commercial.tenantId}</dd></div>{review.commercial.fee ? <><div><dt>Service fee</dt><dd>{review.commercial.fee.feePpm} ppm / {review.commercial.fee.expectedAmountAtomic} atomic units</dd></div><div><dt>Input mint</dt><dd><CodeValue value={review.commercial.fee.mint} /></dd></div><div><dt>Recipient account</dt><dd><CodeValue value={review.commercial.fee.recipientTokenAccount} /></dd></div><div><dt>Fee profile</dt><dd>{review.commercial.fee.profileId}</dd></div></> : <div><dt>Service fee</dt><dd>No PriorSeal service fee is configured for this route.</dd></div>}</dl></section><section><h3>Authorization evidence</h3><p className="jupiter-review-copy">These terms are generated by the deployment, committed into the exact PriorSeal authorization, and exported with the evidence package. A fee is never supplied by this browser.</p><dl className="jupiter-details"><div><dt>Commitment</dt><dd><CodeValue value={review.commercial.commitment.digest} /></dd></div></dl></section></section>
      <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !wallet || !account || Boolean(authorization)} onClick={() => void authorize()}>{busy ? 'Checking and signing…' : authorization ? 'Authorization accepted' : 'Authorize exact swap'}</button><span>First the wallet signs a PriorSeal authorization, then it signs the exact transaction only once.</span></div>
    </section>}
    {authorization && <section className="panel jupiter-submit"><span className="jupiter-index">03 / ONE EXACT BROADCAST</span><h2>Sign and relay unchanged bytes</h2><p>PriorSeal compares the message before sending it to the deployment-owned RPC. A changed route, blockhash or message requires a new simulation and authorization.</p><div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canSubmit} onClick={() => void signAndSubmit()}>{busy ? 'Waiting for wallet or RPC…' : signature ? 'Transaction submitted' : 'Sign and submit exact transaction'}</button>{signature && <button className="button secondary" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : observation ? 'Observation completed' : 'Observe submitted transaction'}</button>}</div>{submission === 'UNKNOWN' && <Notice tone="warning" title="Relay outcome is unknown">The one-time authorization is already bound. Observe this exact signature before taking any other action; do not resubmit it.</Notice>}{signature && <div className="jupiter-signature"><Status value={observation?.observation.status ?? submission ?? 'SUBMITTED'} /><CodeValue value={signature} /></div>}</section>}
    {observation && <section className="panel jupiter-evidence"><span className="jupiter-index">04 / EVIDENCE</span><h2>{observation.receipt ? 'Evidence package is ready' : 'Observation retained'}</h2><p>The export preserves the reviewed route, simulation binding, authorization, submitted signature, observation and any signed receipt. A simulation is not a price or settlement guarantee.</p><div className="jupiter-review-actions"><Status value={observation.observation.status} />{evidence && <button className="button primary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Download evidence package</button>}</div></section>}
  </>
}
