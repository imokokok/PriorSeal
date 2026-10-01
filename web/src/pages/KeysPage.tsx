import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, CodeValue, Empty, LoadingState, Notice, PageHeader, Status } from '../components'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
import { RotationDiagnostics } from './RotationDiagnostics'
import type { ApiError, KeyRegistry } from '../types'
import '../console-keys.css'

const errorMessage = (error: unknown) => { const e = error as ApiError; return (e.code ? e.code + ': ' : '') + (e.message ?? 'Something went wrong.') }

export function KeysPage() {
  const [registry, setRegistry] = useState<KeyRegistry | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.keys().then(setRegistry).catch((caught) => setError(errorMessage(caught))).finally(() => setLoading(false))
  }, [reload])

  const active = registry?.keys.filter((key) => key.status === 'active').length ?? 0

  return <AppShell>
    <PageHeader eyebrow="TRUST" title="Key registry">Keys are read directly from the configured PriorSeal API. No private key material is exposed here.</PageHeader>
    <div className="key-directory-intro"><span>PUBLIC KEY DIRECTORY / 09</span><p>Published issuer keys support verification. Confirm your trust profile independently before treating any receipt as trusted.</p></div>
    {loading ? <LoadingState label="Loading public key registry..." /> : error ?
      <section className="panel key-unavailable">
        <span className="key-section-index">DIRECTORY STATUS / UNAVAILABLE</span>
        <h2>Registry unavailable</h2>
        <Notice tone="danger" title="Key registry unavailable">{error}</Notice>
        <div className="key-unavailable__actions"><button className="button primary retry-button" onClick={() => setReload((value) => value + 1)}>Try again →</button><Link className="button secondary" to="/app/verify">Open local verifier ↗</Link></div>
      </section> : !registry?.keys.length ?
      <section className="panel key-unavailable"><span className="key-section-index">DIRECTORY STATUS / EMPTY</span><Empty title="No public keys published">The API returned an empty registry. Verification cannot establish an issuer key until a key is published.</Empty></section> : <>
      <section className="key-registry-summary" aria-label="Published key summary">
        <div><span>01 / ISSUER</span><strong>{registry.issuer}</strong><small>Configured registry response</small></div>
        <div><span>02 / PUBLISHED</span><strong>{registry.keys.length}</strong><small>Public key records</small></div>
        <div><span>03 / ACTIVE</span><strong>{active}</strong><small>Marked active by issuer</small></div>
      </section>
      <section className="panel key-table key-directory-table">
        <div className="panel-head"><div><span className="key-section-index">PUBLIC MATERIAL / DIRECTORY</span><h2>Published keys</h2><p>{registry.schema} · verifier {registry.verifierVersion ?? '—'}</p></div><Status value="PUBLIC KEYS" small /></div>
        <div className="table-scroll"><table><thead><tr><th>Key</th><th>Algorithm</th><th>Status</th><th>Validity</th><th>Public key</th></tr></thead><tbody>{registry.keys.map((key) => <tr key={key.keyId}><td><strong>{key.keyId}</strong><small>{key.issuer}</small></td><td>{key.algorithm}</td><td><Status value={key.status} small /></td><td>{dateTime(key.validFrom)}<br />{key.validUntil ? 'to ' + dateTime(key.validUntil) : 'No expiry published'}</td><td><CodeValue value={key.publicKey} /></td></tr>)}</tbody></table></div>
      </section>
      <RotationDiagnostics registry={registry} />
    </>}
  </AppShell>
}
