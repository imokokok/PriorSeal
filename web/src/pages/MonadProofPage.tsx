import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import './monad-proof.css'

const monadReference = {
  principal: '0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC',
  contract: '0xDAb872732036Da9bE8b289A2fa4EeDED28421bF1',
  deploymentTx: '0x584eeaf5e06abf6e7bc984ad05d95f2b22b1226352f716d3169dc7131ac07147',
  callTx: '0x00d3069038aa03bbe14d5f181a6707167ff836bc230efd5cdb980f1f6ac2b338',
  runId: '0xaebe478f81fefa75a08777ed8c08ecbc6a81bd11e6b7141f9dd131902f5a9b96',
} as const

const proofCases = [
  { index: '01', title: 'Configured EVM', scope: 'Configured EIP-155 networks', copy: 'One exact EVM call can bind chain, executor, nonce, target, calldata hash and native value. A deployment publishes only the EVM networks whose RPC and proof inputs are configured.' },
  { index: '02', title: 'Solana message', scope: 'Compiled message / confirmed observation', copy: 'A Solana mainnet-beta authorization can bind the complete compiled legacy, v0 or v1 transaction message before its confirmed observation.' },
  { index: '03', title: 'Selected venues', scope: 'Explicit profile / venue scope', copy: 'Venue-specific profiles can bind their own bounded objects, such as a Hyperliquid spot IOC order and its matching fills. They remain separate from generic EVM claims.' },
  { index: '04', title: 'Advanced accounts', scope: 'Explicit deployment activation', copy: 'ERC-4337, Safe 4337 and EIP-7702 need separately pinned contracts, code hashes and deployment configuration. They are never implied by basic chain support.' },
] as const

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { setCopied(false) }
  }
  return <div className="monad-proof__value"><span>{label}</span><code>{value}</code><button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? 'Copied' : 'Copy'}</button></div>
}

function Brand() {
  return <Link className="monad-proof__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
}

/** Kept at its historical module name so existing lazy imports remain stable. */
export function MonadProofPage() {
  return <div className="monad-proof">
    <header className="monad-proof__nav"><Brand /><nav aria-label="Primary navigation"><Link to="/">Overview</Link><Link to="/solutions">Solutions</Link><Link to="/capabilities">Capabilities</Link><Link to="/integrations/mcp">MCP</Link></nav><Link className="monad-proof__console" to="/app">Open console <span>↗</span></Link></header>
    <main id="main-content">
      <section className="monad-proof__hero"><div><p className="monad-proof__kicker">TECHNICAL PROOF CASES / CONFIGURATION-GATED</p><p className="monad-proof__status"><span /> CHAIN-NEUTRAL CORE / DEPLOYMENT-SCOPED</p><h1 data-route-heading tabIndex={-1}>One protocol.<br /><em>Multiple execution environments.</em></h1><p className="monad-proof__lede">PriorSeal is not defined by one chain. It establishes one bounded, independently reviewable action path across configured EVM networks, Solana and selected execution venues—only where the deployment publishes the required authorization, proof and observation inputs.</p><div className="monad-proof__actions"><a href="#cases">See proof cases <span>↓</span></a><a href="#reference">Read a public reference <span>↓</span></a></div></div><aside className="monad-proof__receipt" aria-label="PriorSeal technical proof scope"><header><span>PRIORSEAL / CAPABILITY SCOPE</span><b>CONFIGURED</b></header><div className="monad-proof__receipt-main"><span>Runtime truth</span><code>/v1/capabilities</code></div><dl><div><dt>Authorization</dt><dd>Bounded principal scope</dd></div><div><dt>Proof</dt><dd>Deployment-selected</dd></div><div><dt>Observation</dt><dd>Chain or venue-specific</dd></div><div><dt>Review</dt><dd>Portable signed receipt</dd></div></dl><footer><span>NO IMPLIED COVERAGE</span><b>✓</b></footer></aside></section>
      <section className="monad-proof__strip" aria-label="What every published proof case establishes"><span>01 · CONFIGURED CAPABILITY</span><span>02 · BOUNDED AUTHORIZATION</span><span>03 · OBSERVED EXECUTION</span><span>04 · INDEPENDENT REVIEW</span></section>
      <section className="monad-proof__record" id="cases"><header><p className="monad-proof__kicker">PROOF CASES</p><h2>One evidence model.<br /><em>Different execution forms.</em></h2><p>These are technical profiles, not separate products. A deployment must advertise each profile and its dependencies before a user can prepare an authorization or rely on a receipt.</p></header><div className="monad-proof__case-grid">{proofCases.map((proofCase) => <article key={proofCase.index}><span>{proofCase.index} / {proofCase.scope}</span><h3>{proofCase.title}</h3><p>{proofCase.copy}</p></article>)}</div></section>
      <section className="monad-proof__sequence"><header><p className="monad-proof__kicker">THE COMMON SEQUENCE</p><h2>Not “the chain supports it.”<br /><em>This deployment can prove it.</em></h2></header><ol><li><span>01</span><div><h3>Publish the scope</h3><p>The deployment advertises only its ready chain, profile, proof and observation inputs through its capability document.</p></div><b>BEFORE</b></li><li><span>02</span><div><h3>Bind one authorization</h3><p>A principal signs a time-bounded, single-use scope appropriate to that execution form: an exact call, compiled message or venue-specific order.</p></div><b>BEFORE</b></li><li><span>03</span><div><h3>Observe and match</h3><p>PriorSeal observes the named execution and compares only the fields that the signed profile supports. Uncertainty, failure and unsupported fields remain explicit.</p></div><b>AFTER</b></li></ol></section>
      <section className="monad-proof__verification"><div><p className="monad-proof__kicker">PORTABLE REVIEW</p><h2>Four questions.<br /><em>No chain marketing.</em></h2><p>The local verifier recomputes signed artifacts and exposes any external checks still required. It does not infer a profile merely because a chain name appears in a marketing list.</p></div><ul><li><span>Was authority valid?</span><b>CHECKED</b><p>Signature, time window, principal and explicit authorization scope are assessed from signed evidence.</p></li><li><span>Was ordering established?</span><b>CHECKED</b><p>The receipt records the configured pre-execution proof mode; development issuer-only acceptance has a narrower scope.</p></li><li><span>Did supported fields match?</span><b>CHECKED</b><p>Observation compares the chain- or venue-profile fields explicitly bound before execution.</p></li><li><span>What still needs trust?</span><b>EXPLICIT</b><p>Issuer keys, chain state and external decision evidence remain separately reviewable rather than silently trusted.</p></li></ul></section>
      <section className="monad-proof__boundary" id="reference"><div><p className="monad-proof__kicker">PUBLIC REFERENCE / MONAD</p><h2>One case record.<br /><em>Not the product boundary.</em></h2></div><div><p>Monad remains a useful public exact-call reference: a principal-controlled, zero-value call with a visible on-chain event. It demonstrates the generic EVM profile; it does not make Monad a requirement, preferred chain or claim of universal deployment readiness.</p><p>Use the runtime capability document for the live deployment’s actual scope. Payment rails, advanced profiles and a chain’s presence on this page are never substitutes for that check.</p></div></section>
      <section className="monad-proof__reference-record" aria-labelledby="monad-reference-title"><header><p className="monad-proof__kicker">MONAD / EXACT-CALL REFERENCE</p><h2 id="monad-reference-title">A public record<br /><em>you can inspect.</em></h2><p>These identifiers remain here as one reproducible EVM proof case. Copy them into a Monad RPC or explorer to inspect the public transactions and event independently.</p></header><div className="monad-proof__values"><CopyValue label="Principal / executor" value={monadReference.principal} /><CopyValue label="Deployed contract" value={monadReference.contract} /><CopyValue label="Deployment transaction" value={monadReference.deploymentTx} /><CopyValue label="Exact-call transaction" value={monadReference.callTx} /><CopyValue label="Recorded run ID" value={monadReference.runId} /></div></section>
      <section className="monad-proof__chinese"><p className="monad-proof__kicker">中文说明</p><h2>PriorSeal 是跨执行环境的证据能力，<br />不是 Monad 专用产品。</h2><p>它的通用核心是“明确授权 → 部署配置的预执行证明 → 观察执行 → 可独立验证的收据”。EVM、Solana 和特定交易场所只是不同技术 profile；每个部署必须通过 capabilities 明确公布自己真正配置并可用的范围。</p></section>
    </main>
  </div>
}
