import { useEffect, useMemo, useState } from 'react'
import {
  verifyInsightAgentSwapGuardDecision,
  verifyInsightHyperliquidPerpGuardDecision,
} from 'priorseal-sdk'
import { AppShell, CodeValue, Notice, PageHeader, Status } from '../components'
import './base-lending-telegram.css'

const INSIGHT_KEYS_URL = 'https://www.oracleinsight.xyz/.well-known/oracle-keys.json'
type Artifact = {
  scenario: 'hyperliquid-perp' | 'dex-swap'
  insightDecision: Record<string, unknown>
  transactionAuthority: 'none'
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > 256 * 1024) throw new Error('Service response is too large.')
  try { return JSON.parse(text) as unknown } catch { throw new Error('Service returned invalid JSON.') }
}

async function insightKeys(): Promise<Record<string, unknown>> {
  const response = await fetch(INSIGHT_KEYS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Could not load Insight trusted keys.')
  const value: unknown = await readJson(response)
  if (!isRecord(value)) throw new Error('Insight trusted key registry is malformed.')
  return value
}

function parseArtifact(value: unknown): Artifact {
  if (!isRecord(value) || (value.scenario !== 'hyperliquid-perp' && value.scenario !== 'dex-swap') ||
      !isRecord(value.insightDecision) || value.transactionAuthority !== 'none' ||
      Object.keys(value).some((key) => !['scenario', 'insightDecision', 'transactionAuthority'].includes(key))) {
    throw new Error('Unsupported artifact. Request a fresh read-only assessment from the bot.')
  }
  return value as unknown as Artifact
}

export function TelegramScenarioMiniAppPage() {
  const [source, setSource] = useState('')
  const [fileName, setFileName] = useState('')
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')

  const parsed = useMemo(() => {
    if (!source.trim()) return null
    try { return { value: parseArtifact(JSON.parse(source) as unknown), error: '' } }
    catch (caught) { return { value: null, error: (caught as Error).message } }
  }, [source])

  useEffect(() => {
    (window as Window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp?.ready?.()
    ;(window as Window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } }).Telegram?.WebApp?.expand?.()
  }, [])

  async function loadFile(file?: File) {
    if (!file) return
    setFileName(file.name); setSource(await file.text()); setArtifact(null); setVerified(false); setError('')
  }

  async function verifyArtifact() {
    setBusy(true); setError(''); setArtifact(null); setVerified(false); setVerificationMessage('')
    try {
      if (!parsed?.value) throw new Error(parsed?.error || 'Choose a valid JSON artifact first.')
      const keys = await insightKeys()
      const decision = parsed.value.insightDecision
      const result = parsed.value.scenario === 'dex-swap'
        ? await verifyInsightAgentSwapGuardDecision(decision, { keyRegistry: keys })
        : await verifyInsightHyperliquidPerpGuardDecision(decision, { keyRegistry: keys })
      if (!result.valid || !result.trusted || result.expired || !result.validUntil || result.validUntil <= Math.floor(Date.now() / 1000)) {
        throw new Error(`Insight decision rejected: ${result.reason}`)
      }
      const guard = isRecord(decision.guard) ? decision.guard : null
      if (!guard || !['ALLOW', 'CAUTION', 'BLOCK'].includes(String(guard.verdict))) throw new Error('Signed decision has no recognized risk verdict.')
      setArtifact(parsed.value); setVerified(true)
      setVerificationMessage('Trusted Insight signature, expiry, and decision verified. No authorization or transaction was created.')
    } catch (caught) { setError((caught as Error).message.slice(0, 260)) }
    finally { setBusy(false) }
  }

  const guard = artifact && isRecord(artifact.insightDecision.guard) ? artifact.insightDecision.guard : null
  const verdict = guard && typeof guard.verdict === 'string' ? guard.verdict : 'UNKNOWN'
  const decisionHash = artifact && typeof artifact.insightDecision.decisionHash === 'string' ? artifact.insightDecision.decisionHash : 'n/a'

  return <AppShell><div className="lending-mini-app" data-telegram-mini-app="true">
    <PageHeader eyebrow="INSIGHT × PRIORSEAL / TELEGRAM SCENARIOS" title="Review a risk assessment">Verify the signed assessment and evidence. This page has no wallet connection, authorization, or transaction submission.</PageHeader>
    <section className="panel lending-form">
      <div className="lending-form-heading"><span className="exact-index">01 / IMPORT & VERIFY</span><h2>Open a bot assessment</h2><p>The artifact contains a signed Insight decision only. Orders and transactions are not submitted from this Telegram flow.</p></div>
      <label className="field"><span className="field-label">JSON artifact file</span><input type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0])} /></label>
      {fileName && <p>{fileName}</p>}
      <label className="field"><span className="field-label">Or paste artifact JSON</span><textarea rows={9} spellCheck={false} value={source} onChange={(event) => { setSource(event.target.value); setArtifact(null); setVerified(false) }} placeholder="Paste the signed assessment JSON sent by the Telegram bot" /></label>
      {parsed?.error && <p className="lending-inline-error">{parsed.error}</p>}
      {error && <Notice tone="danger" title="Verification stopped">{error}</Notice>}
      <button className="button primary" type="button" disabled={busy || !parsed?.value} onClick={() => void verifyArtifact()}>{busy ? 'Verifying…' : 'Verify signed assessment →'}</button>
    </section>
    {artifact && guard && <section className="panel lending-result">
      <span className="exact-index">02 / {artifact.scenario === 'dex-swap' ? 'DEX SWAP ASSESSMENT' : 'HYPERLIQUID PERP ASSESSMENT'}</span>
      <div className="lending-result-title"><h2>{artifact.scenario === 'dex-swap' ? 'Reviewed swap request' : 'Hyperliquid perpetual request'}</h2><Status value={verdict} /></div>
      <p>{verificationMessage}</p>
      <dl className="data-grid"><div><dt>Insight decision</dt><dd><CodeValue value={decisionHash} /></dd></div><div><dt>Assessed action</dt><dd>{String(guard.action ?? 'n/a')}</dd></div><div><dt>Valid until</dt><dd>{artifact.insightDecision.attestation && isRecord(artifact.insightDecision.attestation) && isRecord(artifact.insightDecision.attestation.data) ? new Date(Number(artifact.insightDecision.attestation.data.validUntil) * 1000).toISOString() : 'n/a'}</dd></div></dl>
      <p className="lending-caveat">A risk verdict is not an order, authorization, or transaction. Any separate action must be handled independently by the user outside this Telegram flow.</p>
      <details className="lending-call-review"><summary>Review the signed assessment</summary><pre>{JSON.stringify(artifact.insightDecision, null, 2)}</pre></details>
    </section>}
    {verified && <section className="panel lending-receipt"><strong>Signature and decision verified</strong><p>The Telegram integration did not request a wallet signature or submit an order or transaction.</p></section>}
  </div></AppShell>
}
