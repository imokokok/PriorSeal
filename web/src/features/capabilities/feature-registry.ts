import type { Capabilities } from '../../lib/api'

export const executionProfile = {
  standardAuthorization: 'priorseal.intent.v1',
  exactEvmCall: 'priorseal.execution-profile.exact-call.v1',
} as const

export type CapabilityFeature = {
  id: 'standard-authorization' | 'exact-evm-call' | 'portable-verification' | 'execution-observation'
  title: string
  label: string
  description: string
  useCase: string
  establishes: string
  doesNotEstablish: string
  to: string
  action: string
  executionProfile?: string
  layer: 'Seal' | 'Match' | 'Review'
  isPublished?: (capabilities: Capabilities) => boolean
}

export const verifiedActionLayers = [
  { id: 'seal', label: 'Seal', title: 'Bounded authorization', copy: 'Define the exact action boundary and collect one principal-controlled authorization.', boundary: 'It does not submit an action.' },
  { id: 'witness', label: 'Witness', title: 'Pre-execution proof', copy: 'Record that the authorization existed before execution through the deployment’s configured proof mode.', boundary: 'Proof mode and assurance remain deployment-specific.' },
  { id: 'match', label: 'Match', title: 'Execution verification', copy: 'Compare the observed execution with supported fields in the signed authorization.', boundary: 'Observation alone is not authorization compliance.' },
  { id: 'review', label: 'Review', title: 'Portable evidence', copy: 'Export and locally verify the signed receipt with independently established trust.', boundary: 'A delivered key is discovery data, not its own trust root.' },
] as const

const hasProfile = (profile: string) => (capabilities: Capabilities) => capabilities.executionProfiles.includes(profile)

export const capabilityFeatures: CapabilityFeature[] = [
  {
    id: 'standard-authorization',
    title: 'Bounded authorization',
    label: 'Standard authorization',
    description: 'Create a wallet-signed authorization for an agent, recipient, asset, amount, nonce and time boundary before execution.',
    useCase: 'A transfer-style action needs an explicit, reviewable permission boundary.',
    establishes: 'What a principal authorized within the signed intent.',
    doesNotEstablish: 'That a transaction was submitted, finalized, economically safe or successful.',
    to: '/app/actions/standard',
    action: 'Create authorization',
    layer: 'Seal',
    executionProfile: executionProfile.standardAuthorization,
    isPublished: hasProfile(executionProfile.standardAuthorization),
  },
  {
    id: 'exact-evm-call',
    title: 'Exact EVM call authorization',
    label: 'Exact EVM call',
    description: 'Bind an already constructed EVM transaction by chain, executor, nonce, target, calldata hash and native value.',
    useCase: 'An executor has an exact call envelope that must be independently reviewed before signing.',
    establishes: 'The exact call envelope covered by the authorization.',
    doesNotEstablish: 'Token settlement, output amount, price, slippage or contract safety.',
    to: '/app/actions/exact-call',
    action: 'Import exact call',
    layer: 'Seal',
    executionProfile: executionProfile.exactEvmCall,
    isPublished: hasProfile(executionProfile.exactEvmCall),
  },
  {
    id: 'execution-observation',
    title: 'Observed execution evidence',
    label: 'Observe execution',
    description: 'Pair an accepted authorization with an independently submitted transaction and record the observed outcome as evidence.',
    useCase: 'A signed authorization must be reconciled with a submitted onchain execution.',
    establishes: 'The reported relationship between supported authorization fields and observed execution evidence.',
    doesNotEstablish: 'A right to transact, economic safety or complete application-level business correctness.',
    to: '/app/observe',
    action: 'Observe execution',
    layer: 'Match',
    isPublished: (capabilities) => capabilities.workflowReady && capabilities.chains.length > 0 && hasPublishedAuthorization(capabilities),
  },
  {
    id: 'portable-verification',
    title: 'Portable receipt verification',
    label: 'Verify receipt',
    description: 'Inspect an exported receipt locally with independently selected issuer-key and audience trust.',
    useCase: 'A user, reviewer or downstream system needs to examine evidence outside the issuing service.',
    establishes: 'Artifact integrity and the claims covered by a receipt and independently trusted keys.',
    doesNotEstablish: 'That another system consumed the receipt or that external business claims are true.',
    to: '/app/verify',
    action: 'Open verifier',
    layer: 'Review',
  },
]

export function featureIsPublished(feature: CapabilityFeature, capabilities: Capabilities | null) {
  return Boolean(capabilities && (feature.isPublished?.(capabilities) ?? true))
}

export function publishedCapabilityFeatures(capabilities: Capabilities | null) {
  return capabilityFeatures.filter((feature) => featureIsPublished(feature, capabilities))
}

export function actionCapabilityFeatures(capabilities: Capabilities | null) {
  return capabilityFeatures.filter((feature) => Boolean(feature.executionProfile) && featureIsPublished(feature, capabilities))
}

export function hasPublishedAuthorization(capabilities: Capabilities | null) {
  return actionCapabilityFeatures(capabilities).length > 0
}

export function capabilityFeature(id: CapabilityFeature['id']) {
  return capabilityFeatures.find((feature) => feature.id === id)!
}
