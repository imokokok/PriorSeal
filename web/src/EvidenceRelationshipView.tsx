import { CodeValue, Notice, Status } from './components'
import type { Receipt } from './types'

type VerificationSummary = { valid: boolean; code: string }
type RelationshipValue = boolean | null

type EvidenceRelationshipViewProps = {
  receipt: Receipt
  verification?: VerificationSummary
  signerTrustConfirmed?: boolean
  relations?: Record<string, RelationshipValue>
}

const ZERO_HASH = `0x${'0'.repeat(64)}`

function relationshipStatus(relations?: Record<string, RelationshipValue>) {
  if (!relations) return 'NOT REVIEWED'
  const values = Object.values(relations)
  if (values.some((value) => value === false)) return 'MISMATCH'
  if (values.length && values.every((value) => value === true)) return 'MATCHED'
  return 'NOT ESTABLISHED'
}

export function EvidenceRelationshipView({ receipt, verification, signerTrustConfirmed = false, relations }: EvidenceRelationshipViewProps) {
  const authorization = receipt.authorizationEvidence?.authorization
  const commitments = authorization?.intent.contextCommitments ?? []
  const policyHash = authorization?.policyHash
  const authorizationHash = receipt.authorizationHash ?? receipt.authorizationEvidence?.acceptance.authorizationHash
  const transactionHash = receipt.execution.txHash
  const stages = [
    {
      label: 'Context',
      title: 'Context commitments',
      status: commitments.length ? 'BOUND' : 'NOT PRESENT',
      value: commitments.length ? `${commitments.length} signed digest${commitments.length === 1 ? '' : 's'} · ${commitments.map((entry) => entry.namespace).join(', ')}` : 'No context commitment in this authorization',
    },
    ...(policyHash ? [{
      label: 'Policy',
      title: policyHash === ZERO_HASH ? 'Default policy hash' : 'Policy hash',
      status: policyHash === ZERO_HASH ? 'DEFAULT' : 'BOUND',
      hash: policyHash,
    }] : []),
    { label: 'Intent', title: 'Intent hash', status: 'RECORDED', hash: receipt.intentHash },
    ...(authorizationHash ? [{ label: 'Authority', title: 'Authorization hash', status: authorization?.signature ? 'SIGNED' : 'RECORDED', hash: authorizationHash }] : []),
    ...(transactionHash ? [{ label: 'Transaction', title: 'Transaction hash', status: receipt.executionStatus ?? receipt.execution.status, hash: transactionHash }] : []),
    { label: 'Execution', title: 'Execution hash', status: receipt.compliance?.status ?? receipt.outcome, hash: receipt.executionHash },
    { label: 'Receipt', title: 'Receipt identifier', status: verification?.valid ? 'LOCALLY VERIFIED' : 'SIGNED CLAIM', value: receipt.receiptId },
  ]
  const cryptographicStatus = verification ? verification.valid ? 'VERIFIED' : verification.code : 'NOT VERIFIED HERE'
  const crossEvidenceStatus = relationshipStatus(relations)

  return <section className="panel evidence-relationship" aria-labelledby="evidence-relationship-title">
    <div className="panel-head"><div><h2 id="evidence-relationship-title">Evidence relationship</h2><p>Each transition keeps its own scope. A matching digest, valid signature, observed execution and compliance result are related claims, not substitutes for one another.</p></div></div>
    <ol className="relationship-chain">
      {stages.map((stage, index) => <li key={`${stage.label}-${stage.title}`}>
        <div className="relationship-stage-heading"><small>{String(index + 1).padStart(2, '0')} · {stage.label}</small><Status value={stage.status} small /></div>
        <strong>{stage.title}</strong>
        {'hash' in stage && stage.hash ? <CodeValue value={stage.hash} /> : <span>{stage.value}</span>}
      </li>)}
    </ol>
    <dl className="relationship-assessments">
      <div><dt>Cryptographic evidence</dt><dd><Status value={cryptographicStatus} small /><p>{verification ? verification.valid ? 'The local verifier recomputed and checked the receipt within its stated scope.' : `Local verification stopped with ${verification.code}.` : 'This page is displaying receipt claims. Run local verification before relying on signatures or hashes.'}</p></dd></div>
      <div><dt>Signer trust</dt><dd><Status value={signerTrustConfirmed ? 'CONFIRMED' : 'NOT ESTABLISHED'} small /><p>{signerTrustConfirmed ? 'The reviewer confirmed the issuer configuration through an independent source.' : 'A key supplied by the receipt, bundle or discovery endpoint cannot establish its own authority.'}</p></dd></div>
      <div><dt>Cross-evidence relationships</dt><dd><Status value={crossEvidenceStatus} small /><p>{crossEvidenceStatus === 'MATCHED' ? 'Every relationship supported by this review profile matched.' : crossEvidenceStatus === 'MISMATCH' ? 'At least one supported relationship did not match.' : 'No complete supported relationship review was established by this evidence.'}</p></dd></div>
      <div><dt>External decision use</dt><dd><Status value="NOT ESTABLISHED" small /><p>PriorSeal does not claim that an external application read a committed field or that every external signer path enforced it.</p></dd></div>
    </dl>
    <Notice tone="warning" title="Binding has a precise limit">A context commitment proves that the signed authorization contains an exact digest. Runtime decision use and signer-path enforcement require separately reviewed integration evidence; they are not inferred from this receipt.</Notice>
  </section>
}
