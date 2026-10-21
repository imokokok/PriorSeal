import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorSealMark } from '../brand'
import './monad-proof.css'

const proof = {
  network: 'Monad · eip155:143',
  principal: '0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC',
  contract: '0xDAb872732036Da9bE8b289A2fa4EeDED28421bF1',
  deploymentTx: '0x584eeaf5e06abf6e7bc984ad05d95f2b22b1226352f716d3169dc7131ac07147',
  callTx: '0x00d3069038aa03bbe14d5f181a6707167ff836bc230efd5cdb980f1f6ac2b338',
  runId: '0xaebe478f81fefa75a08777ed8c08ecbc6a81bd11e6b7141f9dd131902f5a9b96',
} as const

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="monad-proof__value">
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

function Brand() {
  return <Link className="monad-proof__brand" to="/" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
}

export function MonadProofPage() {
  return (
    <div className="monad-proof">
      <header className="monad-proof__nav">
        <Brand />
        <nav aria-label="Primary navigation">
          <Link to="/">Overview</Link>
          <Link to="/swap">Swap</Link>
          <Link to="/integrations/mcp">MCP</Link>
          <a href="https://github.com/imokokok/PriorSeal" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
        <Link className="monad-proof__console" to="/app">Open console <span>↗</span></Link>
      </header>

      <main id="main-content">
        <section className="monad-proof__hero">
          <div>
            <p className="monad-proof__kicker">MONAD / TECHNICAL CASE RECORD / 001</p>
            <p className="monad-proof__status"><span /> VERIFIED EXACT CALL</p>
            <h1 data-route-heading tabIndex={-1}>Authorization{' '}<br />became <em>evidence.</em></h1>
            <p className="monad-proof__lede">A public, zero-native-value Monad run: a principal signed one time-bounded PriorSeal authorization, then made one exact call. The call emitted the expected event and was checked against its authorized scope.</p>
            <div className="monad-proof__actions"><a href="#evidence">Read the evidence <span>↓</span></a><a href="#boundary">Read the boundary <span>↓</span></a></div>
          </div>

          <aside className="monad-proof__receipt" aria-label="Monad technical proof summary">
            <header><span>PRIORSEAL / MONAD PING</span><b>RECORDED</b></header>
            <div className="monad-proof__receipt-main"><span>Run ID</span><code>{proof.runId}</code></div>
            <dl>
              <div><dt>Network</dt><dd>{proof.network}</dd></div>
              <div><dt>Native value</dt><dd>0 MON</dd></div>
              <div><dt>Deployment nonce</dt><dd>0</dd></div>
              <div><dt>Exact-call nonce</dt><dd>1</dd></div>
            </dl>
            <footer><span>RUN RECORDED</span><b>✓</b></footer>
          </aside>
        </section>

        <section className="monad-proof__strip" aria-label="What this record establishes"><span>01 · PRINCIPAL-SIGNED SCOPE</span><span>02 · EXACT ZERO-VALUE CALL</span><span>03 · OBSERVED EVENT</span><span>04 · READ-ONLY VERIFICATION</span></section>

        <section className="monad-proof__record" id="evidence">
          <header>
            <p className="monad-proof__kicker">PUBLIC RECORD</p>
            <h2>One bounded action,<br /><em>with receipts.</em></h2>
            <p>These are the public identifiers of the completed technical run. Copy them into a Monad RPC or explorer to inspect the corresponding on-chain transactions and event independently.</p>
          </header>
          <div className="monad-proof__values">
            <CopyValue label="Principal / executor" value={proof.principal} />
            <CopyValue label="Deployed contract" value={proof.contract} />
            <CopyValue label="Deployment transaction" value={proof.deploymentTx} />
            <CopyValue label="Exact-call transaction" value={proof.callTx} />
            <CopyValue label="Recorded run ID" value={proof.runId} />
          </div>
        </section>

        <section className="monad-proof__sequence">
          <header><p className="monad-proof__kicker">THE PROOF SEQUENCE</p><h2>Not “an agent did it.”<br /><em>Exactly this was allowed.</em></h2></header>
          <ol>
            <li><span>01</span><div><h3>Bound the authority</h3><p>The principal signed an EIP-712 PriorSeal authorization restricted to one contract, one calldata hash, zero native value, one nonce, one use, and a short time window.</p></div><b>BEFORE</b></li>
            <li><span>02</span><div><h3>Execute the exact call</h3><p>The same principal deployed the minimal Ping contract and called <code>record(bytes32)</code>. The contract refuses native value and accepts no token approval or transfer path.</p></div><b>ON MONAD</b></li>
            <li><span>03</span><div><h3>Match the observation</h3><p>The verifier matched sender, nonce, target, calldata, zero value, mined receipts, code, and the emitted <code>RunRecorded(runId, caller)</code> event against the prepared scope.</p></div><b>AFTER</b></li>
          </ol>
        </section>

        <section className="monad-proof__verification">
          <div>
            <p className="monad-proof__kicker">LOCAL VERIFIER RESULT</p>
            <h2>Four claims,<br /><em>all constrained.</em></h2>
            <p>The repository’s read-only verifier recorded these results for this run. It reads chain data; it does not broadcast or alter a transaction.</p>
          </div>
          <ul>
            <li><span>signatureValid</span><b>true</b><p>The evidence holder’s EIP-712 authorization was valid for its named principal and time window.</p></li>
            <li><span>exactCallMatched</span><b>true</b><p>The observed destination, calldata, nonce, sender, and value matched the authorization.</p></li>
            <li><span>zeroNativeValue</span><b>true</b><p>Both deployment and exact call carried zero MON as transaction value.</p></li>
            <li><span>runRecordedEventMatched</span><b>true</b><p>The expected run ID and caller appeared in the contract’s emitted event.</p></li>
          </ul>
        </section>

        <section className="monad-proof__boundary" id="boundary">
          <div><p className="monad-proof__kicker">SCOPE, NOT HYPE</p><h2>This is a capability proof.<br /><em>Not a financial claim.</em></h2></div>
          <div>
            <p>The case record proves a principal-controlled, zero-value, exact-call evidence flow on Monad. It does not claim an Insight market assessment, x402 settlement, token safety, economic safety, investment result, production custody, or permission for autonomous trading.</p>
            <p>For a financial agent action, Insight and PriorSeal stay separate but connected: Insight evaluates the bounded request; PriorSeal binds the accepted scope to the one authorized execution and preserves evidence afterward.</p>
            <div className="monad-proof__boundary-links"><Link to="/">Explore PriorSeal <span>↗</span></Link><Link to="/swap">See a constrained swap flow <span>↗</span></Link></div>
          </div>
        </section>

        <section className="monad-proof__chinese">
          <p className="monad-proof__kicker">中文说明</p>
          <h2>这是一次零金额的 Monad 精确调用实证。</h2>
          <p>它证明“明确授权 → 固定调用 → 链上事件 → 可验证证据”的闭环，而不是价格判断、投资建议、x402 收款或资产安全背书。真正的金融动作还需要独立的 Insight 风险判断，以及更严格的金额、资产、协议和付款边界。</p>
        </section>
      </main>
    </div>
  )
}
