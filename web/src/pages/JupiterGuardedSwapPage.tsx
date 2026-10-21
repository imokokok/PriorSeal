import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AGENT_PROPOSAL_NAMESPACE,
  assertPreparedGuardedJupiterSwap,
  authorizeGuardedJupiterSwap,
  createAgentProposal,
  observeGuardedJupiterSwap,
  parseAgentProposal,
  reviewGuardedJupiterSwap,
  verifyAgentProposalCommitment,
  type AgentProposal,
  type GuardedJupiterSwapReview,
  type PreparedGuardedJupiterSwap,
} from 'priorseal-sdk'
import { CodeValue, Field, LoadingState, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, prepareGuardedJupiterSwap, submitGuardedJupiterSwap } from '../lib/api'
import { downloadJson } from '../lib/download'
import { base64, decodeTransaction, installedSolanaWallet, messageBytes, sameBytes, serializeTransaction, type BrowserSolanaWallet, walletAddress } from '../lib/solana-wallet'
import type { ObservationResult } from '../types'
import '../console-jupiter-guarded-swap.css'

type AuthorizationResult = Awaited<ReturnType<typeof authorizeGuardedJupiterSwap>>
type Phase = 'IMPORT' | 'REVIEWED' | 'AUTHORIZED' | 'SUBMITTED' | 'OBSERVED'

const defaultInputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const defaultOutputMint = 'So11111111111111111111111111111111111111112'
const defaultAgentId = 'agent:console.jupiter-guarded-swap'
const agentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const shortMint = (value: string) => value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
const timestamp = (seconds: number) => new Date(seconds * 1000).toLocaleString()
const knownMints: Record<string, { symbol: string; decimals: number }> = {
  [defaultInputMint]: { symbol: 'USDC', decimals: 6 },
  [defaultOutputMint]: { symbol: 'wSOL', decimals: 9 },
}

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

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The guarded-swap action could not be completed.'
  return message.replace(/https?:\/\/\S+/g, '[endpoint hidden]').slice(0, 420)
}

function unavailableMessage(reason: string | undefined) {
  if (reason === 'SOLANA_PROFILE_UNAVAILABLE') return 'This deployment does not publish the Solana transaction authorization profile required by the guarded swap.'
  if (reason === 'SOLANA_RPC_UNAVAILABLE') return 'This deployment does not have a configured Solana RPC source for guarded swap observation.'
  if (reason === 'ISSUER_UNAVAILABLE' || reason === 'PRE_EXECUTION_PROOF_UNAVAILABLE' || reason === 'STORAGE_UNAVAILABLE') return 'A required evidence service is unavailable for this deployment. Do not prepare, sign or submit a route here.'
  return 'This deployment has not enabled the protected Jupiter, Insight, Solana authorization and observation workflow.'
}

function preparedFromUpload(value: unknown): { prepared: PreparedGuardedJupiterSwap; proposal: AgentProposal | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The selected file must contain a guarded-swap preparation package.')
  const record = value as Record<string, unknown>
  const packageEnvelope = record.schema === 'priorseal.jupiter-guarded-swap-package.v1' || record.schema === 'priorseal.jupiter-guarded-swap-package.v2'
  const prepared = packageEnvelope ? record.prepared : value
  if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) throw new Error('The preparation package has no guarded-swap object.')
  return { prepared: prepared as PreparedGuardedJupiterSwap, proposal: packageEnvelope && record.agentProposal !== undefined ? parseAgentProposal(record.agentProposal) : null }
}

function phaseIndex(phase: Phase) { return ['IMPORT', 'REVIEWED', 'AUTHORIZED', 'SUBMITTED', 'OBSERVED'].indexOf(phase) }

export function JupiterGuardedSwapPage() {
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof getCapabilities>> | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState('')
  const [prepared, setPrepared] = useState<PreparedGuardedJupiterSwap | null>(null)
  const [review, setReview] = useState<GuardedJupiterSwapReview | null>(null)
  const [wallet, setWallet] = useState<BrowserSolanaWallet | null>(null)
  const [account, setAccount] = useState('')
  const [agentId, setAgentId] = useState(defaultAgentId)
  const [proposal, setProposal] = useState<AgentProposal | null>(null)
  const [proposalRationale, setProposalRationale] = useState('No additional rationale was supplied by the proposing application.')
  const [swapInput, setSwapInput] = useState({ inputMint: defaultInputMint, outputMint: defaultOutputMint, amount: '', minimumOutputAmountAtomic: '', slippageBps: '50' })
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationResult | null>(null)
  const [signature, setSignature] = useState('')
  const [submission, setSubmission] = useState<'SUBMITTED' | 'UNKNOWN' | null>(null)
  const [observation, setObservation] = useState<ObservationResult | null>(null)
  const [phase, setPhase] = useState<Phase>('IMPORT')
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

  const guardedJupiter = capabilities?.integrations?.guardedJupiter
  const workflowAvailable = guardedJupiter?.enabled === true
  const warnings = review?.warnings ?? []
  const blockingWarnings = warnings.filter((warning) => warning === 'ADDRESS_LOOKUP_TABLES_NOT_PINNED' || warning === 'PRIORITY_FEE_NOT_CAPPED')
  const active = authorization?.authorizationWindow.active === true
  const agentIdValid = agentIdPattern.test(agentId)
  const routeExpired = Boolean(review && review.validUntil <= Math.floor(clock / 1000))
  const canAuthorize = Boolean(prepared && wallet && account && !authorization && reviewAcknowledged && agentIdValid && !routeExpired && blockingWarnings.length === 0)
  const canSubmit = Boolean(prepared && wallet && authorization && active && !signature && phaseIndex(phase) === phaseIndex('AUTHORIZED'))
  const evidence = useMemo(() => prepared && review ? {
    schema: 'priorseal.jupiter-guarded-swap-evidence.v2',
    exportedAt: new Date().toISOString(),
    prepared,
    review,
    agent: {
      id: agentId,
      disclosure: 'The agent ID is bound into the PriorSeal authorization. Identity verification remains the integrating application’s responsibility.',
    },
    ...(proposal ? { agentProposal: proposal } : {}),
    ...(authorization ? { authorization: authorization.accepted, authorizationPrepared: authorization.prepared } : {}),
    ...(signature ? { submission: { signature, status: submission, rpcTransport: 'priorseal-guarded-jupiter-relay.v1' } } : {}),
    ...(observation ? { observation: observation.observation, receipt: observation.receipt, observationJob: observation.observationJob } : {}),
  } : null, [agentId, authorization, observation, prepared, proposal, review, signature, submission])

  if (!capabilities && !capabilitiesError) return <><PageHeader eyebrow="SOLANA / JUPITER" title="Checking guarded swap availability">PriorSeal checks the deployment before connecting a wallet or requesting a route.</PageHeader><LoadingState label="Checking guarded swap configuration…" /></>

  if (capabilitiesError || !workflowAvailable) return <><PageHeader eyebrow="SOLANA / JUPITER" title="Guarded swap unavailable">This is an opt-in integration. It becomes an execution surface only after the deployment publishes a complete Solana authorization and observation workflow.</PageHeader><Notice tone="warning" title={capabilitiesError ? 'Deployment capabilities could not be read' : 'This deployment is not configured for guarded Jupiter swaps'}>{capabilitiesError || unavailableMessage(guardedJupiter?.reason)}</Notice><div className="header-actions"><Link className="button primary" to="/app/quickstart">Review available workflow →</Link><Link className="button secondary" to="/app/sdk">Use the SDK integration →</Link></div></>

  async function importPackage(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 1_000_000) throw new Error('Use a guarded-swap package smaller than 1 MB.')
      const candidate = preparedFromUpload(JSON.parse(await file.text()) as unknown)
      await assertPreparedGuardedJupiterSwap(candidate.prepared)
      const proposalCommitmentPresent = candidate.prepared.intent.contextCommitments?.some((commitment) => commitment.namespace === AGENT_PROPOSAL_NAMESPACE) ?? false
      if (candidate.proposal && !(await verifyAgentProposalCommitment(candidate.prepared.intent, candidate.proposal)).matched) throw new Error('The imported Agent proposal record does not match the exact prepared transaction.')
      if (proposalCommitmentPresent && !candidate.proposal) throw new Error('This package commits to an Agent proposal but does not include its record. Ask the proposing application for a complete v2 package.')
      const checkedReview = await reviewGuardedJupiterSwap(candidate.prepared)
      if (candidate.proposal) { setAgentId(candidate.proposal.agentId); setProposalRationale(candidate.proposal.rationale) }
      setProposal(candidate.proposal); setPrepared(candidate.prepared); setReview(checkedReview); setReviewAcknowledged(false); setAuthorization(null); setSignature(''); setSubmission(null); setObservation(null); setPhase('REVIEWED')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(false) }
  }

  async function prepareFromConsole() {
    if (!account) { setError('Connect the wallet that will pay and sign before requesting a guarded route.'); return }
    setBusy(true); setError('')
    try {
      const slippageBps = Number(swapInput.slippageBps)
      if (!/^(0|[1-9][0-9]*)$/.test(swapInput.amount)) throw new Error('Enter the input amount in atomic units (for example, USDC has 6 decimals).')
      if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new Error('Slippage must be a whole number of basis points.')
      const agentProposal = createAgentProposal({
        agentId: agentId.trim(), proposalId: `proposal_${crypto.randomUUID().replaceAll('-', '')}`,
        createdAt: Math.floor(Date.now() / 1000), rationale: proposalRationale,
      })
      const result = await prepareGuardedJupiterSwap({ inputMint: swapInput.inputMint.trim(), outputMint: swapInput.outputMint.trim(), amount: swapInput.amount, taker: account, slippageBps, agentProposal, ...(swapInput.minimumOutputAmountAtomic ? { minimumOutputAmountAtomic: swapInput.minimumOutputAmountAtomic } : {}) })
      await assertPreparedGuardedJupiterSwap(result.prepared)
      if (!(await verifyAgentProposalCommitment(result.prepared.intent, agentProposal)).matched) throw new Error('The protected service did not bind the Agent proposal record into this exact route.')
      setProposal(agentProposal); setPrepared(result.prepared); setReview(result.review); setReviewAcknowledged(false); setAuthorization(null); setSignature(''); setSubmission(null); setObservation(null); setPhase('REVIEWED')
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
      if (!agentIdPattern.test(agentId)) throw new Error('Agent ID must use 1–128 letters, digits, dots, underscores, hyphens, or colons, and begin with a letter or digit.')
      if (!reviewAcknowledged) throw new Error('Confirm the exact spend, minimum receive, fees, expiry, and one-time execution boundary before authorizing.')
      if (blockingWarnings.length) throw new Error('This route lacks a required customer-facing policy control. Prepare a route with pinned lookup tables and a capped priority fee.')
      if (prepared.transaction.feePayer !== account) throw new Error('The connected wallet must be the prepared transaction fee payer. Import a package prepared for this wallet.')
      const capabilities = await getCapabilities()
      if (!capabilities.integrations?.guardedJupiter.enabled || !capabilities.executionProfiles.includes('priorseal.execution-profile.solana-transaction.v2') || !capabilities.authorizers.includes('solana-ed25519') || !capabilities.workflowReady) throw new Error('This PriorSeal deployment is no longer configured for guarded Solana message authorization.')
      const accepted = await authorizeGuardedJupiterSwap({
        client: api, prepared, wallet: { publicKey: account, signMessage: wallet.signMessage.bind(wallet) },
        principal: { type: 'user', id: `wallet:${account}` },
        agentId: agentId.trim(), ...(proposal ? { proposal } : {}), audience: capabilities.audience,
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
      const submitted = await submitGuardedJupiterSwap({ authorizationId: authorization.accepted.authorization.authorizationId, prepared, signedTransactionBase64: signedBase64 })
      setSignature(submitted.signature); setSubmission(submitted.submission); setPhase('SUBMITTED')
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

  function discardUnsignedProposal() {
    if (authorization) return
    setPrepared(null); setReview(null); setProposal(null); setReviewAcknowledged(false); setSignature(''); setSubmission(null); setObservation(null); setPhase('IMPORT'); setError('')
  }

  return <>
    <PageHeader eyebrow="SOLANA / VERIFIED AGENT SWAP" title="Verify an agent swap" actions={<><Link className="button secondary" to="/support#feedback">Share feedback</Link>{evidence && <button className="button secondary" onClick={() => downloadJson(evidence, `${prepared!.request.intentId}-evidence.json`)}>Export evidence</button>}</>}>
      Let an agent prepare one Jupiter route while you keep the final say. Review the exact simulated transaction, authorize it once, submit unchanged bytes once, and retain portable evidence. This page never receives a signing key or an upstream API key.
    </PageHeader>

    <section className="jupiter-flow" aria-label="Guarded swap workflow">
      {['Prepare proposal', 'Review boundaries', 'Authorize once', 'Sign & submit', 'Verify outcome'].map((label, index) => <div className={phaseIndex(phase) >= index ? 'complete' : ''} key={label}><span>0{index + 1}</span><strong>{label}</strong></div>)}
    </section>

    {error && <Notice tone="danger" title="Guarded swap needs attention">{error}</Notice>}

    <div className="jupiter-layout">
      <section className="panel jupiter-import">
        <span className="jupiter-index">01 / AGENT PROPOSAL</span>
        <h2>Prepare one exact swap</h2>
        <p>An agent or application can propose this route. The protected service obtains Jupiter instructions, compiles one exact transaction, gets Insight simulation, and returns no upstream credentials to the browser.</p>
        <div className="jupiter-prepare-grid">
          <Field label="Agent ID" hint="Bound into the proposal record and signed authorization. It is not an identity or performance guarantee."><input value={agentId} maxLength={128} disabled={busy || Boolean(prepared)} onChange={(event) => setAgentId(event.target.value.trim())} /></Field>
          <Field label="Input mint" hint="USDC is required when the deployment charges a platform fee"><input value={swapInput.inputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setSwapInput({ ...swapInput, inputMint: event.target.value })} /></Field>
          <Field label="Output mint" hint="Solana mint address"><input value={swapInput.outputMint} disabled={busy || Boolean(prepared)} onChange={(event) => setSwapInput({ ...swapInput, outputMint: event.target.value })} /></Field>
          <Field label="Input amount" hint={`Atomic units · ${displayAtomicAmount(swapInput.inputMint.trim(), swapInput.amount || '0')}`}><input inputMode="numeric" value={swapInput.amount} disabled={busy || Boolean(prepared)} onChange={(event) => setSwapInput({ ...swapInput, amount: event.target.value })} /></Field>
          <Field label="Slippage" hint="Basis points"><input inputMode="numeric" value={swapInput.slippageBps} disabled={busy || Boolean(prepared)} onChange={(event) => setSwapInput({ ...swapInput, slippageBps: event.target.value })} /></Field>
          <Field label="Independent output floor" hint="Optional atomic minimum"><input inputMode="numeric" value={swapInput.minimumOutputAmountAtomic} disabled={busy || Boolean(prepared)} onChange={(event) => setSwapInput({ ...swapInput, minimumOutputAmountAtomic: event.target.value })} /></Field>
          <Field label="Agent rationale" hint="Required disclosure, 1–280 characters. It is committed as evidence, not an investment recommendation."><textarea rows={3} value={proposalRationale} maxLength={280} disabled={busy || Boolean(prepared)} onChange={(event) => setProposalRationale(event.target.value)} /></Field>
        </div>
        <div className="jupiter-import__actions"><button className="button primary" disabled={busy || !account || Boolean(prepared)} onClick={() => void prepareFromConsole()}>{busy ? 'Preparing exact proposal…' : 'Prepare verified proposal'}</button><button className="button secondary" disabled={busy} onClick={() => void connectWallet()}>{account ? `Wallet ${shortMint(account)}` : 'Connect Solana wallet'}</button>{prepared && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.jupiter-guarded-swap-package.v2', prepared, ...(proposal ? { agentProposal: proposal } : {}) }, `${prepared.request.intentId}-prepared.json`)}>Download prepared package</button>}{prepared && !authorization && <button className="button secondary" disabled={busy} onClick={discardUnsignedProposal}>Discard unsigned proposal</button>}</div>
        <p className="jupiter-import__or">or import a package prepared by an approved agent application</p>
        <Field label="Guarded-swap package" hint="Accepts the prepared object or a v1/v2 package wrapper. A v2 Agent proposal record must match the exact route. No keys are stored in the file."><input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void importPackage(event.target.files?.[0])} /></Field>
        <Notice tone="info" title="The agent never gets a blank check">Jupiter, Insight, and RPC credentials remain on the server. The browser receives only the exact transaction, its reviewed route, and the evidence required to verify it. Your wallet signs both the authorization and the unchanged transaction.</Notice>
      </section>

      <aside className="panel jupiter-state">
        <span className="jupiter-index">SESSION / CONTROL</span>
        <h2>Your execution boundary</h2>
        <dl>
          <div><dt>Agent</dt><dd>{agentId ? <code>{agentId}</code> : 'Required before authorization'}</dd></div>
          <div><dt>Rationale</dt><dd>{proposal ? <Status value="COMMITTED" small /> : 'Not retained in this package'}</dd></div>
          <div><dt>Wallet</dt><dd>{account ? <CodeValue value={account} /> : 'Not connected'}</dd></div>
          <div><dt>Route package</dt><dd><Status value={prepared ? 'VALIDATED' : 'REQUIRED'} small /></dd></div>
          <div><dt>Route expiry</dt><dd>{review ? <Status value={routeExpired ? 'EXPIRED' : remainingTime(review.validUntil - Math.floor(clock / 1000)).toUpperCase()} small /> : 'Not prepared'}</dd></div>
          <div><dt>Authority</dt><dd><Status value={authorization ? active ? 'AUTHORIZED' : 'EXPIRED' : 'NOT SIGNED'} small /></dd></div>
          <div><dt>Submission</dt><dd>{signature ? <><Status value={submission ?? 'SUBMITTED'} small /><CodeValue value={signature} /></> : 'Not broadcast'}</dd></div>
        </dl>
      </aside>
    </div>

    {prepared && review && <>
      <section className="panel jupiter-review">
        <div className="panel-head"><div><span className="jupiter-index">02 / YOUR REVIEW</span><h2>What this wallet will authorize</h2><p>Check the limits in plain language first. Atomic quantities and exact cryptographic identifiers govern this flow; display labels are intentionally not trusted.</p></div><Status value="REVIEW REQUIRED" /></div>
        <dl className="jupiter-summary">
          <div><dt>Agent proposal</dt><dd><strong>{agentId}</strong><span>{proposal ? `${proposal.proposalId}: ${proposal.rationale}` : 'Agent ID is recorded in the authorization; this imported package has no retained rationale record.'}</span></dd></div>
          <div><dt>Spend</dt><dd><strong>{displayAtomicAmount(review.input.mint, review.input.amountAtomic)}</strong><span>{review.input.amountAtomic} atomic units govern</span><CodeValue value={review.input.mint} /></dd></div>
          <div><dt>Receive at least</dt><dd><strong>{displayAtomicAmount(review.output.mint, review.output.minimumAmountAtomic)}</strong><span>{review.output.minimumAmountAtomic} atomic units govern</span><CodeValue value={review.output.mint} /></dd></div>
          <div><dt>Max slippage</dt><dd><strong>{review.slippageBps} bps</strong><span>Route threshold is bound</span></dd></div>
          {review.platformFee && <div><dt>Platform fee</dt><dd><strong>{displayAtomicAmount(review.platformFee.mint, review.platformFee.amountAtomic)} · {review.platformFee.feeBps} bps</strong><span>{review.platformFee.amountAtomic} atomic units; bound to merchant account</span><CodeValue value={review.platformFee.feeAccount} /></dd></div>}
          <div><dt>Valid until</dt><dd><strong>{timestamp(review.validUntil)}</strong><span>{remainingTime(review.validUntil - Math.floor(clock / 1000))}. Fresh package required after expiry.</span></dd></div>
        </dl>
        <div className="jupiter-review-grid">
          <section><h3>Exact transaction binding</h3><dl className="jupiter-details"><div><dt>Message hash</dt><dd><CodeValue value={review.messageHash} /></dd></div><div><dt>Transaction bytes</dt><dd><CodeValue value={review.transactionDigest} /></dd></div><div><dt>Fee payer</dt><dd><CodeValue value={review.feePayer} /></dd></div><div><dt>Instructions</dt><dd>{review.instructionCount}</dd></div></dl></section>
          <section><h3>Route surface</h3><div className="jupiter-tags">{review.programIds.map((program) => <span key={program} title={program}>{shortMint(program)}</span>)}</div><p>{review.addressLookupTables.length ? `${review.addressLookupTables.length} address lookup table(s) are bound.` : 'No address lookup tables.'}</p><dl className="jupiter-details"><div><dt>Compute limit</dt><dd>{review.computeBudget.computeUnitLimit ?? 'Not set'}</dd></div><div><dt>Unit price</dt><dd>{review.computeBudget.computeUnitPriceMicroLamports ?? 'Not set'}</dd></div><div><dt>Max priority fee</dt><dd>{review.computeBudget.maximumPriorityFeeLamports ?? 'Not calculated'}</dd></div></dl></section>
        </div>
        {warnings.length > 0 && <div className="jupiter-warnings">{warnings.map((warning) => <Notice key={warning} tone="warning" title={warning.replaceAll('_', ' ')}>{warning === 'ADDRESS_LOOKUP_TABLES_NOT_PINNED' ? 'This blocks customer-facing authorization. The integration must pin permitted address lookup tables before this exact route can be approved.' : warning === 'PRIORITY_FEE_NOT_CAPPED' ? 'This blocks customer-facing authorization. The route policy must set a maximum priority fee before a wallet can approve it.' : 'The output is wrapped SOL, not automatically unwrapped native SOL.'}</Notice>)}</div>}
        <div className="jupiter-acknowledgement"><label><input type="checkbox" checked={reviewAcknowledged} disabled={busy || Boolean(authorization) || routeExpired} onChange={(event) => setReviewAcknowledged(event.target.checked)} /><span>I reviewed the exact spend, minimum receive, fees, expiry, agent rationale/ID, and single-use execution boundary.</span></label><p>{routeExpired ? 'This route has expired. Discard it and prepare a new route; an expired quote must never be re-authorized.' : blockingWarnings.length ? 'Authorization is blocked until the deployment supplies the missing policy controls.' : !agentIdValid ? 'Enter a valid agent ID before authorizing.' : 'This authorization permits one exact transaction only. It does not authorize future or automatic swaps.'}</p></div>
        <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canAuthorize} onClick={() => void authorize()}>{busy ? 'Checking and signing…' : authorization ? 'Authorization accepted' : 'Confirm and authorize once'}</button><span>The wallet signs a readable PriorSeal authorization before it is asked to sign the exact transaction.</span></div>
      </section>

      {authorization && <section className="panel jupiter-submit">
        <span className="jupiter-index">03 / ONE EXACT BROADCAST</span><h2>Sign and submit unchanged bytes</h2>
        <p>Your wallet first signs the exact reviewed transaction. The browser compares its message bytes with the reviewed message and broadcasts only if they are identical. Submission has no automatic retry; a failed Solana transaction can still consume network or priority fees.</p>
        <div className="jupiter-submit-grid"><div className="jupiter-submit-check"><strong>Same-origin guarded relay</strong><span>The signed bytes go to PriorSeal’s protected relay, which checks the same reviewed message and uses a deployment-owned Solana RPC. Provider credentials never enter this page.</span></div><div className="jupiter-submit-check"><strong>Single-send control</strong><span>Changing quote, blockhash, transaction bytes or route requires a brand-new package, simulation and authorization.</span></div></div>
        <div className="jupiter-review-actions"><button className="button primary" disabled={busy || !canSubmit} onClick={() => void signAndSubmit()}>{busy ? 'Waiting for wallet or RPC…' : signature ? submission === 'UNKNOWN' ? 'Submission needs observation' : 'Transaction submitted' : 'Sign and submit exact transaction'}</button>{signature && <button className="button secondary" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : observation ? 'Observation completed' : 'Observe submitted transaction'}</button>}</div>
        {submission === 'UNKNOWN' && <Notice tone="warning" title="Relay outcome is unknown">PriorSeal bound this one-time authorization before contacting RPC, but did not receive a trustworthy submission response. Observe this exact signature before taking any further action; do not sign or submit it again.</Notice>}
        {signature && <div className="jupiter-signature"><Status value={observation?.observation.status ?? submission ?? 'SUBMITTED'} /><CodeValue value={signature} /></div>}
      </section>}

      {observation && <section className="panel jupiter-evidence">
        <span className="jupiter-index">04 / EVIDENCE</span><h2>{observation.receipt ? 'Evidence package is ready' : 'Observation retained'}</h2>
        <p>{observation.receipt ? 'The export contains the route review, exact bytes digest, authorization, submitted signature, observed execution and signed receipt.' : 'The export preserves the authorization and observation state. A non-final result is not proof of a completed swap.'}</p>
        <div className="jupiter-review-actions"><Status value={observation.observation.status} />{evidence && <button className="button primary" onClick={() => downloadJson(evidence, `${prepared.request.intentId}-evidence.json`)}>Download evidence package</button>}</div>
      </section>}
    </>}
  </>
}
