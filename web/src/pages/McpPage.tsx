import { Link } from 'react-router-dom'
import { CopyButton } from '../components'
import { PriorSealMark } from '../brand'
import './mcp-page.css'

const endpoint = 'https://priorseal.xyz/mcp'
const config = JSON.stringify({ type: 'streamable-http', url: endpoint }, null, 2)

const toolGroups = [
  { title: 'Read & verify', tone: 'read', detail: 'No business-state change.', tools: ['priorseal_get_capabilities', 'priorseal_get_authorization', 'priorseal_get_observation_job', 'priorseal_get_receipt', 'priorseal_get_evidence_bundle', 'priorseal_verify_receipt'] },
  { title: 'Prepare', tone: 'prepare', detail: 'Returns review and signing material only.', tools: ['priorseal_prepare_authorization', 'priorseal_prepare_controlled_execution'] },
  { title: 'Record a reviewed action', tone: 'record', detail: 'Persists service state; may consume configured Agent credits.', tools: ['priorseal_accept_authorization', 'priorseal_observe_execution'] },
]

const flow = [
  ['01', 'Inspect', 'Read live capabilities before constructing a workflow.'],
  ['02', 'Prepare', 'Prepare the bounded authorization and exact signing payload.'],
  ['03', 'Principal signs', 'A human-controlled principal reviews and signs outside MCP.'],
  ['04', 'Accept', 'Accept that exact signature with an idempotency key.'],
  ['05', 'Execute', 'A separate executor submits only the exact, still-valid action.'],
  ['06', 'Observe & verify', 'Observe the submitted transaction, export evidence, then verify it independently.'],
]

export function McpPage() {
  return <div className="mcp-guide">
    <header className="mcp-guide__nav">
      <Link to="/" className="mcp-guide__brand" aria-label="PriorSeal home"><PriorSealMark /><span>PriorSeal<small>Authority evidence</small></span></Link>
      <nav aria-label="MCP guide navigation"><a href="#connect">Connect</a><a href="#workflow">Workflow</a><a href="#compatibility">Compatibility</a></nav>
      <Link className="mcp-guide__console" to="/app">Open console <span>↗</span></Link>
    </header>

    <main id="main-content">
      <section className="mcp-guide__hero">
        <div>
          <p className="mcp-guide__kicker">PRIORSEAL / REMOTE MCP</p>
          <h1 data-route-heading tabIndex={-1}>Bounded authority,<br /><em>ready for agents.</em></h1>
          <p>Connect an MCP client to prepare principal-reviewed authorizations, record observations of already-submitted actions, and retrieve portable evidence. The server never holds wallet keys, signs for a principal, or broadcasts a transaction.</p>
          <div className="mcp-guide__actions"><a href="#connect">Connect the endpoint <span>↓</span></a><a href="https://registry.modelcontextprotocol.io/v0/servers/io.github.imokokok%2Fpriorseal/versions/0.1.1" target="_blank" rel="noreferrer">View in MCP Registry <span>↗</span></a></div>
        </div>
        <aside className="mcp-guide__endpoint" aria-label="PriorSeal MCP endpoint">
          <div><span>REMOTE ENDPOINT</span><b>STREAMABLE HTTP</b></div>
          <code>{endpoint}</code>
          <dl><div><dt>Protocol</dt><dd>2026-07-28</dd></div><div><dt>Fallback handshake</dt><dd>2025-11-25</dd></div><div><dt>Tools</dt><dd>10</dd></div></dl>
        </aside>
      </section>

      <section className="mcp-guide__connect" id="connect">
        <header><p className="mcp-guide__kicker">01 / CONNECT</p><h2>A remote server,<br />not a wallet.</h2><p>In a client that supports remote Streamable HTTP, create a PriorSeal server with the configuration below. Keep any Agent credit credential in the client’s secret store, never in a prompt or browser page.</p></header>
        <div className="mcp-guide__code"><div><span>priorseal.mcp.json</span><CopyButton value={config} label="Copy configuration" /></div><pre><code>{config}</code></pre><p>Endpoint <code>{endpoint}</code></p></div>
      </section>

      <section className="mcp-guide__tools" aria-labelledby="mcp-tools-heading">
        <header><p className="mcp-guide__kicker">02 / TOOL SURFACE</p><h2 id="mcp-tools-heading">Know what each call can do.</h2><p>Every result includes a stable structured envelope: status, next action, human-signature requirement, broadcast boundary, risk label, and original response data.</p></header>
        <div>{toolGroups.map((group) => <article key={group.title} className={`mcp-guide__tool-group mcp-guide__tool-group--${group.tone}`}><div><span>{group.tone === 'read' ? 'READ ONLY' : group.tone === 'prepare' ? 'HUMAN REVIEW' : 'STATE CHANGE'}</span><h3>{group.title}</h3><p>{group.detail}</p></div><ul>{group.tools.map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul></article>)}</div>
      </section>

      <section className="mcp-guide__workflow" id="workflow">
        <header><p className="mcp-guide__kicker">03 / CONTROLLED EXECUTION</p><h2>One explicit handoff chain.</h2><p><code>priorseal_prepare_controlled_execution</code> returns the reviewed preparation material and this sequence. It does not accept the authorization or execute an action.</p></header>
        <ol>{flow.map(([number, title, description]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
      </section>

      <section className="mcp-guide__boundaries">
        <div><p className="mcp-guide__kicker">OPERATING BOUNDARIES</p><h2>What the integration will not do.</h2></div>
        <ul><li><b>No custody</b><span>No wallet keys, principal signature, or transaction broadcast passes through PriorSeal.</span></li><li><b>No implied permission</b><span>A prepared or accepted authorization never permits an altered, expired, or unmatched action.</span></li><li><b>Explicit state changes</b><span>Acceptance and observation can persist records and consume configured Agent credits; use an idempotency key.</span></li><li><b>Independent evidence</b><span>Download the bundle and verify it using independently established issuer-key trust.</span></li></ul>
      </section>

      <section className="mcp-guide__compatibility" id="compatibility">
        <header><p className="mcp-guide__kicker">04 / COMPATIBILITY EVIDENCE</p><h2>Protocol claims that can be rerun.</h2><p>The release includes a read-only production check, rather than an unqualified claim about any particular client application.</p></header>
        <div className="mcp-guide__proof"><dl><div><dt>Stateless discovery</dt><dd><code>server/discover</code> with MCP 2026-07-28</dd></div><div><dt>Legacy initialization</dt><dd><code>initialize</code> with MCP 2025-11-25</dd></div><div><dt>Tool contract</dt><dd>All 10 tools, annotations and structured capabilities result</dd></div><div><dt>Safety invariant</dt><dd>Read-only proof requests create no authorization, observation or transaction</dd></div></dl><div><a href="https://github.com/imokokok/PriorSeal/blob/main/docs/runbooks/mcp-compatibility-proof.md" target="_blank" rel="noreferrer">Read the proof runbook <span>↗</span></a><a href="https://github.com/imokokok/PriorSeal/blob/main/docs/integrations/priorseal-mcp.md" target="_blank" rel="noreferrer">Read the integration reference <span>↗</span></a></div></div>
      </section>
    </main>
  </div>
}
