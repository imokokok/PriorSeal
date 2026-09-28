import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SWAP_APPROVAL_NAMESPACE, assertV3SwapAuthorization, buildExactCallIntent, buildV3SwapIntent, createV3SwapApproval, parseAuthorizationCheckpoint, parseContextCommitments, parseExactCallTransaction, parseV3SwapApproval, type V3SwapApproval } from 'priorseal-sdk'
import { AppShell, CodeValue, Field, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities, type Capabilities } from '../lib/api'
import { downloadJson } from '../lib/download'
import { dateTime, fromUnix, toUnix } from '../lib/format'
import { session } from '../lib/storage'
import type { AuthorizationCheckpoint, AuthorizationRecord, Eip1193Provider, PreparedAuthorization, WalletAuthorizationInput } from '../types'

const example = JSON.stringify({ chainId: 8453, from: '0x1111111111111111111111111111111111111111', to: '0x2222222222222222222222222222222222222222', nonce: '0', value: '0', data: '0x' }, null, 2)

export function ExactCallPage() {
  const draftRevision = useRef(0)
  const importing = useRef(false)
  const [raw, setRaw] = useState('')
  const [intentId, setIntentId] = useState(() => `intent_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`)
  const [asset, setAsset] = useState('')
  const [amount, setAmount] = useState('0')
  const [swapMode, setSwapMode] = useState(false)
  const [routerCodeHash, setRouterCodeHash] = useState('')
  const [expiry, setExpiry] = useState(() => fromUnix(Math.floor(Date.now() / 1000) + 3600))
  const [contexts, setContexts] = useState('')
  const [confirmations, setConfirmations] = useState(12)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [capError, setCapError] = useState('')
  const [prepared, setPrepared] = useState<PreparedAuthorization | null>(null)
  const [checkpoint, setCheckpoint] = useState<AuthorizationCheckpoint | null>(null)
  const [authorizationActive, setAuthorizationActive] = useState(true)
  const signed = Boolean(checkpoint?.signature)
  const [result, setResult] = useState<AuthorizationRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  

  useEffect(() => { getCapabilities().then((value) => { setCaps(value) }).catch((caught) => setCapError(String(caught.message))) }, [])
  useEffect(() => { draftRevision.current += 1; if (importing.current) { importing.current = false; return } setPrepared(null); setCheckpoint(null); setError('') }, [raw, asset, amount, swapMode, routerCodeHash, expiry, contexts, confirmations, intentId])

  const draft = useMemo(() => {
    if (!raw.trim()) return { intent: null, approval: null, error: '' }
    try {
      const transaction = parseExactCallTransaction(JSON.parse(raw) as unknown)
      const contextCommitments = contexts.trim() ? parseContextCommitments(JSON.parse(contexts) as unknown) : undefined
      if (!swapMode && contextCommitments?.some((entry) => entry.namespace === SWAP_APPROVAL_NAMESPACE)) throw new Error('Use the reviewed swap mode for the reserved swap approval commitment.')
      const approval = swapMode ? createV3SwapApproval(transaction, routerCodeHash.trim()) : null
      const intent = approval
        ? buildV3SwapIntent({ approval, transaction, intentId, validUntil: toUnix(expiry), constraints: { minConfirmations: confirmations }, contextCommitments })
        : buildExactCallIntent({ transaction, intentId, asset: asset.trim() || `eip155:${transaction.chainId}/native`, amount, validUntil: toUnix(expiry), constraints: { minConfirmations: confirmations }, contextCommitments })
      if (!Number.isSafeInteger(confirmations) || confirmations < (caps?.minConfirmations ?? 0)) throw new Error('Confirmations must satisfy the deployment minimum.')
      if (intent.validUntil <= Math.floor(Date.now() / 1000)) throw new Error('Choose a future authorization expiry.')
      return { intent, approval, error: '' }
    } catch (caught) { return { intent: null, approval: null, error: (caught as Error).message } }
  }, [raw, intentId, asset, amount, swapMode, routerCodeHash, expiry, contexts, confirmations, caps])
  const visibleSwapApproval = useMemo(() => {
    if (!swapMode || !raw.trim()) return null
    try { return createV3SwapApproval(JSON.parse(raw) as unknown, routerCodeHash.trim()) }
    catch { return null }
  }, [swapMode, raw, routerCodeHash])

  const unsupported = caps && draft.intent ? !caps.executionProfiles.includes('priorseal.execution-profile.exact-call.v1') ? 'This deployment does not support the exact-call profile.' : !caps.chains.includes(Number(draft.intent.chainId)) ? 'This chain is not supported by the selected deployment.' : caps.chainReadiness?.find((entry) => entry.chainId === Number(draft.intent!.chainId))?.rpc === 'unavailable' ? 'An RPC source is not configured for this chain.' : !caps.authorizers.includes('eip712') ? 'This deployment does not support EIP-712 wallet authorization.' : !caps.workflowReady ? 'The deployment is missing a required configured dependency. Resolve its readiness checks before requesting a signature.' : '' : ''
  function wallet() { const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum; if (!provider) throw new Error('Connect an EIP-1193 wallet to authorize this intent.'); return provider }

  async function checkSwap(approval: V3SwapApproval, intent = draft.intent) {
    if (!intent) throw new Error('Review a valid swap authorization first.')
    const provider = wallet()
    const chain = await provider.request({ method: 'eth_chainId' })
    if (typeof chain !== 'string' || Number(BigInt(chain)) !== approval.chainId) throw new Error('Wallet chain differs from the approved swap chain.')
    const bytecode = await provider.request({ method: 'eth_getCode', params: [approval.router, 'latest'] })
    return assertV3SwapAuthorization({ approval, transaction: JSON.parse(raw) as unknown, intent, routerBytecode: bytecode })
  }

  async function prepare() {
    const revision = draftRevision.current
    setBusy(true); setError('')
    try {
      if (!draft.intent || !caps || unsupported) throw new Error(unsupported || 'Load deployment capabilities and a valid transaction first.')
      if (draft.approval) await checkSwap(draft.approval)
      const accounts = await wallet().request({ method: 'eth_requestAccounts' }) as string[]
      const account = accounts[0]?.toLowerCase()
      if (!account) throw new Error('The wallet did not return an account.')
      const now = Math.floor(Date.now() / 1000)
      if (draft.intent.validUntil <= now) throw new Error('The draft expired. Update the expiry and prepare again.')
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('')}`
      const request: WalletAuthorizationInput = { intent: draft.intent, principal: { type: 'user', id: `wallet:${account.slice(2)}` }, delegate: { agentId: `agent:${draft.intent.sender.slice(2)}`, executor: draft.intent.sender }, account, issuedAt: now, notBefore: now, expiresAt: draft.intent.validUntil, authorizationNonce: nonce, maxUses: '1', audience: caps.audience }
      const value = await api.prepareAuthorization({ intent: request.intent, delegate: request.delegate, principal: { ...request.principal, account }, authorizer: { type: 'eip712', address: account }, issuedAt: now, notBefore: now, expiresAt: draft.intent.validUntil, authorizationNonce: nonce, maxUses: '1', audience: caps.audience })
      if (revision !== draftRevision.current) throw new Error('Inputs changed while preparing. Review the current draft and prepare again.')
      if (draft.approval) {
        await checkSwap(draft.approval, value.authorization.intent)
        if (JSON.stringify(value.authorization.intent.contextCommitments) !== JSON.stringify(draft.intent.contextCommitments) || JSON.stringify(value.authorization.intent.constraints) !== JSON.stringify(draft.intent.constraints)) throw new Error('Prepared authorization changed the reviewed swap constraints.')
      }
      setPrepared(value)
      setCheckpoint({ schema: 'priorseal.authorization-checkpoint.v1', stage: 'PREPARED', account, request, prepared: value, acceptIdempotencyKey: crypto.randomUUID() })
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }

  async function importCheckpoint(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 1_000_000) throw new Error('Use a checkpoint file smaller than 1 MB.')
      const imported: unknown = JSON.parse(await file.text())
      const packageValue = imported && typeof imported === 'object' && 'schema' in imported && imported.schema === 'priorseal.swap-authorization-checkpoint.v1'
        ? imported as unknown as { approval: unknown; transaction: unknown; checkpoint: unknown }
        : null
      const value = parseAuthorizationCheckpoint(packageValue?.checkpoint ?? imported)
      const { authorizationSigningData } = await import('priorseal-sdk/verifier')
      await authorizationSigningData(value.prepared.authorization)
      if (packageValue) {
        const approval = parseV3SwapApproval(packageValue.approval)
        const tx = parseExactCallTransaction(packageValue.transaction)
        const provider = wallet()
        const chain = await provider.request({ method: 'eth_chainId' })
        if (typeof chain !== 'string' || Number(BigInt(chain)) !== approval.chainId) throw new Error('Wallet chain differs from the saved swap chain.')
        const bytecode = await provider.request({ method: 'eth_getCode', params: [approval.router, 'latest'] })
        assertV3SwapAuthorization({ approval, transaction: tx, intent: value.prepared.authorization.intent, routerBytecode: bytecode, now: value.prepared.authorization.issuedAt })
        importing.current = true
        setSwapMode(true); setRaw(JSON.stringify(tx, null, 2)); setRouterCodeHash(approval.routerCodeHash)
        setIntentId(value.prepared.authorization.intent.intentId)
        setExpiry(fromUnix(value.prepared.authorization.intent.validUntil))
        setConfirmations(value.prepared.authorization.intent.constraints?.minConfirmations ?? 0)
        const external = value.prepared.authorization.intent.contextCommitments?.filter((entry) => entry.namespace !== SWAP_APPROVAL_NAMESPACE) ?? []
        setContexts(external.length ? JSON.stringify(external) : '')
      } else if (value.prepared.authorization.intent.contextCommitments?.some((entry) => entry.namespace === SWAP_APPROVAL_NAMESPACE)) {
        throw new Error('Import the swap checkpoint package so its approved fields and router code can be checked.')
      }
      setCheckpoint(value); setPrepared(value.prepared)
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }

  async function accept() {
    if (!prepared || !checkpoint) return
    setBusy(true); setError('')
    try {
      if (swapMode && !checkpoint.signature) {
        if (!draft.approval || !draft.intent) throw new Error('Review the current swap draft again.')
        await checkSwap(draft.approval, checkpoint.prepared.authorization.intent)
      }
      const provider: Eip1193Provider = checkpoint.signature ? { request: async () => { throw new Error('A signed checkpoint must never request another wallet signature.') } } : wallet()
      const completed = await api.authorizeWithWallet(checkpoint.request, provider, { checkpoint, onCheckpoint: setCheckpoint })
      const accepted = completed.accepted
      const record: AuthorizationRecord = { authorization: accepted.authorization, acceptance: accepted.acceptance, policyEvidence: accepted.policyEvidence, timestampEvidence: accepted.timestampEvidence, witnessEvidence: accepted.witnessEvidence, status: 'ACCEPTED', boundTxHash: null, uses: 0 }
      setAuthorizationActive(completed.authorizationWindow.active)
      session.saveIntent(record.authorization.intent); session.saveAuthorization(record); setResult(record)
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }

  if (result) return <AppShell><PageHeader eyebrow="EXACT CALL" title="Authorization accepted">The signed intent binds this call envelope. No transaction was submitted by this page.</PageHeader><section className="panel"><Status value={authorizationActive ? "AUTHORIZED" : "HISTORICAL ACCEPTANCE"} />{!authorizationActive && <Notice tone="warning" title="Authorization window is not active">This replay recovered an existing acceptance. It does not grant permission to execute now. Reconcile prior execution or obtain a fresh authorization for new work.</Notice>}<dl className="data-grid"><div><dt>Authorization</dt><dd><CodeValue value={result.authorization.authorizationId} /></dd></div><div><dt>Intent hash</dt><dd><CodeValue value={result.authorization.intentHash} /></dd></div><div><dt>Expires</dt><dd>{dateTime(result.authorization.expiresAt)}</dd></div><div><dt>Timestamp</dt><dd>{result.timestampEvidence ? dateTime(result.timestampEvidence.timestamp) : 'Issuer acceptance only'}</dd></div></dl><div className="header-actions"><button className="button secondary" onClick={() => downloadJson(result, `${result.authorization.authorizationId}.json`)}>Download authorization</button>{swapMode && visibleSwapApproval && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.swap-approval-package.v1', approval: visibleSwapApproval, transaction: JSON.parse(raw) as unknown, authorization: result }, `${result.authorization.authorizationId}-swap-approval.json`)}>Download swap approval package</button>}<Link className="button primary" to="/app/observe">{authorizationActive ? "Observe execution →" : "Reconcile original execution →"}</Link></div></section></AppShell>

  return <AppShell><PageHeader eyebrow="AUTHORIZATION" title="Authorize an exact call" actions={<Link className="button secondary" to="/app/intents/new">Transfer authorization</Link>}>Import an already constructed EVM call. Your wallet signs the authorization; your execution system submits the transaction separately.</PageHeader>
    {capError && <Notice tone="warning" title="Deployment capabilities unavailable">{capError} <button className="text-link" onClick={() => { setCapError(''); getCapabilities().then(setCaps).catch((caught) => setCapError(caught.message)) }}>Retry capabilities</button></Notice>}
    <section className="panel"><h2>Resume a saved authorization</h2><Field label="Authorization checkpoint file" hint="For a swap, import the swap checkpoint package with the reviewed transaction and approval. Checkpoints contain public artifacts and an operation key, never a private key."><input type="file" disabled={busy} accept="application/json,.json" onChange={(event) => void importCheckpoint(event.target.files?.[0])} /></Field></section>
    <div className="form-layout"><section className="panel intent-form"><fieldset disabled={busy} className="polish-fieldset"><Field label="Transaction JSON" hint="Required: chainId (number), from, to, nonce, data; value defaults to zero. Contract creation is not supported."><textarea rows={10} value={raw} placeholder={example} onChange={(event) => setRaw(event.target.value)} /></Field><Field label="Import transaction file"><input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 2_000_000) { setError('Use a transaction JSON file smaller than 2 MB.'); return } setRaw(await file.text()) } }} /></Field><Field label="Review as a single-pool ERC-20 swap" hint="Only original Uniswap V3 exactInputSingle with tuple deadline. Other router versions and multicalls are rejected."><input type="checkbox" checked={swapMode} onChange={(event) => setSwapMode(event.target.checked)} /></Field>{swapMode && <Field label="Trusted router runtime code hash" hint="Use a code hash from your independently reviewed router deployment configuration; the wallet RPC code is checked against it before authorization."><input value={routerCodeHash} onChange={(event) => setRouterCodeHash(event.target.value)} placeholder="0x…" /></Field>}<div className="form-grid">{!swapMode && <><Field label="Asset context" hint="Descriptive metadata; exact-call does not verify token settlement."><input value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="eip155:8453/native" /></Field><Field label="Amount context" hint="Atomic-unit integer; not a verified amount-out or spend limit."><input value={amount} onChange={(event) => setAmount(event.target.value)} /></Field></>}<Field label="Valid until"><input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></Field><Field label="Minimum confirmations"><input type="number" min={caps?.minConfirmations ?? 0} value={confirmations} onChange={(event) => setConfirmations(Number(event.target.value))} /></Field></div><Field label="Context commitments (optional)" hint="Paste existing namespace, algorithm and digest entries. Digests are bound directly; they are not hashed again."><textarea rows={4} value={contexts} onChange={(event) => setContexts(event.target.value)} placeholder={'[{"namespace":"agent-call-envelope.v1","algorithm":"sha256","digest":"0x…"}]'} /></Field>{(draft.error || error || unsupported) && <Notice tone="danger" title="Authorization needs attention">{error || unsupported || draft.error}</Notice>}<button className="button primary" disabled={busy || !draft.intent || !caps || Boolean(unsupported)} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Prepare canonical intent →'}</button></fieldset></section>
    <aside className="panel preview"><h2>{prepared ? 'Review canonical authorization' : 'Intent preview'}</h2><p>{prepared ? 'These are the exact server-canonicalized fields your wallet will sign.' : 'Built locally with the same exact-call helper used by the SDK.'}</p>{visibleSwapApproval && <><h3>Swap you are approving</h3><dl className="data-grid"><div><dt>Chain</dt><dd>{visibleSwapApproval.chainId}</dd></div><div><dt>Spend at most</dt><dd>{visibleSwapApproval.maxInputAmount} atomic units of <CodeValue value={visibleSwapApproval.inputToken} /></dd></div><div><dt>Receive at least</dt><dd>{visibleSwapApproval.minOutputAmount} atomic units of <CodeValue value={visibleSwapApproval.outputToken} /></dd></div><div><dt>Recipient</dt><dd><CodeValue value={visibleSwapApproval.recipient} /></dd></div><div><dt>Router</dt><dd><CodeValue value={visibleSwapApproval.router} /></dd></div><div><dt>Pool fee</dt><dd>{visibleSwapApproval.fee}</dd></div><div><dt>Deadline</dt><dd>{dateTime(visibleSwapApproval.deadline)}</dd></div></dl></>}{(prepared || draft.intent) ? <><pre className="review-json">{JSON.stringify(prepared?.authorization ?? draft.intent, null, 2)}</pre><Notice tone="info" title="Scope of this authorization">{swapMode ? 'The reviewed swap fields are decoded from the exact calldata and bound by a signed approval digest. The code hash is checked against wallet RPC before signing. This page does not submit the trade or prove the actual fill.' : 'Binds chain, executor, nonce, target, calldata hash, native value and listed constraints. It does not prove output amount, price, slippage or token safety.'}</Notice></> : <p className="muted">Import a transaction to inspect the complete binding fields.</p>}{prepared && <><button className="button secondary" disabled={busy || !checkpoint} onClick={() => downloadJson(swapMode && visibleSwapApproval ? { schema: 'priorseal.swap-authorization-checkpoint.v1', approval: visibleSwapApproval, transaction: JSON.parse(raw) as unknown, checkpoint } : checkpoint, "authorization-checkpoint.json")}>Export recovery checkpoint</button><button className="button primary" disabled={busy} onClick={() => void accept()}>{busy ? 'Waiting for wallet or acceptance…' : signed ? 'Retry acceptance of the same signed bytes' : 'Confirm and sign authorization'}</button>{signed && !result && <p className="panel-copy">Retrying reuses the same signed bytes and operation key. An expired signed checkpoint may only recover an existing acceptance; it cannot authorize new execution. Export this checkpoint before refreshing to preserve recovery.</p>}</>}</aside></div>
  </AppShell>
}
