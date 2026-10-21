import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import { getCapabilities, type Capabilities } from '../lib/api'
import './swap-page.css'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const FEEDBACK_FORM = 'https://github.com/imokokok/PriorSeal/issues/new?template=swap-feedback.yml'

function displayedPercent(bps: number) {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2) + '%'
}

function availabilityLabel(value: 'checking' | 'available' | 'unavailable') {
  if (value === 'available') return 'Guarded route available'
  if (value === 'unavailable') return 'Check route availability in workspace'
  return 'Checking deployment'
}

export function SwapPage() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [availability, setAvailability] = useState<'checking' | 'available' | 'unavailable'>('checking')

  useEffect(() => {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousDescription = description?.content
    if (description) description.content = 'PriorSeal Swap lets a Solana wallet review one exact Jupiter route, authorize and submit it once, then retain independent execution evidence.'
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
  const fee = terms ? displayedPercent(terms.feeBps) + ' of the USDC input' : 'Shown in the exact review before a signature'
  const feeMint = terms?.inputMint === USDC_MINT ? 'Solana USDC' : terms ? terms.inputMint : 'Exact review'

  return <main id="main-content" className="swap-page">
    <header className="swap-page__nav">
      <Link className="swap-page__brand" to="/" aria-label="PriorSeal home">
        <span><PriorSealMark /></span>
        <strong>PriorSeal<small>Authority evidence</small></strong>
      </Link>
      <nav aria-label="Swap page navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#proof">Your proof</a>
        <a href="#feedback">Feedback</a>
      </nav>
      <Link className="swap-page__console-link" to="/app">Open console <span aria-hidden="true">↗</span></Link>
    </header>

    <section className="swap-page__hero">
      <div className="swap-page__hero-copy">
        <p className="swap-page__kicker">SOLANA / JUPITER / USER-CONTROLLED EXECUTION</p>
        <p className={'swap-page__status ' + availability}>{availabilityLabel(availability)}</p>
        <h1 data-route-heading tabIndex={-1}>One exact<br /><em>swap.</em> Then proof.</h1>
        <p className="swap-page__lede">PriorSeal makes the decision boundary visible: a route can be prepared, but your wallet sees the exact spend, minimum receive, disclosed fees and expiry before it authorizes and signs one unchanged transaction.</p>
        <div className="swap-page__actions">
          <Link className="swap-page__primary" to="/app/jupiter-guarded-swap">Open swap workspace <span aria-hidden="true">→</span></Link>
          <a className="swap-page__secondary" href="#how-it-works">See the control path <span aria-hidden="true">↓</span></a>
        </div>
        <p className="swap-page__caption">No custody. No wallet private keys. No reusable trading permission.</p>
      </div>

      <aside className="swap-page__route-card" aria-label="Current PriorSeal Swap scope">
        <header><span>ROUTE / 01</span><b>ONE-TIME</b></header>
        <div className="swap-page__route-mark" aria-hidden="true"><span>01</span><i>→</i><span>02</span><i>→</i><span>03</span></div>
        <dl>
          <div><dt>Network</dt><dd>Solana mainnet-beta</dd></div>
          <div><dt>Route</dt><dd>One ExactIn Jupiter route</dd></div>
          <div><dt>Signer</dt><dd>Your wallet, twice by design</dd></div>
          <div><dt>Record</dt><dd>Authorization + observation</dd></div>
        </dl>
      </aside>
    </section>

    <section className="swap-page__sequence" id="how-it-works" aria-labelledby="swap-sequence-title">
      <header>
        <p className="swap-page__kicker">THE CONTROL PATH</p>
        <h2 id="swap-sequence-title">Nothing stays<br /><em>implicitly approved.</em></h2>
      </header>
      <ol>
        <li><span>01</span><div><h3>Prepare</h3><p>PriorSeal prepares one route and simulates the compiled transaction. A changed quote, blockhash or route starts a new review.</p></div></li>
        <li><span>02</span><div><h3>Review</h3><p>See the exact input, output floor, slippage, program surface, fees, expiry and the proposing Agent disclosure.</p></div></li>
        <li><span>03</span><div><h3>Authorize</h3><p>Your wallet signs a readable, time-bounded PriorSeal authorization for this one exact transaction.</p></div></li>
        <li><span>04</span><div><h3>Broadcast once</h3><p>Your wallet signs the unchanged transaction. The protected relay will not turn it into a retrying mandate.</p></div></li>
        <li><span>05</span><div><h3>Keep the proof</h3><p>Observe that exact signature and export the authorization, transaction binding and signed evidence together.</p></div></li>
      </ol>
    </section>

    <section className="swap-page__review" id="proof" aria-labelledby="swap-review-title">
      <div className="swap-page__review-copy">
        <p className="swap-page__kicker">BEFORE A WALLET SIGNS</p>
        <h2 id="swap-review-title">A route is a proposal.<br /><em>Your signature is the decision.</em></h2>
        <p>Display amounts make the review understandable. The exact mints, atomic amounts and transaction digest remain the controlling values. A wallet is never asked to approve a future swap because it approved this one.</p>
        <Link className="swap-page__inline-link" to="/app/jupiter-guarded-swap">Review a guarded route in the workspace <span aria-hidden="true">→</span></Link>
      </div>
      <div className="swap-page__review-board" role="group" aria-label="Fields visible in a guarded route review">
        <div className="swap-page__board-head"><span>REVIEW RECORD</span><span>EXACT / BOUND</span></div>
        <div className="swap-page__board-grid">
          <article><span>SPEND</span><strong>Input amount</strong><p>Atomic units and mint</p></article>
          <article><span>RECEIVE</span><strong>Output floor</strong><p>Minimum bound amount</p></article>
          <article><span>DISCLOSED</span><strong>Fees &amp; slippage</strong><p>Before either signature</p></article>
          <article><span>LIMIT</span><strong>Expiry &amp; one use</strong><p>New route after change</p></article>
        </div>
        <div className="swap-page__board-foot"><span>MESSAGE DIGEST</span><code>bound before broadcast</code></div>
      </div>
    </section>

    <section className="swap-page__scope" aria-label="Swap boundary">
      <article><span>WHAT PRIORSEAL DOES</span><strong>Separates a route proposal from one explicit wallet decision, then preserves what was reviewed and what the chain reported.</strong></article>
      <article><span>WHAT IT DOES NOT DO</span><strong>It does not give investment advice, custody assets, guarantee price quality or token safety, or grant an Agent open-ended authority.</strong></article>
    </section>

    <section className="swap-page__terms">
      <div>
        <p className="swap-page__kicker">DISCLOSED AT REVIEW</p>
        <h2>Fees are part of<br /><em>the decision record.</em></h2>
        <p>The protected route exposes configured commercial terms before authorization. If the exact review is unavailable or incomplete, do not sign or submit a route.</p>
      </div>
      <dl>
        <div><dt>Hosted route fee</dt><dd>{fee}</dd></div>
        <div><dt>Fee input</dt><dd>{feeMint}</dd></div>
        <div><dt>Evidence</dt><dd>Portable after observation; not a claim of economic outcome</dd></div>
      </dl>
    </section>

    <section className="swap-page__feedback" id="feedback" aria-labelledby="swap-feedback-title">
      <div>
        <p className="swap-page__kicker">MAKE THE NEXT REVIEW CLEARER</p>
        <h2 id="swap-feedback-title">Tried the flow?<br /><em>Tell us where it broke down.</em></h2>
        <p>We want the useful parts too: unclear language, a stopped step, a missing safeguard, or proof that made the decision easier. Feedback is public, so keep it redacted.</p>
      </div>
      <div className="swap-page__feedback-action">
        <p><strong>Never include</strong> wallet addresses, transaction signatures or payloads, token mint addresses, private keys, credentials, personal data or commercial terms.</p>
        <a className="swap-page__feedback-link" href={FEEDBACK_FORM} target="_blank" rel="noreferrer">Share redacted swap feedback <span aria-hidden="true">↗</span></a>
        <small>For a wallet, SDK or agent-team deployment, use the scoped pilot brief instead.</small>
        <Link to="/swap/pilot-intake">Plan an Agent / integration pilot <span aria-hidden="true">→</span></Link>
      </div>
    </section>

    <footer className="swap-page__footer">
      <Link to="/">← PriorSeal</Link>
      <Link to="/app/verify">Verify evidence</Link>
      <Link to="/privacy">Privacy &amp; storage</Link>
    </footer>
  </main>
}
