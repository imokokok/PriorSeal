import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { PrivacyPreferences } from './PrivacyPreferences'
import { loadConsole } from './route-loaders'

const LandingPage = lazy(() => import('./landing/LandingPage').then((module) => ({ default: module.LandingPage })))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })))
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
      document.title = location.pathname === '/' ? 'PriorSeal — Authority before action' : `${title} — PriorSeal`
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
  return <BrowserRouter><a className="skip-link" href="#main-content">Skip to main content</a><ScrollManager /><RouteAccessibility /><Suspense fallback={<RouteFallback />}><Routes><Route path="/" element={<LandingPage />} /><Route path="/privacy" element={<PrivacyPage />} /><Route path="/app/*" element={<Console />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense><PrivacyPreferences /></BrowserRouter>
}
