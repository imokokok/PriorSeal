import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AGENT_PROPOSAL_NAMESPACE,
  assertPreparedGuardedZeroExSwap,
  authorizeGuardedZeroExSwap,
  createAgentProposal,
  observeGuardedZeroExSwap,
  parseAgentProposal,
  reviewGuardedZeroExSwap,
  verifyAgentProposalCommitment,
  type AgentProposal,
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
const defaultAgentId = 'agent:console.zeroex-guarded-swap'
const agentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const shorten = (value: string) => value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'The guarded 0x swap could not be completed.').replace(/https?:\/\/\S+/g, '[endpoint hidden]').slice(0, 420)
const knownMints: Record<string, { symbol: string; decimals: number }> = { [USDC]: { symbol: 'USDC', decimals: 6 }, [WRAPPED_SOL]: { symbol: 'wSOL', decimals: 9 } }

function displayAtomicAmount(mint: string, amount: string): string {
  const token = knownMints[mint]
  if (!token || !/^(0|[1-9][0-9]*)$/.test(amount)) return `${amount} atomic units`
  const padded = amount.padStart(token.decimals + 1, '0')
  const whole = padded.slice(0, -token.decimals)
  const fraction = padded.slice(-token.decimals).replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} ${token.symbol}`
}

function remainingTime(seconds: number): string {
  if (seconds <= 0) return 'Expired — prepare a new route'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s remaining` : `${remainder}s remaining`
}

function preparedFromUpload(value: unknown): { prepared: PreparedGuardedZeroExSwap; proposal: AgentProposal | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The selected file must contain a guarded 0x preparation package.')
  const record = value as Record<string, unknown>
  const packageEnvelope = record.schema === 'priorseal.zeroex-guarded-swap-package.v1' || record.schema === 'priorseal.zeroex-guarded-swap-package.v2'
  const prepared = packageEnvelope ? record.prepared : value
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) throw new Error('The preparation package has no guarded 0x object.')
  return { prepared: prepared as PreparedGuardedZeroExSwap, proposal: packageEnvelope && record.agentProposal !== undefined ? parseAgentProposal(record.agentProposal) : null }
}

export function ZeroExGuardedSwapPage() {
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof getCapabilities>> | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [wallet, setWallet] = useState<BrowserSolanaWallet | null>(null)
  const [account, setAccount] = useState('')
  const [agentId, setAgentId] = useState(defaultAgentId)
  const [proposal, setProposal] = useState<AgentProposal | null>(null)
  const [proposalRationale, setProposalRationale] = useState('No additional rationale was supplied by the proposing application.')
  const [input, setInput] = useState({ inputMint: USDC, outputMint: WRAPPED_SOL, amount: '', minimumOutputAmountAtomic: '', slippageBps: '50' })
  const [prepared, setPrepared] = useState<PreparedGuardedZeroExSwap | null>(null)
  const [review, setReview] = useState<GuardedZeroExSwapReview | null>(null)
  const [authorization, setAuthorization] = useState<Awaited<ReturnType<typeof authorizeGuardedZeroExSwap>> | null>(null)
  const [signature, setSignature] = useState('')
  const [submission, setSubmission] = useState<'SUBMITTED' | 'UNKNOWN' | null>(null)
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    getCapabilities().then((value) => { if (active) setCapabilities(value) }).catch((caught) => { if (active) setCapabilitiesError(errorText(caught)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!prepared || authorization) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [authorization, prepared])

  const integration = capabilities?.integrations?.guardedZeroEx
  const ready = integration?.enabled === true
  const authorizationActive = authorization?.authorizationWindow.active === true
  const routeExpired = Boolean(review && review.validUntil <= Math.floor(clock / 1000))
  const agentIdValid = agentIdPattern.test(agentId)
  const canAuthorize = Boolean(prepared && wallet && account && !authorization && reviewAcknowledged && agentIdValid && !routeExpired)
  const canSubmit = Boolean(prepared && wallet && authorization && authorizationActive && !signature)
  const evidence = useMemo(() => prepared && review ? {
    schema: 'priorseal.zeroex-guarded-swap-evidence.v2', exportedAt: new Date().toISOString(), prepared, review,
    agent: { id: agentId, disclosure: 'The agent ID is bound into the PriorSeal authorization. Identity verification remains the integrating application’s responsibility.' },
    ...(proposal ? { agentProposal: proposal } : {}),
    ...(authorization ? { authorization: authorization.accepted, authorizationPrepared: authorization.prepared } : {}),
    ...(signature ? { submission: { signature, status: submission, rpcTransport: 'priorseal-guarded-zeroex-relay.v1' } } : {}),
    ...(observation ? { observation: observation.observation, receipt: observation.receipt, observationJob: observation.observationJob } : {}),
  } : null, [agentId, authorization, observation, prepared, proposal, review, signature, submission])

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
      const agentProposal = createAgentProposal({ agentId: agentId.trim(), proposalId: `proposal_${crypto.randomUUID().replaceAll('-', '')}`, createdAt: Math.floor(Date.now() / 1000), rationale: proposalRationale })
      const result = await prepareGuardedZeroExSwap({ inputMint: input.inputMint.trim(), outputMint: input.outputMint.trim(), amount: input.amount, taker: account, slippageBps, agentProposal, ...(input.minimumOutputAmountAtomic ? { minimumOutputAmountAtomic: input.minimumOutputAmountAtomic } : {}) })
      await assertPreparedGuardedZeroExSwap(result.prepared)
      if (!(await verifyAgentProposalCommitment(result.prepared.intent, agentProposal)).matched) throw new Error('The protected service did not bind the Agent proposal record into this exact route.')
      setProposal(agentProposal); setPrepared(result.prepared); setReview(result.review); setReviewAcknowledged(false); setAuthorization(null); setSignature(''); setSubmission(null); setObservation(null)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function authorize() {
    if (!prepared || !wallet || !account) return
    setBusy(true); setError('')
    try {
      await assertPreparedGuardedZeroExSwap(prepared)
      if (!agentIdPattern.test(agentId)) throw new Error('Agent ID must use 1–128 letters, digits, dots, underscores, hyphens, or colons, and begin with a letter or digit.')
      if (!reviewAcknowledged) throw new Error('Confirm the exact spend, minimum receive, fees, expiry, and one-time execution boundary before authorizing.')
      if (routeExpired) throw new Error('This route has expired. Discard it and prepare a fresh route.')
      if (prepared.transaction.feePayer !== account) throw new Error('The connected wallet must be the fee payer in the prepared transaction.')
      const latest = await getCapabilities()
      if (!latest.integrations?.guardedZeroEx?.enabled || !latest.workflowReady || !latest.executionProfiles.includes('priorseal.execution-profile.solana-transaction.v2') || !latest.authorizers.includes('solana-ed25519')) throw new Error('This deployment is no longer ready for guarded Solana authorization.')
      const accepted = await authorizeGuardedZeroExSwap({
        client: api, prepared, wallet: { publicKey: account, signMessage: wallet.signMessage.bind(wallet) },
        principal: { type: 'user', id: `wallet:${account}` }, agentId: agentId.trim(), ...(proposal ? { proposal } : {}), audience: latest.audience,
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

  async function importPackage(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 1_000_000) throw new Error('Use a guarded 0x package smaller than 1 MB.')
      const candidate = preparedFromUpload(JSON.parse(await file.text()) as unknown)
      await assertPreparedGuardedZeroExSwap(candidate.prepared)
      const proposalCommitmentPresent = candidate.prepared.intent.contextCommitments?.some((commitment) => commitment.namespace === AGENT_PROPOSAL_NAMESPACE) ?? false
      if (candidate.proposal && !(await verifyAgentProposalCommitment(candidate.prepared.intent, candidate.proposal)).matched) throw new Error('The imported Agent proposal record does not match the exact prepared transaction.')
      if (proposalCommitmentPresent && !candidate.proposal) throw new Error('This package commits to an Agent proposal but does not include its record. Ask the proposing application for a complete v2 package.')
      const checkedReview = await reviewGuardedZeroExSwap(candidate.prepared)
      if (candidate.proposal) { setAgentId(candidate.proposal.agentId); setProposalRationale(candidate.proposal.rationale) }
      setProposal(candidate.proposal); setPrepared(candidate.prepared); setReview(checkedReview); setReviewAcknowledged(false); setAuthorization(null); setSignature(''); setSubmission(null); setObservation(null)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  function discardUnsignedProposal() {
    if (authorization) return
    setPrepared(null); setReview(null); setProposal(null); setReviewAcknowledged(false); setSignature(''); setSubmission(null); setObservation(null); setError('')
  }

  if (!capabilities && !capabilitiesError) return <><PageHeader eyebrow="SOLANA / 0X" title="Checking guarded swap availability">PriorSeal checks the deployment before connecting a wallet or requesting a route.</PageHeader><LoadingState label="Checking guarded 0x configuration…" /></>
  if (capabilitiesError || !ready) return <><PageHeader eyebrow="SOLANA / 0X" title="Guarded swap unavailable">0x access is opt-in. A deployment must publish complete Solana authorization, observation and protected route services before this page can prepare a swap.</PageHeader><Notice tone="warning" title={capabilitiesError ? 'Deployment capabilities could not be read' : 'This deployment is not configured for guarded 0x swaps'}>{capabilitiesError || `Deployment status: ${integration?.reason ?? 'NOT_CONFIGURED'}.`}</Notice><div className="header-actions"><Link className="button primary" to="/app/quickstart">Review available workflow →</Link><Link className="button secondary" to="/app/sdk">Use the SDK integration →</Link></div></>

  return <>
    <PageHeader eyebrow="SOLANA / VERIFIED AGENT SWAP" title="Verify an agent 0x swap" actions={evidence ? <button className="button secondary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Export evidence</button> : undefined}>Let an agent prepare one 0x route while you keep the final say. The protected service fixes route controls, simulates the exact transaction, and relays only wallet-signed unchanged bytes once.</PageHeader>
    {error && <Notice tone="danger" title="Guarded 0x swap needs attention">{error}</Notice>}
    <div className="jupiter-layout">
      <section className="panel jupiter-import"><span className="jupiter-index">01 / AGENT PROPOSAL</span><h2>Prepare one exact 0x swap</h2><p>The browser never receives an 0x API key, Insight API key, or RPC credential. The Agent rationale is retained as evidence; atomic values remain binding.</p>
        <div className="jupiter-prepare-grid">
          <Field label="Agent ID" hint="Bound into the proposal record and signed authorization. It is not an identity or performance guarantee."><input value={agentId} maxLength={128} disabled={busy || Boolean(prepared)} onChange={(event) => setAgentId(event.target.value.trim())} /></Field>
          <Field label="Input mint" hint="Solana mint address"><input value={input.inputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, inputMint: event.target.value })} /></Field>
          <Field label="Output mint" hint="Solana mint address"><input value={input.outputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, outputMint: event.target.value })} /></Field>
          <Field label="Input amount" hint={`Atomic units · ${displayAtomicAmount(input.inputMint.trim(), input.amount || '0')}`}><input inputMode="numeric" value={input.amount} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, amount: event.target.value })} /></Field>
          <Field label="Slippage" hint="Basis points"><input inputMode="numeric" value={input.slippageBps} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, slippageBps: event.target.value })} /></Field>
          <Field label="Independent output floor" hint="Optional atomic minimum"><input inputMode="numeric" value={input.minimumOutputAmountAtomic} disabled={busy || Boolean(prepared)} onChange={(event) => setInput({ ...input, minimumOutputAmountAtomic: event.target.value })} /></Field>
          <Field label="Agent rationale" hint="Required disclosure, 1–280 characters. It is committed as evidence, not an investment recommendation."><textarea rows={3} value={proposalRationale} maxLength={280} disabled={busy || Boolean(prepared)} onChange={(event) => setProposalRationale(event.target.value)} /></Field>
        </div>
        <div className="jupiter-import__actions"><button className="button primary" disabled={busy || !account || Boolean(prepared)} onClick={() => void prepare()}>{busy ? 'Preparing exact proposal…' : 'Prepare verified proposal'}</button><button className="button secondary" disabled={busy} onClick={() => void connectWallet()}>{account ? `Wallet ${shorten(account)}` : 'Connect Solana wallet'}</button>{prepared && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.zeroex-guarded-swap-package.v2', prepared, ...(proposal ? { agentProposal: proposal } : {}) }, `${prepared.request.intentId}-prepared.json`)}>Download prepared package</button>}{prepared && !authorization && <button className="button secondary" disabled={busy} onClick={discardUnsignedProposal}>Discard unsigned proposal</button>}</div>
        <p className="jupiter-import__or">or import a package prepared by an approved agent application</p>
        <Field label="Guarded 0x package" hint="Accepts the prepared object or a v1/v2 wrapper. A v2 Agent proposal record must match the exact route. No keys are stored in the file."><input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void importPackage(event.target.files?.[0])} /></Field>
      </section>
      <aside className="panel jupiter-state"><span className="jupiter-index">SESSION / CONTROL</span><h2>Your execution boundary</h2><dl><div><dt>Agent</dt><dd>{agentId ? <code>{agentId}</code> : 'Required before authorization'}</dd></div><div><dt>Rationale</dt><dd>{proposal ? <Status value="COMMITTED" small /> : 'Not retained in this package'}</dd></div><div><dt>Wallet</dt><dd>{account ? <CodeValue value={account} /> : 'Not connected'}</dd></div><div><dt>Route package</dt><dd><Status value={prepared ? 'VALIDATED' : 'REQUIRED'} small /></dd></div><div><dt>Route expiry</dt><dd>{review ? <Status value={routeExpired ? 'EXPIRED' : remainingTime(review.validUntil - Math.floor(clock / 1000)).toUpperCase()} small /> : 'Not prepared'}</dd></div><div><dt>Authority</dt><dd><Status value={authorization ? authorizationActive ? 'AUTHORIZED' : 'EXPIRED' : 'NOT SIGNED'} small /></dd></div><div><dt>Submission</dt><dd>{signature ? <><Status value={submission ?? 'SUBMITTED'} small /><CodeValue value={signature} /></> : 'Not broadcast'}</dd></div></dl></aside>
    </div>
    {prepared && review && <section className="panel jupiter-review"><div className="panel-head"><div><span className="jupiter-index">02 / EXACT REVIEW</span><h2>What the wallet will authorize</h2><p>The route ID is trace data; the transaction message hash, unsigned-byte digest, mints, output floor and deployed program controls determine the authorization.</p></div><Status value="REVIEW REQUIRED" /></div>
      <dl className="jupiter-summary"><div><dt>Agent proposal</dt><dd><strong>{agentId}</strong><span>{proposal ? `${proposal.proposalId}: ${proposal.rationale}` : 'Agent ID is recorded in the authorization; this imported package has no retained rationale record.'}</span></dd></div><div><dt>Spend</dt><dd><strong>{displayAtomicAmount(review.input.mint, review.input.amountAtomic)}</strong><span>{review.input.amountAtomic} atomic units govern</span><CodeValue value={review.input.mint} /></dd></div><div><dt>Receive at least</dt><dd><strong>{displayAtomicAmount(review.output.mint, review.output.minimumAmountAtomic)}</strong><span>{review.output.minimumAmountAtomic} atomic units govern</span><CodeValue value={review.output.mint} /></dd></div><div><dt>Estimated output</dt><dd><strong>{displayAtomicAmount(review.output.mint, review.output.estimatedAmountAtomic)}</strong><span>Not a settlement guarantee</span></dd></div><div><dt>Valid until</dt><dd><strong>{new Date(review.validUntil * 1000).toLocaleString()}</strong><span>{remainingTime(review.validUntil - Math.floor(clock / 1000))}. Fresh route required after expiry.</span></dd></div></dl>
      <div className="jupiter-review-grid"><section><h3>Transaction binding</h3><dl className="jupiter-details"><div><dt>0x route ID</dt><dd><CodeValue value={review.provider.zid} /></dd></div><div><dt>Message hash</dt><dd><CodeValue value={review.messageHash} /></dd></div><div><dt>Transaction bytes</dt><dd><CodeValue value={review.transactionDigest} /></dd></div><div><dt>Fee payer</dt><dd><CodeValue value={review.feePayer} /></dd></div></dl></section><section><h3>Policy-bound route surface</h3><div className="jupiter-tags">{review.programIds.map((program) => <span key={program} title={program}>{shorten(program)}</span>)}</div><dl className="jupiter-details"><div><dt>Compute limit</dt><dd>{review.computeBudget.computeUnitLimit ?? 'Not set'}</dd></div><div><dt>Unit price</dt><dd>{review.computeBudget.computeUnitPriceMicroLamports ?? 'Not set'}</dd></div><div><dt>Max priority fee</dt><dd>{review.computeBudget.maximumPriorityFeeLamports ?? 'Not calculated'}</dd></div></dl></section></div>
      <section className="jupiter-review-grid"><section><h3>Commercial terms</h3><dl className="jupiter-details"><div><dt>Tenant</dt><dd>{review.commercial.tenantId}</dd></div>{review.commercial.fee ? <><div><dt>Service fee</dt><dd>{review.commercial.fee.feePpm} ppm / {review.commercial.fee.expectedAmountAtomic} atomic units</dd></div><div><dt>Input mint</dt><dd><CodeValue value={review.commercial.fee.mint} /></dd></div><div><dt>Recipient account</dt><dd><CodeValue value={review.commercial.fee.recipientTokenAccount} /></dd></div><div><dt>Fee profile</dt><dd>{review.commercial.fee.profileId}</dd></div></> : <div><dt>Service fee</dt><dd>No PriorSeal service fee is configured for this route.</dd></div>}</dl></section><section><h3>Authorization evidence</h3><p className="jupiter-review-copy">These terms are generated by the deployment, committed into the exact PriorSeal authorization, and exported with the evidence package. A fee is never supplied by this browser.</p><dl className="jupiter-details"><div><dt>Commitment</dt><dd><CodeValue value={review.commercial.commitment.digest} /></dd></div></dl></section></section>
      <div className="jupiter-acknowledgement"><label><input type="checkbox" checked={reviewAcknowledged} disabled={busy || Boolean(authorization) || routeExpired} onChange={(event) => setReviewAcknowledged(event.target.checked)} /><span>I reviewed the exact spend, minimum receive, fees, expiry, agent rationale/ID, and single-use execution boundary.</span></label><p>{routeExpired ? 'This route has expired. Discard it and prepare a new route; an expired quote must never be re-authorized.' : !agentIdValid ? 'Enter a valid agent ID before authorizing.' : 'This authorization permits one exact transaction only. It does not authorize future or automatic swaps.'}</p></div>
      <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canAuthorize} onClick={() => void authorize()}>{busy ? 'Checking and signing…' : authorization ? 'Authorization accepted' : 'Confirm and authorize once'}</button><span>First the wallet signs a PriorSeal authorization, then it signs the exact transaction only once.</span></div>
    </section>}
    {authorization && <section className="panel jupiter-submit"><span className="jupiter-index">03 / ONE EXACT BROADCAST</span><h2>Sign and relay unchanged bytes</h2><p>PriorSeal compares the message before sending it to the deployment-owned RPC. A changed route, blockhash or message requires a new simulation and authorization.</p><div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canSubmit} onClick={() => void signAndSubmit()}>{busy ? 'Waiting for wallet or RPC…' : signature ? 'Transaction submitted' : 'Sign and submit exact transaction'}</button>{signature && <button className="button secondary" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : observation ? 'Observation completed' : 'Observe submitted transaction'}</button>}</div>{submission === 'UNKNOWN' && <Notice tone="warning" title="Relay outcome is unknown">The one-time authorization is already bound. Observe this exact signature before taking any other action; do not resubmit it.</Notice>}{signature && <div className="jupiter-signature"><Status value={observation?.observation.status ?? submission ?? 'SUBMITTED'} /><CodeValue value={signature} /></div>}</section>}
    {observation && <section className="panel jupiter-evidence"><span className="jupiter-index">04 / EVIDENCE</span><h2>{observation.receipt ? 'Evidence package is ready' : 'Observation retained'}</h2><p>The export preserves the reviewed route, simulation binding, authorization, submitted signature, observation and any signed receipt. A simulation is not a price or settlement guarantee.</p><div className="jupiter-review-actions"><Status value={observation.observation.status} />{evidence && <button className="button primary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Download evidence package</button>}</div></section>}
  </>
}
