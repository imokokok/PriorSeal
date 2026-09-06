import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from './lib/api'
import { chains, dateTime, short } from './lib/format'
import type { Receipt } from './types'

export function PriorSealMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`priorseal-mark ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="priorseal-mark-blue" d="M29 44H8V8h29l6 6v14" />
      <path className="priorseal-mark-ink" d="M35 32h15l6 6v18H30l-6-6V36" />
      <circle className="priorseal-mark-proof" cx="32" cy="32" r="4.5" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) { return <Link className="logo" to={compact ? '/app' : '/'} aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Execution Evidence</small></span></Link> }
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) { const [copied, setCopied] = useState(false); return <button className="copy-button" onClick={async () => { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }}>{copied ? 'Copied' : label}</button> }
export function CodeValue({ value, title }: { value?: string | null; title?: string }) { return <span className="code-value" title={title ?? value ?? ''}>{short(value)}{value && <CopyButton value={value} />}</span> }
export function Status({ value, small = false }: { value?: string | null; small?: boolean }) {
  const text = value ?? 'UNKNOWN'
  const tokens = new Set(text.toUpperCase().split(/[\s_]+/))
  const contains = (values: string[]) => values.some((candidate) => tokens.has(candidate))
  const tone = contains(['FAILED', 'INVALID', 'MISSING', 'REVERTED', 'EXPIRED', 'ERROR', 'MISMATCH', 'OFFLINE']) || text.toUpperCase() === 'NOT_FOUND' ? 'danger' : contains(['PENDING', 'CHECKING', 'INACTIVE', 'UNDETERMINED', 'REORGED', 'INSUFFICIENT']) ? 'warning' : contains(['COMPLETED', 'CONFIRMED', 'VALID', 'BOUND', 'ACTIVE', 'OK', 'SIGNED', 'ACCEPTED', 'AUTHORIZED', 'READY', 'ONLINE', 'HEALTHY', 'CLEAR']) ? 'success' : 'neutral'
  return <span className={'status ' + tone + (small ? ' small' : '')}><span aria-hidden="true">{tone === 'success' ? '✓' : tone === 'danger' ? '!' : '•'}</span>{text.replaceAll('_', ' ')}</span>
}
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children: ReactNode }) { return <section className={'notice ' + tone}><span className="notice-icon" aria-hidden="true">{tone === 'warning' ? '!' : tone === 'danger' ? '×' : 'i'}</span><div><strong>{title}</strong><p>{children}</p></div></section> }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty"><div className="empty-icon">⌁</div><h3>{title}</h3><p>{children}</p>{action}</div> }
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <label className="field"><span className="field-label">{label}</span>{children}{error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}</label> }
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) { return <div className="page-header"><div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <p className="lede">{children}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div> }

const nav = [
  { index: 'OV', key: 'overview', label: 'Overview', to: '/app', group: 'Workspace' },
  { index: 'AU', key: 'intent', label: 'New authorization', to: '/app/intents/new', group: 'Operate' },
  { index: 'OB', key: 'observe', label: 'Observe execution', to: '/app/observe', group: 'Operate' },
  { index: 'EV', key: 'audit', label: 'Evidence audit', to: '/app/audit', group: 'Evidence' },
  { index: 'RC', key: 'receipts', label: 'Receipts', to: '/app/receipts', group: 'Evidence' },
  { index: 'VR', key: 'verify', label: 'Verify receipt', to: '/app/verify', group: 'Evidence' },
  { index: 'QS', key: 'quickstart', label: 'Quickstart', to: '/app/quickstart', group: 'Developers' },
  { index: 'KY', key: 'keys', label: 'Key registry', to: '/app/keys', group: 'Developers' },
  { index: 'AP', key: 'api', label: 'API reference', to: '/app/api', group: 'Developers' },
]
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking')
  const location = useLocation()
  const current = [...nav].reverse().find((item) => item.to === '/app' ? location.pathname === '/app' : location.pathname.startsWith(item.to)) ?? nav[0]
  useEffect(() => {
    let active = true
    api.health().then(() => { if (active) setApiState('online') }).catch(() => { if (active) setApiState('offline') })
    return () => { active = false }
  }, [])
  const groups = [...new Set(nav.map((item) => item.group))]
  return <div className="shell"><aside className={open ? 'sidebar open' : 'sidebar'}><div className="side-top"><Logo compact /><button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close navigation">×</button></div><div className="environment"><span className={`live-dot ${apiState}`} /><span>Local workspace</span><small>DEVICE SCOPE</small></div><nav aria-label="Console navigation">{groups.map((group) => <div className="nav-group" key={group}><p className="side-caption">{group}</p>{nav.filter((item) => item.group === group).map((item) => <NavLink end={item.to === '/app'} key={item.to} to={item.to} onClick={() => setOpen(false)}><span className="nav-index">{item.index}</span><span>{item.label}</span></NavLink>)}</div>)}</nav><div className="side-bottom"><span>Local evidence scope</span><small>Evidence stays on this device until you export it. Production history requires a server-backed workspace.</small><span className="side-accession">PRIORSEAL / LOCAL</span></div></aside><main><header className="app-topbar"><button className="menu" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button><div className="top-title"><span>{current.index}</span><strong>{current.label}</strong></div><div className="topbar-right"><span className={`api-state ${apiState}`}><span className={`live-dot ${apiState}`} /> API {apiState}</span><Link className="text-link" to="/">PriorSeal site ↗</Link></div></header><div className={`page page-${current.key}`}>{children}</div></main></div>
}

export function ReceiptSummary({ receipt, timestampStatus }: { receipt: Receipt; timestampStatus?: 'VALID' | 'INVALID' | 'MISSING' | 'NOT_REQUIRED' | 'CHECKING' }) { const navigate = useNavigate(); const timestampLabel = timestampStatus === 'NOT_REQUIRED' ? 'TIMESTAMP N/A' : `TIMESTAMP ${timestampStatus ?? (receipt.authorizationEvidence?.timestamp ? 'ATTACHED' : 'N/A')}`; return <article className="receipt-row"><div><div className="receipt-badges"><Status value={receipt.outcome} /><Status value={timestampLabel} small /></div><strong>{receipt.receiptId}</strong><span>{chains[Number(receipt.execution.chainId)] ?? 'Chain ' + receipt.execution.chainId} · {dateTime(receipt.issuedAt)}</span></div><div className="receipt-row-actions"><CodeValue value={receipt.intentHash} /><button className="text-link" onClick={() => navigate('/app/receipts/' + encodeURIComponent(receipt.receiptId))}>View</button></div></article> }
