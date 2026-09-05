export const sectionLinks = [
  ['Collection', 'archive'],
  ['Provenance', 'provenance'],
  ['Receipt', 'object'],
  ['Boundaries', 'boundary'],
] as const

export const proofSequence = [
  {
    number: '01',
    title: 'Define',
    body: 'Write the exact chain, participants, asset, amount, validity window and constraints before execution.',
  },
  {
    number: '02',
    title: 'Commit',
    body: 'Canonicalize that intent into a stable hash that cannot quietly change after the fact.',
  },
  {
    number: '03',
    title: 'Observe',
    body: 'Read an identified EVM transaction from the configured chain source, preserving uncertainty and finality.',
  },
  {
    number: '04',
    title: 'Bind',
    body: 'Compare authorization with observation and explain the result through durable reason codes.',
  },
  {
    number: '05',
    title: 'Verify',
    body: 'Issue a signed receipt that can be downloaded and checked independently of RunProof.',
  },
] as const

export const audiences = [
  {
    label: 'Agent builders',
    text: 'Give an automated system explicit limits, then retain a checkable record of what followed.',
  },
  {
    label: 'Treasury teams',
    text: 'Connect a pre-approved instruction to an observed on-chain execution without handing RunProof a wallet.',
  },
  {
    label: 'Auditors',
    text: 'Inspect signed claims, binding logic and reason codes instead of reconstructing intent from scattered logs.',
  },
] as const

export const boundaries = [
  ['A valid receipt proves', 'The issuer signed the claims contained in that receipt.'],
  ['It does not prove', 'Economic safety, token legitimacy, or that an RPC source is infallible.'],
  ['RunProof never needs', 'Custody of assets, a connected wallet, or transaction-signing keys.'],
] as const

export const receiptLines = [
  ['intentHash', 'sha256:7ce8…d41a'],
  ['executionHash', 'sha256:921f…8b0c'],
  ['outcome', 'COMPLETED'],
  ['binding', 'BOUND'],
  ['algorithm', 'Ed25519'],
] as const
