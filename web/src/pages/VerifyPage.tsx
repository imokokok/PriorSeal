import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { LocalVerificationResult } from 'priorseal-sdk/verifier'
import { AppShell, Field, Notice, PageHeader, Status } from '../components'
import { api } from '../lib/api'
import { verificationText } from '../lib/format'
import { session } from '../lib/storage'
import type { ApiError, KeyEntry, Receipt } from '../types'

const errorMessage = (error: unknown) => {
  const value = error as ApiError
  return (value.code ? `${value.code}: ` : '') + (value.message ?? 'Something went wrong.')
}

export function VerifyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const received = (location.state as { receipt?: Receipt } | null)?.receipt
  const [lookup, setLookup] = useState('')
  const [raw, setRaw] = useState(received ? JSON.stringify(received, null, 2) : '')
  const [publicKey, setPublicKey] = useState('')
  const [registryKeys, setRegistryKeys] = useState<KeyEntry[]>([])
  const [keyTrustedOutOfBand, setKeyTrustedOutOfBand] = useState(false)
  const [verifiedWithTrustedKey, setVerifiedWithTrustedKey] = useState(false)
  const [result, setResult] = useState<LocalVerificationResult | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.keys().then((registry) => {
      setRegistryKeys(registry.keys)
      const matching = received && registry.keys.find((key) => key.keyId === received.keyId && key.issuer === received.issuer)
      if (matching) {
        setPublicKey(matching.publicKey)
        setKeyTrustedOutOfBand(false)
      }
    }).catch(() => { /* Pasting a trusted public key keeps local verification available offline. */ })
  }, [received])

  async function verify(receipt: Receipt) {
    setBusy(true)
    setMessage('')
    try {
      const registered = registryKeys.find((key) => key.keyId === receipt.keyId && key.issuer === receipt.issuer)
      const key: KeyEntry | undefined = publicKey.trim() ? {
        issuer: receipt.issuer,
        keyId: receipt.keyId,
        algorithm: 'Ed25519',
        publicKey: publicKey.trim(),
        status: registered?.status ?? 'active',
        validFrom: registered?.validFrom ?? null,
        validUntil: registered?.validUntil ?? null,
      } : registered
      if (!key) {
        setVerifiedWithTrustedKey(false)
        setResult({ valid: false, code: 'UNKNOWN_KEY', outcome: receipt.outcome, executionStatus: receipt.executionStatus ?? receipt.execution.status, complianceStatus: receipt.compliance?.status, receiptId: receipt.receiptId, verificationScope: 'LOCAL_COMPLETE', requiredExternalChecks: [] })
        return
      }
      const trustedForThisRun = Boolean(publicKey.trim() && keyTrustedOutOfBand)
      const { verifyReceiptLocally } = await import('priorseal-sdk/verifier')
      const verified = await verifyReceiptLocally(receipt, { trustedKeys: key })
      setVerifiedWithTrustedKey(trustedForThisRun)
      setResult(verified)
      if (verified.valid && verified.verificationScope === 'LOCAL_COMPLETE' && trustedForThisRun) session.saveReceipt(receipt)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function pasteSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const parsed = JSON.parse(raw) as Receipt
      if (!parsed || typeof parsed !== 'object' || !parsed.receiptId) throw new Error('Paste a complete receipt JSON object that includes receiptId.')
      await verify(parsed)
    } catch (error) { setMessage(errorMessage(error)) }
  }

  async function lookupSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const receipt = await api.receipt(lookup)
      setRaw(JSON.stringify(receipt, null, 2))
      await verify(receipt)
    } catch (error) {
      setMessage(errorMessage(error))
      setBusy(false)
    }
  }

  const externalPending = Boolean(result && ((result.valid && result.verificationScope === 'EXTERNAL_CHECK_REQUIRED') || result.code === 'AUTHORIZATION_REQUIRES_CHAIN_VERIFICATION'))
  const complete = Boolean(result?.valid && result.verificationScope === 'LOCAL_COMPLETE' && verifiedWithTrustedKey)
  const displayStatus = complete ? 'VALID' : externalPending ? 'EXTERNAL CHECK REQUIRED' : result?.valid ? 'TRUST SOURCE REQUIRED' : 'INVALID'

  return <AppShell>
    <PageHeader eyebrow="VERIFICATION" title="Verify receipt">Receipt bytes and the public key are verified locally with Web Crypto. Pasted receipt data is not sent to the PriorSeal API.</PageHeader>
    <div className="verify-layout">
      <section className="panel"><h2>Paste receipt JSON</h2><p className="panel-copy">The entire signed receipt is required, including its execution object and signature.</p><form onSubmit={pasteSubmit} aria-busy={busy}><textarea value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'{\n  "receiptId": "psr_…",\n  "signature": "…"\n}'} rows={15} /><Field label="Issuer public key" hint="The API registry is only a discovery source. For independent verification, obtain or compare this Ed25519 key through a separate trusted channel."><textarea value={publicKey} onChange={(event) => { setPublicKey(event.target.value); setKeyTrustedOutOfBand(false) }} placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'} rows={5} /></Field><label className="check-row"><input type="checkbox" checked={keyTrustedOutOfBand} disabled={!publicKey.trim()} onChange={(event) => setKeyTrustedOutOfBand(event.target.checked)} /><span>I confirmed this public key through an independent trusted channel.</span></label><button className="button primary" disabled={busy}>{busy ? 'Verifying locally…' : 'Verify locally →'}</button></form></section>
      <section className="panel lookup"><h2>Retrieve by receipt ID</h2><p className="panel-copy">This fetch may discover a key from the same API. Neither source is an independent trust anchor.</p><form onSubmit={lookupSubmit} aria-busy={busy}><Field label="Receipt ID"><input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="psr_…" /></Field><button className="button secondary" disabled={busy}>Retrieve and verify locally</button></form><div className="offline-code"><strong>Command-line verification</strong><pre>{'npm run verify:receipt -- receipt.json public-key.pem'}</pre><p>With a separately trusted public key, pasted-receipt verification requires no server request.</p></div></section>
    </div>
    {message && <Notice tone="danger" title="Verification could not run">{message}</Notice>}
    {result && <section className="panel verification-result"><Status value={displayStatus} /><h2>{complete ? result.code : displayStatus.replaceAll(' ', '_')}</h2><p>{complete || !result.valid ? verificationText[result.code] ?? 'The verifier returned this result.' : 'Local cryptographic checks passed, but independent verification is not complete.'}</p>{result.valid && !verifiedWithTrustedKey && <Notice tone="warning" title="Independent key trust not established">The signature matches the supplied or API-discovered key, but that key was not confirmed separately.</Notice>}{externalPending && <Notice tone="warning" title="External verification is still required">{result.requiredExternalChecks.length ? result.requiredExternalChecks.map((check) => check.type === 'ERC1271' ? `Verify ERC-1271 authority ${check.address} on chain ${check.chainId}.` : `Verify anchor transaction ${check.txHash} for ${check.contract} on chain ${check.chainId}.`).join(' ') : 'Verify the contract-wallet authorization against the relevant chain state.'}</Notice>}<dl><dt>Receipt ID</dt><dd>{result.receiptId ?? '—'}</dd><dt>Evidence</dt><dd>{complete ? 'VALID' : externalPending ? 'PENDING EXTERNAL CHECK' : result.valid ? 'PENDING TRUSTED KEY' : 'INVALID'}</dd><dt>Execution claim</dt><dd>{result.executionStatus ?? '—'}</dd><dt>Compliance claim</dt><dd>{result.complianceStatus ?? 'Legacy outcome'}</dd></dl>{complete && result.receiptId && <button className="text-link" onClick={() => navigate(`/app/receipts/${encodeURIComponent(result.receiptId!)}`)}>Open receipt detail →</button>}</section>}
  </AppShell>
}
