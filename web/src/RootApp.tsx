import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { loadConsole } from './route-loaders'

const LandingPage = lazy(() => import('./landing/LandingPage').then((module) => ({ default: module.LandingPage })))
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
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
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

function RouteFallback() {
  return <div className="route-loading" role="status">Loading PriorSeal…</div>
}

export default function RootApp() {
  return <BrowserRouter><ScrollManager /><Suspense fallback={<RouteFallback />}><Routes><Route path="/" element={<LandingPage />} /><Route path="/app/*" element={<Console />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></BrowserRouter>
}
