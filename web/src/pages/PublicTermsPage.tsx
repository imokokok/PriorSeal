import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'

const contact = 'contact@priorseal.xyz'

export function PublicTermsPage() {
  return <main id="main-content" className="public-document">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/support">Contact →</Link></header>
    <article>
      <p className="eyebrow">PUBLIC PILOT TERMS &amp; RISK / 001</p>
      <h1 data-route-heading tabIndex={-1}>Bounded service.<br />User control.</h1>
      <p className="public-document__lede">These public pilot terms describe the current PriorSeal service boundary. They are deliberately narrower than a brokerage, custody, exchange, investment-advice or autonomous-trading service.</p>

      <section><h2>What PriorSeal provides</h2><p>PriorSeal helps an application or Agent prepare one bounded action, present the exact review, retain the principal’s confirmation, and preserve evidence afterward. The pilot is operated by YuTao Peng under the PriorSeal name. Questions about the pilot go to <a href={`mailto:${contact}`}>{contact}</a>.</p><p>PriorSeal does not hold customer assets, request a transaction-signing key, choose an investment, guarantee token safety, price, route availability, settlement or profit. A receipt establishes only the authorization and observation claims it contains.</p></section>
      <section><h2>Your wallet and decision</h2><p>You remain responsible for reviewing the exact input amount, output floor, slippage, fees, expiry, wallet prompts and transaction details before signing. Your wallet remains the signer and network-fee payer. An Agent proposal is context, not investment advice or a guarantee of quality. If an outcome is unknown, observe the original signature; do not create a replacement action or ask support to do so.</p></section>
      <section><h2>Risks you accept</h2><p>Digital-asset transactions can be irreversible and may fail, be delayed, be front-run, settle at an unfavorable price, or interact with unavailable third-party infrastructure. Token, smart-contract, wallet, network, routing, price, liquidity, tax and regulatory risks remain yours. Do not use the pilot where its use is prohibited or where you cannot independently assess the action.</p></section>
      <section><h2>Service credits, payments and refunds</h2><p>During the current pilot, Agent credits are issued manually by the operator after a reviewed access request. Public x402 payment acceptance and self-serve credit claims are disabled. Credits pay only for the stated PriorSeal service operation; they are not a wallet, execution mandate, transferable balance, investment product or cash-equivalent.</p><p>YuTao Peng is the manual refund and chargeback decision owner for this pilot. There is no automatic refund path for an onchain payment, network fee, completed route, consumed service or market outcome. Documented duplicate charges, billing errors and paid-but-undelivered PriorSeal service are reviewed through <a href={`mailto:${contact}?subject=Billing%20%2F%20PriorSeal`}>{contact}</a>. Any approved refund is subject to identity, payment-reference, fraud and legal review.</p></section>
      <section><h2>Availability, changes and legal review</h2><p>The pilot is invitation-only and may be limited, paused or changed to protect users, comply with law, or maintain service integrity. PriorSeal will publish material changes to this page before applying them to a newly presented pilot action. Do not use the pilot where it is prohibited or where you cannot independently assess the action. Broader paid public availability requires a separately confirmed operating entity, launch jurisdiction review, payment-control approval and documented Go/No-Go decision.</p></section>
      <section><h2>Contact</h2><p>For support, security, privacy, billing or pilot access, email <a href={`mailto:${contact}`}>{contact}</a>. Never send credentials, secret phrases, private keys or raw signed payloads by email.</p></section>

      <footer><Link to="/privacy">Privacy and storage</Link><span>Effective 21 October 2026</span></footer>
    </article>
  </main>
}
