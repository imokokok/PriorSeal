export const sectionLinks = [
  ['System', 'system'],
  ['Evidence chain', 'chain'],
  ['Receipt', 'receipt'],
  ['Proof scope', 'boundaries'],
] as const

export const proofSequence = [
  {
    number: '01',
    title: 'Propose',
    body: 'The agent defines an exact chain, executor, recipient, asset, amount, validity window and optional call constraints.',
  },
  {
    number: '02',
    title: 'Authorize',
    body: 'A user or organization approves the canonical intent with EIP-712 or ERC-1271 authority.',
  },
  {
    number: '03',
    title: 'Timestamp',
    body: 'An independent RFC 3161 authority proves the authorization digest existed before execution.',
  },
  {
    number: '04',
    title: 'Observe',
    body: 'PriorSeal records an identified EVM transaction while preserving source, finality and uncertainty.',
  },
  {
    number: '05',
    title: 'Bind',
    body: 'Deterministic rules compare signed authority with observed execution and return durable reason codes.',
  },
  {
    number: '06',
    title: 'Verify',
    body: 'The complete evidence chain leaves PriorSeal as a signed receipt that can be checked locally.',
  },
] as const

export const audiences = [
  {
    label: 'Agent builders',
    text: 'Prove that an automated execution stayed inside the authority it was given.',
  },
  {
    label: 'Treasury teams',
    text: 'Retain a portable record connecting organizational approval to one observed EVM transaction.',
  },
  {
    label: 'Auditors',
    text: 'Recompute authorization, timing, binding and signatures without trusting the PriorSeal service.',
  },
] as const

export const boundaries = [
  ['Artifact integrity & authority', 'CAN ESTABLISH', 'Local verification can recompute the receipt and check its signatures against independently selected trust. It establishes only the claims covered by those artifacts and keys.'],
  ['Cross-evidence binding', 'CAN ESTABLISH', 'A signed context commitment can bind an exact external digest. A supported review can match related artifacts without merging their trust roots or business semantics.'],
  ['Observed execution & compliance', 'CAN ESTABLISH', 'PriorSeal can correlate an observed EVM transaction with signed constraints and report execution state separately from authorization compliance.'],
  ['External decision use', 'SEPARATE EVIDENCE', 'A commitment does not prove that another application read a decision or placed every signer path behind it. That requires separately reviewed integration evidence.'],
] as const

export const receiptLines = [
  ['authorization', 'auth_5e91…c20a'],
  ['authorizer', 'eip712 / 0x71…09f4'],
  ['timestamp', 'RFC 3161 / VERIFIED'],
  ['execution', 'eip155:8453 / 0xa8…d120'],
  ['binding', 'BOUND / 0 exceptions'],
  ['outcome', 'COMPLETED'],
] as const
