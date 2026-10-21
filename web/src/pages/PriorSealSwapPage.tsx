import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { getCapabilities, type Capabilities } from '../lib/api'
import './priorseal-swap.css'

type Availability = 'checking' | 'available' | 'unavailable'

const statusCopy: Record<Availability, string> = {
  checking: 'Checking guarded route',
  available: 'Guarded route available',
  unavailable: 'Check availability in console',
}

export function PriorSealSwapPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [availability, setAvailability] = useState<Availability>('checking')

  useEffect(() => {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousDescription = description?.content
    if (description) description.content = 'PriorSeal Swap is a protected Solana swap path that binds exact route review, wallet authorization, one relay attempt and portable execution evidence.'
    let active = true
    getCapabilities().then((value) => {
      if (!active) return
      setCapabilities(value)
      setAvailability(value.integrations?.guardedZeroEx?.enabled ? 'available' : 'unavailable')
    }).catch(() => { if (active) setAvailability('unavailable') })
    return () => {
      active = false
      if (description && previousDescription !== undefined) description.content = previousDescription
    }
  }, [])

  const zeroEx = capabilities?.integrations?.guardedZeroEx
  const readiness = zeroEx?.reason

  return <main id="main-content" className="priorseal-swap">
    <header className="priorseal-swap__nav">
      <Link className="priorseal-swap__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
      <nav aria-label="PriorSeal Swap navigation"><Link to="/">Product</Link><a href="#how-it-works">Process</a><a href="#evidence">Evidence</a><Link to="/app">Console</Link></nav>
    </header>

    <section className="priorseal-swap__hero" aria-labelledby="swap-heading">
      <div className="priorseal-swap__hero-copy">
        <p className="priorseal-swap__eyebrow">SOLANA / 0X ROUTING / PRIORSEAL</p>
        <p className={`priorseal-swap__status ${availability}`}><span aria-hidden="true" />{statusCopy[availability]}</p>
        <h1 id="swap-heading" data-route-heading tabIndex={-1}>Swap with<br /> <em>proof in the loop.</em></h1>
        <p className="priorseal-swap__lede">PriorSeal Swap turns a Solana route into a constrained, reviewable action: exact request, signed authorization, unchanged wallet transaction and observed result. It is designed for people and teams that need evidence of what a wallet approved—not just a transaction hash.</p>
        <div className="priorseal-swap__actions"><Link className="priorseal-swap__primary" to="/app/0x-guarded-swap">Start a protected swap <span>→</span></Link><a className="priorseal-swap__secondary" href="#how-it-works">See the process <span>↓</span></a></div>
        <p className="priorseal-swap__disclosure">Self-custodial. Your wallet remains the signer and fee payer. Any applicable service terms appear in the exact review before you sign.</p>
      </div>

      <aside className="priorseal-swap__route-card" aria-label="PriorSeal Swap execution boundary">
        <header><span>LIVE EXECUTION BOUNDARY</span><b className={availability}>{availability === 'available' ? 'READY' : availability === 'checking' ? 'CHECKING' : 'CONSOLE'}</b></header>
        <div className="priorseal-swap__route-path" aria-hidden="true"><span>01</span><i /><span>02</span><i /><span>03</span><i /><span>04</span></div>
        <dl>
          <div><dt>Route</dt><dd>0x instructions stay server-side until the protected package is ready.</dd></div>
          <div><dt>Authority</dt><dd>A wallet signs a time-bounded PriorSeal authorization for that exact message.</dd></div>
          <div><dt>Relay</dt><dd>One unchanged, wallet-signed transaction is submitted without automatic retry.</dd></div>
          <div><dt>Record</dt><dd>Observation and receipt evidence remain available for independent review.</dd></div>
        </dl>
        <footer><span>{readiness === 'READY' ? 'Production readiness published' : 'Readiness is checked before execution'}</span><span>PS / SWAP / 01</span></footer>
      </aside>
    </section>

    <section id="how-it-works" className="priorseal-swap__sequence" aria-labelledby="sequence-heading">
      <div className="priorseal-swap__section-heading"><p>01 / THE ROUTE IS NOT THE AUTHORITY</p><h2 id="sequence-heading">Four clear moments,<br /><em>one bounded action.</em></h2></div>
      <ol>
        <li><span>01</span><h3>Prepare</h3><p>Request a permitted route. Provider, simulation and RPC credentials do not enter the browser.</p></li>
        <li><span>02</span><h3>Review</h3><p>Inspect spend, output floor, message binding, programs and any applicable server-owned terms.</p></li>
        <li><span>03</span><h3>Authorize</h3><p>Sign the precise PriorSeal authority, then sign the exact Solana transaction from your own wallet.</p></li>
        <li><span>04</span><h3>Observe</h3><p>Keep the returned signature, outcome and portable evidence package available for verification.</p></li>
      </ol>
    </section>

    <section className="priorseal-swap__review" aria-labelledby="review-heading">
      <div><p className="priorseal-swap__eyebrow">EXACT REVIEW / BEFORE A WALLET SIGNATURE</p><h2 id="review-heading">You approve the action,<br /><em>not a blank mandate.</em></h2><p>Each preparation is bound to one transaction message. A route, blockhash, amount, output floor or program-surface change means the previous authorization cannot be reused.</p><Link className="priorseal-swap__inline-link" to="/app/0x-guarded-swap">Open the review console <span>→</span></Link></div>
      <dl>
        <div><dt>Spend and floor</dt><dd>The exact input amount and independently checked minimum output are recorded.</dd></div>
        <div><dt>Policy surface</dt><dd>Permitted mints, size, slippage, programs and compute bounds are enforced by the deployment.</dd></div>
        <div><dt>Commercial terms</dt><dd>Applicable server-owned fees are disclosed and committed before authorization, never set by the browser.</dd></div>
      </dl>
    </section>

    <section id="evidence" className="priorseal-swap__evidence" aria-labelledby="evidence-heading">
      <div className="priorseal-swap__evidence-card"><div className="priorseal-swap__stamp">PS<small>V1</small></div><p>PORTABLE EXECUTION RECORD</p><strong>Authorization<br /><i>meets observation.</i></strong><span>Inspectable beyond the dashboard</span></div>
      <div className="priorseal-swap__evidence-copy"><p className="priorseal-swap__eyebrow">AFTER SUBMISSION / EVIDENCE YOU CAN EXAMINE</p><h2 id="evidence-heading">A transaction hash says<br />something happened.<br /><em>The record says what.</em></h2><p>A completed flow can retain the reviewed package, authorization, submitted signature and observation in an evidence export. It supports verification of the execution boundary; it does not guarantee price, token quality, settlement or profit.</p><Link className="priorseal-swap__inline-link" to="/app/verify">Verify a PriorSeal receipt <span>→</span></Link></div>
    </section>

    <section className="priorseal-swap__boundaries" aria-label="PriorSeal Swap boundaries">
      <article><span>WHAT PRIORSEAL DOES</span><strong>Protects an exact, policy-bounded execution path and makes its authorization and observation inspectable.</strong></article>
      <article><span>WHAT PRIORSEAL DOES NOT DO</span><strong>Hold wallet keys, select assets for you, provide investment advice, guarantee a quote or retry an uncertain broadcast.</strong></article>
    </section>

    <footer className="priorseal-swap__footer"><Link to="/">← PriorSeal product</Link><Link to="/jupiter">Guarded Jupiter pilot →</Link><Link to="/support#feedback">Support and feedback →</Link><Link to="/app/sdk">Developer integration →</Link><Link to="/privacy">Privacy and storage →</Link></footer>
  </main>
}
