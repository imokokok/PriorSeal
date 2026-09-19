import { FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { LocalVerificationResult, ReviewResult } from 'priorseal-sdk/verifier'
import { AppShell, CodeValue, Field, Notice, PageHeader, Status } from '../components'
import { api } from '../lib/api'
import { downloadJson } from '../lib/download'
import { dateTime, verificationText } from '../lib/format'
import { session } from '../lib/storage'
import { getTrustProfiles, keyFingerprint, parseTrustProfile, saveTrustProfile, type TrustProfile } from '../lib/trust-profiles'
import type { KeyEntry, Receipt, VerificationBundle } from '../types'

export function VerifyPage() {
  const navigate = useNavigate()
  const received = (useLocation().state as { receipt?: Receipt } | null)?.receipt
  const [lookup, setLookup] = useState('')
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [raw, setRaw] = useState(received ? JSON.stringify(received, null, 2) : '')
  const [publicKey, setPublicKey] = useState('')
  const [issuer, setIssuer] = useState('')
  const [audience, setAudience] = useState('priorseal')
  const [registryKeys, setRegistryKeys] = useState<KeyEntry[]>([])
  const [keyTrusted, setKeyTrusted] = useState(false)
  const [profiles, setProfiles] = useState(getTrustProfiles)
  const [profile, setProfile] = useState<TrustProfile | null>(null)
  const [profileRaw, setProfileRaw] = useState('')
  const [fingerprints, setFingerprints] = useState<string[]>([])
  const [insightKeys, setInsightKeys] = useState('')
  const [insightProtocol, setInsightProtocol] = useState('')
  const [insightTrusted, setInsightTrusted] = useState(false)
  const [verifiedWithTrust, setVerifiedWithTrust] = useState(false)
  const [result, setResult] = useState<LocalVerificationResult | null>(null)
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const verificationRun = useRef(0)

  useEffect(() => {
    api.keys().then((registry) => {
      setRegistryKeys(registry.keys)
      const key = received && registry.keys.find((entry) => entry.keyId === received.keyId && entry.issuer === received.issuer)
      if (key) { setPublicKey(key.publicKey); setIssuer(key.issuer) }
    }).catch(() => { /* Local verification remains available without registry discovery. */ })
  }, [received])
  useEffect(() => { const cleared = () => { setProfiles([]); setProfile(null); setKeyTrusted(false); setPublicKey(''); setIssuer(''); setInsightKeys(''); setInsightProtocol(''); setInsightTrusted(false) }; window.addEventListener('priorseal:trust-clear', cleared); return () => window.removeEventListener('priorseal:trust-clear', cleared) }, [])
  useEffect(() => { verificationRun.current += 1; setResult(null); setReview(null); setVerifiedWithTrust(false) }, [raw, publicKey, issuer, audience, keyTrusted, profile, insightKeys, insightProtocol, insightTrusted])
  useEffect(() => { let active = true; const keys = profile?.keys.map((key) => key.publicKey) ?? (publicKey ? [publicKey] : []); Promise.all(keys.map(keyFingerprint)).then((values) => { if (active) setFingerprints(values) }).catch(() => { if (active) setFingerprints([]) }); return () => { active = false } }, [profile, publicKey])

  function loadProfile(value: unknown, alreadyConfirmed = false) {
    const parsed = parseTrustProfile(value)
    setInsightKeys(parsed.insightKeyRegistry ? JSON.stringify(parsed.insightKeyRegistry, null, 2) : '')
    setInsightProtocol(parsed.insightProtocolTrust ? JSON.stringify(parsed.insightProtocolTrust, null, 2) : '')
    setInsightTrusted(false)
    setProfile(parsed); setAudience(parsed.audience); setIssuer(parsed.issuer); setKeyTrusted(alreadyConfirmed); setMessage(''); setNotice(alreadyConfirmed ? 'Saved trust profile selected.' : 'Profile imported. Confirm its issuer, audience and keys using your independent source before trusting it.')
  }
  async function readFile(file: File | undefined, setter: (value: string) => void) {
    if (!file) return
    try { if (file.size > 10_000_000) throw new Error('Use a JSON file smaller than 10 MB.'); setter(await file.text()) } catch (caught) { setMessage((caught as Error).message) }
  }
  async function verifyText(text: string) {
    setBusy(true); setMessage(''); setNotice(''); setResult(null); setReview(null)
    const run = ++verificationRun.current
    try {
      const parsed = JSON.parse(text)
      const manifest = parsed.schema === 'priorseal.review-manifest.v1'
      const bundle = parsed.schema === 'priorseal.verification-bundle.v1'
      const receipt = (manifest ? parsed.bundle?.receipt : bundle ? parsed.receipt : parsed) as Receipt
      if (!receipt?.receiptId) throw new Error('Import a complete receipt, PriorSeal verification bundle or review manifest.')
      let keys: KeyEntry[]
      if (profile) keys = profile.keys
      else if (publicKey.trim()) {
        const discovered = registryKeys.find((key) => key.keyId === receipt.keyId && key.issuer === issuer && key.publicKey.trim() === publicKey.trim())
        keys = [{ issuer: issuer.trim() || receipt.issuer, keyId: receipt.keyId, algorithm: 'Ed25519', publicKey: publicKey.trim(), status: discovered?.status ?? 'active', validFrom: discovered?.validFrom ?? null, validUntil: discovered?.validUntil ?? null }]
      } else keys = registryKeys
      const trusted = Boolean(keyTrusted && (profile || publicKey.trim() && issuer.trim()))
      const verifier = await import('priorseal-sdk/verifier')
      const options = { trustedKeys: keys, expectedAudience: audience.trim() }
      if (!options.expectedAudience) throw new Error('Specify the expected authorization audience from an independent source.')
      let verified: LocalVerificationResult
      if (manifest) {
        const evaluated = await verifier.verifyReviewManifestLocally(parsed, { ...options, ...(insightTrusted && insightKeys.trim() ? { insightKeyRegistry: JSON.parse(insightKeys), ...(insightProtocol.trim() ? { insightProtocolTrust: JSON.parse(insightProtocol) } : {}) } : {}) })
        if (run !== verificationRun.current) return
        setReview(evaluated)
        verified = evaluated.priorSeal
      } else verified = bundle ? await verifier.verifyVerificationBundleLocally(parsed as VerificationBundle, options) : await verifier.verifyReceiptLocally(receipt, options)
      if (run !== verificationRun.current) return
      setVerifiedWithTrust(trusted); setResult(verified)
      if (verified.valid && verified.verificationScope === 'LOCAL_COMPLETE' && trusted) session.saveReceipt(receipt)
    } catch (caught) { if (run === verificationRun.current) setMessage((caught as Error).message) } finally { setBusy(false) }
  }
  async function pasteSubmit(event: FormEvent) { event.preventDefault(); await verifyText(raw) }
  async function lookupSubmit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try { const bundle = await api.getVerificationBundle(lookup.trim()); const text = JSON.stringify(bundle, null, 2); setOriginalFile(null); setRaw(text); setNotice('Bundle retrieved. Its embedded registry is discovery material; select independent trust and verify locally.'); setResult(null); setReview(null) } catch (caught) { setMessage((caught as Error).message) } finally { setBusy(false) }
  }
  const externalPending = Boolean(result && (result.verificationScope === 'EXTERNAL_CHECK_REQUIRED' || result.code === 'AUTHORIZATION_REQUIRES_CHAIN_VERIFICATION'))
  const complete = Boolean(result?.valid && !externalPending && verifiedWithTrust && (!review || review.valid && !review.unverified.length))
  const displayStatus = complete ? 'VALID' : !result?.valid ? 'INVALID' : externalPending ? 'EXTERNAL CHECK REQUIRED' : !verifiedWithTrust ? 'TRUST SOURCE REQUIRED' : 'PARTIAL REVIEW'

  return <AppShell><PageHeader eyebrow="VERIFICATION" title="Verify receipt">Import a receipt, native verification bundle or combined review manifest. Verification runs locally; pasted evidence and trust profiles are not sent to the API.</PageHeader>
    <div className="verify-layout"><section className="panel"><h2>Import evidence</h2><form onSubmit={pasteSubmit} aria-busy={busy}><Field label="Evidence JSON"><textarea value={raw} onChange={(event) => { setOriginalFile(null); setRaw(event.target.value) }} placeholder={'{\n  "schema": "priorseal.verification-bundle.v1",\n  "receipt": { … }\n}'} rows={12} /></Field><Field label="Evidence JSON file"><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; void readFile(file, (text) => { setRaw(text); setOriginalFile(file ?? null) }) }} /></Field><div className="header-actions"><button className="button primary" disabled={busy || !raw.trim()}>{busy ? 'Verifying locally…' : 'Verify locally →'}</button><button type="button" className="button secondary" disabled={!raw.trim()} onClick={() => { const blob = originalFile ?? new Blob([raw], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'original-evidence.json'; link.click(); URL.revokeObjectURL(url) }}>{originalFile ? 'Export original bytes' : 'Export evidence JSON'}</button></div></form><details className="polish-details"><summary>Insight trust for a combined review</summary><Field label="Independent Insight key registry"><textarea value={insightKeys} onChange={(event) => { setInsightKeys(event.target.value); setInsightTrusted(false) }} rows={5} /></Field><Field label="Independent Insight protocol trust" hint="insight.protocol-trust.v1: exact registry bytes/hash/length, immutable releases/profile and your consumer policy."><textarea value={insightProtocol} onChange={(event) => { setInsightProtocol(event.target.value); setInsightTrusted(false) }} rows={6} /></Field><Field label="Insight protocol trust file"><input type="file" accept="application/json,.json" onChange={(event) => void readFile(event.target.files?.[0], (text) => { setInsightProtocol(text); setInsightTrusted(false) })} /></Field><label className="check-row"><input type="checkbox" checked={insightTrusted} disabled={!insightKeys.trim()} onChange={(event) => setInsightTrusted(event.target.checked)} /><span>I independently confirmed these Insight keys, registry bytes and consumer policy.</span></label><p className="panel-copy">V5 requires its signed semantic profile and a policy-admitted registry lineage. Legacy v1–v4 review is relative to the exact pinned registry bytes; missing evidence stays incomplete. Importing evidence does not establish trust.</p></details></section>
    <section className="panel"><h2>Independent trust</h2><Field label="Saved trust profile"><select value={profile?.name ?? ''} onChange={(event) => { const selected = profiles.find((entry) => entry.name === event.target.value); if (selected) loadProfile(selected, true); else { setProfile(null); setKeyTrusted(false) } }}><option value="">Manual key or new profile</option>{profiles.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.audience}</option>)}</select></Field>
      <details className="polish-details"><summary>Import a trust profile</summary><Field label="Trust profile JSON" hint="Schema priorseal.trust-profile.v1; issuer, audience, keys, source and optional name/confirmedAt."><textarea value={profileRaw} onChange={(event) => setProfileRaw(event.target.value)} rows={5} /></Field><Field label="Trust profile file"><input type="file" accept="application/json,.json" onChange={(event) => void readFile(event.target.files?.[0], (text) => { setProfileRaw(text); try { loadProfile(JSON.parse(text)) } catch (caught) { setMessage((caught as Error).message) } })} /></Field><button className="button secondary" onClick={() => { try { loadProfile(JSON.parse(profileRaw)) } catch (caught) { setMessage((caught as Error).message) } }}>Import profile</button></details>
      {profile ? <><dl className="data-grid"><div><dt>Issuer</dt><dd>{profile.issuer}</dd></div><div><dt>Source</dt><dd>{profile.source}</dd></div><div><dt>Prior confirmation</dt><dd>{profile.confirmedAt ? dateTime(profile.confirmedAt) : 'Not recorded'}</dd></div></dl>{profile.keys.map((key) => <div className="trust-key" key={key.keyId}><strong>{key.keyId}</strong> <Status value={key.status} small /><p>{key.validFrom === null ? 'No start bound' : dateTime(key.validFrom)} → {key.validUntil === null ? 'No expiry bound' : dateTime(key.validUntil)}</p></div>)}<button className="text-link" onClick={() => { setProfile(null); setKeyTrusted(false) }}>Use manual key instead</button></> : <><Field label="Expected issuer"><input value={issuer} onChange={(event) => { setIssuer(event.target.value); setKeyTrusted(false) }} /></Field><Field label="Issuer public key" hint="API-discovered keys and keys inside evidence are not independent trust roots."><textarea value={publicKey} onChange={(event) => { setPublicKey(event.target.value); setKeyTrusted(false) }} placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'} rows={4} /></Field></>}
      <Field label="Expected audience"><input value={audience} readOnly={Boolean(profile)} onChange={(event) => { setAudience(event.target.value); setKeyTrusted(false) }} /></Field>{fingerprints.map((fingerprint, index) => <p className="fingerprint" key={`${index}-${fingerprint}`}>SHA-256 key fingerprint <CodeValue value={fingerprint} /></p>)}<label className="check-row"><input type="checkbox" checked={keyTrusted} disabled={!profile && (!publicKey.trim() || !issuer.trim())} onChange={(event) => setKeyTrusted(event.target.checked)} /><span>I confirmed this issuer, audience and public key configuration through an independent trusted channel.</span></label>{profile && <div className="header-actions"><button className="button secondary" disabled={!keyTrusted} onClick={() => { const confirmed = { ...profile, confirmedAt: Math.floor(Date.now() / 1000) }; saveTrustProfile(confirmed); setProfiles(getTrustProfiles()); setNotice('Trust profile saved according to your local-storage choice.'); }}>Save confirmed profile</button><button className="button secondary" onClick={() => downloadJson(profile, 'trust-profile.json')}>Export profile</button></div>}
    </section></div>
    <section className="panel lookup"><h2>Retrieve by receipt ID</h2><form onSubmit={lookupSubmit} className="archive-query" aria-busy={busy}><Field label="Receipt ID"><input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="psr_…" /></Field><button className="button secondary" disabled={busy || !lookup.trim()}>Retrieve verification bundle</button></form></section>
    {notice && <Notice tone="info" title="Evidence review">{notice}</Notice>}{message && <Notice tone="danger" title="Verification could not run">{message}</Notice>}
    {result && <section className="panel verification-result"><Status value={displayStatus} /><h2>{complete ? result.code : displayStatus.replaceAll(' ', '_')}</h2><p>{verificationText[result.code] ?? result.code}</p><dl className="data-grid"><div><dt>Verification performed by</dt><dd>This browser, using the local SDK verifier</dd></div><div><dt>Receipt</dt><dd>{result.receiptId ?? '—'}</dd></div><div><dt>Signature and evidence checks</dt><dd>{result.valid ? 'Passed within stated scope' : result.code}</dd></div><div><dt>Signer trust</dt><dd>{verifiedWithTrust ? 'Independently confirmed configuration' : 'Not independently established'}</dd></div><div><dt>Execution claim</dt><dd>{result.executionStatus ?? '—'}</dd></div><div><dt>Compliance claim</dt><dd>{result.complianceStatus ?? 'Legacy outcome'}</dd></div></dl>{!verifiedWithTrust && <Notice tone="warning" title="Independent key trust not established">Cryptographic consistency with a supplied or discovered key does not establish that its issuer is trusted.</Notice>}{externalPending && <Notice tone="warning" title="External verification is still required">{result.requiredExternalChecks.length ? result.requiredExternalChecks.map((check) => check.type === 'ERC1271' ? `Check contract authority ${check.address} on chain ${check.chainId}; a current-state check does not prove historical authority.` : `Check anchor transaction ${check.txHash} at block ${check.blockNumber} on chain ${check.chainId}.`).join(' ') : 'Verify the contract-wallet authorization against the relevant chain state.'}</Notice>}
      {review && <><h3>Combined evidence review</h3><p>{review.code} · verification origin: {review.verificationOrigin}</p><div className="table-scroll"><table className="evidence-table"><thead><tr><th>Artifact</th><th>Integrity</th><th>Signature</th><th>Trust</th><th>Result</th></tr></thead><tbody>{review.artifacts.map((artifact) => <tr key={artifact.id}><td>{artifact.role}<small>{artifact.profile}</small></td><td>{artifact.integrityValid ? 'Verified' : 'Invalid'}</td><td>{artifact.signatureValid === null ? 'Not verified' : artifact.signatureValid ? 'Verified' : 'Invalid'}</td><td>{artifact.trusted === null ? 'Not established' : artifact.trusted ? 'Configured registry' : 'Untrusted'}</td><td>{artifact.code}</td></tr>)}</tbody></table></div><div>{review.artifacts.filter((artifact) => artifact.protocol).map((artifact) => <section className="trust-key" key={`protocol-${artifact.id}`}><h4>Insight protocol: {artifact.protocol!.code}</h4><dl className="data-grid"><div><dt>Review scope</dt><dd>{artifact.protocol!.scope}</dd></div><div><dt>Signed or snapshot profile</dt><dd><CodeValue value={artifact.protocol!.profileId ?? 'Not established'} /></dd></div><div><dt>Registry release</dt><dd><CodeValue value={artifact.protocol!.registryReleaseId ?? 'Not established'} /></dd></div><div><dt>Consumer policy</dt><dd><CodeValue value={artifact.protocol!.policyId ?? 'Independently selected admission pins'} /></dd></div><div><dt>Exact registry SHA-256</dt><dd><CodeValue value={artifact.protocol!.registrySnapshotSha256 ?? 'Not established'} /></dd></div><div><dt>Registry byte length</dt><dd>{artifact.protocol!.registrySnapshotByteLength ?? 'Not established'}</dd></div></dl>{artifact.protocol!.required.length > 0 && <p>Required: {artifact.protocol!.required.join('; ')}</p>}</section>)}</div><dl className="data-grid">{Object.entries(review.relations).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value === null ? 'Not established' : value ? 'Matched' : 'Mismatch'}</dd></div>)}</dl>{review.unverified.length > 0 && <Notice tone="warning" title="Review remains partial">{review.unverified.join('; ')}</Notice>}</>}
      <div className="header-actions"><button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.local-review-report.v1', verifiedAt: Math.floor(Date.now() / 1000), expectedAudience: audience, trustedIssuer: verifiedWithTrust ? issuer : null, result, review, complete, verificationOrigin: 'local' }, 'local-review-report.json')}>Export review report</button>{externalPending && <button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.external-check-plan.v1', receiptId: result.receiptId, requiredChecks: result.requiredExternalChecks, completed: false, notice: 'No chain checks were performed by this offline review. Current-state results do not establish historical authority.' }, 'external-check-plan.json')}>Export external check plan</button>}{complete && result.receiptId && <button className="text-link" onClick={() => navigate(`/app/receipts/${encodeURIComponent(result.receiptId!)}`)}>Open receipt detail →</button>}</div>
    </section>}
  </AppShell>
}
