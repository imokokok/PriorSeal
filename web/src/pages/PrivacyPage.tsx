import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { getStoragePreference, openStoragePreferences } from '../lib/storage'

export function PrivacyPage() {
  const preference = getStoragePreference()
  return <main id="main-content" className="public-document">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/app">Open console →</Link></header>
    <article>
      <p className="eyebrow">PRIVACY &amp; STORAGE</p>
      <h1 data-route-heading tabIndex={-1}>Privacy in plain language</h1>
      <p className="public-document__lede">PriorSeal is designed to verify evidence without behavioural tracking. This page describes what the current web application stores and when information leaves your browser.</p>

      <section><h2>Cookies and tracking</h2><p>The current PriorSeal web application does not set cookies and does not include advertising, cross-site tracking or analytics scripts. If that changes, the storage notice and this page must be updated before those technologies are enabled.</p></section>
      <section><h2>Local evidence storage</h2><p>If you choose “Allow local saving”, PriorSeal uses your browser’s local storage to retain up to 50 items in each category: intents, signed authorizations, execution observations and receipts. This makes the local workspace available after a refresh. The data stays on this device until you delete it or clear browser storage.</p><p>If you choose “Use without saving”, new evidence is held only in memory for the current page session and is not written to the local evidence archive. Prior evidence already saved on the device is not silently deleted; use the delete control below when you want to remove it.</p></section>
      <section><h2>Your choice record</h2><p>PriorSeal stores one strictly functional preference record so it can remember whether you allowed local evidence saving. The choice expires after 180 days and can be changed at any time. It is not used to identify you across websites.</p></section>
      <section><h2>When data is sent</h2><p>Opening the public pages and using the offline verifier does not send receipt contents to an analytics provider. Actions that explicitly call the configured PriorSeal API—such as preparing an authorization, retrieving a receipt or observing a transaction—send the fields needed to perform that request. Wallet signatures are requested through the wallet provider you choose.</p></section>
      <section><h2>Your controls</h2><p>Your current choice is <strong>{preference === 'granted' ? 'local saving allowed' : preference === 'denied' ? 'use without saving' : 'not chosen'}</strong>. You can change it or permanently remove locally saved evidence below.</p><button className="button primary" onClick={openStoragePreferences}>Open privacy choices</button></section>
      <footer><Link to="/">← Return to the public collection</Link><span>Last updated September 2026</span></footer>
    </article>
  </main>
}
