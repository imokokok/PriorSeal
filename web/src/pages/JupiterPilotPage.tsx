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
    if (description) description.content = 'A verified Jupiter agent-swap pilot for Solana applications that need user-controlled authorization, exact simulation, one-time relay controls, and portable execution evidence.'
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
  const status = availability === 'checking' ? 'Checking deployment' : availability === 'available' ? 'Verified route available' : 'Agent-pilot intake available'

  return <main id="main-content" className="jupiter-pilot">
    <header className="jupiter-pilot__nav">
      <Link className="jupiter-pilot__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
      <div><Link to="/">Product</Link><Link to="/swap">Swap</Link><Link to="/app">Console</Link></div>
    </header>

    <section className="jupiter-pilot__hero">
      <div>
        <p className="jupiter-pilot__eyebrow">SOLANA / JUPITER / AGENT EXECUTION PILOT</p>
        <p className={`jupiter-pilot__status ${availability}`}>{status}</p>
        <h1>Let the agent prepare.<br /><em>You control the swap.</em></h1>
        <p className="jupiter-pilot__lede">PriorSeal combines a Jupiter route, Insight simulation, a wallet’s explicit authorization, and a one-time guarded relay. It gives Agent builders a safe execution boundary and gives their users a clear final decision—not a general-purpose trading bot.</p>
        <div className="jupiter-pilot__actions"><Link className="jupiter-pilot__primary" to="/jupiter/pilot-intake">Plan an agent pilot <span>→</span></Link><Link className="jupiter-pilot__secondary" to="/app/jupiter-guarded-swap">Open verified swap <span>→</span></Link></div>
      </div>
      <aside className="jupiter-pilot__scope" aria-label="Current guarded Jupiter scope">
        <span>CURRENT USER CONTROL</span>
        <dl>
          <div><dt>Network</dt><dd>Solana mainnet-beta</dd></div>
          <div><dt>Proposal</dt><dd>One ExactIn route</dd></div>
          <div><dt>Control</dt><dd>Wallet is taker, fee payer and final signer</dd></div>
          <div><dt>Proof</dt><dd>Simulation, authorization, observation</dd></div>
        </dl>
      </aside>
    </section>

    <section className="jupiter-pilot__sequence" aria-label="Verified agent swap sequence">
      <article><span>01 / PROPOSE</span><h2>Let an Agent prepare, not possess.</h2><p>The protected service obtains raw Jupiter instructions, compiles one final message and binds the simulation evidence. The Agent and browser never receive Jupiter, Insight, RPC, or wallet signing credentials.</p></article>
      <article><span>02 / CONTROL</span><h2>Show the human the exact boundary.</h2><p>The wallet reviews the agent ID, spend, output floor, slippage, expiry, program surface and every disclosed fee. A quote or blockhash change needs a new preparation and authorization.</p></article>
      <article><span>03 / PROVE</span><h2>Keep an evidence trail after one attempt.</h2><p>PriorSeal relays the unchanged wallet-signed transaction once, preserves uncertain and failed outcomes, then observes that exact signature and produces portable evidence for independent review.</p></article>
    </section>

    <section className="jupiter-pilot__commercial">
      <div><p className="jupiter-pilot__eyebrow">COMMERCIAL TERMS / DISCLOSED BEFORE SIGNATURE</p><h2>Start with a bounded user-controlled pilot.</h2><p>Each pilot names the Agent or application, route boundary, user-control model, review owner, evidence consumer, support contact and success criterion. PriorSeal is non-custodial: it does not hold a wallet key, select a trade, verify an Agent’s reputation, or guarantee token safety, price, profit or settlement.</p><p className="jupiter-pilot__commercial-link"><Link to="/jupiter/pilot-intake">Create a non-sensitive agent-pilot brief →</Link></p></div>
      <dl>
        <div><dt>Hosted route fee</dt><dd>{fee}</dd></div>
        <div><dt>Minimum fee mint</dt><dd>{terms?.inputMint === USDC_MINT ? 'Solana USDC' : terms ? terms.inputMint : 'Shown in exact review'}</dd></div>
        <div><dt>Service usage</dt><dd>Authorization and observation usage is separately disclosed by the deployment.</dd></div>
      </dl>
    </section>

    <section className="jupiter-pilot__limits">
      <div><span>WHAT THIS DOES</span><strong>Separates Agent proposal, user permission, exact relay and post-execution evidence.</strong></div>
      <div><span>WHAT THIS DOES NOT DO</span><strong>Provide investment advice, give an Agent open-ended authority, guarantee a route, sponsor gas, approve multiple signers or automatically retry an uncertain submission.</strong></div>
    </section>

    <footer className="jupiter-pilot__footer"><Link to="/">← PriorSeal product</Link><Link to="/app/sdk">Agent SDK integration →</Link><Link to="/privacy">Privacy and storage →</Link></footer>
  </main>
}
