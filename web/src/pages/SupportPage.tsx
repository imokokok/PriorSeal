import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'

const contact = 'contact@priorseal.xyz'

export function SupportPage() {
  return <main id="main-content" className="public-document">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/app">Open console →</Link></header>
    <article>
      <p className="eyebrow">SUPPORT &amp; SECURITY / 001</p>
      <h1 data-route-heading tabIndex={-1}>Contact PriorSeal.</h1>
      <p className="public-document__lede">Use one accountable contact channel for product help, feedback, privacy requests, security reports, billing questions and service access. PriorSeal does not provide chat-based wallet recovery or transaction execution support.</p>

      <section><h2>Contact</h2><p>Email <a href={`mailto:${contact}`}>{contact}</a>. Use a descriptive subject prefix: <strong>Support</strong>, <strong>Feedback</strong>, <strong>Security</strong>, <strong>Privacy</strong>, <strong>Billing</strong>, or <strong>Access</strong>. The initial response target for non-emergency requests is two business days.</p></section>
      <section id="feedback"><h2>Product feedback</h2><p>For a clarity, usability or documentation observation, email <a href={`mailto:${contact}?subject=Feedback%20%E2%80%94%20PriorSeal`}>{contact}</a> with the screen or step, the expected outcome and a redacted description. For public open-source discussion, open a <a href="https://github.com/imokokok/PriorSeal/issues/new" target="_blank" rel="noreferrer">redacted PriorSeal issue</a>. Do not send a seed phrase, private key, wallet address, transaction signature or payload, Agent credential, customer data, or confidential commercial information.</p></section>
      <section><h2>Security and unknown outcomes</h2><p>For suspected account compromise, credential exposure, unsafe route behavior, or an unknown transaction outcome, write <strong>Security</strong> in the subject. Include only a public transaction signature, receipt ID, approximate time and a redacted description. Do not send a seed phrase, private key, raw signed transaction, wallet signature, Agent credential, payment signature or recovery phrase. PriorSeal will never ask for them.</p></section>
      <section><h2>Billing and refunds</h2><p>Public x402 receipt-bundle payment and self-serve Base USDC credit claims are available. Use <strong>Billing</strong> for a duplicate charge, an apparent service-delivery failure, or an Agent-credit question. A request must include the public payment or receipt reference, not a secret. YuTao Peng reviews documented duplicate charges, billing mistakes and paid-but-undelivered service manually; PriorSeal does not promise an automatic refund for consumed service, network fees, market losses, or a user-signed action.</p></section>
      <section><h2>Privacy requests</h2><p>Use <strong>Privacy</strong> to request access, correction or deletion review for server-side information. Local evidence can be deleted immediately from the Privacy and storage page. Server-side deletion requests are evaluated against evidence integrity, security, fraud prevention and applicable retention obligations; do not email sensitive wallet material to prove ownership.</p></section>
      <section><h2>Service access</h2><p>Public receipt-bundle export is available through x402. Agent service credits can be claimed after an eligible Base USDC payment or issued by the operator. Use <strong>Support</strong> to report a capability mismatch. The contact channel cannot approve an action, widen a route limit, sign for a user, or resubmit an unknown transaction.</p></section>

      <footer><Link to="/">← Return to PriorSeal</Link><span>Effective 21 October 2026</span></footer>
    </article>
  </main>
}
