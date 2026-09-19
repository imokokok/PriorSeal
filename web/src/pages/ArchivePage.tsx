import { FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, CodeValue, Empty, Field, Notice, PageHeader, Status } from '../components'
import { consoleRequest } from '../lib/api'
import { downloadJson } from '../lib/download'
import { dateTime } from '../lib/format'

type ArchiveItem = { id: string; kind: string; createdAt: number; txHash: string | null; authorizationId: string | null; status: string; artifactHash: string; supersedesId: string | null }
type ArchivePage = { schema: string; projectId: string; environment: string; role: string; items: ArchiveItem[]; nextCursor: string | null; scope: string; retention: string; snapshot?: number; completeness?: string }

export function ArchivePage() {
  const [token, setToken] = useState('')
  const [filters, setFilters] = useState({ txHash: '', authorizationId: '', status: '', from: '', to: '' })
  const [loadedFilters, setLoadedFilters] = useState(filters)
  const [queriedFilters, setQueriedFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState<ArchivePage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [upload, setUpload] = useState('')
  const [supersedesId, setSupersedesId] = useState('')
  const [previousCursors, setPreviousCursors] = useState<string[]>([])
  const [cursor, setCursor] = useState('')
  const exportController = useRef<AbortController | null>(null)
  const headers = () => ({ Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' })
  async function load(nextCursor = '', selectedFilters = filters) {
    setBusy(true); setError(''); setNotice('')
    try {
      if (!token.trim()) throw new Error('Enter a project-scoped archive token from your operator.')
      const query = new URLSearchParams({ limit: '25', ...(nextCursor ? { cursor: nextCursor } : {}) })
      const normalized: Record<string, string> = {}
      for (const [key, value] of Object.entries(selectedFilters)) {
        if (!value.trim()) continue
        const converted = key === 'from' || key === 'to' ? String(Math.floor(new Date(value).getTime() / 1000)) : value.trim()
        if (converted === 'NaN') throw new Error('Use valid date filters.')
        query.set(key, converted); normalized[key] = converted
      }
      const result = await consoleRequest<ArchivePage>(`/v1/archive?${query}`, { headers: headers() })
      setPage(result); setLoadedFilters({ ...selectedFilters }); setCursor(nextCursor); setQueriedFilters(normalized)
    } catch (caught) { setPage(null); setError((caught as Error).message) } finally { setBusy(false) }
  }
  async function search(event: FormEvent) { event.preventDefault(); setPreviousCursors([]); await load() }
  async function retrieve(item: ArchiveItem) {
    setBusy(true); setError('')
    try { const result = await consoleRequest<ArchiveItem & { artifact: unknown }>(`/v1/archive/${encodeURIComponent(item.id)}`, { headers: headers() }); downloadJson(result.artifact, `${item.id}.json`) } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  async function exportAll() {
    if (!page) return
    setBusy(true); setError(''); setNotice('Starting a fresh snapshot for all matching uploaded evidence…')
    const controller = new AbortController(); exportController.current = controller
    const entries: unknown[] = []
    let nextCursor = '', snapshot: number | undefined, complete = false, interruption = '', totalBytes = 0
    const startedAt = Math.floor(Date.now() / 1000)
    async function exportRequest<T>(path: string): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        try { return await consoleRequest<T>(path, { headers: headers(), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }) }
        catch (caught) {
          const failure = caught as Error & { status?: number; retryAfterMs?: number }
          const delay = Math.max(1000, failure.retryAfterMs ?? 60_000)
          if (failure.status !== 429 || attempt >= 3 || !Number.isFinite(delay) || delay > 60_000 || controller.signal.aborted) throw caught
          setNotice(`Archive rate limit reached. ${entries.length} artifacts collected; waiting ${Math.ceil(delay / 1000)} seconds before resuming. Cancel remains available.`)
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error('Export cancelled.')) }
            const timer = window.setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve() }, delay)
            controller.signal.addEventListener('abort', abort, { once: true })
          })
        }
      }
    }
    try {
      do {
        const query = new URLSearchParams({ ...queriedFilters, limit: '10', ...(nextCursor ? { cursor: nextCursor } : {}) })
        const batch = await exportRequest<ArchivePage & { items: (ArchiveItem & { artifact: unknown })[] }>(`/v1/archive/export?${query}`)
        if (!Number.isSafeInteger(batch.snapshot)) throw new Error('The server did not supply a stable export snapshot; export is incomplete.')
        if (snapshot !== undefined && batch.snapshot !== snapshot) throw new Error('The archive snapshot changed; export is incomplete.')
        snapshot ??= batch.snapshot
        for (const item of batch.items) {
          if (entries.length >= 2000) throw new Error('The 2,000-entry browser export limit was reached. Narrow the filters to export the remaining evidence.')
          const entry = item as ArchiveItem & { artifact: unknown }
          if (!entry.artifact) throw new Error('The archive export page omitted an artifact; export is incomplete.')
          const bytes = new TextEncoder().encode(JSON.stringify(entry)).length
          if (totalBytes + bytes > 20 * 1024 * 1024) throw new Error('The 20 MiB browser export limit was reached. Narrow the filters to export the remaining evidence.')
          entries.push(entry); totalBytes += bytes
          setNotice(`Exporting snapshot evidence: ${entries.length} artifacts collected. You can cancel and keep a clearly marked partial export.`)
        }
        nextCursor = batch.nextCursor ?? ''
        complete = !nextCursor
      } while (nextCursor)
    } catch (caught) { interruption = controller.signal.aborted ? 'Export cancelled by the user.' : (caught as Error).message }
    finally {
      downloadJson({ schema: 'priorseal.archive-export.v1', exportedAt: Math.floor(Date.now() / 1000), startedAt, projectId: page.projectId, environment: page.environment, scope: 'uploaded_evidence', filters: queriedFilters, snapshot: snapshot ?? null, complete, completeness: complete ? 'ALL_MATCHING_UPLOADED_EVIDENCE_AT_SNAPSHOT' : 'PARTIAL_EXPORT', interruption: interruption || null, entries }, complete ? 'archive-complete-export.json' : 'archive-partial-export.json')
      setNotice(complete ? `Exported all ${entries.length} matching uploaded artifacts at snapshot ${snapshot}. This does not claim to contain every execution.` : `Partial export: ${entries.length} artifacts. ${interruption}`)
      exportController.current = null; setBusy(false)
    }
  }
  async function store(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const artifact = JSON.parse(upload)
      const uploadBody = JSON.stringify({ artifact, ...(supersedesId.trim() ? { supersedesId: supersedesId.trim() } : {}) })
      if (new TextEncoder().encode(uploadBody).length > 1024 * 1024) throw new Error('The upload including its envelope must be no larger than 1 MiB.')
      const result = await consoleRequest<ArchiveItem>('/v1/archive', { method: 'POST', headers: headers(), body: uploadBody })
      setNotice(`Evidence stored as ${result.id}. Existing evidence remains immutable.`); setUpload('')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <AppShell><PageHeader eyebrow="PRIVATE EVIDENCE" title="Project archive" actions={<Link className="button secondary" to="/app/receipts">Local receipts</Link>}>Search evidence explicitly uploaded to your project and environment. This archive does not claim to contain every transaction or every object known by the public API.</PageHeader>
    <section className="panel"><h2>Connect to your archive</h2><Field label="Archive access token" hint="Kept in this page's memory only. It is sent only to the configured PriorSeal API and is excluded from exports."><input type="password" disabled={busy} autoComplete="off" value={token} onChange={(event) => { setToken(event.target.value); setPage(null); setError(''); setPreviousCursors([]) }} /></Field><form onSubmit={search}><div className="form-grid">{Object.entries(filters).map(([key, value]) => <Field key={key} label={{ txHash: 'Transaction hash filter', authorizationId: 'Authorization ID filter', status: 'Status filter', from: 'Created after', to: 'Created before' }[key]!}><input type={key === 'from' || key === 'to' ? 'datetime-local' : 'text'} value={value} onChange={(event) => setFilters((previous) => ({ ...previous, [key]: event.target.value }))} /></Field>)}</div><button className="button primary" disabled={busy || !token.trim()}>Search project evidence</button></form></section>
    {error && <Notice tone="danger" title="Archive request could not complete">{error}</Notice>}{notice && <Notice tone="success" title="Archive updated">{notice}</Notice>}
    {page && <><section className="panel"><div className="panel-head"><div><h2>{page.projectId} / {page.environment}</h2><p>Role: {page.role}. Retention: {page.retention === "process_lifetime" ? "temporary memory; evidence is lost when this server process restarts" : "until the operator deletes it"}. Scope: uploaded evidence.</p></div><button className="button secondary" onClick={() => downloadJson({ schema: 'priorseal.archive-page-export.v1', exportedAt: Math.floor(Date.now() / 1000), projectId: page.projectId, environment: page.environment, filters: queriedFilters, cursor, nextCursor: page.nextCursor, completeness: 'THIS_PAGE_ONLY', scope: page.scope, retention: page.retention, items: page.items }, 'archive-page-manifest.json')}>Export this page manifest</button></div><div className="header-actions"><button className="button secondary" disabled={busy} onClick={() => void exportAll()}>Export all matches with artifacts</button>{busy && exportController.current && <button className="button secondary" onClick={() => exportController.current?.abort()}>Cancel export and save partial</button>}</div>
      {page.items.length ? <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Evidence</th><th>Status</th><th>Recorded</th><th>Relations</th><th /></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}><td><strong>{item.kind}</strong><CodeValue value={item.id} /><small>SHA-256 <CodeValue value={item.artifactHash} /></small></td><td><Status value={item.status} small /></td><td>{dateTime(item.createdAt)}</td><td>{item.txHash && <CodeValue value={item.txHash} />}{item.authorizationId && <CodeValue value={item.authorizationId} />}{item.supersedesId && <small>Supersedes <CodeValue value={item.supersedesId} /></small>}</td><td><button className="button secondary" disabled={busy} onClick={() => void retrieve(item)}>Download evidence</button></td></tr>)}</tbody></table></div> : <Empty title="No matching uploaded evidence">Adjust these filters or ask a project writer to upload the required evidence.</Empty>}
      <div className="header-actions"><button className="button secondary" disabled={busy || !previousCursors.length} onClick={() => { const previous = previousCursors.at(-1) ?? ''; setPreviousCursors((items) => items.slice(0, -1)); void load(previous, loadedFilters) }}>Previous page</button><button className="button secondary" disabled={busy || !page.nextCursor} onClick={() => { setPreviousCursors((items) => [...items, cursor]); void load(page.nextCursor ?? '', loadedFilters) }}>Next page</button><span className="muted">{page.items.length} entries on this page{page.nextCursor ? '; more available' : '; end of current query'}.</span></div></section>
      {page.role === 'writer' && <section className="panel"><h2>Upload evidence</h2><p className="panel-copy">Upload a native verification bundle, review manifest or authorization record. Uploading stores the artifact; it does not verify its claims or grant trust to embedded keys.</p><form onSubmit={store}><fieldset disabled={busy} className="polish-fieldset"><Field label="Archive artifact JSON"><textarea value={upload} onChange={(event) => setUpload(event.target.value)} rows={6} /></Field><Field label="Artifact JSON file"><input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setError('Use a JSON file smaller than 1 MB; the upload including its envelope is limited to 1 MiB.'); return } setUpload(await file.text()) }} /></Field><Field label="Superseded archive entry (optional)" hint="The old entry remains available; this records a successor relationship."><input value={supersedesId} onChange={(event) => setSupersedesId(event.target.value)} /></Field><button className="button primary" disabled={busy || !upload.trim()}>Upload to this project</button></fieldset></form></section>}
    </>}
  </AppShell>
}
