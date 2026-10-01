import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { getStoragePreference, openStoragePreferences, storagePreferenceEvent } from '../lib/storage'
import '../privacy-document.css'

export function PrivacyPage() {
  const [preference, setPreference] = useState(getStoragePreference)

  useEffect(() => {
    const update = () => setPreference(getStoragePreference())
    window.addEventListener(storagePreferenceEvent, update)
    return () => window.removeEventListener(storagePreferenceEvent, update)
  }, [])

  return <main id="main-content" className="public-document privacy-document">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/app">Open console →</Link></header>
    <article>
      <div className="privacy-document__hero">
        <p className="eyebrow">PRIVACY &amp; STORAGE / 001</p>
        <h1 data-route-heading tabIndex={-1}>Privacy in plain language</h1>
        <p className="public-document__lede">PriorSeal is designed to verify evidence without behavioural tracking. This page describes what the current web application stores and when information leaves your browser.</p>
        <div className="privacy-principles" aria-label="Privacy at a glance">
          <div><span>01 / TRACKING</span><strong>No analytics scripts</strong></div>
          <div><span>02 / EVIDENCE</span><strong>Your device, your choice</strong></div>
          <div><span>03 / TRANSFER</span><strong>Explicit API actions</strong></div>
        </div>
      </div>

      <div className="privacy-document__body">
        <aside className="privacy-index" aria-label="On this page"><span>IN THIS DOCUMENT</span><nav><a href="#tracking">01 / Cookies and tracking</a><a href="#local-storage">02 / Local evidence storage</a><a href="#choice-record">03 / Your choice record</a><a href="#data-transfer">04 / When data is sent</a><a href="#your-controls">05 / Your controls</a></nav><small>Current web application<br />September 2026 revision</small></aside>
        <div className="privacy-sections">
          <section id="tracking" className="privacy-section"><span className="privacy-section__number">01 / TRACKING</span><div><h2>Cookies and tracking</h2><p>The current PriorSeal web application does not set cookies and does not include advertising, cross-site tracking or analytics scripts. If that changes, the storage notice and this page must be updated before those technologies are enabled.</p></div></section>
          <section id="local-storage" className="privacy-section"><span className="privacy-section__number">02 / LOCAL STORAGE</span><div><h2>Local evidence storage</h2><p>If you choose “Allow local saving”, PriorSeal uses your browser’s local storage to retain up to 50 items in each category: intents, signed authorizations, execution observations, resumable observation jobs and receipts. You can also explicitly save up to 20 independently confirmed issuer trust profiles, including public keys, audiences and key validity windows. This makes the local workspace available after a refresh. The data stays on this device until you delete it or clear browser storage.</p><p>If you choose “Use without saving”, new evidence is held only in memory for the current page session and is not written to the local evidence archive. Prior evidence already saved on the device is not silently deleted; use the delete control below when you want to remove it.</p></div></section>
          <section id="choice-record" className="privacy-section"><span className="privacy-section__number">03 / PREFERENCE</span><div><h2>Your choice record</h2><p>PriorSeal stores one strictly functional preference record so it can remember whether you allowed local evidence saving. The choice expires after 180 days and can be changed at any time. It is not used to identify you across websites.</p></div></section>
          <section id="data-transfer" className="privacy-section"><span className="privacy-section__number">04 / DATA TRANSFER</span><div><h2>When data is sent</h2><p>Opening the public pages and using the offline verifier does not send receipt contents to an analytics provider. Actions that explicitly call the configured PriorSeal API—such as preparing an authorization, retrieving a receipt or observing a transaction—send the fields needed to perform that request. Wallet signatures are requested through the wallet provider you choose. If you connect to a private project archive, its access token stays in page memory and is sent only to the configured API. Searching or uploading to that archive is an explicit action; archive retention depends on the deployment: durable stores retain uploads until operator deletion, while temporary memory archives lose uploads at process restart. Offline evidence and trust-profile imports are not automatically uploaded.</p></div></section>
          <section id="your-controls" className="privacy-section privacy-section--controls"><span className="privacy-section__number">05 / YOUR CONTROLS</span><div><h2>Your controls</h2><p>Your current choice is <strong>{preference === 'granted' ? 'local saving allowed' : preference === 'denied' ? 'use without saving' : 'not chosen'}</strong>. You can change it or permanently remove locally saved evidence below.</p><button className="button primary" onClick={openStoragePreferences}>Open privacy choices <span aria-hidden="true">↗</span></button></div></section>
          <footer><Link to="/">← Return to the public collection</Link><span>Last updated September 2026</span></footer>
        </div>
      </div>
    </article>
  </main>
}
