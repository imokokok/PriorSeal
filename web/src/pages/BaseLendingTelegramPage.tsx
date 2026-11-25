import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  baseLendingGuardIntentAsset,
  buildBaseLendingGuardBoundIntent,
  verifyBaseLendingGuardReceiptBundle,
  verifyInsightBaseLendingGuardDecision,
  type InsightBaseLendingGuardDecision,
  type Intent,
  type WalletAuthorizationInput,
} from 'priorseal-sdk'
import { AppShell, CodeValue, Field, Notice, PageHeader, Status } from '../components'
import { api, getCapabilities } from '../lib/api'
import type { Eip1193Provider } from '../types'
import './base-lending-telegram.css'

const INSIGHT_KEYS_URL = 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json'
const BOT_API_URL = (import.meta.env.VITE_LENDING_BOT_API_URL ?? '').replace(/\/$/, '')
const PROTOCOLS = [
  ['aave-v3-base', 'Aave V3 · Base'],
  ['morpho-blue-base', 'Morpho Blue · Base'],
  ['compound-v3-base', 'Compound V3 · Base'],
  ['moonwell-base', 'Moonwell · Base'],
] as const

type ProtocolId = (typeof PROTOCOLS)[number][0]
type LendingAction = 'supply' | 'borrow'
type TelegramWindow = Window & {
  ethereum?: Eip1193Provider
  Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } }
}
type ExactTransaction = {
  chainId: 8453
  from: string
  to: string
  data: `0x${string}`
  nonce: string | number
  value: string | number
}
type Assessment = {
  decision: InsightBaseLendingGuardDecision
  intent: Intent | null
}
type ReceiptOutcome = { txHash: string; receiptId: string; decisionHash: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseTransaction(value: unknown): ExactTransaction {
  if (!isRecord(value) || value.chainId !== 8453 || typeof value.from !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.from) || typeof value.to !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.to) || typeof value.data !== 'string' ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(value.data) ||
      !((typeof value.nonce === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value.nonce)) ||
        (typeof value.nonce === 'number' && Number.isSafeInteger(value.nonce) && value.nonce >= 0)) ||
      (value.value !== undefined && String(value.value) !== '0')) {
    throw new TypeError('Enter one valid Base transaction with a zero native value.')
  }
  return { chainId: 8453, from: value.from, to: value.to, data: value.data as `0x${string}`, nonce: value.nonce as string | number, value: 0 }
}

async function jsonResponse(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > 256 * 1024) throw new Error('The lending service returned an oversized response.')
  const text = await response.text()
  if (text.length > 256 * 1024) throw new Error('The lending service returned an oversized response.')
  try { return JSON.parse(text) as unknown } catch { throw new Error('The lending service returned invalid JSON.') }
}

function assessmentData(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('The lending service returned an invalid response.')
  const envelope = value.success === true && isRecord(value.data) ? value.data : value
  if (!isRecord(envelope)) throw new Error('The lending service returned an invalid response.')
  return isRecord(envelope.assessment) ? envelope.assessment : envelope
}

async function insightKeys(): Promise<NonNullable<Parameters<typeof verifyInsightBaseLendingGuardDecision>[1]['keyRegistry']>> {
  const response = await fetch(INSIGHT_KEYS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Could not load Insight trusted keys.')
  const value = await jsonResponse(response)
  if (!isRecord(value)) throw new Error('Insight trusted key registry is malformed.')
  return value as NonNullable<Parameters<typeof verifyInsightBaseLendingGuardDecision>[1]['keyRegistry']>
}

function telegramWebApp() {
  return (window as TelegramWindow).Telegram?.WebApp
}

export function BaseLendingTelegramPage() {
  const [protocolId, setProtocolId] = useState<ProtocolId>('aave-v3-base')
  const [action, setAction] = useState<LendingAction>('borrow')
  const [collateralSymbol, setCollateralSymbol] = useState('WETH')
  const [loanSymbol, setLoanSymbol] = useState('USDC')
  const [collateralValueUsd, setCollateralValueUsd] = useState('10000')
  const [debtValueUsd, setDebtValueUsd] = useState('4000')
  const [marketId, setMarketId] = useState('')
  const [transactionJson, setTransactionJson] = useState('')
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [authorizationId, setAuthorizationId] = useState('')
  const [txHash, setTxHash] = useState('')
  const [receipt, setReceipt] = useState<ReceiptOutcome | null>(null)
  const [needsReconcile, setNeedsReconcile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const webApp = telegramWebApp()
  const morphoRequired = protocolId === 'morpho-blue-base'
  const verdict = assessment?.decision.guard.verdict
  const transaction = useMemo(() => {
    if (!transactionJson.trim()) return null
    try { return { value: parseTransaction(JSON.parse(transactionJson) as unknown), error: '' } }
    catch (caught) { return { value: null, error: (caught as Error).message } }
  }, [transactionJson])

  useEffect(() => {
    webApp?.ready?.()
    webApp?.expand?.()
  }, [webApp])

  async function assess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    setAssessment(null)
    setAuthorizationId('')
    setTxHash('')
    setNeedsReconcile(false)
    setReceipt(null)
    try {
      if (!BOT_API_URL) throw new Error('The Telegram lending service URL is not configured yet.')
      if (!webApp?.initData) throw new Error('Open this screen from the PriorSeal Telegram bot so Telegram can authenticate the request.')
      if (!transaction?.value) throw new Error(transaction?.error || 'Enter the exact unsigned transaction first.')
      if (morphoRequired && !/^0x[a-fA-F0-9]{64}$/.test(marketId)) throw new Error('Morpho Blue requires the exact 32-byte market ID.')
      const now = Math.floor(Date.now() / 1000)
      const requestInput = {
        guard: {
          protocolId,
          action,
          collateralSymbol,
          loanSymbol,
          collateralValueUsd: Number(collateralValueUsd),
          debtValueUsd: Number(debtValueUsd),
          ...(morphoRequired ? { marketId } : {}),
        },
        transaction: transaction.value,
        intentId: `lending_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
        validUntil: now + 240,
      }
      const response = await fetch(`${BOT_API_URL}/telegram/lending/assess`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ initData: webApp.initData, input: requestInput }),
        signal: AbortSignal.timeout(20_000),
      })
      const body = await jsonResponse(response)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : `Assessment failed (${response.status}).`)
      const rawAssessment = assessmentData(body)
      if (!isRecord(rawAssessment) || !isRecord(rawAssessment.decision)) throw new Error('No signed lending decision was returned.')
      const decision = rawAssessment.decision as unknown as InsightBaseLendingGuardDecision
      const keys = await insightKeys()
      const verified = await verifyInsightBaseLendingGuardDecision(decision, { keyRegistry: keys })
      if (!verified.valid) throw new Error(`Insight decision is not trusted: ${verified.reason}`)
      if (decision.guard.protocolId !== protocolId || decision.guard.action !== action ||
          decision.guard.market.collateralSymbol.toLowerCase() !== collateralSymbol.trim().toLowerCase() ||
          decision.guard.market.loanSymbol.toLowerCase() !== loanSymbol.trim().toLowerCase() ||
          decision.transaction.from.toLowerCase() !== transaction.value.from.toLowerCase() ||
          decision.transaction.to.toLowerCase() !== transaction.value.to.toLowerCase() ||
          decision.transaction.data.toLowerCase() !== transaction.value.data.toLowerCase() ||
          String(decision.transaction.nonce) !== String(transaction.value.nonce) ||
          String(decision.transaction.value) !== '0') {
        throw new Error('The signed decision does not match the inputs and exact call you submitted.')
      }
      if (decision.guard.verdict === 'ALLOW') {
        const intent = await buildBaseLendingGuardBoundIntent({
          transaction: decision.transaction,
          intentId: requestInput.intentId,
          asset: baseLendingGuardIntentAsset(decision.guard.protocolId),
          amount: decision.action.amount,
          validUntil: requestInput.validUntil,
        }, decision, { keyRegistry: keys })
        setAssessment({ decision, intent })
      } else {
        setAssessment({ decision, intent: null })
      }
    } catch (caught) {
      setError((caught as Error).message.slice(0, 220))
    } finally {
      setBusy(false)
    }
  }

  async function authorize() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!assessment?.intent || !assessment.decision.attestation) throw new Error('Only a verified ALLOW decision can be authorized.')
      const provider = (window as TelegramWindow).ethereum
      if (!provider) throw new Error('Connect an EVM wallet to authorize this exact call.')
      const [chainId, accounts, capabilities] = await Promise.all([
        provider.request({ method: 'eth_chainId' }) as Promise<string>,
        provider.request({ method: 'eth_requestAccounts' }) as Promise<string[]>,
        getCapabilities(),
      ])
      if (Number(chainId) !== 8453) throw new Error('Switch your wallet to Base before authorizing.')
      const account = accounts[0]?.toLowerCase()
      if (!account || account !== assessment.decision.transaction.from.toLowerCase()) throw new Error('The connected wallet must match the transaction sender.')
      if (!capabilities.workflowReady || !capabilities.chains.includes(8453) || !capabilities.authorizers.includes('eip712')) {
        throw new Error('The PriorSeal deployment is not ready for Base EIP-712 authorization.')
      }
      const issuedAt = Math.floor(Date.now() / 1000)
      if (assessment.intent.validUntil <= issuedAt) throw new Error('The Insight decision expired. Run a fresh assessment.')
      const input: WalletAuthorizationInput = {
        intent: assessment.intent,
        principal: { type: 'user', id: `wallet:${account.slice(2)}` },
        delegate: { agentId: `agent:${account.slice(2)}`, executor: account },
        account,
        issuedAt,
        notBefore: issuedAt,
        expiresAt: assessment.intent.validUntil,
        authorizationNonce: `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')}`,
        maxUses: '1',
        audience: capabilities.audience,
      }
      const result = await api.authorizeWithWallet(input, provider)
      setAuthorizationId(result.accepted.authorization.authorizationId)
      setNotice('PriorSeal accepted the wallet authorization. The Mini App has not submitted the transaction.')
    } catch (caught) {
      setError((caught as Error).message.slice(0, 220))
    } finally {
      setBusy(false)
    }
  }

  async function submitExactCall() {
    if (!assessment || !authorizationId) return
    const provider = (window as TelegramWindow).ethereum
    if (!provider) { setError('Reconnect the wallet before submitting.') ; return }
    setBusy(true)
    setError('')
    setNotice('')
    let submissionAttempted = false
    try {
      const currentChain = await provider.request({ method: 'eth_chainId' }) as string
      const currentAccounts = await provider.request({ method: 'eth_accounts' }) as string[]
      const transaction = assessment.decision.transaction
      if (Number(currentChain) !== 8453 || currentAccounts[0]?.toLowerCase() !== transaction.from.toLowerCase()) {
        throw new Error('The wallet account or network changed. Reconnect with the authorized Base account.')
      }
      submissionAttempted = true
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
          value: '0x0',
          nonce: `0x${BigInt(transaction.nonce).toString(16)}`,
        }],
      }) as string
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('The wallet did not return a valid transaction hash.')
      setTxHash(hash)
      setNotice('Submitted once. PriorSeal is now observing this original transaction; do not resubmit it.')
      await observe(hash)
    } catch (caught) {
      const detail = (caught as Error).message.slice(0, 180)
      setError(submissionAttempted
        ? `Submission may have reached the network. Reconcile the original transaction hash; do not submit again. ${detail}`
        : detail)
      if (submissionAttempted) setNeedsReconcile(true)
    } finally {
      setBusy(false)
    }
  }

  async function observe(rawHash = txHash) {
    if (!assessment || !authorizationId || !/^0x[0-9a-fA-F]{64}$/.test(rawHash)) {
      setError('Enter the original 32-byte transaction hash to reconcile this authorization.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setTxHash(rawHash)
      const capabilities = await getCapabilities()
      const observed = await api.observeExecutionUntilFinal({
        authorizationId,
        chainId: 8453,
        txHash: rawHash,
        confirmations: capabilities.minConfirmations,
      }, { timeoutMs: 120_000 })
      if (!observed.receipt) throw new Error('PriorSeal has not issued a receipt for this observation yet.')
      const [insightTrust, priorSealTrust] = await Promise.all([insightKeys(), api.keys()])
      const verification = await verifyBaseLendingGuardReceiptBundle({
        receipt: observed.receipt,
        decision: assessment.decision,
        insightTrust: { keyRegistry: insightTrust },
        priorSealTrust: { trustedKeys: priorSealTrust },
      })
      if (!verification.valid) throw new Error(`Combined receipt verification failed: ${verification.reason}`)
      setReceipt({ txHash: rawHash, receiptId: observed.receipt.receiptId, decisionHash: assessment.decision.decisionHash })
      setNotice('PriorSeal receipt and its Insight lending decision both verified.')
    } catch (caught) {
      setError((caught as Error).message.slice(0, 220))
    } finally {
      setBusy(false)
    }
  }

  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / BASE LENDING" title="Check a lending action">Insight checks lending risk. PriorSeal binds an ALLOW to one exact call. Your wallet remains the signer.</PageHeader>
    {!BOT_API_URL && <Notice tone="warning" title="Telegram service is not configured">Set the public VITE_LENDING_BOT_API_URL to the bot Worker before enabling this Mini App.</Notice>}
    {!webApp?.initData && <Notice tone="info" title="Open from Telegram">This workflow requires a Telegram Mini App session. Its signed initData is checked by the bot Worker before the API key is used.</Notice>}
    <form className="panel lending-form" onSubmit={(event) => void assess(event)}>
      <div className="lending-form-heading"><span className="exact-index">01 / ASSESS</span><h2>Describe one unsigned Base call</h2><p>Paste the exact transaction that your wallet would submit. The risk inputs are your declared post-action USD values; Insight does not simulate the protocol position.</p></div>
      <div className="lending-form-grid">
        <Field label="Protocol"><select value={protocolId} disabled={busy} onChange={(event) => setProtocolId(event.target.value as ProtocolId)}>{PROTOCOLS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="Action"><select value={action} disabled={busy} onChange={(event) => setAction(event.target.value as LendingAction)}><option value="borrow">Borrow</option><option value="supply">Supply</option></select></Field>
        <Field label="Collateral symbol"><input required maxLength={16} value={collateralSymbol} onChange={(event) => setCollateralSymbol(event.target.value)} /></Field>
        <Field label="Loan symbol"><input required maxLength={16} value={loanSymbol} onChange={(event) => setLoanSymbol(event.target.value)} /></Field>
        <Field label="Post-action collateral value (USD)"><input required type="number" min="0.01" step="0.01" value={collateralValueUsd} onChange={(event) => setCollateralValueUsd(event.target.value)} /></Field>
        <Field label="Post-action debt value (USD)"><input required type="number" min="0" step="0.01" value={debtValueUsd} onChange={(event) => setDebtValueUsd(event.target.value)} /></Field>
        {morphoRequired && <Field label="Morpho market ID"><input required value={marketId} onChange={(event) => setMarketId(event.target.value)} placeholder="0x + 64 hex characters" /></Field>}
      </div>
      <Field label="Exact unsigned transaction JSON" hint="Must include chainId 8453, from, to, data and nonce. Native value must be zero. Batches and approval bundles are rejected."><textarea required rows={8} spellCheck={false} value={transactionJson} onChange={(event) => setTransactionJson(event.target.value)} placeholder={'{"chainId":8453,"from":"0x…","to":"0x…","data":"0x…","nonce":"0","value":"0"}'} /></Field>
      {transaction?.error && <p className="lending-inline-error">{transaction.error}</p>}
      {error && <Notice tone="danger" title="Action stopped">{error}</Notice>}
      <button className="button primary" type="submit" disabled={busy || !BOT_API_URL || !webApp?.initData}>{busy ? 'Checking…' : 'Get trusted assessment →'}</button>
    </form>

    {assessment && <section className="panel lending-result">
      <span className="exact-index">02 / DECISION</span><div className="lending-result-title"><h2>{assessment.decision.guard.protocolId.replaceAll('-', ' ')}</h2><Status value={verdict ?? 'UNKNOWN'} /></div>
      <dl className="data-grid"><div><dt>Action</dt><dd>{assessment.decision.guard.action}</dd></div><div><dt>Projected LTV</dt><dd>{(assessment.decision.guard.projected.ltv * 100).toFixed(2)}%</dd></div><div><dt>Liquidation buffer</dt><dd>{assessment.decision.guard.projected.liquidationBufferPct.toFixed(2)}%</dd></div><div><dt>Decision hash</dt><dd><CodeValue value={assessment.decision.decisionHash} /></dd></div></dl>
      <p className="lending-caveat">This is a risk assessment, not a liquidation guarantee, and does not authorize the call by itself.</p>
      {verdict === 'ALLOW' && assessment.intent && <><details className="lending-call-review"><summary>Review the exact call and signed commitment</summary><pre>{JSON.stringify(assessment.intent, null, 2)}</pre><pre>{JSON.stringify(assessment.decision.transaction, null, 2)}</pre></details><button className="button primary" type="button" disabled={busy || Boolean(authorizationId)} onClick={() => void authorize()}>{busy ? 'Waiting for wallet…' : authorizationId ? 'Authorization accepted' : 'Review and authorize in wallet →'}</button></>}
      {verdict !== 'ALLOW' && <p className="lending-blocked">No PriorSeal intent was created for this verdict, so this flow cannot authorize the call.</p>}
    </section>}

    {authorizationId && <section className="panel lending-execution">
      <span className="exact-index">03 / EXECUTE & VERIFY</span><h2>Authorization accepted</h2><p><CodeValue value={authorizationId} /></p><p>Read the exact call again in your wallet. The app submits it once and then reconciles that original hash with PriorSeal.</p>
      {!txHash && !needsReconcile ? <button className="button primary" type="button" disabled={busy} onClick={() => void submitExactCall()}>{busy ? 'Waiting for wallet…' : 'Submit exact call in wallet →'}</button> : <><Field label="Original transaction hash"><input value={txHash} onChange={(event) => setTxHash(event.target.value)} /></Field><button className="button secondary" type="button" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : 'Reconcile original transaction'}</button></>}
      {error && <Notice tone="warning" title="Execution needs reconciliation">{error}</Notice>}
      {receipt && <div className="lending-receipt"><strong>Combined evidence verified</strong><dl className="data-grid"><div><dt>Transaction</dt><dd><CodeValue value={receipt.txHash} /></dd></div><div><dt>Receipt</dt><dd><CodeValue value={receipt.receiptId} /></dd></div><div><dt>Insight decision</dt><dd><CodeValue value={receipt.decisionHash} /></dd></div></dl></div>}
    </section>}
  </div></AppShell>
}
