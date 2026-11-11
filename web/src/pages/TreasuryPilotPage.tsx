import { Link } from 'react-router-dom'
import { AppShell, Notice, PageHeader, Status, useDeploymentCapabilities } from '../components'
import '../treasury-pilot.css'

const BASE_CHAIN_ID = 8453
const STANDARD_TRANSFER_PROFILE = 'priorseal.intent.v1'

export function TreasuryPilotPage() {
  const { capabilities, capabilitiesState, capabilitiesError, refreshCapabilities } = useDeploymentCapabilities()
  const baseRpc = capabilities?.chainReadiness?.find((entry) => entry.chainId === BASE_CHAIN_ID)?.rpc
  const standardTransfer = Boolean(capabilities?.executionProfiles.includes(STANDARD_TRANSFER_PROFILE))
  const baseAvailable = Boolean(capabilities?.chains.includes(BASE_CHAIN_ID) && baseRpc !== 'unavailable')
  const independentWitness = Boolean(capabilities && capabilities.proofMode !== 'issuer')
  const ready = Boolean(capabilities?.workflowReady && standardTransfer && baseAvailable && independentWitness)
  const startTarget = '/app/actions/standard?template=base-usdc-treasury'

  return <AppShell>
    <PageHeader eyebrow="PILOT / BASE USDC TREASURY" title="One approved payment. One provable path.">Use this pilot to establish that a bounded Base USDC payment was accepted before execution, matched to the submitted transaction, and exported for independent review.</PageHeader>
    <section className="treasury-pilot-status panel" aria-label="Base USDC treasury pilot readiness">
      <div><span>DEPLOYMENT GATE</span><h2>{capabilitiesState === 'loading' ? 'Checking the pilot path…' : capabilitiesState === 'unavailable' ? 'Pilot readiness is unavailable.' : ready ? 'Base USDC pilot path is configured.' : 'Complete the pilot gate before signing.'}</h2><p>{capabilitiesState === 'unavailable' ? capabilitiesError : 'The console checks only published configuration. Confirm organization policy, recipient allowlists and wallet controls separately.'}</p></div>
      <Status value={capabilitiesState === 'loading' ? 'CHECKING' : ready ? 'CONFIGURED' : capabilitiesState === 'unavailable' ? 'UNAVAILABLE' : 'NEEDS CONFIGURATION'} />
    </section>
    <section className="treasury-pilot-gates" aria-label="Pilot configuration checks">
      <article className="panel"><span>01 / SEAL</span><h2>Base transfer profile</h2><Status value={standardTransfer && baseAvailable ? 'CONFIGURED' : 'UNAVAILABLE'} small /><p>Requires the published transfer profile and a configured Base RPC path.</p></article>
      <article className="panel"><span>02 / WITNESS</span><h2>Independent pre-execution proof</h2><Status value={independentWitness ? 'CONFIGURED' : 'REQUIRED'} small /><p>{independentWitness ? `The deployment publishes ${capabilities?.proofMode}. The signed authorization is accepted before execution.` : 'Issuer acceptance alone is not enough for this external treasury pilot. Configure RFC 3161, witness quorum or an EVM anchor.'}</p></article>
      <article className="panel"><span>03 / MATCH</span><h2>Customer-controlled submission</h2><Status value="SEPARATE" small /><p>PriorSeal never broadcasts or signs the USDC payment. Your organization’s executor submits it, then provides its transaction hash for observation.</p></article>
      <article className="panel"><span>04 / REVIEW</span><h2>Portable receipt</h2><Status value="LOCAL VERIFIER" small /><p>Export the resulting receipt and verify it with independently established issuer-key and audience trust.</p></article>
    </section>
    {capabilitiesState === 'unavailable' && <Notice tone="warning" title="Do not sign from an unknown deployment">Restore the capability response first. The console cannot determine whether this deployment supports the Base USDC pilot.</Notice>}
    {capabilitiesState === 'ready' && !independentWitness && <Notice tone="warning" title="Witness proof is required">The current deployment only publishes issuer acceptance. This template will not request a wallet authorization until an independent Witness proof mode is configured.</Notice>}
    <section className="treasury-pilot-path panel"><div><span>THE PILOT DELIVERY</span><h2>Seal → Witness → Match → Review</h2><p>Start with one recipient, one amount, one execution wallet, one nonce and one validity window. After acceptance, submit the payment through your own controls, match the exact transaction, then hand the portable receipt to a reviewer.</p></div><div className="treasury-pilot-actions">{ready ? <Link className="button primary" to={startTarget}>Start a Base USDC authorization →</Link> : <Link className="button primary" to="/app/quickstart">Review deployment requirements →</Link>}<Link className="button secondary" to="/app/verify">Open local verifier →</Link>{capabilitiesState !== 'loading' && <button className="text-link" type="button" onClick={refreshCapabilities}>Refresh readiness</button>}</div></section>
    <Notice tone="info" title="Explicit boundary">This is a guided evidence workflow, not a treasury-management system. It does not approve organization policy, custody assets, execute payments, establish recipient identity, or prove economic safety.</Notice>
  </AppShell>
}
