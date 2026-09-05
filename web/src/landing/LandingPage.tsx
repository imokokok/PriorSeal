import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { RunProofMark } from '../components'
import { audiences, boundaries, proofSequence, receiptLines, sectionLinks } from './content'
import './landing.css'

function MuseumMark() {
  return (
    <Link className="museum-mark" to="/" aria-label="RunProof home">
      <span className="museum-logo-symbol"><RunProofMark /></span>
      <span className="museum-name">RunProof<small>Execution Archive</small></span>
    </Link>
  )
}

function ArtifactStudy() {
  return (
    <div className="artifact-study" aria-label="Abstract study of a portable signed execution receipt">
      <div className="study-field" aria-hidden="true"><i /><i /><i /></div>
      <div className="study-sheet study-sheet-back" aria-hidden="true" />
      <div className="study-sheet study-sheet-middle" aria-hidden="true" />
      <div className="study-sheet study-sheet-front">
        <div className="sheet-heading"><span>RUNPROOF</span><span>OBJECT / 001</span></div>
        <div className="sheet-seal" aria-hidden="true">R</div>
        <div className="sheet-title"><small>SIGNED EXECUTION RECEIPT</small><strong>rpr_83c1c94f</strong></div>
        <div className="sheet-data"><span>intentHash</span><b>sha256:7ce8…d41a</b><span>outcome</span><b>COMPLETED</b><span>signature</span><b>Ed25519 / valid</b></div>
        <div className="sheet-foot">PORTABLE JSON / INDEPENDENT VERIFICATION</div>
      </div>
      <div className="study-caption"><span>FIG. 01</span><p>A portable statement connecting authorization to observed execution.</p></div>
    </div>
  )
}

function ArchiveObject() {
  return (
    <div className="archive-object">
      <div className="object-spine"><span>RP–001</span><small>PERMANENT RECORD</small></div>
      <div className="object-header"><span>RUNPROOF RECEIPT</span><span>SCHEMA / V1</span></div>
      <div className="object-id"><small>ACCESSION NUMBER</small><strong>rpr_83c1c94f</strong></div>
      <dl>
        {receiptLines.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="object-signature"><span>ISSUER / RUNPROOF</span><span>∿</span><span>OFFLINE VERIFIABLE</span></div>
    </div>
  )
}

export function LandingPage() {
  useEffect(() => {
    document.documentElement.classList.add('motion-ready')
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')),
      { threshold: 0.12 },
    )
    document.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="museum-site">
      <header className="museum-nav">
        <MuseumMark />
        <nav aria-label="Homepage navigation">
          {sectionLinks.map(([label, id]) => <a href={`#${id}`} key={id}>{label}</a>)}
          <Link to="/app/api">API</Link>
        </nav>
        <Link className="museum-entry" to="/app"><span>Enter console</span><b aria-hidden="true">↗</b></Link>
      </header>

      <main>
        <section className="museum-hero">
          <div className="hero-index" aria-hidden="true"><span>EXHIBITION</span><b>01</b><small>RUNPROOF<br />MMXXVI</small></div>
          <div className="museum-hero-copy" data-reveal>
            <p className="museum-kicker">RUNPROOF / PORTABLE EXECUTION EVIDENCE</p>
            <h1>Actions disappear.<br /><em>Evidence should not.</em></h1>
            <p className="hero-lede">A pre-authorized intent. An observed EVM execution. A signed receipt that can leave the system that issued it—and still be verified.</p>
            <div className="museum-actions">
              <Link className="museum-button blue" to="/app/intents/new">Create an intent <span>→</span></Link>
              <Link className="museum-link" to="/app/verify">Verify a receipt <span>↗</span></Link>
            </div>
          </div>
          <ArtifactStudy />
          <div className="hero-register">
            <span>COLLECTION</span><strong>Independent execution evidence</strong>
            <span>MATERIAL</span><strong>Canonical JSON / Ed25519</strong>
            <span>CUSTODY</span><strong>None</strong>
          </div>
        </section>

        <section className="collection-section" id="archive">
          <div className="collection-heading" data-reveal>
            <p className="museum-kicker"><span>ROOM 01</span> THE COLLECTION</p>
            <h2>The record begins before execution.</h2>
            <p>An on-chain result cannot explain what an agent was allowed to do. Authorization alone cannot establish what eventually happened. RunProof preserves the relationship between the two.</p>
          </div>
          <div className="collection-grid" data-reveal>
            <article><div className="collection-figure figure-intent" aria-hidden="true"><span /><i /></div><small>OBJECT / A</small><h3>Intent</h3><p>The bounded instruction recorded before action: chain, participants, asset, amount, time and constraints.</p></article>
            <article><div className="collection-figure figure-observation" aria-hidden="true"><span /><i /><b /></div><small>OBJECT / B</small><h3>Observation</h3><p>What a configured EVM source returned at a specific point in time, with uncertainty and finality intact.</p></article>
            <article><div className="collection-figure figure-receipt" aria-hidden="true"><span /><i /></div><small>OBJECT / C</small><h3>Receipt</h3><p>An issuer-signed statement connecting the intent and observed execution through explainable binding results.</p></article>
          </div>
        </section>

        <section className="provenance-section" id="provenance">
          <div className="provenance-intro" data-reveal>
            <p className="museum-kicker"><span>ROOM 02</span> PROVENANCE</p>
            <h2>Every transition leaves a trace.</h2>
            <p>RunProof does not replace uncertainty with confidence. It records the evidence chain clearly enough for another person—or another system—to inspect later.</p>
          </div>
          <ol className="provenance-list" data-reveal>
            {proofSequence.map((step) => (
              <li key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.body}</p><i aria-hidden="true" /></li>
            ))}
          </ol>
        </section>

        <section className="object-section" id="object">
          <div className="object-wall-label" data-reveal>
            <p className="museum-kicker"><span>ROOM 03</span> FEATURED OBJECT</p>
            <h2>A document designed to leave.</h2>
            <p>The receipt carries the hashes, observation, binding result, issuer and signature needed to examine the claim. Download it. Retain it. Verify it independently.</p>
            <Link className="museum-link" to="/app/verify">Open verification workbench <span>↗</span></Link>
          </div>
          <div className="object-plinth" data-reveal><ArchiveObject /><span className="plinth-number">001</span></div>
        </section>

        <section className="boundary-section" id="boundary">
          <div className="boundary-title" data-reveal>
            <p className="museum-kicker"><span>ROOM 04</span> WALL TEXT</p>
            <h2>A receipt is a signed statement.<br /><em>It is not an oracle.</em></h2>
          </div>
          <dl className="boundary-catalogue" data-reveal>
            {boundaries.map(([term, description], index) => (
              <div key={term}><span>0{index + 1}</span><dt>{term}</dt><dd>{description}</dd></div>
            ))}
          </dl>
        </section>

        <section className="reading-room">
          <div className="reading-heading" data-reveal><p className="museum-kicker"><span>READING ROOM</span> WHO USES THE RECORD</p><h2>One artifact.<br />Different questions.</h2></div>
          <div className="reader-list" data-reveal>
            {audiences.map((audience, index) => <article key={audience.label}><span>0{index + 1}</span><h3>{audience.label}</h3><p>{audience.text}</p></article>)}
          </div>
        </section>

        <section className="museum-closing">
          <div className="closing-sculpture" aria-hidden="true"><span /><span /><i /></div>
          <div className="museum-closing-copy" data-reveal>
            <p className="museum-kicker">THE RECORD REMAINS</p>
            <h2>Make the action<br />inspectable.</h2>
            <div className="museum-actions"><Link className="museum-button blue" to="/app">Enter console <span>→</span></Link><Link className="museum-link" to="/app/api">Read the API <span>↗</span></Link></div>
          </div>
          <footer><MuseumMark /><span>Independent execution evidence for EVM agents.</span><span>© {new Date().getFullYear()}</span></footer>
        </section>
      </main>
    </div>
  )
}
