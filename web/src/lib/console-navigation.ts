import type { Capabilities } from './api'
import { hasPublishedAuthorization } from '../features/capabilities/feature-registry'

export type ConsoleNavigationItem = {
  index: string
  key: string
  label: string
  to: string
  group: string
  activePrefixes?: string[]
  pageKey?: (pathname: string) => string
  visible?: (capabilities: Capabilities | null) => boolean
}

export const consoleNavigation: ConsoleNavigationItem[] = [
  { index: '01', key: 'overview', label: 'Overview', to: '/app', group: 'Workspace' },
  { index: '02', key: 'quickstart', label: 'Quickstart', to: '/app/quickstart', group: 'Workspace' },
  { index: '03', key: 'treasury-pilot', label: 'Base USDC pilot', to: '/app/treasury-pilot', group: 'Workspace' },
  { index: '04', key: 'base-lending', label: 'Base lending', to: '/app/lending', group: 'Execute' },
  { index: '05', key: 'new-action', label: 'New action', to: '/app/actions/new', activePrefixes: ['/app/actions', '/app/intents'], pageKey: (pathname) => pathname === '/app/actions/new' ? 'new-action' : 'intent', group: 'Execute', visible: hasPublishedAuthorization },
  { index: '06', key: 'observe', label: 'Observe execution', to: '/app/observe', group: 'Execute' },
  { index: '07', key: 'evidence', label: 'Evidence library', to: '/app/evidence', activePrefixes: ['/app/evidence', '/app/audit', '/app/receipts'], pageKey: (pathname) => pathname.startsWith('/app/evidence/') || pathname.startsWith('/app/receipts/') ? 'receipts' : 'audit', group: 'Evidence' },
  { index: '08', key: 'archive', label: 'Project archive', to: '/app/archive', group: 'Evidence', visible: (capabilities) => Boolean(capabilities?.archive.enabled) },
  { index: '09', key: 'verify', label: 'Verify receipt', to: '/app/verify', group: 'Verify & trust' },
  { index: '10', key: 'keys', label: 'Issuer key directory', to: '/app/trust/keys', activePrefixes: ['/app/trust/keys', '/app/keys'], group: 'Verify & trust' },
  { index: '11', key: 'developer', label: 'Developer hub', to: '/app/develop', activePrefixes: ['/app/develop', '/app/sdk', '/app/api'], pageKey: (pathname) => pathname === '/app/sdk' ? 'sdk' : pathname === '/app/api' ? 'api' : 'developer', group: 'Build' },
  ...(import.meta.env.DEV ? [
    { index: '12', key: 'erc4337-pilot', label: 'Safe 4337 pilot', to: '/app/erc4337-pilot', group: 'Labs' },
    { index: '13', key: 'eip7702-pilot', label: 'MetaMask 7702 pilot', to: '/app/eip7702-pilot', group: 'Labs' },
  ] : []),
]

export function matchesConsoleNavigation(item: ConsoleNavigationItem, pathname: string) {
  const targets = item.activePrefixes ?? [item.to]
  return targets.some((target) => target === '/app' ? pathname === '/app' : pathname === target || pathname.startsWith(`${target}/`))
}
