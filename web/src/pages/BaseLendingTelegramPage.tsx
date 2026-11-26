import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  verifyInsightBaseLendingGuardDecision,
  type InsightBaseLendingGuardDecision,
} from 'priorseal-sdk'
import { AppShell, CodeValue, Field, Notice, PageHeader, Status } from '../components'
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
type TelegramWindow = Window & { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } }
type ExactTransaction = { chainId: 8453; from: string; to: string; data: `0x${string}`; nonce: string | number; value: 0 }
type Assessment = InsightBaseLendingGuardDecision

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
    throw new TypeError('Enter one valid unsigned Base call with zero native value.')
  }
  return { chainId: 8453, from: value.from, to: value.to, data: value.data as `0x${string}`, nonce: value.nonce as string | number, value: 0 }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 256 * 1024) throw new Error('Service response is too large.')
  try { return JSON.parse(text) as unknown } catch { throw new Error('Service returned invalid JSON.') }
}

function unwrapAssessment(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('Service returned an invalid assessment.')
  const envelope = value.success === true && isRecord(value.data) ? value.data : value
  if (!isRecord(envelope)) throw new Error('Service returned an invalid assessment.')
  const assessment = isRecord(envelope.assessment) ? envelope.assessment : envelope
  return isRecord(assessment.decision) ? assessment.decision : assessment
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const webApp = (window as TelegramWindow).Telegram?.WebApp
  const morphoRequired = protocolId === 'morpho-blue-base'
  const transaction = useMemo(() => {
    if (!transactionJson.trim()) return null
    try { return { value: parseTransaction(JSON.parse(transactionJson) as unknown), error: '' } }
    catch (caught) { return { value: null, error: (caught as Error).message } }
  }, [transactionJson])

  useEffect(() => { webApp?.ready?.(); webApp?.expand?.() }, [webApp])

  async function assess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setAssessment(null)
    try {
      if (!BOT_API_URL) throw new Error('The Telegram assessment service is not configured.')
      if (!webApp?.initData) throw new Error('Open this screen from the PriorSeal Telegram bot.')
      if (!transaction?.value) throw new Error(transaction?.error || 'Enter the exact unsigned call to assess.')
      if (morphoRequired && !/^0x[a-fA-F0-9]{64}$/.test(marketId)) throw new Error('Morpho Blue requires the exact 32-byte market ID.')
      const guard = {
        protocolId, action, collateralSymbol, loanSymbol,
        collateralValueUsd: Number(collateralValueUsd), debtValueUsd: Number(debtValueUsd),
        ...(morphoRequired ? { marketId } : {}),
      }
      const response = await fetch(`${BOT_API_URL}/telegram/lending/assess`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ initData: webApp.initData, input: { guard, transaction: transaction.value } }),
        signal: AbortSignal.timeout(20_000),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : `Assessment failed (${response.status}).`)
      const decision = unwrapAssessment(body) as Assessment
      const keyResponse = await fetch(INSIGHT_KEYS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!keyResponse.ok) throw new Error('Could not load Insight trusted keys.')
      const keys: unknown = await readJson(keyResponse)
      if (!isRecord(keys)) throw new Error('Insight trusted key registry is malformed.')
      const verified = await verifyInsightBaseLendingGuardDecision(decision, { keyRegistry: keys })
      const market = isRecord(decision.guard.market) ? decision.guard.market : null
      const projected = isRecord(decision.guard.projected) ? decision.guard.projected : null
      if (!verified.valid || decision.guard.protocolId !== protocolId || decision.guard.action !== action ||
          !market || !projected ||
          typeof market.collateralSymbol !== 'string' || market.collateralSymbol.toLowerCase() !== collateralSymbol.trim().toLowerCase() ||
          typeof market.loanSymbol !== 'string' || market.loanSymbol.toLowerCase() !== loanSymbol.trim().toLowerCase() ||
          projected.collateralValueUsd !== Number(collateralValueUsd) || projected.debtValueUsd !== Number(debtValueUsd) ||
          (morphoRequired && (typeof market.marketId !== 'string' || market.marketId.toLowerCase() !== marketId.toLowerCase())) ||
          decision.transaction.chainId !== 8453 ||
          decision.transaction.from.toLowerCase() !== transaction.value.from.toLowerCase() ||
          decision.transaction.to.toLowerCase() !== transaction.value.to.toLowerCase() ||
          decision.transaction.data.toLowerCase() !== transaction.value.data.toLowerCase() ||
          String(decision.transaction.nonce) !== String(transaction.value.nonce) || String(decision.transaction.value) !== '0') {
        throw new Error(`Insight decision is untrusted or does not match this exact call: ${verified.reason}`)
      }
      setAssessment(decision)
    } catch (caught) { setError((caught as Error).message.slice(0, 240)) }
    finally { setBusy(false) }
  }

  const projected = assessment && isRecord(assessment.guard.projected) ? assessment.guard.projected : null
  const verdict = assessment?.guard.verdict ?? 'UNKNOWN'

  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / BASE LENDING" title="Assess a lending action">Insight evaluates lending risk. PriorSeal verifies the signed decision. This Telegram flow never authorizes or submits a transaction.</PageHeader>
    {!BOT_API_URL && <Notice tone="warning" title="Assessment service is not configured">Set the public VITE_LENDING_BOT_API_URL to the bot Worker before using this Mini App.</Notice>}
    {!webApp?.initData && <Notice tone="info" title="Open from Telegram">The assessment service requires Telegram's signed Mini App session.</Notice>}
    <form className="panel lending-form" onSubmit={(event) => void assess(event)}>
      <div className="lending-form-heading"><span className="exact-index">01 / ASSESS</span><h2>Provide one unsigned Base call</h2><p>Insight checks the stated post-action risk and exact call. It does not simulate the protocol position or perform the action.</p></div>
      <div className="lending-form-grid">
        <Field label="Protocol"><select value={protocolId} disabled={busy} onChange={(event) => setProtocolId(event.target.value as ProtocolId)}>{PROTOCOLS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="Action"><select value={action} disabled={busy} onChange={(event) => setAction(event.target.value as LendingAction)}><option value="borrow">Borrow</option><option value="supply">Supply</option></select></Field>
        <Field label="Collateral symbol"><input required maxLength={16} value={collateralSymbol} onChange={(event) => setCollateralSymbol(event.target.value)} /></Field>
        <Field label="Loan symbol"><input required maxLength={16} value={loanSymbol} onChange={(event) => setLoanSymbol(event.target.value)} /></Field>
        <Field label="Post-action collateral value (USD)"><input required type="number" min="0.01" step="0.01" value={collateralValueUsd} onChange={(event) => setCollateralValueUsd(event.target.value)} /></Field>
        <Field label="Post-action debt value (USD)"><input required type="number" min="0" step="0.01" value={debtValueUsd} onChange={(event) => setDebtValueUsd(event.target.value)} /></Field>
        {morphoRequired && <Field label="Morpho market ID"><input required value={marketId} onChange={(event) => setMarketId(event.target.value)} placeholder="0x + 64 hex characters" /></Field>}
      </div>
      <Field label="Unsigned transaction JSON" hint="Used only to bind the assessment to the exact call. This page has no wallet authorization or submission control."><textarea required rows={8} spellCheck={false} value={transactionJson} onChange={(event) => setTransactionJson(event.target.value)} placeholder={'{"chainId":8453,"from":"0x…","to":"0x…","data":"0x…","nonce":"0","value":"0"}'} /></Field>
      {transaction?.error && <p className="lending-inline-error">{transaction.error}</p>}
      {error && <Notice tone="danger" title="Assessment stopped">{error}</Notice>}
      <button className="button primary" type="submit" disabled={busy || !BOT_API_URL || !webApp?.initData}>{busy ? 'Checking…' : 'Get signed risk assessment →'}</button>
    </form>
    {assessment && <section className="panel lending-result">
      <span className="exact-index">02 / SIGNED DECISION</span><div className="lending-result-title"><h2>{assessment.guard.protocolId.replaceAll('-', ' ')}</h2><Status value={verdict} /></div>
      <dl className="data-grid"><div><dt>Action</dt><dd>{assessment.guard.action}</dd></div><div><dt>Projected LTV</dt><dd>{typeof projected?.ltv === 'number' ? `${(projected.ltv * 100).toFixed(2)}%` : 'n/a'}</dd></div><div><dt>Liquidation buffer</dt><dd>{typeof projected?.liquidationBufferPct === 'number' ? `${projected.liquidationBufferPct.toFixed(2)}%` : 'n/a'}</dd></div><div><dt>Decision hash</dt><dd><CodeValue value={assessment.decisionHash} /></dd></div></dl>
      <p className="lending-caveat">Assessment and signature verification only. No authorization was created and no wallet or transaction was used.</p>
      <details className="lending-call-review"><summary>Review signed assessment and bound call</summary><pre>{JSON.stringify(assessment, null, 2)}</pre></details>
    </section>}
  </div></AppShell>
}
