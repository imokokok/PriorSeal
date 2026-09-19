import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signEd25519,
} from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeAbiParameters, hashTypedData, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  signReceipt,
} from '../src/index.mjs';
import { signAuthorizationReceipt } from '../src/domain/authorization.mjs';
import { jcsCanonicalBytes } from '../examples/insight-boundaryattest-three-object-v0.2/jcs.mjs';

// All private values in this generator are deterministic fixture-only values.
// They are intentionally unrelated to production or user-controlled keys.
const output = new URL(
  '../examples/insight-boundaryattest-three-object-v0.2/',
  import.meta.url,
);
const insightAccount = privateKeyToAccount(`0x${'4'.repeat(64)}`);
const wrongInsightAccount = privateKeyToAccount(`0x${'5'.repeat(64)}`);
const authorizer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const executor = `0x${'a'.repeat(40)}`;
const target = `0x${'c'.repeat(40)}`;
const otherTarget = `0x${'d'.repeat(40)}`;
const calldata =
  '0x38ed17390000000000000000000000000000000000000000000000000000000000000001';
const calldataHash = keccak256(calldata);
const changedCalldataHash = keccak256('0x1234');
const intentId = 'insight-boundaryattest-8453-0001';
const chainId = 8453;
const transactionNonce = '2048';
const nativeValue = '0';
const sourceAmount = '1000000';
const maxSlippageBps = 50;
const authorizationTime = Date.parse('2026-09-17T03:00:00.000Z') / 1000;
const insightCheckedAt = authorizationTime - 120;
const boundaryDecisionTime = authorizationTime - 90;
const boundaryExportTime = authorizationTime - 30;
const SOURCE_ASSET =
  'eip155:8453/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const DESTINATION_ASSET =
  'eip155:8453/erc20:0x4200000000000000000000000000000000000006';

const INSIGHT_DOMAIN = {
  name: 'Insight Oracle Safety',
  version: '3',
  chainId: 1,
};
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    { name: 'verdict', type: 'string' },
    { name: 'sourceAssetId', type: 'string' },
    { name: 'destinationAssetId', type: 'string' },
    { name: 'subjectChainId', type: 'uint256' },
    { name: 'action', type: 'string' },
    { name: 'tradeAmountUsd', type: 'uint256' },
    { name: 'consensusPrice', type: 'uint256' },
    { name: 'maxDeviationBps', type: 'uint256' },
    { name: 'manipulationRiskBps', type: 'uint256' },
    { name: 'participantCount', type: 'uint256' },
    { name: 'requiredParticipantCount', type: 'uint256' },
    { name: 'coverageStatus', type: 'string' },
    { name: 'independenceStatus', type: 'string' },
    { name: 'sourceGroupCount', type: 'uint256' },
    { name: 'crossProviderAgreementBps', type: 'uint256' },
    { name: 'maxStablecoinDepegBps', type: 'uint256' },
    { name: 'maxDataAgeSeconds', type: 'uint256' },
    { name: 'recommendedMaxPositionUsd', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' },
    { name: 'requestHash', type: 'bytes32' },
    { name: 'evaluationScope', type: 'string' },
    { name: 'evaluatedAssetIdsHash', type: 'bytes32' },
    { name: 'providerObservationsHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
    { name: 'requiredSourceGroupCount', type: 'uint256' },
  ],
};
const CANONICAL_REQUEST_DOMAIN = {
  name: 'Insight Canonical Pre-Trade Request',
  version: '1',
  chainId: 1,
};
const CANONICAL_REQUEST_TYPES = {
  CanonicalPreTradeRequest: [
    { name: 'subjectChainId', type: 'uint256' },
    { name: 'sourceAssetId', type: 'string' },
    { name: 'destinationAssetId', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'tradeAmountUsd', type: 'uint256' },
  ],
};
const INSIGHT_UINT_FIELDS = [
  'subjectChainId',
  'tradeAmountUsd',
  'consensusPrice',
  'maxDeviationBps',
  'manipulationRiskBps',
  'participantCount',
  'requiredParticipantCount',
  'sourceGroupCount',
  'crossProviderAgreementBps',
  'maxStablecoinDepegBps',
  'maxDataAgeSeconds',
  'recommendedMaxPositionUsd',
  'validUntil',
  'checkedAt',
  'schemaVersion',
  'requiredSourceGroupCount',
];

function iso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function seededEd25519(seedByte) {
  const seed = Buffer.from(seedByte.repeat(32), 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  return {
    privateKey,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem,
    fingerprint,
    publicKeyId: `sha256:${fingerprint}`,
  };
}

const boundaryKey = seededEd25519('66');
const wrongBoundaryKey = seededEd25519('77');
const priorSealKey = seededEd25519('88');
const issuer = 'priorseal.insight-boundaryattest-fixture';
const priorSealKeyId = 'priorseal-insight-boundaryattest-ed25519-1';

function canonicalRequestHash({
  sourceAssetId,
  destinationAssetId,
  tradeAmountUsd,
}) {
  return hashTypedData({
    domain: CANONICAL_REQUEST_DOMAIN,
    types: CANONICAL_REQUEST_TYPES,
    primaryType: 'CanonicalPreTradeRequest',
    message: {
      subjectChainId: BigInt(chainId),
      sourceAssetId,
      destinationAssetId,
      action: 'swap',
      tradeAmountUsd: BigInt(tradeAmountUsd),
    },
  });
}

function insightTypedData(data) {
  const message = { ...data };
  for (const field of INSIGHT_UINT_FIELDS) message[field] = BigInt(data[field]);
  return {
    domain: INSIGHT_DOMAIN,
    types: INSIGHT_TYPES,
    primaryType: 'OracleSafetyCheck',
    message,
  };
}

async function makeInsightAttestation({
  account = insightAccount,
  sourceAssetId,
  destinationAssetId,
  checkedAt = insightCheckedAt,
  consensusPrice,
}) {
  const tradeAmountUsd = 50_000_000_000;
  const data = {
    verdict: 'PASS',
    sourceAssetId,
    destinationAssetId,
    subjectChainId: chainId,
    action: 'swap',
    tradeAmountUsd,
    consensusPrice,
    maxDeviationBps: 20,
    manipulationRiskBps: 100,
    participantCount: 4,
    requiredParticipantCount: 3,
    coverageStatus: 'SUFFICIENT',
    independenceStatus: 'ASSESSED',
    sourceGroupCount: 2,
    crossProviderAgreementBps: 9900,
    maxStablecoinDepegBps: 5,
    maxDataAgeSeconds: 12,
    recommendedMaxPositionUsd: 100_000_000_000,
    reasonCodesHash: keccak256(
      encodeAbiParameters([{ type: 'string[]', name: 'reasonCodes' }], [[]]),
    ),
    requestHash: canonicalRequestHash({
      sourceAssetId,
      destinationAssetId,
      tradeAmountUsd,
    }),
    evaluationScope: 'SOURCE_ASSET_ONLY',
    evaluatedAssetIdsHash: keccak256(
      encodeAbiParameters(
        [{ type: 'string[]', name: 'assetIds' }],
        [[sourceAssetId]],
      ),
    ),
    providerObservationsHash: keccak256('0x'),
    validUntil: checkedAt + 600,
    checkedAt,
    schemaVersion: 3,
    requiredSourceGroupCount: 2,
  };
  const args = insightTypedData(data);
  return {
    uid: hashTypedData(args),
    schemaVersion: 3,
    attester: account.address,
    attesterLabel: 'Insight Oracle Safety Attestation',
    signedAt: iso(checkedAt),
    validForSeconds: 600,
    validUntil: data.validUntil,
    signature: await account.signTypedData(args),
    verifyUrl: 'https://www.oracleinsight.xyz/api/v1/safety/attestation/verify',
    data,
    eip712: {
      domain: INSIGHT_DOMAIN,
      types: INSIGHT_TYPES,
      primaryType: 'OracleSafetyCheck',
      canonicalRequestDomain: CANONICAL_REQUEST_DOMAIN,
      canonicalRequestTypes: CANONICAL_REQUEST_TYPES,
      canonicalRequestPrimaryType: 'CanonicalPreTradeRequest',
    },
  };
}

function computeInsightCommitment(source, destination) {
  return {
    namespace: 'insight.pretrade-pair.v1',
    algorithm: 'keccak256',
    digest: keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32', name: 'sourceUid' },
          { type: 'bytes32', name: 'destinationUid' },
          { type: 'bytes32', name: 'sourceRequestHash' },
          { type: 'bytes32', name: 'destinationRequestHash' },
          { type: 'uint16', name: 'maxSlippageBps' },
        ],
        [
          source.uid,
          destination.uid,
          source.data.requestHash,
          destination.data.requestHash,
          maxSlippageBps,
        ],
      ),
    ),
  };
}

function deepMerge(base, patch) {
  if (!patch) return structuredClone(base);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] =
      isPlainObject(result[key]) && isPlainObject(value)
        ? deepMerge(result[key], value)
        : value;
  }
  return result;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function signBoundaryClaim(claim, key = boundaryKey) {
  return {
    claim,
    signature: signEd25519(
      null,
      jcsCanonicalBytes(claim),
      key.privateKey,
    ).toString('base64'),
    public_key_id: key.publicKeyId,
  };
}

function boundaryDigest(receipt) {
  return `0x${createHash('sha256').update(jcsCanonicalBytes(receipt.claim)).digest('hex')}`;
}

function makeBoundaryReceipt(baseClaim, patch, key = boundaryKey) {
  const claim = deepMerge(baseClaim, patch);
  const patchedDecision = patch?.decision_record;
  if (
    patchedDecision?.decision_id &&
    !Object.hasOwn(patchedDecision, 'inputs')
  ) {
    claim.decision_record.inputs = claim.decision_record.inputs.map(
      (input) => ({
        ...input,
        decision_id: patchedDecision.decision_id,
      }),
    );
  }
  if (
    patchedDecision?.decision_id &&
    !Object.hasOwn(patchedDecision, 'adjudication')
  ) {
    claim.decision_record.adjudication.decision_id =
      patchedDecision.decision_id;
  }
  return signBoundaryClaim(claim, key);
}

function contextCommitments(
  insightCommitment,
  boundaryReceipt,
  overrides = {},
) {
  const base = [
    insightCommitment,
    {
      namespace: 'boundaryattest.insight-handoff.jcs-claim.v0.2',
      algorithm: 'sha256',
      digest: boundaryDigest(boundaryReceipt),
    },
    {
      namespace: 'boundaryattest.governance-signer.spki-sha256.v1',
      algorithm: 'sha256',
      digest: `0x${boundaryKey.fingerprint}`,
    },
  ];
  if (overrides.missingBoundary)
    return base.filter(
      (entry) => !entry.namespace.startsWith('boundaryattest.insight-handoff'),
    );
  if (overrides.wrongInsight)
    return base.map((entry) =>
      entry.namespace === 'insight.pretrade-pair.v1'
        ? { ...entry, digest: `0x${'f'.repeat(64)}` }
        : entry,
    );
  if (overrides.wrongBoundary)
    return base.map((entry) =>
      entry.namespace.startsWith('boundaryattest.insight-handoff')
        ? { ...entry, digest: `0x${'e'.repeat(64)}` }
        : entry,
    );
  if (overrides.wrongSigner)
    return base.map((entry) =>
      entry.namespace.startsWith('boundaryattest.governance-signer')
        ? { ...entry, digest: `0x${'d'.repeat(64)}` }
        : entry,
    );
  return base;
}

let receiptCounter = 0;
async function makePriorSealReceipt({
  name,
  insightCommitment,
  boundaryReceipt,
  commitmentOverrides,
  validUntil = authorizationTime + 180,
  executionOverrides,
}) {
  receiptCounter += 1;
  const intent = {
    schema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
    intentId,
    chainId,
    action: 'CONTRACT_CALL',
    asset: SOURCE_ASSET,
    amount: sourceAmount,
    sender: executor,
    recipient: target,
    validUntil,
    nonce: transactionNonce,
    callTarget: target,
    calldataHash,
    transactionValue: nativeValue,
    contextCommitments: contextCommitments(
      insightCommitment,
      boundaryReceipt,
      commitmentOverrides,
    ),
    constraints: { minConfirmations: 12 },
  };
  const nonceHex = receiptCounter.toString(16).padStart(2, '0');
  const draft = buildAuthorization({
    intent,
    principal: {
      type: 'user',
      id: 'insight-boundaryattest-fixture-user',
      account: authorizer.address,
    },
    authorizer: { type: 'eip712', address: authorizer.address },
    delegate: { agentId: 'insight-boundaryattest-fixture-agent', executor },
    issuedAt: authorizationTime,
    notBefore: authorizationTime,
    expiresAt: validUntil,
    authorizationNonce: `0x${nonceHex.repeat(32)}`,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: `0x${'0'.repeat(64)}`,
  });
  const authorization = buildAuthorization({
    ...draft,
    signature: await authorizer.signTypedData(authorizationTypedData(draft)),
  });
  const acceptance = signAuthorizationReceipt(
    buildAuthorizationReceipt({
      authorization,
      issuer,
      keyId: priorSealKeyId,
      acceptedAt: authorizationTime + 1,
    }),
    priorSealKey.privateKeyPem,
  );
  const executedAt = authorizationTime + 60;
  const execution = {
    schema: 'priorseal.execution-observation.v1',
    chainId,
    txHash: `0x${nonceHex.repeat(32)}`,
    status: 'CONFIRMED',
    blockNumber: 33_200_000 + receiptCounter,
    blockHash: `0x${'e'.repeat(64)}`,
    executedAt,
    observedAt: executedAt + 5,
    action: 'CONTRACT_CALL',
    nonce: transactionNonce,
    sender: executor,
    recipient: target,
    target,
    calldataHash,
    asset: SOURCE_ASSET,
    amount: sourceAmount,
    transfers: [],
    transferMatchUnique: false,
    nativeValue,
    tokenValue: null,
    gasUsed: '180000',
    fee: null,
    executionDataAvailable: true,
    observationSource: 'fixture',
    finalityState: 'CONFIRMED',
    confirmations: 12,
    ...executionOverrides,
  };
  const receipt = signReceipt(
    buildAuthorizedReceipt({
      authorization,
      acceptance,
      execution,
      issuer,
      keyId: priorSealKeyId,
      issuedAt: execution.observedAt,
    }),
    priorSealKey.privateKeyPem,
  );
  await writeJson(`priorseal-receipt-${name}.json`, receipt);
  return receipt;
}

async function writeJson(name, value) {
  await writeFile(new URL(name, output), `${JSON.stringify(value, null, 2)}\n`);
}

await mkdir(output, { recursive: true });

const insightSource = await makeInsightAttestation({
  sourceAssetId: SOURCE_ASSET,
  destinationAssetId: DESTINATION_ASSET,
  consensusPrice: 100_000_000,
});
const insightDestination = await makeInsightAttestation({
  sourceAssetId: DESTINATION_ASSET,
  destinationAssetId: SOURCE_ASSET,
  consensusPrice: 250_000_000_000,
});
const wrongKeyInsightSource = await makeInsightAttestation({
  account: wrongInsightAccount,
  sourceAssetId: SOURCE_ASSET,
  destinationAssetId: DESTINATION_ASSET,
  consensusPrice: 100_000_000,
});
const staleInsightSource = await makeInsightAttestation({
  sourceAssetId: SOURCE_ASSET,
  destinationAssetId: DESTINATION_ASSET,
  checkedAt: authorizationTime - 1000,
  consensusPrice: 100_000_000,
});
const insightCommitment = computeInsightCommitment(
  insightSource,
  insightDestination,
);

const baseClaim = {
  receipt_version: '0.2',
  receipt_role: 'server_attested',
  event_id: 'evt-insight-handoff-0001',
  timestamp: iso(boundaryExportTime),
  action_type: 'governance.decision_evidence_exported',
  status: 'exported',
  decision_record: {
    decision_id: 'decision-insight-handoff-0001',
    subject: { action_ref: intentId, action_type: 'evm.exact-call' },
    mode: 'pre_authorization_gate',
    evidence: {
      bundle_digest: `${insightCommitment.algorithm}:${insightCommitment.digest}`,
      source_ref: `${insightCommitment.namespace}:${insightCommitment.digest}`,
      rule_ref:
        'fixture:insight-risk-reviewed-before-principal-authorization:v1',
    },
    opened: {
      timestamp: iso(boundaryDecisionTime - 30),
      options: [
        'proceed_to_principal_authorization',
        'stop_before_principal_authorization',
      ],
      scope: {
        chainId,
        executor,
        transactionNonce,
        callTarget: target,
        calldataHash,
        nativeValue,
      },
      resolution_rule: 'single_governance_actor_review',
    },
    inputs: [
      {
        type: 'evidence_review',
        decision_id: 'decision-insight-handoff-0001',
        evidence_bundle_digest: `${insightCommitment.algorithm}:${insightCommitment.digest}`,
        source: 'governance-reviewer:fixture',
        selection: 'proceed_to_principal_authorization',
        confidence: 1,
        round: 1,
        timestamp: iso(boundaryDecisionTime - 10),
      },
    ],
    resolution: {
      verdict: 'proceed_to_principal_authorization',
      chosen_option: 'proceed_to_principal_authorization',
      reason: 'Named Insight evidence passed review for this exact action.',
      tally: {
        proceed_to_principal_authorization: 1,
        stop_before_principal_authorization: 0,
      },
      dissent: [],
      timestamp: iso(boundaryDecisionTime),
    },
    adjudication: {
      decision_id: 'decision-insight-handoff-0001',
      outcome: 'released_to_principal_authorization',
      path: 'governance_handoff',
      reason:
        'The governance review permits the principal to decide whether to authorize.',
      timestamp: iso(boundaryDecisionTime + 1),
    },
    execution_observation: {
      state: 'not_observed',
      scope: 'governance_exporter_does_not_observe_execution',
      timestamp: iso(boundaryExportTime),
    },
  },
};

const boundaryReceipts = {
  base: makeBoundaryReceipt(baseClaim),
  wrongKey: makeBoundaryReceipt(baseClaim, null, wrongBoundaryKey),
  staleExport: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-stale-export',
    timestamp: iso(authorizationTime - 400),
  }),
  staleDecision: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-stale-decision',
    decision_record: {
      decision_id: 'decision-insight-handoff-stale-decision',
      resolution: { timestamp: iso(authorizationTime - 400) },
    },
  }),
  actionMismatch: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-action-mismatch',
    decision_record: {
      decision_id: 'decision-insight-handoff-action-mismatch',
      subject: { action_ref: 'different-intent-id' },
    },
  }),
  calldataMismatch: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-calldata-mismatch',
    decision_record: {
      decision_id: 'decision-insight-handoff-calldata-mismatch',
      opened: { scope: { calldataHash: changedCalldataHash } },
    },
  }),
  targetMismatch: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-target-mismatch',
    decision_record: {
      decision_id: 'decision-insight-handoff-target-mismatch',
      opened: { scope: { callTarget: otherTarget } },
    },
  }),
  insightReferenceMismatch: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-insight-reference-mismatch',
    decision_record: {
      decision_id: 'decision-insight-handoff-insight-reference-mismatch',
      evidence: { source_ref: `insight.pretrade-pair.v1:0x${'9'.repeat(64)}` },
    },
  }),
  genericVerdict: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-generic-verdict',
    decision_record: {
      decision_id: 'decision-insight-handoff-generic-verdict',
      resolution: { verdict: 'allow', chosen_option: 'allow' },
    },
  }),
  stopped: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-stopped',
    decision_record: {
      decision_id: 'decision-insight-handoff-stopped',
      inputs: [
        {
          ...baseClaim.decision_record.inputs[0],
          decision_id: 'decision-insight-handoff-stopped',
          selection: 'stop_before_principal_authorization',
        },
      ],
      resolution: {
        verdict: 'stop_before_principal_authorization',
        chosen_option: 'stop_before_principal_authorization',
        reason:
          'Governance review stopped the handoff before principal authorization.',
        tally: {
          proceed_to_principal_authorization: 0,
          stop_before_principal_authorization: 1,
        },
      },
      adjudication: {
        decision_id: 'decision-insight-handoff-stopped',
        outcome: 'stopped_before_principal_authorization',
        path: 'governance_handoff',
        reason:
          'Governance review stopped the handoff before principal authorization.',
      },
    },
  }),
  wrongCoreStatus: makeBoundaryReceipt(baseClaim, {
    event_id: 'evt-insight-handoff-wrong-core-status',
    status: 'allowed',
  }),
};

await writeJson('insight-source.json', insightSource);
await writeJson('insight-destination.json', insightDestination);
await writeJson('insight-source-wrong-key.json', wrongKeyInsightSource);
await writeJson('insight-source-stale.json', staleInsightSource);
for (const [name, receipt] of Object.entries(boundaryReceipts)) {
  const suffix =
    name === 'base'
      ? ''
      : `-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  await writeJson(`boundaryattest-receipt${suffix}.json`, receipt);
}
await writeFile(
  new URL('boundaryattest-public-key.pem', output),
  boundaryKey.publicKeyPem,
);

await makePriorSealReceipt({
  name: 'matching',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
});
await makePriorSealReceipt({
  name: 'wrong-insight-commitment',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  commitmentOverrides: { wrongInsight: true },
});
await makePriorSealReceipt({
  name: 'wrong-boundary-commitment',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  commitmentOverrides: { wrongBoundary: true },
});
await makePriorSealReceipt({
  name: 'missing-boundary-commitment',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  commitmentOverrides: { missingBoundary: true },
});
await makePriorSealReceipt({
  name: 'wrong-signer-commitment',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  commitmentOverrides: { wrongSigner: true },
});
for (const name of [
  'staleExport',
  'staleDecision',
  'actionMismatch',
  'calldataMismatch',
  'targetMismatch',
  'insightReferenceMismatch',
  'stopped',
]) {
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  await makePriorSealReceipt({
    name: kebab,
    insightCommitment,
    boundaryReceipt: boundaryReceipts[name],
  });
}
await makePriorSealReceipt({
  name: 'execution-mismatch',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  executionOverrides: { calldataHash: changedCalldataHash },
});
await makePriorSealReceipt({
  name: 'validity-exceeds-evidence',
  insightCommitment,
  boundaryReceipt: boundaryReceipts.base,
  validUntil: authorizationTime + 300,
});

const trustedIssuerKeys = {
  schema: 'priorseal.keys.v1',
  issuer,
  keys: [
    {
      issuer,
      keyId: priorSealKeyId,
      algorithm: 'Ed25519',
      publicKey: priorSealKey.publicKeyPem,
      status: 'active',
      validFrom: null,
      validUntil: null,
    },
  ],
};
await writeJson('priorseal-trusted-issuer-keys.json', trustedIssuerKeys);

const cases = [
  {
    name: 'fully matching three-object flow',
    expectedCode: 'OK',
    expectedValueConclusion: 'BOUNDARYATTEST_ADDS_GOVERNANCE_HANDOFF',
  },
  {
    name: 'tampered Insight source attestation',
    mutation: 'tamper-insight-source-verdict',
    expectedCode: 'INSIGHT_SOURCE_UID_MISMATCH',
  },
  {
    name: 'wrong-key Insight source attestation',
    insightSource: 'insight-source-wrong-key.json',
    expectedCode: 'INSIGHT_SOURCE_SIGNER_UNTRUSTED',
  },
  {
    name: 'expired Insight source evidence',
    insightSource: 'insight-source-stale.json',
    expectedCode: 'INSIGHT_SOURCE_EVIDENCE_EXPIRED',
  },
  {
    name: 'changed Insight pair commitment',
    priorSealReceipt: 'priorseal-receipt-wrong-insight-commitment.json',
    expectedCode: 'INSIGHT_CONTEXT_COMMITMENT_DIGEST_MISMATCH',
  },
  {
    name: 'tampered BoundaryAttest claim',
    mutation: 'tamper-boundary-verdict',
    expectedCode: 'BOUNDARYATTEST_SIGNATURE_INVALID',
  },
  {
    name: 'wrong-key BoundaryAttest claim',
    boundaryReceipt: 'boundaryattest-receipt-wrong-key.json',
    expectedCode: 'BOUNDARYATTEST_KEY_ID_MISMATCH',
  },
  {
    name: 'invalid generic BoundaryAttest governance verdict',
    boundaryReceipt: 'boundaryattest-receipt-generic-verdict.json',
    expectedCode: 'BOUNDARYATTEST_GOVERNANCE_VERDICT_INVALID',
  },
  {
    name: 'valid BoundaryAttest stop verdict blocks the executed flow',
    boundaryReceipt: 'boundaryattest-receipt-stopped.json',
    priorSealReceipt: 'priorseal-receipt-stopped.json',
    expectedCode: 'BOUNDARYATTEST_GOVERNANCE_STOPPED',
  },
  {
    name: 'invalid BoundaryAttest core status semantics',
    boundaryReceipt: 'boundaryattest-receipt-wrong-core-status.json',
    expectedCode: 'BOUNDARYATTEST_CORE_EVENT_SEMANTICS_INVALID',
  },
  {
    name: 'stale BoundaryAttest export',
    boundaryReceipt: 'boundaryattest-receipt-stale-export.json',
    priorSealReceipt: 'priorseal-receipt-stale-export.json',
    expectedCode: 'BOUNDARYATTEST_EXPORT_STALE',
  },
  {
    name: 'stale BoundaryAttest underlying decision',
    boundaryReceipt: 'boundaryattest-receipt-stale-decision.json',
    priorSealReceipt: 'priorseal-receipt-stale-decision.json',
    expectedCode: 'BOUNDARYATTEST_DECISION_STALE',
  },
  {
    name: 'replayed exact BoundaryAttest export',
    preloadExportReplay: true,
    expectedCode: 'BOUNDARYATTEST_EXPORT_REPLAYED',
  },
  {
    name: 'replayed BoundaryAttest decision',
    preloadDecisionReplay: true,
    expectedCode: 'BOUNDARYATTEST_DECISION_REPLAYED',
  },
  {
    name: 'mismatched decision_record.subject.action_ref',
    boundaryReceipt: 'boundaryattest-receipt-action-mismatch.json',
    priorSealReceipt: 'priorseal-receipt-action-mismatch.json',
    expectedCode: 'BOUNDARYATTEST_SUBJECT_ACTION_REF_MISMATCH',
  },
  {
    name: 'changed exact-call calldata hash',
    boundaryReceipt: 'boundaryattest-receipt-calldata-mismatch.json',
    priorSealReceipt: 'priorseal-receipt-calldata-mismatch.json',
    expectedCode: 'BOUNDARYATTEST_SCOPE_CALLDATA_MISMATCH',
  },
  {
    name: 'changed exact-call target',
    boundaryReceipt: 'boundaryattest-receipt-target-mismatch.json',
    priorSealReceipt: 'priorseal-receipt-target-mismatch.json',
    expectedCode: 'BOUNDARYATTEST_SCOPE_TARGET_MISMATCH',
  },
  {
    name: 'changed BoundaryAttest Insight evidence reference',
    boundaryReceipt: 'boundaryattest-receipt-insight-reference-mismatch.json',
    priorSealReceipt: 'priorseal-receipt-insight-reference-mismatch.json',
    expectedCode: 'BOUNDARYATTEST_INSIGHT_REFERENCE_MISMATCH',
  },
  {
    name: 'changed BoundaryAttest claim commitment',
    priorSealReceipt: 'priorseal-receipt-wrong-boundary-commitment.json',
    expectedCode: 'BOUNDARYATTEST_CONTEXT_COMMITMENT_DIGEST_MISMATCH',
  },
  {
    name: 'missing BoundaryAttest claim commitment',
    priorSealReceipt: 'priorseal-receipt-missing-boundary-commitment.json',
    expectedCode: 'BOUNDARYATTEST_CONTEXT_COMMITMENT_MISSING',
  },
  {
    name: 'changed separately bound BoundaryAttest signer identity',
    priorSealReceipt: 'priorseal-receipt-wrong-signer-commitment.json',
    expectedCode: 'BOUNDARYATTEST_SIGNER_CONTEXT_COMMITMENT_DIGEST_MISMATCH',
  },
  {
    name: 'observed execution mismatch',
    priorSealReceipt: 'priorseal-receipt-execution-mismatch.json',
    expectedCode: 'PRIORSEAL_RECEIPT_NOT_COMPLIANT',
  },
  {
    name: 'PriorSeal validity exceeds evidence window',
    priorSealReceipt: 'priorseal-receipt-validity-exceeds-evidence.json',
    expectedCode: 'PRIORSEAL_VALIDITY_EXCEEDS_EVIDENCE',
  },
];

const expected = {
  schema: 'priorseal.insight-boundaryattest-three-object-fixture.v1',
  priorSealBaseCommit: '9260a115c42358046a6af7af0c86489ec0ec252b',
  insightSourceCommit: 'a5fe98018dc87936aad1647c8f631f1d661b0ebf',
  boundaryAttestSourceCommit: 'fc2fb18af50458c0a6fd2489768e21fd339a621e',
  insight: {
    schemaVersion: 3,
    expectedAttester: insightAccount.address,
    namespace: insightCommitment.namespace,
    algorithm: insightCommitment.algorithm,
    digest: insightCommitment.digest,
    maxSlippageBps,
  },
  boundaryAttest: {
    receiptVersion: '0.2',
    namespace: 'boundaryattest.insight-handoff.jcs-claim.v0.2',
    signerNamespace: 'boundaryattest.governance-signer.spki-sha256.v1',
    algorithm: 'sha256',
    publicKeyId: boundaryKey.publicKeyId,
    maxExportAgeSeconds: 300,
    maxDecisionAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    deletionTest: {
      exactFact:
        'The independently pinned governance signer reviewed the exact named Insight evidence for the exact proposed EVM call and resolved that it may proceed to principal authorization.',
      materialFactLost: true,
      providerReason:
        'Support the portable claim because it preserves an independently signed governance review and handoff fact that neither native Insight risk evidence nor native PriorSeal authorization and execution evidence establishes.',
    },
  },
  priorSeal: {
    issuer,
    keyId: priorSealKeyId,
    publicKeySpkiSha256: priorSealKey.fingerprint,
    receiptSchema: 'priorseal.execution-receipt.v3',
    intentSchema: 'priorseal.intent.v2',
    executionProfile: 'priorseal.execution-profile.exact-call.v1',
  },
  cases,
};
await writeJson('expected.json', expected);

console.log(
  `Generated ${cases.length} Insight + BoundaryAttest + PriorSeal cases.`,
);
console.log(`Insight fixture attester: ${insightAccount.address}`);
console.log(`BoundaryAttest fixture key: ${boundaryKey.publicKeyId}`);
console.log(
  `PriorSeal fixture issuer key fingerprint: ${priorSealKey.fingerprint}`,
);
