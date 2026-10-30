import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'

const contact = 'contact@priorseal.xyz'

export function PublicTermsPage() {
  return <main id="main-content" className="public-document">
    <header className="public-document__nav"><Link className="logo" to="/" aria-label="PriorSeal home"><span className="logo-symbol"><PriorSealMark /></span><span className="logo-type">PriorSeal<small>Authority Evidence</small></span></Link><Link to="/support">Contact →</Link></header>
    <article>
      <p className="eyebrow">PUBLIC SERVICE TERMS &amp; RISK / 001</p>
      <h1 data-route-heading tabIndex={-1}>Bounded service.<br />User control.</h1>
      <p className="public-document__lede">These public pilot terms describe the current PriorSeal service boundary. They are deliberately narrower than a brokerage, custody, exchange, investment-advice or autonomous-trading service.</p>

      <section><h2>What PriorSeal provides</h2><p>PriorSeal helps an application or Agent prepare one bounded action, present the exact review, retain the principal’s confirmation, and preserve evidence afterward. The service is operated by YuTao Peng under the PriorSeal name. Questions about the service go to <a href={`mailto:${contact}`}>{contact}</a>.</p><p>PriorSeal does not hold customer assets, request a transaction-signing key, choose an investment, guarantee token safety, price, route availability, settlement or profit. A receipt establishes only the authorization and observation claims it contains.</p></section>
      <section><h2>Your wallet and decision</h2><p>You remain responsible for reviewing the exact input amount, output floor, slippage, fees, expiry, wallet prompts and transaction details before signing. Your wallet remains the signer and network-fee payer. An Agent proposal is context, not investment advice or a guarantee of quality. If an outcome is unknown, observe the original signature; do not create a replacement action or ask support to do so.</p></section>
      <section><h2>Risks you accept</h2><p>Digital-asset transactions can be irreversible and may fail, be delayed, be front-run, settle at an unfavorable price, or interact with unavailable third-party infrastructure. Token, smart-contract, wallet, network, routing, price, liquidity, tax and regulatory risks remain yours. Do not use the service where its use is prohibited or where you cannot independently assess the action.</p></section>
      <section><h2>Service credits, payments and refunds</h2><p>PriorSeal is currently offered through scoped design-partner pilots. General public self-service payment, x402 receipt-bundle purchase and self-service credit claims are not yet open. A displayed technical capability, reference price or development route is not an offer to purchase and does not grant execution authority. Any pilot fee, delivery scope and support commitment are agreed in writing before service begins.</p><p>YuTao Peng is the manual refund decision owner for an agreed pilot. There is no automatic refund path for an onchain payment, network fee, completed service route or market outcome. Documented duplicate charges, billing errors and paid-but-undelivered PriorSeal service are reviewed through <a href={`mailto:${contact}?subject=Billing%20%2F%20PriorSeal`}>{contact}</a>. Any approved refund is returned only after the payment reference and service record are reviewed.</p></section>
      <section><h2>Availability and changes</h2><p>PriorSeal is a public online service and may be paused or changed to protect users or maintain service integrity. PriorSeal will publish material changes to this page before applying them to a newly presented paid service. Do not use the service where you cannot independently assess the action or where use is prohibited. PriorSeal does not custody assets, execute a trade, choose a route, or sign for a user.</p></section>
      <section><h2>Contact</h2><p>For support, security, privacy, billing or service access, email <a href={`mailto:${contact}`}>{contact}</a>. Never send credentials, secret phrases, private keys or raw signed payloads by email.</p></section>

      <footer><Link to="/privacy">Privacy and storage</Link><span>Effective 31 October 2026</span></footer>
    </article>
  </main>
}
