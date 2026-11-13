import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import './solutions-page.css'
import '../landing/landing.css'

function PublicMark() {
  return <Link className="museum-mark" to="/" aria-label="PriorSeal home"><span className="museum-mark__symbol"><PriorSealMark /></span><span className="museum-mark__name">PriorSeal<small>Verified Action</small></span></Link>
}

const paths = [
  {
    index: '01',
    eyebrow: 'FLAGSHIP / INSIGHT + PRIORSEAL',
    title: 'Trusted Agent Execution',
    copy: 'For one consequential treasury, wallet or trading action where the decision input, human authority and observed outcome must all remain inspectable.',
    steps: ['Insight assessment', 'Integrator-owned gate', 'Bounded authorization', 'Observed execution', 'Independent review'],
    action: 'Explore the controlled workflow',
    to: '/app/develop',
  },
  {
    index: '02',
    eyebrow: 'STANDALONE / PRIORSEAL',
    title: 'Verified Action',
    copy: 'For an Agent-involved onchain action that needs an explicit before-and-after record without making PriorSeal the signer, executor or custodian.',
    steps: ['Agent proposal', 'Principal approval', 'Time evidence', 'Execution match', 'Portable receipt'],
    action: 'Run one Verified Action',
    to: '/app/quickstart',
  },
  {
    index: '03',
    eyebrow: 'STANDALONE / INSIGHT',
    title: 'Decision intelligence',
    copy: 'For an application that needs oracle transparency, simulation or risk intelligence before it decides whether to present an action for approval.',
    steps: ['Inspect inputs', 'Assess risk', 'Publish decision evidence', 'Apply your policy', 'Retain the assessment'],
    action: 'Explore Insight',
    href: 'https://www.oracleinsight.xyz/',
  },
] as const

const roles = [
  { title: 'Wallet & Agent teams', copy: 'Give an Agent a legible proposal and one explicit approval boundary. Keep signing and submission infrastructure in the system you already operate.' },
  { title: 'High-value operations', copy: 'Start with a single payment, swap, lending or treasury route. Bring the decision input, the approver and the reviewer into one evidence trail.' },
  { title: 'Reviewers & counterparties', copy: 'Receive portable artifacts instead of dashboard screenshots. Verify signed claims with independently selected keys and preserve uncertainty.' },
] as const

export function SolutionsPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  return <div className="priorseal-museum solutions-public">
    <header className="museum-nav">
      <PublicMark />
      <nav className={menuOpen ? 'is-open' : ''} aria-label="Solutions navigation" id="solutions-navigation"><Link to="/" onClick={() => setMenuOpen(false)}>Product</Link><Link to="/capabilities" onClick={() => setMenuOpen(false)}>Capabilities</Link><Link to="/integrations/mcp" onClick={() => setMenuOpen(false)}>MCP integration</Link><Link to="/support" onClick={() => setMenuOpen(false)}>Support</Link></nav>
      <button className="museum-nav__menu" type="button" aria-controls="solutions-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? 'Close' : 'Menu'} <span aria-hidden="true">{menuOpen ? '×' : '+'}</span></button>
      <Link className="museum-nav__entry" to="/app">Open console <span>↗</span></Link>
    </header>
    <main id="main-content">
      <section className="solutions-hero">
        <div><p className="museum-kicker">PRIORSEAL / SOLUTIONS</p><h1 data-route-heading tabIndex={-1}>Choose the<br /><em>outcome</em>,<br />not four tools.</h1></div>
        <div className="solutions-hero__copy"><p>Every offer preserves a clear boundary between intelligence, authority, execution and review. Select the smallest path that solves the action you need to make trustworthy.</p><Link className="museum-button" to="/app/quickstart">Start with one action <span>→</span></Link></div>
      </section>

      <section className="solution-register" aria-labelledby="solution-register-title">
        <header><div className="museum-section-id"><span>01</span><p>Product paths</p></div><div><p className="museum-kicker">ONE PORTFOLIO / THREE OFFERS</p><h2 id="solution-register-title">Start where<br />the responsibility sits.</h2></div></header>
        <div className="solution-register__list">
          {paths.map((path) => <article key={path.title}>
            <span className="solution-register__index">{path.index}</span>
            <div><p className="museum-kicker">{path.eyebrow}</p><h3>{path.title}</h3><p>{path.copy}</p></div>
            <ol aria-label={`${path.title} path`}>{path.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}</ol>
            {'to' in path ? <Link className="museum-text-link" to={path.to}>{path.action} <span>→</span></Link> : <a className="museum-text-link" href={path.href} target="_blank" rel="noreferrer">{path.action} <span>↗</span></a>}
          </article>)}
        </div>
      </section>

      <section className="solution-roles">
        <header><p className="museum-kicker">DESIGNED FOR A SINGLE HIGH-VALUE PATH</p><h2>Same action.<br /><em>Different responsibility.</em></h2></header>
        <div>{roles.map((role, index) => <article key={role.title}><span>0{index + 1}</span><h3>{role.title}</h3><p>{role.copy}</p></article>)}</div>
      </section>

      <section className="solution-boundary">
        <div><p className="museum-kicker">THE OPERATING MODEL</p><h2>Evidence does not<br />replace enforcement.</h2></div>
        <div><p>PriorSeal can establish a bounded authorization, record configured prior-proof evidence, observe an execution and produce a portable receipt. It does not route or block a transaction by itself.</p><p>When a deployment requires an Insight assessment or a PriorSeal authorization before execution, the wallet, Safe, policy service or Agent runtime must enforce those requirements on the submission path it owns.</p><Link className="museum-button" to="/app/develop">Design the integration <span>→</span></Link></div>
      </section>
    </main>
  </div>
}
