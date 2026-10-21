import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { getCapabilities, type Capabilities } from '../lib/api'
import './jupiter-pilot.css'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function displayPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}

export function JupiterPilotPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [availability, setAvailability] = useState<'checking' | 'available' | 'unavailable'>('checking')

  useEffect(() => {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousDescription = description?.content
    if (description) description.content = 'A guarded Jupiter swap pilot for Solana teams that need exact wallet authorization, server-side simulation, one-time relay controls, and portable execution evidence.'
    let active = true
    getCapabilities().then((value) => {
      if (!active) return
      setCapabilities(value)
      setAvailability(value.integrations?.guardedJupiter.enabled ? 'available' : 'unavailable')
    }).catch(() => { if (active) setAvailability('unavailable') })
    return () => {
      active = false
      if (description && previousDescription !== undefined) description.content = previousDescription
    }
  }, [])

  const terms = capabilities?.integrations?.guardedJupiter.commercial?.platformFee
  const fee = terms ? `${displayPercent(terms.feeBps)} USDC-input platform fee` : 'Fee terms are shown in the exact transaction review before either signature.'
  const status = availability === 'checking' ? 'Checking deployment' : availability === 'available' ? 'Protected route available' : 'Pilot intake available'

  return <main id="main-content" className="jupiter-pilot">
    <header className="jupiter-pilot__nav">
      <Link className="jupiter-pilot__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
      <div><Link to="/">Product</Link><Link to="/app">Console</Link></div>
    </header>

    <section className="jupiter-pilot__hero">
      <div>
        <p className="jupiter-pilot__eyebrow">SOLANA / JUPITER / DESIGN PARTNER</p>
        <p className={`jupiter-pilot__status ${availability}`}>{status}</p>
        <h1>One exact swap.<br /><em>Evidence before execution.</em></h1>
        <p className="jupiter-pilot__lede">PriorSeal combines Jupiter routing, an Insight simulation commitment, a wallet’s explicit authorization, and a one-time guarded relay. It is for teams that need to prove what a wallet approved—not a general-purpose trading interface.</p>
        <div className="jupiter-pilot__actions"><Link className="jupiter-pilot__primary" to="/jupiter/pilot-intake">Plan a pilot <span>→</span></Link><Link className="jupiter-pilot__secondary" to="/app/jupiter-guarded-swap">Open guarded console <span>→</span></Link></div>
      </div>
      <aside className="jupiter-pilot__scope" aria-label="Current guarded Jupiter scope">
        <span>CURRENT BOUNDARY</span>
        <dl>
          <div><dt>Network</dt><dd>Solana mainnet-beta</dd></div>
          <div><dt>Swap</dt><dd>One ExactIn route</dd></div>
          <div><dt>Signer</dt><dd>Wallet is taker and fee payer</dd></div>
          <div><dt>Evidence</dt><dd>Simulation, authorization, observation</dd></div>
        </dl>
      </aside>
    </section>

    <section className="jupiter-pilot__sequence" aria-label="Guarded Jupiter pilot sequence">
      <article><span>01 / PREPARE</span><h2>Route without exposing provider keys.</h2><p>The protected service obtains raw Jupiter instructions, compiles one final message and binds the simulation evidence. Browser code never receives the Jupiter, Insight or RPC credentials.</p></article>
      <article><span>02 / AUTHORIZE</span><h2>Review the exact bytes before signing.</h2><p>The wallet sees the message hash, program surface, limits, output floor and any server-owned fee. A quote or blockhash change needs a new preparation and authorization.</p></article>
      <article><span>03 / OBSERVE</span><h2>Retain proof after one relay attempt.</h2><p>PriorSeal relays the unchanged wallet-signed transaction once, preserves uncertain outcomes, then observes that exact signature and produces portable evidence for independent review.</p></article>
    </section>

    <section className="jupiter-pilot__commercial">
      <div><p className="jupiter-pilot__eyebrow">COMMERCIAL TERMS / DISCLOSED BEFORE SIGNATURE</p><h2>Start with a bounded pilot, not a blank trading mandate.</h2><p>Each pilot names the route boundary, review owner, evidence consumer, support contact and success criterion. PriorSeal is non-custodial: it does not hold a wallet key, select a trade or guarantee token safety, price, profit or settlement.</p><p className="jupiter-pilot__commercial-link"><Link to="/jupiter/pilot-intake">Create a non-sensitive pilot brief →</Link></p></div>
      <dl>
        <div><dt>Hosted route fee</dt><dd>{fee}</dd></div>
        <div><dt>Minimum fee mint</dt><dd>{terms?.inputMint === USDC_MINT ? 'Solana USDC' : terms ? terms.inputMint : 'Shown in exact review'}</dd></div>
        <div><dt>Service usage</dt><dd>Authorization and observation usage is separately disclosed by the deployment.</dd></div>
      </dl>
    </section>

    <section className="jupiter-pilot__limits">
      <div><span>WHAT THIS DOES</span><strong>Separates route preparation, principal permission, execution relay and post-execution evidence.</strong></div>
      <div><span>WHAT THIS DOES NOT DO</span><strong>Provide investment advice, guarantee a route, sponsor gas, approve multiple signers or automatically retry an uncertain submission.</strong></div>
    </section>

    <footer className="jupiter-pilot__footer"><Link to="/">← PriorSeal product</Link><Link to="/app/sdk">SDK integration →</Link><Link to="/privacy">Privacy and storage →</Link></footer>
  </main>
}
