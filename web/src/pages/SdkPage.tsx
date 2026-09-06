import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, CopyButton, Notice, PageHeader, Status } from '../components'
import { api } from '../lib/api'

const install = 'npm install priorseal-sdk'

const browserExample = `import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({
  baseUrl: 'https://priorseal.example'
})

const { accepted } = await priorseal.authorizeWithWallet({
  intent,
  principal: { type: 'user', id: 'user:42' },
  delegate: {
    agentId: 'agent:treasury',
    executor: intent.sender
  }
}, window.ethereum)

// Your agent submits the transaction separately.
const evidence = await priorseal.observeExecution({
  authorizationId: accepted.authorization.authorizationId,
  chainId: Number(intent.chainId),
  txHash,
  confirmations: 12
})

console.log(evidence.receipt)`

const nodeExample = `import { createPriorSealClient } from 'priorseal-sdk'

const priorseal = createPriorSealClient({
  baseUrl: process.env.PRIORSEAL_URL
})

const prepared = await priorseal.prepareAuthorization(draft)
// Return prepared.typedData to your trusted signing surface.

const accepted = await priorseal.acceptAuthorization({
  ...prepared.authorization,
  signature
})

const evidence = await priorseal.observeExecution({
  authorizationId: accepted.authorization.authorizationId,
  chainId: 8453,
  txHash,
  confirmations: 12
})`

const verificationExample = `const registry = await priorseal.getKeyRegistry()
const receipt = await priorseal.getReceipt(receiptId)

// Convenience server check; independent verification remains local.
const result = await priorseal.verifyReceiptRemotely(receipt)

console.log({ registry, result })`

type Runtime = { state: 'checking' | 'ready' | 'offline'; version?: string; protocols?: number }

export function SdkPage() {
  const [target, setTarget] = useState<'browser' | 'node'>('browser')
  const [runtime, setRuntime] = useState<Runtime>({ state: 'checking' })
  const example = useMemo(() => target === 'browser' ? browserExample : nodeExample, [target])

  useEffect(() => {
    let active = true
    api.version().then((result) => { if (active) setRuntime({ state: 'ready', version: result.version, protocols: result.protocol.length }) }).catch(() => { if (active) setRuntime({ state: 'offline' }) })
    return () => { active = false }
  }, [])

  return <AppShell>
    <PageHeader eyebrow="TYPESCRIPT SDK" title="Integrate the evidence loop." actions={<CopyButton value={install} label="Copy install command" />}>One typed client prepares authority, collects the wallet signature, observes execution and retrieves portable receipts. It never submits a transaction or receives a transaction-signing key.</PageHeader>

    <section className="sdk-hero panel">
      <div className="sdk-package">
        <p className="eyebrow">PACKAGE / 0.1.0</p>
        <h2>priorseal-sdk</h2>
        <p>Universal ESM · Browser and Node.js 20+ · Zero runtime dependencies</p>
        <div className="sdk-install"><code>{install}</code><CopyButton value={install} /></div>
      </div>
      <div className="sdk-runtime">
        <span>Connected environment</span>
        <Status value={runtime.state === 'ready' ? 'READY' : runtime.state === 'checking' ? 'CHECKING' : 'OFFLINE'} />
        <dl><div><dt>API version</dt><dd>{runtime.version ?? '—'}</dd></div><div><dt>Protocol schemas</dt><dd>{runtime.protocols ?? '—'}</dd></div><div><dt>API base</dt><dd>{api.baseUrl || window.location.origin}</dd></div></dl>
      </div>
    </section>

    <section className="sdk-workbench">
      <div className="sdk-code panel">
        <div className="panel-head"><div><h2>Complete integration</h2><p>Choose the environment that owns your signing interaction.</p></div><div className="sdk-tabs" role="tablist" aria-label="SDK environment"><button className={target === 'browser' ? 'active' : ''} onClick={() => setTarget('browser')}>Browser wallet</button><button className={target === 'node' ? 'active' : ''} onClick={() => setTarget('node')}>Node service</button></div></div>
        <div className="sdk-code-head"><span>{target === 'browser' ? 'browser.ts' : 'agent-service.ts'}</span><CopyButton value={example} /></div>
        <pre>{example}</pre>
      </div>

      <aside className="sdk-sequence">
        {[
          ['01', 'Prepare', 'Canonicalize the intent and receive EIP-712 typed data.'],
          ['02', 'Authorize', 'Collect the user or organization signature on a trusted surface.'],
          ['03', 'Observe', 'Attach the independently submitted EVM transaction hash.'],
          ['04', 'Verify', 'Retrieve the signed receipt and verify it independently.'],
        ].map(([number, title, copy]) => <article className="panel" key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}
      </aside>
    </section>

    <section className="sdk-methods panel">
      <div className="panel-head"><div><h2>Typed surface</h2><p>Explicit methods mirror the stable `/v1` API without exposing transport details.</p></div><Link className="text-link" to="/app/api">Compare raw API →</Link></div>
      <div className="sdk-method-grid">
        {[
          ['prepareAuthorization', 'Build authorization v2 typed data'],
          ['authorizeWithWallet', 'Prepare, sign and accept in one browser flow'],
          ['acceptAuthorization', 'Submit an externally collected signature'],
          ['observeExecution', 'Check an EVM execution against authorization'],
          ['getReceipt', 'Retrieve portable signed evidence'],
          ['getTransparencyEvidence', 'Retrieve the signed log checkpoint and chain'],
          ['getObservationJob', 'Follow automatic finality observation'],
          ['getKeyRegistry', 'Load issuer trust metadata'],
          ['verifyReceiptRemotely', 'Run the convenience API verifier'],
          ['health / readiness / version', 'Inspect deployment availability'],
        ].map(([method, description]) => <div key={method}><code>{method}()</code><span>{description}</span></div>)}
      </div>
    </section>

    <section className="sdk-verify panel">
      <div><p className="eyebrow">VERIFICATION</p><h2>Keep independent verification explicit.</h2><p>The SDK labels server verification as a convenience. Use the local browser verifier or CLI with a trusted issuer key when independent assurance matters.</p><div className="sdk-links"><Link className="button primary" to="/app/verify">Open local verifier</Link><Link className="button secondary" to="/app/quickstart">Run quickstart</Link></div></div>
      <div><div className="sdk-code-head"><span>verification.ts</span><CopyButton value={verificationExample} /></div><pre>{verificationExample}</pre></div>
    </section>

    <Notice tone="info" title="Boundary preserved">The SDK reduces integration work. PriorSeal still observes and verifies evidence only; transaction construction, signing and submission remain with your Agent or wallet infrastructure.</Notice>
  </AppShell>
}
