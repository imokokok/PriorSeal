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
    body: 'An Agent or application proposes an exact chain action, including its executor, recipient, asset, amount, validity window and any constrained call fields.',
  },
  {
    number: '02',
    title: 'Authorize',
    body: 'A user or organization reviews and approves the canonical intent with EIP-712, ERC-1271, or a supported Solana authorization.',
  },
  {
    number: '03',
    title: 'Timestamp',
    body: 'Use independent time evidence: an RFC 3161 timestamp, witness quorum, or EVM anchor. Issuer-only acceptance has a narrower proof scope.',
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
    body: 'Export a signed receipt and check it with independently confirmed keys. Some proof modes require additional chain-state checks.',
  },
] as const

export const audiences = [
  {
    label: 'Agent builders',
    text: 'Give an Agent enough authority to prepare and execute one bounded action, without giving it a blank check.',
  },
  {
    label: 'Wallets & trading apps',
    text: 'Embed a human-readable confirmation boundary before an Agent-mediated onchain action reaches a wallet.',
  },
  {
    label: 'Users & reviewers',
    text: 'Retain a portable record of what an Agent proposed, what a principal authorized, and what was observed afterward.',
  },
] as const

export const boundaries = [
  ['Artifact integrity & authority', 'CAN ESTABLISH', 'Local verification can recompute the receipt and check its signatures against independently selected trust. It establishes only the claims covered by those artifacts and keys.'],
  ['Cross-evidence binding', 'CAN ESTABLISH', 'A signed context commitment can bind an exact external digest. A supported review can match oracle assessments from Insight or other external evidence without merging trust roots or business semantics.'],
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
