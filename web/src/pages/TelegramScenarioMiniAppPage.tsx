import { useEffect, useMemo, useState } from 'react'
import { ExchangeClient, HttpTransport } from '@nktkas/hyperliquid'
import type { AbstractViemLocalAccount } from '@nktkas/hyperliquid/signing'
import {
  buildAgentSwapGuardBoundIntents,
  buildHyperliquidPerpGuardBoundIntent,
  buildHyperliquidPerpGuardSubmission,
  verifyAgentSwapGuardReceiptBundle,
  verifyHyperliquidPerpGuardAuthorizationBinding,
  verifyInsightAgentSwapGuardDecision,
  verifyInsightAgentSwapGuardSettlement,
  verifyInsightHyperliquidPerpGuardDecision,
  verifyReceiptLocally,
  type Intent,
} from 'priorseal-sdk'
import { AppShell, CodeValue, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities } from '../lib/api'
import type { Eip1193Provider } from '../types'
import './base-lending-telegram.css'

const BOT_API_URL = (import.meta.env.VITE_LENDING_BOT_API_URL ?? '').replace(/\/$/, '')
const INSIGHT_KEYS_URL = 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json'
type TelegramWindow = Window & { ethereum?: Eip1193Provider; Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } }
type Artifact = { scenario: 'hyperliquid-perp' | 'dex-swap'; insightDecision: Record<string, unknown>; priorSealIntent?: unknown; priorSealIntents?: unknown; transactionAuthority?: string }
type TransactionIntent = Intent & { transactionValue?: string; nonce?: string }

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 256 * 1024) throw new Error('Service response is too large.')
  try { return JSON.parse(text) as unknown } catch { throw new Error('Service returned invalid JSON.') }
}
async function insightKeys(): Promise<Record<string, unknown>> {
  const response = await fetch(INSIGHT_KEYS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Could not load Insight trusted keys.')
  const keys: unknown = await readJson(response)
  if (!isRecord(keys)) throw new Error('Insight trusted key registry is malformed.')
  return keys
}
function intent(value: unknown): TransactionIntent {
  if (!isRecord(value) || value.schema !== 'priorseal.intent.v2' || typeof value.intentId !== 'string' ||
      !Number.isSafeInteger(value.validUntil) || typeof value.sender !== 'string') throw new Error('Artifact has no valid PriorSeal intent.')
  return value as unknown as TransactionIntent
}
function wallet() { return (window as TelegramWindow).ethereum }
function initData() { return (window as TelegramWindow).Telegram?.WebApp?.initData ?? '' }
async function connectedAccount(provider: Eip1193Provider): Promise<string> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as unknown
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[\da-fA-F]{40}$/.test(accounts[0])) throw new Error('Wallet did not return a valid account.')
  return accounts[0].toLowerCase()
}
function nonce(): string { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}` }

export function TelegramScenarioMiniAppPage() {
  const [source, setSource] = useState('')
  const [fileName, setFileName] = useState('')
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [step, setStep] = useState('Import the JSON artifact sent by the bot.')
  const [result, setResult] = useState<Record<string, string> | null>(null)
  const [approvalAuthorizationId, setApprovalAuthorizationId] = useState('')
  const [swapAuthorizationId, setSwapAuthorizationId] = useState('')
  const [executionStarted, setExecutionStarted] = useState(false)
  const webApp = (window as TelegramWindow).Telegram?.WebApp
  const parsed = useMemo(() => {
    if (!source.trim()) return null
    try {
      const value: unknown = JSON.parse(source)
      if (!isRecord(value) || (value.scenario !== 'hyperliquid-perp' && value.scenario !== 'dex-swap') ||
          !isRecord(value.insightDecision) || value.transactionAuthority !== 'none') throw new Error('This is not a supported Telegram scenario artifact.')
      return { value: value as unknown as Artifact, error: '' }
    } catch (caught) { return { value: null, error: (caught as Error).message } }
  }, [source])

  useEffect(() => { webApp?.ready?.(); webApp?.expand?.() }, [webApp])

  async function loadFile(file?: File) {
    if (!file) return
    setFileName(file.name)
    setSource(await file.text())
    setArtifact(null); setResult(null); setExecutionStarted(false); setError(''); setNotice('')
  }

  async function verifyArtifact() {
    setBusy(true); setError(''); setNotice(''); setArtifact(null); setResult(null); setExecutionStarted(false)
    try {
      if (!BOT_API_URL) throw new Error('Telegram Worker URL is not configured in the web build.')
      if (!initData()) throw new Error('Open this page from the Telegram bot so the Mini App can authenticate the request.')
      if (!parsed?.value) throw new Error(parsed?.error || 'Choose a valid JSON artifact first.')
      const keys = await insightKeys()
      const decision = parsed.value.insightDecision
      if (parsed.value.scenario === 'dex-swap') {
        const guard = isRecord(decision.guard) ? decision.guard : null
        const checked = await verifyInsightAgentSwapGuardDecision(decision, { keyRegistry: keys })
        if (!checked.valid || !checked.trusted || checked.expired || !checked.validUntil || checked.validUntil <= Math.floor(Date.now() / 1000)) throw new Error(`Insight swap decision rejected: ${checked.reason}`)
        if (!guard || guard.verdict !== 'ALLOW' || !isRecord(guard.binding) || !isRecord(parsed.value.priorSealIntents)) throw new Error('Only an ALLOW swap with both bound intents can continue.')
        const prior = parsed.value.priorSealIntents as Record<string, unknown>
        const approval = intent(prior.approval); const swap = intent(prior.swap)
        const binding = guard.binding as Record<string, unknown>
        const calls = guard.transactionsToSign as Record<string, unknown>
        if (!isRecord(calls) || !isRecord(calls.approval) || !isRecord(calls.swap) || !isRecord(binding.approval)) throw new Error('Signed swap decision is missing exact calls.')
        const rebuilt = await buildAgentSwapGuardBoundIntents({
          approval: { intentId: approval.intentId, asset: approval.asset, amount: approval.amount, validUntil: approval.validUntil,
            transaction: { chainId: Number(approval.chainId), from: approval.sender, to: calls.approval.to as string, data: calls.approval.data as `0x${string}`, value: String(calls.approval.value), nonce: approval.nonce ?? '' } },
          swap: { intentId: swap.intentId, asset: swap.asset, amount: swap.amount, validUntil: swap.validUntil,
            transaction: { chainId: Number(swap.chainId), from: swap.sender, to: calls.swap.to as string, data: calls.swap.data as `0x${string}`, value: String(calls.swap.value), nonce: swap.nonce ?? '' } },
        }, decision, { keyRegistry: keys })
        if (canonical(rebuilt.approval) !== canonical(approval) || canonical(rebuilt.swap) !== canonical(swap) ||
            approval.sender.toLowerCase() !== String(binding.recipient).toLowerCase() || swap.sender.toLowerCase() !== String(binding.recipient).toLowerCase()) throw new Error('Artifact intents do not exactly match the signed Insight decision.')
      } else {
        const guard = isRecord(decision.guard) ? decision.guard : null
        const checked = await verifyInsightHyperliquidPerpGuardDecision(decision, { keyRegistry: keys })
        if (!checked.valid || !checked.trusted || checked.expired || !checked.validUntil || checked.validUntil <= Math.floor(Date.now() / 1000)) throw new Error(`Insight perp decision rejected: ${checked.reason}`)
        if (!guard || guard.verdict !== 'ALLOW') throw new Error('Only an ALLOW perp decision can continue.')
        const submittedIntent = intent(parsed.value.priorSealIntent)
        const order = submittedIntent.hyperliquidOrder
        if (!order || typeof submittedIntent.nonce !== 'string') throw new Error('Perp artifact is missing its exact IOC order envelope.')
        const rebuilt = await buildHyperliquidPerpGuardBoundIntent({ intentId: submittedIntent.intentId, account: submittedIntent.sender,
          amount: submittedIntent.amount, nonce: submittedIntent.nonce, validUntil: submittedIntent.validUntil }, decision, { keyRegistry: keys })
        if (canonical(rebuilt) !== canonical(submittedIntent)) throw new Error('Perp intent does not exactly match the signed Insight decision.')
        buildHyperliquidPerpGuardSubmission(rebuilt)
      }
      setArtifact(parsed.value)
      setStep('Signature, trusted key, expiry, and exact PriorSeal binding verified.')
      setNotice('The signed decision and exact intent are verified locally. No transaction has been signed or submitted yet.')
    } catch (caught) { setError((caught as Error).message.slice(0, 260)) }
    finally { setBusy(false) }
  }

  async function authorize(intentValue: Intent, account: string) {
    const capabilities = await getCapabilities()
    if (!capabilities.workflowReady || !capabilities.authorizers.includes('eip712')) throw new Error('PriorSeal is not ready for wallet authorization.')
    const now = Math.floor(Date.now() / 1000)
    if (intentValue.validUntil <= now) throw new Error('The signed decision or intent expired. Request a fresh assessment in Telegram.')
    const accepted = await api.authorizeWithWallet({ intent: intentValue, principal: { type: 'user', id: `wallet:${account.slice(2)}` },
      delegate: { agentId: `agent:${account.slice(2)}`, executor: account }, account, issuedAt: now, notBefore: now,
      expiresAt: intentValue.validUntil, authorizationNonce: nonce(), maxUses: '1', audience: capabilities.audience }, wallet()!)
    return accepted.accepted.authorization.authorizationId
  }

  async function observeAuthorization(authorizationId: string, chainId: number, txHash: string) {
    const observed = await api.observeExecutionUntilFinal({ authorizationId, chainId, txHash, confirmations: 0 }, { timeoutMs: 90_000 })
    if (!observed.receipt) throw new Error('PriorSeal has not issued the receipt yet. Reopen this artifact and reconcile the original transaction; do not resubmit.')
    if (!observed.verification?.valid) throw new Error(`PriorSeal execution verification failed: ${observed.verification?.code ?? 'not verified'}`)
    return observed.receipt
  }

  async function executePerp() {
    if (!artifact || artifact.scenario !== 'hyperliquid-perp') return
    if (executionStarted) return
    setExecutionStarted(true)
    setBusy(true); setError(''); setNotice(''); setStep('Connect and verify the Hyperliquid main account.')
    try {
      const provider = wallet(); if (!provider) throw new Error('Connect an EVM wallet that can sign Hyperliquid actions.')
      const account = await connectedAccount(provider)
      const perpIntent = intent(artifact.priorSealIntent)
      if (perpIntent.sender.toLowerCase() !== account) throw new Error('Connected wallet does not match the assessed Hyperliquid main account.')
      const authorizationId = await authorize(perpIntent, account)
      setStep('PriorSeal authorization accepted. Review and approve the exact IOC order in your wallet next.')
      if (perpIntent.validUntil <= Math.floor(Date.now() / 1000)) throw new Error('The Insight decision expired before the wallet prompt. Request a fresh assessment; no IOC was submitted.')
      const submission = buildHyperliquidPerpGuardSubmission(perpIntent)
      const hlWallet: AbstractViemLocalAccount = {
        address: account as `0x${string}`,
        async signTypedData(data) {
          const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(data, (_key, value) => typeof value === 'bigint' ? value.toString() : value)] })
          if (typeof signature !== 'string') throw new Error('Wallet did not return the Hyperliquid signature.')
          return signature as `0x${string}`
        },
      }
      const exchange = new ExchangeClient({ transport: new HttpTransport(), wallet: hlWallet,
        nonceManager: () => submission.nonce, defaultExpiresAfter: submission.expiresAfter })
      const order = submission.action.orders[0]!
      const resultValue: unknown = await exchange.order({ orders: [{ a: order.a, b: order.b, p: order.p, s: order.s, r: false, t: { limit: { tif: 'Ioc' } }, c: order.c }], grouping: 'na' }, { expiresAfter: submission.expiresAfter })
      const keys = await insightKeys()
      const accepted = await api.authorization(authorizationId)
      const binding = await verifyHyperliquidPerpGuardAuthorizationBinding(accepted.authorization, artifact.insightDecision, { keyRegistry: keys })
      if (!binding.valid) throw new Error(`PriorSeal authorization binding failed: ${binding.reason}`)
      const receipt = await observeAuthorization(authorizationId, 0, submission.clientOrderId)
      const priorSealKeys = await api.keys()
      const receiptCheck = await verifyReceiptLocally(receipt, { trustedKeys: priorSealKeys })
      if (!receiptCheck.valid) throw new Error(`PriorSeal receipt failed local verification: ${receiptCheck.code}`)
      setResult({ authorizationId, orderId: submission.clientOrderId, receiptId: receipt.receiptId, response: JSON.stringify(resultValue) })
      setStep('Order submitted once; PriorSeal receipt and decision binding verified.')
      setNotice('The IOC may have filled or canceled. Use the receipt and client order ID to inspect the recorded outcome.')
    } catch (caught) { setError((caught as Error).message.slice(0, 260)); setStep('Execution stopped or needs reconciliation; never submit the same IOC twice.') }
    finally { setBusy(false) }
  }

  async function sendEvmTransaction(provider: Eip1193Provider, txIntent: TransactionIntent, call: { to: string; data: string; value?: string }): Promise<string> {
    if (txIntent.validUntil <= Math.floor(Date.now() / 1000)) throw new Error('The signed decision expired before this transaction. Do not submit it.')
    const chain = await provider.request({ method: 'eth_chainId' }) as string
    if (Number.parseInt(chain, 16) !== txIntent.chainId) throw new Error(`Switch wallet to chain ${txIntent.chainId} before continuing.`)
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
    if (accounts[0]?.toLowerCase() !== txIntent.sender.toLowerCase()) throw new Error('Wallet account changed; reconnect the authorized account.')
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: txIntent.sender, to: call.to, data: call.data,
      value: call.value ?? '0x0', nonce: `0x${BigInt(txIntent.nonce ?? '0').toString(16)}` }] })
    if (typeof hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('Wallet did not return a valid transaction hash; reconcile before any retry.')
    return hash
  }

  async function executeSwap() {
    if (!artifact || artifact.scenario !== 'dex-swap') return
    if (executionStarted) return
    setExecutionStarted(true)
    setBusy(true); setError(''); setNotice('')
    let approvalHash = ''; let swapHash = ''
    try {
      const decision = artifact.insightDecision
      const validUntil = Number(decision.attestation && isRecord(decision.attestation) && isRecord(decision.attestation.data) ? decision.attestation.data.validUntil : 0)
      if (Math.floor(Date.now() / 1000) >= validUntil) throw new Error('The Insight decision expired. New authorization and swap execution are disabled.')
      const provider = wallet(); if (!provider) throw new Error('Connect an EVM wallet for the reviewed swap.')
      const intents = artifact.priorSealIntents as { approval: TransactionIntent; swap: TransactionIntent }
      const calls = isRecord(decision.guard) && isRecord(decision.guard.transactionsToSign) ? decision.guard.transactionsToSign : null
      if (!calls || !isRecord(calls.approval) || !isRecord(calls.swap) || typeof calls.approval.to !== 'string' || typeof calls.approval.data !== 'string' || typeof calls.swap.to !== 'string' || typeof calls.swap.data !== 'string') throw new Error('Signed swap decision is missing exact transaction calls.')
      const account = await connectedAccount(provider)
      if (intents.approval.sender.toLowerCase() !== account || intents.swap.sender.toLowerCase() !== account) throw new Error('Connected wallet does not match the reviewed swap recipient.')
      setStep('Requesting PriorSeal authorization for the exact token approval.')
      const approveId = await authorize(intents.approval, account); setApprovalAuthorizationId(approveId)
      setStep('Review the exact token approval in your wallet.')
      approvalHash = await sendEvmTransaction(provider, intents.approval, { to: calls.approval.to, data: calls.approval.data, value: typeof calls.approval.value === 'string' ? calls.approval.value : '0x0' })
      setStep('PriorSeal is reconciling the original approval transaction.')
      const approvalReceipt = await observeAuthorization(approveId, Number(intents.approval.chainId), approvalHash)
      const keys = await insightKeys(); const priorSealKeys = await api.keys()
      const decisionValid = await verifyInsightAgentSwapGuardDecision(decision, { keyRegistry: keys })
      if (!decisionValid.valid || !decisionValid.validUntil || Math.floor(Date.now() / 1000) >= decisionValid.validUntil) throw new Error('Decision expired before swap execution; do not continue.')
      setStep('Requesting PriorSeal authorization for the exact swap call.')
      const swapId = await authorize(intents.swap, account); setSwapAuthorizationId(swapId)
      setStep('Review the exact swap call and amount in your wallet.')
      swapHash = await sendEvmTransaction(provider, intents.swap, { to: calls.swap.to, data: calls.swap.data, value: typeof calls.swap.value === 'string' ? calls.swap.value : '0x0' })
      setStep('PriorSeal is reconciling the original swap transaction.')
      const swapReceipt = await observeAuthorization(swapId, Number(intents.swap.chainId), swapHash)
      const bundle = await verifyAgentSwapGuardReceiptBundle({ approvalReceipt, swapReceipt, decision,
        priorSealTrust: { trustedKeys: priorSealKeys }, insightTrust: { keyRegistry: keys } })
      if (!bundle.valid) throw new Error(`Combined approval/swap evidence failed verification: ${bundle.reason}`)
      if (Math.floor(Date.now() / 1000) >= decisionValid.validUntil) throw new Error('The decision expired before settlement. Per your rule, settlement is not requested after expiry.')
      if (!BOT_API_URL || !initData()) throw new Error('The Telegram session or settlement endpoint is unavailable; retain transaction hashes and receipts.')
      setStep('Requesting signed Insight settlement before the decision expires.')
      const response = await fetch(`${BOT_API_URL}/telegram/swap/settle`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: initData(), decision, approvalTxHash: approvalHash, swapTxHash: swapHash }), signal: AbortSignal.timeout(22_000) })
      const payload = await readJson(response)
      if (!response.ok || !isRecord(payload) || payload.success !== true || !isRecord(payload.data) || !isRecord(payload.data.settlement))
        throw new Error(isRecord(payload) && typeof payload.message === 'string' ? payload.message : `Settlement failed (${response.status}).`)
      const settlement = payload.data.settlement
      const settlementSignature = await verifyInsightAgentSwapGuardSettlement(settlement, { keyRegistry: keys })
      const guard = isRecord(decision.guard) ? decision.guard : null
      const binding = guard && isRecord(guard.binding) ? guard.binding : null
      const scope = guard && isRecord(guard.scope) ? guard.scope : null
      const settlementData = isRecord(settlement.data) ? settlement.data : null
      if (!settlementSignature.valid || !binding || !isRecord(binding.swap) || !scope || !settlementData ||
          settlementData.decisionHash !== decision.decisionHash || settlementData.chainId !== scope.chainId ||
          typeof binding.recipient !== 'string' || typeof settlementData.recipient !== 'string' || settlementData.recipient.toLowerCase() !== binding.recipient.toLowerCase() ||
          settlementData.onChainSwapCalldataHash !== binding.swap.calldataHash || typeof settlementData.swapTxHash !== 'string' ||
          settlementData.swapTxHash.toLowerCase() !== swapHash.toLowerCase()) throw new Error('Insight settlement signature or transaction binding failed verification.')
      setResult({ approvalHash, swapHash, approvalReceiptId: approvalReceipt.receiptId, swapReceiptId: swapReceipt.receiptId,
        decisionHash: String(decision.decisionHash), settlementStatus: String(settlementData.fillStatus ?? 'verified') })
      setStep('Both PriorSeal receipts and the in-window Insight settlement verified.')
      setNotice('Swap evidence is complete. The wallet signed both calls separately; the bot never held keys or submitted on your behalf.')
    } catch (caught) {
      setError((caught as Error).message.slice(0, 260))
      if (approvalHash || swapHash) setNotice(`Do not resubmit. Preserve the original hashes: approval ${approvalHash || '(not submitted)'}, swap ${swapHash || '(not submitted)'}.`)
    } finally { setBusy(false) }
  }

  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / TELEGRAM SCENARIOS" title="Continue a reviewed order">Verify the bot's signed artifact, authorize one exact action with your wallet, and reconcile its evidence.</PageHeader>
    {!BOT_API_URL && <Notice tone="warning" title="Telegram service is not configured">The public web build needs VITE_LENDING_BOT_API_URL set to the deployed bot Worker origin.</Notice>}
    {!initData() && <Notice tone="info" title="Open from Telegram">This Mini App requires Telegram's signed session data to authorize and settle actions.</Notice>}
    <section className="panel lending-form">
      <div className="lending-form-heading"><span className="exact-index">01 / IMPORT & VERIFY</span><h2>Open a bot artifact</h2><p>The JSON file contains the signed Insight decision and PriorSeal's exact intent. A BLOCK, CAUTION, expired, or altered artifact cannot proceed.</p></div>
      <label className="field"><span className="field-label">JSON artifact file</span><input type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0])} /></label>
      {fileName && <p>{fileName}</p>}
      <label className="field"><span className="field-label">Or paste artifact JSON</span><textarea rows={9} spellCheck={false} value={source} onChange={(event) => { setSource(event.target.value); setArtifact(null); setResult(null) }} placeholder="Paste the JSON document sent by the Telegram bot" /></label>
      {parsed?.error && <p className="lending-inline-error">{parsed.error}</p>}
      {error && <Notice tone="danger" title="Action stopped">{error}</Notice>}
      {notice && <Notice tone="info" title="Status">{notice}</Notice>}
      <button className="button primary" type="button" disabled={busy || !parsed?.value || !initData()} onClick={() => void verifyArtifact()}>{busy ? 'Verifying…' : 'Verify signed decision and exact intent →'}</button>
    </section>
    {artifact && <section className="panel lending-result">
      <span className="exact-index">02 / {artifact.scenario === 'dex-swap' ? 'DEX SWAP' : 'HYPERLIQUID PERP'}</span>
      <div className="lending-result-title"><h2>{artifact.scenario === 'dex-swap' ? 'Two exact EVM calls' : 'One Hyperliquid IOC order'}</h2><Status value="ALLOW" /></div>
      <p>{step}</p><dl className="data-grid"><div><dt>Insight decision</dt><dd><CodeValue value={String(artifact.insightDecision.decisionHash)} /></dd></div><div><dt>Valid until</dt><dd>{String((artifact.insightDecision.attestation as Record<string, unknown>)?.data && ((artifact.insightDecision.attestation as Record<string, unknown>).data as Record<string, unknown>).validUntil ? new Date(Number(((artifact.insightDecision.attestation as Record<string, unknown>).data as Record<string, unknown>).validUntil) * 1000).toISOString() : 'n/a')}</dd></div></dl>
      <details className="lending-call-review"><summary>Review exact action before wallet prompts</summary><pre>{JSON.stringify(artifact.scenario === 'dex-swap' ? artifact.priorSealIntents : artifact.priorSealIntent, null, 2)}</pre></details>
      {artifact.scenario === 'dex-swap' && <p>Approval and swap are separate single-use authorizations. Insight settlement is requested only while its original decision is still valid.</p>}
      {artifact.scenario === 'hyperliquid-perp' && <p>Hyperliquid order submission asks your connected wallet to sign the exact IOC. No API wallet or bot-held key is used.</p>}
      <button className="button primary" type="button" disabled={busy || executionStarted || Boolean(result)} onClick={() => void (artifact.scenario === 'dex-swap' ? executeSwap() : executePerp())}>{busy ? step : artifact.scenario === 'dex-swap' ? 'Authorize and execute swap calls →' : 'Authorize and submit IOC order →'}</button>
    </section>}
    {result && <section className="panel lending-receipt"><strong>Evidence flow completed</strong><dl className="data-grid">{Object.entries(result).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><CodeValue value={value} /></dd></div>)}</dl></section>}
    {approvalAuthorizationId && <p>Approval authorization: <CodeValue value={approvalAuthorizationId} /></p>}{swapAuthorizationId && <p>Swap authorization: <CodeValue value={swapAuthorizationId} /></p>}
  </div></AppShell>
}
