import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getStoragePreference,
  openStoragePreferencesEvent,
  session,
  setStoragePreference,
  storagePreferenceEvent,
  type StoragePreference,
} from './lib/storage'

export function PrivacyPreferences() {
  const [preference, setPreference] = useState<StoragePreference | null>(getStoragePreference)
  const [open, setOpen] = useState(() => getStoragePreference() === null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const sync = () => setPreference(getStoragePreference())
    const show = () => {
      setConfirmingClear(false)
      setOpen(true)
      window.requestAnimationFrame(() => headingRef.current?.focus())
    }
    window.addEventListener(storagePreferenceEvent, sync)
    window.addEventListener(openStoragePreferencesEvent, show)
    return () => {
      window.removeEventListener(storagePreferenceEvent, sync)
      window.removeEventListener(openStoragePreferencesEvent, show)
    }
  }, [])

  useEffect(() => {
    if (!open || !preference) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, preference])

  function choose(choice: StoragePreference) {
    setStoragePreference(choice)
    setPreference(choice)
    setOpen(false)
    setAnnouncement(choice === 'granted' ? 'Local evidence saving enabled.' : 'Using PriorSeal without persistent local evidence saving.')
  }

  function clearEvidence() {
    session.clear()
    setConfirmingClear(false)
    setAnnouncement('Saved local evidence was deleted from this browser.')
  }

  return <>
    <div className="sr-only" aria-live="polite">{announcement}</div>
    {open && <section className="privacy-panel" role="dialog" aria-modal="false" aria-labelledby="privacy-title" aria-describedby="privacy-description">
      <div className="privacy-panel__copy">
        <p className="privacy-kicker">PRIVACY &amp; LOCAL STORAGE</p>
        <h2 id="privacy-title" ref={headingRef} tabIndex={-1}>{preference ? 'Your storage choice' : 'Keep evidence on this device?'}</h2>
        <p id="privacy-description">PriorSeal does not use cookies, advertising trackers or analytics. With your permission, it stores up to 50 local intents, authorizations, observations and receipts in this browser so they remain after a refresh.</p>
        <p className="privacy-current">Current setting: <strong>{preference === 'granted' ? 'Local saving allowed' : preference === 'denied' ? 'Use without saving' : 'Not chosen'}</strong></p>
        <Link to="/privacy" onClick={() => setOpen(false)}>Read privacy and storage details</Link>
      </div>
      <div className="privacy-panel__actions">
        <button type="button" className="button secondary" onClick={() => choose('denied')}>Use without saving</button>
        <button type="button" className="button secondary" onClick={() => choose('granted')}>Allow local saving</button>
        {preference && !confirmingClear && <button type="button" className="text-link privacy-clear" onClick={() => setConfirmingClear(true)}>Delete saved local evidence</button>}
        {confirmingClear && <div className="privacy-confirm" role="alert"><span>This permanently removes evidence saved by PriorSeal in this browser.</span><div><button type="button" className="button secondary" onClick={() => setConfirmingClear(false)}>Cancel</button><button type="button" className="button danger" onClick={clearEvidence}>Delete evidence</button></div></div>}
        {preference && <button type="button" className="privacy-close" aria-label="Close privacy choices" onClick={() => setOpen(false)}>×</button>}
      </div>
    </section>}
  </>
}
