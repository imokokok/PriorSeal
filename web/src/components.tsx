import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { PriorSealMark } from './brand'
import { api, type Capabilities } from './lib/api'
import { chains, dateTime, short } from './lib/format'
import { openStoragePreferences } from './lib/storage'
import type { Receipt } from './types'

export function Logo({ compact = false }: { compact?: boolean }) { return <Link className="logo" to={compact ? '/app' : '/'} aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link> }
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) { const [copied, setCopied] = useState(false); return <button type="button" className="copy-button" aria-live="polite" onClick={async () => { try { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setCopied(false) } }}>{copied ? 'Copied' : label}</button> }
export function CodeValue({ value, title }: { value?: string | null; title?: string }) { return <span className="code-value" title={title ?? value ?? ''}>{short(value)}{value && <CopyButton value={value} />}</span> }
export function Status({ value, small = false }: { value?: string | null; small?: boolean }) {
  const text = value ?? 'UNKNOWN'
  const tokens = new Set(text.toUpperCase().split(/[\s_]+/))
  const contains = (values: string[]) => values.some((candidate) => tokens.has(candidate))
  const upper = text.toUpperCase()
  const tone = upper === 'NON_COMPLIANT' || contains(['FAILED', 'INVALID', 'MISSING', 'REVERTED', 'EXPIRED', 'ERROR', 'MISMATCH', 'OFFLINE']) || upper === 'NOT_FOUND' ? 'danger' : upper === 'NOT_ASSESSABLE' || contains(['PENDING', 'CHECKING', 'INACTIVE', 'UNDETERMINED', 'REORGED', 'INSUFFICIENT']) ? 'warning' : contains(['COMPLIANT', 'COMPLETED', 'CONFIRMED', 'VALID', 'BOUND', 'ACTIVE', 'OK', 'SIGNED', 'ACCEPTED', 'AUTHORIZED', 'READY', 'ONLINE', 'HEALTHY', 'CLEAR']) ? 'success' : 'neutral'
  return <span className={'status ' + tone + (small ? ' small' : '')}><span aria-hidden="true">{tone === 'success' ? '✓' : tone === 'danger' ? '!' : '•'}</span>{text.replaceAll('_', ' ')}</span>
}
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children: ReactNode }) { return <section className={'notice ' + tone} role={tone === 'danger' ? 'alert' : 'status'}><span className="notice-icon" aria-hidden="true">{tone === 'warning' ? '!' : tone === 'danger' ? '×' : 'i'}</span><div><strong>{title}</strong><p>{children}</p></div></section> }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty"><div className="empty-icon" aria-hidden="true">∅</div><h3>{title}</h3><p>{children}</p>{action}</div> }
export function LoadingState({ label }: { label: string }) { return <div className="loading" role="status" aria-live="polite"><span>{label}</span><span className="loading-lines" aria-hidden="true"><i /><i /><i /></span></div> }
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const descriptionId = useId()
  const child = isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string; 'aria-labelledby'?: string; 'aria-invalid'?: boolean }>, {
    'aria-describedby': error || hint ? descriptionId : undefined,
    'aria-labelledby': `${descriptionId}-label`,
    'aria-invalid': error ? true : undefined,
  }) : children
  return <label className="field"><span className="field-label" id={`${descriptionId}-label`}>{label}</span>{child}{error ? <span id={descriptionId} className="field-error">{error}</span> : hint && <span id={descriptionId} className="field-hint">{hint}</span>}</label>
}
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) { return <div className="page-header"><div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 data-route-heading tabIndex={-1}>{title}</h1>{children && <p className="lede">{children}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div> }

type NavigationItem = {
  index: string
  key: string
  label: string
  to: string
  group: string
  visible?: (capabilities: Capabilities | null) => boolean
  disabled?: (capabilities: Capabilities | null) => boolean
}

const nav: NavigationItem[] = [
  { index: '01', key: 'overview', label: 'Overview', to: '/app', group: 'Start' },
  { index: '02', key: 'quickstart', label: 'Quickstart', to: '/app/quickstart', group: 'Start' },
  { index: '03', key: 'intent', label: 'New authorization', to: '/app/intents/new', group: 'Execute' },
  { index: '04', key: 'observe', label: 'Observe execution', to: '/app/observe', group: 'Execute' },
  { index: '05', key: 'exact-call', label: 'Exact-call authorization', to: '/app/intents/exact-call', group: 'Integrations' },
  { index: '06', key: 'jupiter', label: 'Guarded Jupiter swap', to: '/app/jupiter-guarded-swap', group: 'Integrations', disabled: (capabilities) => !capabilities?.integrations?.guardedJupiter.enabled },
  { index: '07', key: 'zeroex', label: 'Guarded 0x swap', to: '/app/0x-guarded-swap', group: 'Integrations', disabled: (capabilities) => !capabilities?.integrations?.guardedZeroEx?.enabled },
  { index: '08', key: 'audit', label: 'Evidence audit', to: '/app/audit', group: 'Evidence & trust' },
  { index: '09', key: 'receipts', label: 'Receipts', to: '/app/receipts', group: 'Evidence & trust' },
  { index: '10', key: 'verify', label: 'Verify receipt', to: '/app/verify', group: 'Evidence & trust' },
  { index: '11', key: 'archive', label: 'Project archive', to: '/app/archive', group: 'Evidence & trust', visible: (capabilities) => Boolean(capabilities?.archive.enabled) },
  { index: '12', key: 'keys', label: 'Key registry', to: '/app/keys', group: 'Evidence & trust' },
  { index: '13', key: 'sdk', label: 'SDK integration', to: '/app/sdk', group: 'Build' },
  { index: '14', key: 'api', label: 'API reference', to: '/app/api', group: 'Build' },
  { index: '15', key: 'mcp', label: 'MCP integration', to: '/integrations/mcp', group: 'Build' },
  ...(import.meta.env.DEV ? [
    { index: '16', key: 'erc4337-pilot', label: 'Safe 4337 pilot', to: '/app/erc4337-pilot', group: 'Experimental' },
    { index: '17', key: 'eip7702-pilot', label: 'MetaMask 7702 pilot', to: '/app/eip7702-pilot', group: 'Experimental' },
  ] : []),
]

function matchesNavigation(item: NavigationItem, pathname: string) {
  return item.to === '/app' ? pathname === '/app' : pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function unavailableNavigationDetail(item: NavigationItem, capabilities: Capabilities | null) {
  if (item.key !== 'jupiter' && item.key !== 'zeroex') return ''
  const reason = item.key === 'jupiter' ? capabilities?.integrations?.guardedJupiter.reason : capabilities?.integrations?.guardedZeroEx?.reason
  if (!capabilities) return 'Checking deployment setup'
  if (reason === 'SOLANA_PROFILE_UNAVAILABLE') return 'Solana authorization is not configured'
  if (reason === 'SOLANA_RPC_UNAVAILABLE') return 'Solana RPC is not configured'
  if (reason === 'ISSUER_UNAVAILABLE' || reason === 'PRE_EXECUTION_PROOF_UNAVAILABLE' || reason === 'STORAGE_UNAVAILABLE') return 'Required evidence services are unavailable'
  return 'Deployment setup required'
}
const AppShellContext = createContext(false)

export function AppShell({ children }: { children: ReactNode }) {
  return useContext(AppShellContext) ? <>{children}</> : <AppShellFrame>{children}</AppShellFrame>
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [compactNavigation, setCompactNavigation] = useState(false)
  const [apiState, setApiState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const location = useLocation()
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const current = [...nav].reverse().find((item) => matchesNavigation(item, location.pathname)) ?? { ...nav[0], key: 'missing', index: '—', label: 'Page not found' }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const sync = () => { setCompactNavigation(media.matches); if (!media.matches) setOpen(false) }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let active = true
    api.health().then(() => { if (active) setApiState('online') }).catch(() => { if (active) setApiState('offline') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    api.capabilities().then((value) => { if (active) setCapabilities(value) }).catch(() => { if (active) setCapabilities(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!compactNavigation || !open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])]
    window.requestAnimationFrame(() => focusable()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      restoreFocus.current?.focus()
    }
  }, [compactNavigation, open])

  function showNavigation() {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : menuButton.current
    setOpen(true)
  }

  const visibleNavigation = nav.filter((item) => item.visible?.(capabilities) ?? true)
  const groups = [...new Set(visibleNavigation.map((item) => item.group))]
  return <AppShellContext.Provider value><div className="shell">
    {compactNavigation && open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside ref={sidebar} id="console-navigation" className={open ? 'sidebar open' : 'sidebar'} aria-hidden={compactNavigation && !open} inert={compactNavigation && !open ? true : undefined}>
      <div className="side-top"><Logo compact /><button type="button" className="mobile-close" onClick={() => setOpen(false)} aria-label="Close navigation">×</button></div>
      <div className="environment"><span className={`live-dot ${apiState}`} /><span>Local collection</span><small>DEVICE SCOPE</small></div>
      <nav aria-label="Console navigation">{groups.map((group) => <div className="nav-group" key={group}><p className="side-caption">{group}</p>{visibleNavigation.filter((item) => item.group === group).map((item) => item.disabled?.(capabilities) ? <span className="nav-unavailable" aria-disabled="true" key={item.to}><span className="nav-index">{item.index}</span><span>{item.label}<small>{unavailableNavigationDetail(item, capabilities)}</small></span></span> : <NavLink end={item.to === '/app'} key={item.to} to={item.to} onClick={() => setOpen(false)}><span className="nav-index">{item.index}</span><span>{item.label}</span></NavLink>)}</div>)}</nav>
      <div className="side-bottom"><span>Local evidence collection</span><small>Browser activity remains on this device when local saving is allowed. Project archive access appears above when the deployment enables it.</small><button type="button" className="side-privacy" onClick={() => { setOpen(false); openStoragePreferences() }}>Privacy &amp; storage</button><span className="side-accession">PRIORSEAL / LOCAL / 001</span></div>
    </aside>
    <main id="main-content"><header className="app-topbar"><button ref={menuButton} type="button" className="menu" onClick={showNavigation} aria-label="Open navigation" aria-controls="console-navigation" aria-expanded={open}>☰</button><div className="top-title"><span>{current.index}</span><strong>{current.label}</strong></div><div className="topbar-right"><span className={`api-state ${apiState}`} aria-live="polite"><span className={`live-dot ${apiState}`} /> API {apiState}</span><Link className="text-link" to="/">Public collection ↗</Link></div></header><div key={location.pathname} className={`page page-${current.key}`}>{children}</div></main>
  </div></AppShellContext.Provider>
}

export const receiptPrimaryStatus = (receipt: Receipt) => receipt.compliance?.status ?? receipt.outcome
export function ReceiptSummary({ receipt, timestampStatus }: { receipt: Receipt; timestampStatus?: 'VALID' | 'INVALID' | 'MISSING' | 'NOT_REQUIRED' | 'CHECKING' }) { const navigate = useNavigate(); const timestampLabel = timestampStatus === 'NOT_REQUIRED' ? 'TIMESTAMP N/A' : `TIMESTAMP ${timestampStatus ?? (receipt.authorizationEvidence?.timestamp ? 'ATTACHED' : 'N/A')}`; return <article className="receipt-row"><div><div className="receipt-badges"><Status value={receiptPrimaryStatus(receipt)} />{receipt.executionStatus && <Status value={receipt.executionStatus} small />}<Status value={timestampLabel} small /></div><strong>{receipt.receiptId}</strong><span>{chains[Number(receipt.execution.chainId)] ?? 'Chain ' + receipt.execution.chainId} · {dateTime(receipt.issuedAt)} · receipt claim</span></div><div className="receipt-row-actions"><CodeValue value={receipt.intentHash} /><button type="button" className="text-link" onClick={() => navigate('/app/receipts/' + encodeURIComponent(receipt.receiptId))}>View</button></div></article> }
