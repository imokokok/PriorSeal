import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../components'
import { audiences, boundaries, proofSequence, receiptLines, sectionLinks } from './content'
import './landing.css'

function InstitutionMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`museum-mark${inverse ? ' museum-mark--inverse' : ''}`} to="/" aria-label="PriorSeal home">
      <span className="museum-mark__symbol"><PriorSealMark /></span>
      <span className="museum-mark__name">PriorSeal<small>Authority evidence</small></span>
    </Link>
  )
}

function PhotoCredit({ children, href }: { children: string; href: string }) {
  return <a className="photo-credit" href={href} target="_blank" rel="noreferrer">{children} ↗</a>
}

function ReceiptRecord() {
  return (
    <article className="digital-record" aria-label="Example PriorSeal v2 execution receipt">
      <header>
        <span>PRIORSEAL / EXECUTION RECEIPT</span>
        <strong>V2 / FINAL</strong>
      </header>
      <div className="digital-record__identity">
        <p>Receipt ID</p>
        <h3>psr_83c1c94f</h3>
        <span>Issued 2026-09-06 · 00:18 UTC</span>
      </div>
      <dl>
        {receiptLines.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
      </dl>
      <footer><span>Issuer signature · Ed25519</span><b>VALID</b></footer>
    </article>
  )
}

export function LandingPage() {
  useEffect(() => {
    document.documentElement.classList.add('motion-ready')
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')),
      { threshold: 0.1 },
    )
    document.querySelectorAll('.priorseal-museum [data-reveal]').forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      document.documentElement.classList.remove('motion-ready')
    }
  }, [])

  return (
    <div className="priorseal-museum">
      <header className="museum-nav">
        <InstitutionMark />
        <nav aria-label="Homepage navigation">
          {sectionLinks.map(([label, id]) => <a href={`#${id}`} key={id}>{label}</a>)}
          <Link to="/app/api">Documentation</Link>
        </nav>
        <Link className="museum-nav__entry" to="/app">Open console <span>↗</span></Link>
      </header>

      <main>
        <section className="museum-hero">
          <div className="museum-hero__copy" data-reveal>
            <p className="museum-kicker"><span>PRIORSEAL</span> / EVIDENCE INSTITUTION 001</p>
            <h1>Authority,<br /><em>before action.</em></h1>
            <p className="museum-hero__statement">A verifiable record connecting what a person or organization authorized to what an autonomous agent actually executed onchain.</p>
            <div className="museum-actions">
              <Link className="museum-button" to="/app/intents/new">Authorize an intent <span>→</span></Link>
              <Link className="museum-text-link" to="/app/verify">Verify a receipt <span>↗</span></Link>
            </div>
            <p className="museum-hero__note">Portable evidence for EVM agents. No custody. No transaction-signing keys.</p>
          </div>

          <figure className="museum-hero__visual" data-reveal>
            <img src="/images/priorseal-museum.jpg" alt="Visitors viewing works inside a real contemporary museum gallery" />
            <figcaption>
              <span>FIELD REFERENCE / 01</span>
              <p>A record should remain legible beyond the system that produced it.</p>
              <PhotoCredit href="https://unsplash.com/photos/people-observe-exhibits-in-a-modern-museum-interior-e11OulaSBzo">MONA, Tasmania · Neon Wang</PhotoCredit>
            </figcaption>
          </figure>
        </section>

        <div className="accession-strip" aria-label="PriorSeal evidence qualities">
          <span>01 · PRINCIPAL AUTHORITY</span><span>02 · INDEPENDENT TIME</span><span>03 · OBSERVED EXECUTION</span><span>04 · PORTABLE RECEIPT</span>
        </div>

        <section className="museum-statement" id="system">
          <div className="museum-section-id" data-reveal><span>01</span><p>The system</p></div>
          <div className="museum-statement__body" data-reveal>
            <p className="museum-kicker">THE MISSING RELATIONSHIP</p>
            <h2>An execution proves that something happened. It does not prove that it was allowed.</h2>
            <div className="museum-statement__columns">
              <p>PriorSeal preserves the relationship between a principal-signed, time-bounded authorization and an identified EVM execution.</p>
              <p>The resulting receipt can be inspected and verified without trusting the service that issued it.</p>
            </div>
          </div>
          <dl className="museum-system-index" data-reveal>
            <div><dt>Authority</dt><dd>EIP-712 EOA<br />ERC-1271 organization</dd></div>
            <div><dt>Independent order</dt><dd>DigiCert RFC 3161<br />Witness quorum / EVM anchor</dd></div>
            <div><dt>Evidence format</dt><dd>Canonical JSON<br />Ed25519 issuer signature</dd></div>
            <div><dt>Custody boundary</dt><dd>No assets<br />No transaction-signing keys</dd></div>
          </dl>
        </section>

        <section className="museum-chain" id="chain">
          <header data-reveal>
            <div className="museum-section-id museum-section-id--light"><span>02</span><p>Evidence chain</p></div>
            <div><p className="museum-kicker">SIX ENTRIES / ONE VERIFIABLE HISTORY</p><h2>From proposal<br />to proof.</h2></div>
            <p>Each transition is explicit. Uncertainty remains visible. Every signed claim can be recomputed.</p>
          </header>
          <ol data-reveal>
            {proofSequence.map((step) => (
              <li key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.body}</p></li>
            ))}
          </ol>
        </section>

        <section className="archive-room" id="archive">
          <figure className="archive-room__photograph" data-reveal>
            <img src="/images/priorseal-archive.jpg" alt="Rows of archival boxes stored on wooden shelves" />
            <figcaption><span>ARCHIVAL REFERENCE / 02</span><PhotoCredit href="https://unsplash.com/photos/rows-of-white-archive-boxes-on-wooden-shelves-5utYi64hnJ0">Oxford · Luke Caunt</PhotoCredit></figcaption>
          </figure>
          <div className="archive-room__copy" data-reveal>
            <div className="museum-section-id"><span>03</span><p>The archive</p></div>
            <p className="museum-kicker">RETAINED OUTSIDE THE SERVICE</p>
            <h2>Evidence that<br />leaves with you.</h2>
            <p>A PriorSeal receipt is not a dashboard state or a promise held inside one database. It is a portable, signed record of authority, time, execution and binding.</p>
            <ul>
              <li><span>A</span>Canonical, inspectable fields</li>
              <li><span>B</span>Independent timestamp evidence</li>
              <li><span>C</span>Local cryptographic verification</li>
            </ul>
          </div>
        </section>

        <section className="receipt-gallery" id="receipt">
          <div className="receipt-gallery__copy" data-reveal>
            <div className="museum-section-id"><span>04</span><p>Receipt</p></div>
            <p className="museum-kicker">THE PORTABLE RECORD</p>
            <h2>Built to be<br />examined.</h2>
            <p>A v2 receipt carries the signed authorization, policy result, independent time evidence, observed execution, binding decision and issuer signature in one document.</p>
            <Link className="museum-text-link" to="/app/verify">Open the local verifier <span>↗</span></Link>
          </div>
          <div className="receipt-gallery__record" data-reveal>
            <p>SPECIMEN DATA / EVERY FIELD MACHINE-VERIFIABLE</p>
            <ReceiptRecord />
          </div>
        </section>

        <section className="claim-boundaries" id="boundaries">
          <header data-reveal>
            <div className="museum-section-id"><span>05</span><p>Boundaries</p></div>
            <div><p className="museum-kicker">SCOPE OF THE CLAIM</p><h2>Precise evidence.<br /><em>Explicit limits.</em></h2></div>
          </header>
          <dl data-reveal>
            {boundaries.map(([term, description], index) => (
              <div key={term}><span>0{index + 1}</span><dt>{term}</dt><dd>{description}</dd></div>
            ))}
          </dl>
        </section>

        <section className="evidence-audiences">
          <header data-reveal><p className="museum-kicker">EVIDENCE CONSUMERS</p><h2>One record.<br />Three responsibilities.</h2></header>
          <div data-reveal>
            {audiences.map((audience, index) => <article key={audience.label}><span>0{index + 1}</span><h3>{audience.label}</h3><p>{audience.text}</p></article>)}
          </div>
        </section>

        <section className="museum-closing">
          <div data-reveal>
            <p className="museum-kicker">PRIORSEAL / AUTHORIZATION EVIDENCE</p>
            <h2>Make authority<br />inspectable.</h2>
            <div className="museum-actions"><Link className="museum-button museum-button--light" to="/app">Open console <span>→</span></Link><Link className="museum-text-link" to="/app/api">Read the API <span>↗</span></Link></div>
          </div>
          <footer><InstitutionMark inverse /><span>Portable authorization and execution evidence for EVM agents.</span><span>© {new Date().getFullYear()}</span></footer>
        </section>
      </main>
    </div>
  )
}
