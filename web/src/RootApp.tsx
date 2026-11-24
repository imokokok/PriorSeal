import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { PrivacyPreferences } from './PrivacyPreferences'
import { loadConsole } from './route-loaders'
import { LandingPage } from './landing/LandingPage'

function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, key: K) {
  return lazy(() => load().then((module) => ({ default: module[key] })))
}

const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage'), 'PrivacyPage')
const PublicTermsPage = lazyPage(() => import('./pages/PublicTermsPage'), 'PublicTermsPage')
const SupportPage = lazyPage(() => import('./pages/SupportPage'), 'SupportPage')
const McpPage = lazyPage(() => import('./pages/McpPage'), 'McpPage')
const MonadProofPage = lazyPage(() => import('./pages/MonadProofPage'), 'MonadProofPage')
const CapabilitiesPage = lazyPage(() => import('./pages/CapabilitiesPage'), 'CapabilitiesPage')
const SolutionsPage = lazyPage(() => import('./pages/SolutionsPage'), 'SolutionsPage')
const PublicNotFoundPage = lazyPage(() => import('./pages/OutcomePages'), 'PublicNotFoundPage')
const Console = lazy(loadConsole)

type ScrollPosition = { left: number; top: number }

function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef(new Map<string, ScrollPosition>())

  useLayoutEffect(() => {
    const previousRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const frame = window.requestAnimationFrame(() => {
      if (location.hash) {
        let id = location.hash.slice(1)
        try { id = decodeURIComponent(id) } catch { /* Use the literal fragment when it is not URI encoded correctly. */ }
        const target = document.getElementById(id)
        if (target) {
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
          return
        }
      }
      const saved = navigationType === 'POP' ? positions.current.get(location.key) : undefined
      window.scrollTo(saved ?? { left: 0, top: 0 })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      positions.current.set(location.key, { left: window.scrollX, top: window.scrollY })
      window.history.scrollRestoration = previousRestoration
    }
  }, [location.hash, location.key, navigationType])

  return null
}

function RouteAccessibility() {
  const location = useLocation()
  const previousPath = useRef(location.pathname)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    let stopped = false
    let observer: MutationObserver | undefined
    const shouldFocus = previousPath.current !== location.pathname
    previousPath.current = location.pathname

    const update = () => {
      if (stopped) return true
      const heading = document.querySelector<HTMLElement>('[data-route-heading]')
      if (!heading) return false
      const title = heading.textContent?.replace(/\s+/g, ' ').trim() || 'PriorSeal'
      document.title = location.pathname === '/' ? 'PriorSeal — Verified Action for onchain Agents' : `${title} — PriorSeal`
      if (shouldFocus) {
        heading.focus({ preventScroll: true })
        setAnnouncement(`${title} page loaded`)
      }
      observer?.disconnect()
      return true
    }

    const frame = window.requestAnimationFrame(() => {
      if (update()) return
      observer = new MutationObserver(update)
      observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    })

    return () => {
      stopped = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [location.pathname])

  return <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
}

function RouteFallback() {
  return <main id="main-content" className="route-loading" role="status">Loading PriorSeal…</main>
}

export default function RootApp() {
  return <BrowserRouter><a className="skip-link" href="#main-content">Skip to main content</a><ScrollManager /><RouteAccessibility /><Suspense fallback={<RouteFallback />}><Routes><Route path="/" element={<LandingPage />} /><Route path="/solutions" element={<SolutionsPage />} /><Route path="/capabilities" element={<CapabilitiesPage />} /><Route path="/proof-cases" element={<MonadProofPage />} /><Route path="/monad" element={<Navigate replace to="/proof-cases" />} /><Route path="/integrations/mcp" element={<McpPage />} /><Route path="/privacy" element={<PrivacyPage />} /><Route path="/terms" element={<PublicTermsPage />} /><Route path="/support" element={<SupportPage />} /><Route path="/app/*" element={<Console />} /><Route path="*" element={<PublicNotFoundPage />} /></Routes></Suspense><PrivacyPreferences /></BrowserRouter>
}
