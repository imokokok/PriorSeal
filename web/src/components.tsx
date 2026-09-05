import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { chains, dateTime, short } from './lib/format'
import type { Receipt } from './types'

export function RunProofMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`runproof-mark ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="runproof-mark-blue" d="M29 44H8V8h29l6 6v14" />
      <path className="runproof-mark-ink" d="M35 32h15l6 6v18H30l-6-6V36" />
      <circle className="runproof-mark-proof" cx="32" cy="32" r="4.5" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) { return <Link className="logo" to={compact ? '/app' : '/'} aria-label="RunProof home"><span className="logo-symbol"><RunProofMark /></span><span className="logo-type">RunProof<small>Execution Archive</small></span></Link> }
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) { const [copied, setCopied] = useState(false); return <button className="copy-button" onClick={async () => { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }}>{copied ? 'Copied' : label}</button> }
export function CodeValue({ value, title }: { value?: string | null; title?: string }) { return <span className="code-value" title={title ?? value ?? ''}>{short(value)}{value && <CopyButton value={value} />}</span> }
export function Status({ value, small = false }: { value?: string | null; small?: boolean }) {
  const text = value ?? 'UNKNOWN'
  const tokens = new Set(text.toUpperCase().split(/[\s_]+/))
  const contains = (values: string[]) => values.some((candidate) => tokens.has(candidate))
  const tone = contains(['FAILED', 'INVALID', 'REVERTED', 'EXPIRED', 'ERROR', 'MISMATCH']) || text.toUpperCase() === 'NOT_FOUND' ? 'danger' : contains(['PENDING', 'INACTIVE', 'UNDETERMINED', 'REORGED', 'INSUFFICIENT']) ? 'warning' : contains(['COMPLETED', 'CONFIRMED', 'VALID', 'BOUND', 'ACTIVE', 'OK', 'SIGNED']) ? 'success' : 'neutral'
  return <span className={'status ' + tone + (small ? ' small' : '')}><span aria-hidden="true">{tone === 'success' ? '✓' : tone === 'danger' ? '!' : '•'}</span>{text.replaceAll('_', ' ')}</span>
}
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children: ReactNode }) { return <section className={'notice ' + tone}><span className="notice-icon" aria-hidden="true">{tone === 'warning' ? '!' : tone === 'danger' ? '×' : 'i'}</span><div><strong>{title}</strong><p>{children}</p></div></section> }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty"><div className="empty-icon">⌁</div><h3>{title}</h3><p>{children}</p>{action}</div> }
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <label className="field"><span className="field-label">{label}</span>{children}{error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}</label> }
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) { return <div className="page-header"><div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <p className="lede">{children}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div> }

const nav = [
  { index: '01', key: 'overview', label: 'Overview', to: '/app' },
  { index: '02', key: 'quickstart', label: 'Quickstart', to: '/app/quickstart' },
  { index: '03', key: 'intent', label: 'Create intent', to: '/app/intents/new' },
  { index: '04', key: 'observe', label: 'Observe execution', to: '/app/observe' },
  { index: '05', key: 'audit', label: 'Audit workspace', to: '/app/audit' },
  { index: '06', key: 'verify', label: 'Verify receipt', to: '/app/verify' },
  { index: '07', key: 'receipts', label: 'Receipts', to: '/app/receipts' },
  { index: '08', key: 'keys', label: 'Key registry', to: '/app/keys' },
  { index: '09', key: 'api', label: 'API reference', to: '/app/api' },
]
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const current = [...nav].reverse().find((item) => item.to === '/app' ? location.pathname === '/app' : location.pathname.startsWith(item.to)) ?? nav[0]
  return <div className="shell"><aside className={open ? 'sidebar open' : 'sidebar'}><div className="side-top"><Logo compact /><button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close navigation">×</button></div><div className="environment"><span className="live-dot" /><span>Archive console</span><small>LOCAL / ACTIVE</small></div><p className="side-caption">Collection index</p><nav aria-label="Console navigation">{nav.map((item) => <NavLink end={item.to === '/app'} key={item.to} to={item.to} onClick={() => setOpen(false)}><span className="nav-index">{item.index}</span><span>{item.label}</span></NavLink>)}</nav><div className="side-bottom"><span>Browser-local collection</span><small>Objects created here remain on this device unless exported.</small><span className="side-accession">RP / MMXXVI / 001</span></div></aside><main><header className="app-topbar"><button className="menu" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button><div className="top-title"><span>{current.index}</span><strong>{current.label}</strong></div><div className="topbar-right"><span className="api-state"><span className="live-dot" /> API configurable</span><Link className="text-link" to="/">Exhibition site ↗</Link></div></header><div className={`page page-${current.key}`} data-room={current.index}>{children}</div></main></div>
}

export function ReceiptSummary({ receipt }: { receipt: Receipt }) { const navigate = useNavigate(); return <article className="receipt-row"><div><Status value={receipt.outcome} /><strong>{receipt.receiptId}</strong><span>{chains[Number(receipt.execution.chainId)] ?? 'Chain ' + receipt.execution.chainId} · {dateTime(receipt.issuedAt)}</span></div><div className="receipt-row-actions"><CodeValue value={receipt.intentHash} /><button className="text-link" onClick={() => navigate('/app/receipts/' + encodeURIComponent(receipt.receiptId))}>View</button></div></article> }
