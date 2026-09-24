// Generated from generate-web3-agent-kit-base-swap-vectors.mts by npm run core:build. Do not edit directly.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  canonicalize,
  signReceipt
} from "../src/index.mjs";
import { signAuthorizationReceipt } from "../src/domain/authorization.mjs";
const insightAccount = privateKeyToAccount(`0x${"4".repeat(64)}`);
const successorInsightAccount = privateKeyToAccount(`0x${"5".repeat(64)}`);
const principal = privateKeyToAccount(`0x${"1".repeat(64)}`);
const priorSealKey = seededEd25519("88");
const successorPriorSealKey = seededEd25519("99");
const output = new URL("../examples/web3-agent-kit-base-swap-v1/", import.meta.url);
const WAK_COMMIT = "b673b82e4e90dfc86942fd59533a6b3e5f32598c";
const INSIGHT_COMMIT = "7b3311c5fcce064e8a0411fcefe32143cb4530ea";
const PRIORSEAL_COMMIT = "506c59c121b962bdfc06df37023559f71e3fd8e8";
const CHAIN_ID = 8453;
const EXECUTOR = `0x${"a".repeat(40)}`;
const ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NONCE = "2048";
const AMOUNT_IN_WEI = "1000000000000000";
const AMOUNT_OUT_MIN = 2487500n;
const MAX_SLIPPAGE_BPS = 50;
const AUTHORIZATION_TIME = Date.parse("2026-09-17T10:00:00.000Z") / 1e3;
const CHECKED_AT = AUTHORIZATION_TIME - 120;
const GOVERNOR_EVALUATED_AT = AUTHORIZATION_TIME - 30;
const EXECUTED_AT = AUTHORIZATION_TIME + 60;
const OBSERVED_AT = EXECUTED_AT + 5;
const AUTHORIZATION_VALID_UNTIL = AUTHORIZATION_TIME + 180;
const ROUTER_DEADLINE = AUTHORIZATION_TIME + 1200;
const INSIGHT_ROTATION_AT = AUTHORIZATION_TIME + 1800;
const ISSUER = "priorseal.web3-agent-kit-fixture";
const PRIORSEAL_KEY_ID = "priorseal-wak-fixture-ed25519-1";
const PRIORSEAL_SUCCESSOR_KEY_ID = "priorseal-wak-fixture-ed25519-2";
const SWAP_ABI = [{
  type: "function",
  name: "swapExactETHForTokens",
  stateMutability: "payable",
  inputs: [
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" }
  ],
  outputs: [{ name: "amounts", type: "uint256[]" }]
}];
const INSIGHT_DOMAIN = { name: "Insight Oracle Safety", version: "3", chainId: 1 };
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    { name: "verdict", type: "string" },
    { name: "sourceAssetId", type: "string" },
    { name: "destinationAssetId", type: "string" },
    { name: "subjectChainId", type: "uint256" },
    { name: "action", type: "string" },
    { name: "tradeAmountUsd", type: "uint256" },
    { name: "consensusPrice", type: "uint256" },
    { name: "maxDeviationBps", type: "uint256" },
    { name: "manipulationRiskBps", type: "uint256" },
    { name: "participantCount", type: "uint256" },
    { name: "requiredParticipantCount", type: "uint256" },
    { name: "coverageStatus", type: "string" },
    { name: "independenceStatus", type: "string" },
    { name: "sourceGroupCount", type: "uint256" },
    { name: "crossProviderAgreementBps", type: "uint256" },
    { name: "maxStablecoinDepegBps", type: "uint256" },
    { name: "maxDataAgeSeconds", type: "uint256" },
    { name: "recommendedMaxPositionUsd", type: "uint256" },
    { name: "reasonCodesHash", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "evaluationScope", type: "string" },
    { name: "evaluatedAssetIdsHash", type: "bytes32" },
    { name: "providerObservationsHash", type: "bytes32" },
    { name: "validUntil", type: "uint256" },
    { name: "checkedAt", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
    { name: "requiredSourceGroupCount", type: "uint256" }
  ]
};
const INSIGHT_UINT_FIELDS = [
  "subjectChainId",
  "tradeAmountUsd",
  "consensusPrice",
  "maxDeviationBps",
  "manipulationRiskBps",
  "participantCount",
  "requiredParticipantCount",
  "sourceGroupCount",
  "crossProviderAgreementBps",
  "maxStablecoinDepegBps",
  "maxDataAgeSeconds",
  "recommendedMaxPositionUsd",
  "validUntil",
  "checkedAt",
  "schemaVersion",
  "requiredSourceGroupCount"
];
const CANONICAL_REQUEST_DOMAIN = {
  name: "Insight Canonical Pre-Trade Request",
  version: "1",
  chainId: 1
};
const CANONICAL_REQUEST_TYPES = {
  CanonicalPreTradeRequest: [
    { name: "subjectChainId", type: "uint256" },
    { name: "sourceAssetId", type: "string" },
    { name: "destinationAssetId", type: "string" },
    { name: "action", type: "string" },
    { name: "tradeAmountUsd", type: "uint256" }
  ]
};
const OBSERVATION_ABI = [
  { name: "provider", type: "string" },
  { name: "feedId", type: "string" },
  { name: "value", type: "uint256" },
  { name: "timestamp", type: "uint256" },
  { name: "dataAgeSeconds", type: "uint256" },
  { name: "included", type: "bool" },
  { name: "exclusionReason", type: "string" }
];
function seededEd25519(seedByte) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seedByte.repeat(32), "hex")
    ]),
    format: "der",
    type: "pkcs8"
  });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    fingerprint: createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex")
  };
}
function sha256Canonical(value) {
  return `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
function iso(seconds) {
  return new Date(seconds * 1e3).toISOString();
}
function insightMessage(data) {
  const message = { ...data };
  for (const field of INSIGHT_UINT_FIELDS) message[field] = BigInt(String(data[field]));
  return message;
}
function requestHash({ sourceAssetId, destinationAssetId, tradeAmountUsd }) {
  return hashTypedData({
    domain: CANONICAL_REQUEST_DOMAIN,
    types: CANONICAL_REQUEST_TYPES,
    primaryType: "CanonicalPreTradeRequest",
    message: {
      subjectChainId: BigInt(CHAIN_ID),
      sourceAssetId,
      destinationAssetId,
      action: "swap",
      tradeAmountUsd: BigInt(tradeAmountUsd)
    }
  });
}
function observationsHash(observations) {
  const hashes = observations.map((entry) => keccak256(encodeAbiParameters(OBSERVATION_ABI, [
    entry.provider,
    entry.feedId,
    BigInt(entry.value),
    BigInt(entry.timestamp),
    BigInt(entry.dataAgeSeconds),
    entry.included,
    entry.exclusionReason
  ]))).sort();
  return hashes.length ? keccak256(concat(hashes)) : keccak256("0x");
}
function agreementBps(observations) {
  const values = observations.filter((entry) => entry.included).map((entry) => Number(entry.value));
  if (!values.length) return 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return Math.round((max > 0 ? 1 - (max - min) / max : 1) * 1e4);
}
async function makeInsightAttestation({ sourceAssetId, destinationAssetId, consensusPrice, observations }) {
  const tradeAmountUsd = 25e5;
  const data = {
    verdict: "PASS",
    sourceAssetId,
    destinationAssetId,
    subjectChainId: CHAIN_ID,
    action: "swap",
    tradeAmountUsd,
    consensusPrice,
    maxDeviationBps: 5,
    manipulationRiskBps: 100,
    participantCount: observations.filter((entry) => entry.included).length,
    requiredParticipantCount: 3,
    coverageStatus: "SUFFICIENT",
    independenceStatus: "ASSESSED",
    sourceGroupCount: 3,
    crossProviderAgreementBps: agreementBps(observations),
    maxStablecoinDepegBps: sourceAssetId.endsWith(USDC) ? 1 : 0,
    maxDataAgeSeconds: Math.max(...observations.map((entry) => entry.dataAgeSeconds)),
    recommendedMaxPositionUsd: 1e11,
    reasonCodesHash: keccak256(encodeAbiParameters(
      [{ type: "string[]", name: "reasonCodes" }],
      [[]]
    )),
    requestHash: requestHash({ sourceAssetId, destinationAssetId, tradeAmountUsd }),
    evaluationScope: "SOURCE_ASSET_ONLY",
    evaluatedAssetIdsHash: keccak256(encodeAbiParameters(
      [{ type: "string[]", name: "assetIds" }],
      [[sourceAssetId]]
    )),
    providerObservationsHash: observationsHash(observations),
    validUntil: CHECKED_AT + 600,
    checkedAt: CHECKED_AT,
    schemaVersion: 3,
    requiredSourceGroupCount: 2
  };
  const typedData = {
    domain: INSIGHT_DOMAIN,
    types: INSIGHT_TYPES,
    primaryType: "OracleSafetyCheck",
    message: insightMessage(data)
  };
  return {
    uid: hashTypedData(typedData),
    schemaVersion: 3,
    attester: insightAccount.address,
    attesterLabel: "Insight Oracle Safety Attestation",
    signedAt: iso(CHECKED_AT),
    validForSeconds: 600,
    validUntil: data.validUntil,
    signature: await insightAccount.signTypedData(typedData),
    verifyUrl: "https://www.oracleinsight.xyz/api/v1/safety/attestation/verify",
    data,
    evidence: {
      providerObservations: observations,
      providerGroups: {
        chainlink: "chainlink",
        pyth: "pyth",
        redstone: "redstone",
        uniswap_twap: "derived"
      }
    }
  };
}
function makeObservations(values, asset) {
  const providers = ["chainlink", "pyth", "redstone", "uniswap_twap"];
  return providers.map((provider, index) => ({
    provider,
    feedId: `${asset}:${provider}:synthetic`,
    value: String(values[index]),
    timestamp: CHECKED_AT - (index + 3),
    dataAgeSeconds: index + 3,
    included: true,
    exclusionReason: ""
  }));
}
function insightPairCommitment(source, destination) {
  return {
    namespace: "insight.pretrade-pair.v1",
    algorithm: "keccak256",
    digest: keccak256(encodeAbiParameters([
      { type: "bytes32", name: "sourceUid" },
      { type: "bytes32", name: "destinationUid" },
      { type: "bytes32", name: "sourceRequestHash" },
      { type: "bytes32", name: "destinationRequestHash" },
      { type: "uint16", name: "maxSlippageBps" }
    ], [
      source.uid,
      destination.uid,
      source.data.requestHash,
      destination.data.requestHash,
      MAX_SLIPPAGE_BPS
    ]))
  };
}
function wakIntentId(draft2) {
  const payload = {
    action: "swap",
    amount_base_units: 0,
    calldata: draft2.data.slice(2),
    chain: "base",
    contract: draft2.to,
    native_value_wei: Number(draft2.value),
    recipient: null,
    sender: draft2.from,
    token: null
  };
  return sha256Text(canonicalize(payload));
}
await mkdir(output, { recursive: true });
const calldata = encodeFunctionData({
  abi: SWAP_ABI,
  functionName: "swapExactETHForTokens",
  args: [AMOUNT_OUT_MIN, [WETH, USDC], EXECUTOR, BigInt(ROUTER_DEADLINE)]
});
const draft = {
  schema: "web3-agent-kit.evm-transaction-draft.v1",
  sourceCommit: WAK_COMMIT,
  createdAt: CHECKED_AT - 30,
  chain: "base",
  chainId: CHAIN_ID,
  action: "swap",
  from: EXECUTOR,
  to: ROUTER,
  data: calldata,
  calldataHash: keccak256(calldata),
  value: AMOUNT_IN_WEI,
  nonce: NONCE,
  gasLimit: "250000",
  decodedCall: {
    functionName: "swapExactETHForTokens",
    amountOutMin: AMOUNT_OUT_MIN.toString(),
    path: [WETH, USDC],
    recipient: EXECUTOR,
    deadline: ROUTER_DEADLINE
  },
  intentId: ""
};
draft.intentId = wakIntentId(draft);
const insightSource = await makeInsightAttestation({
  sourceAssetId: `eip155:${CHAIN_ID}/erc20:${WETH}`,
  destinationAssetId: `eip155:${CHAIN_ID}/erc20:${USDC}`,
  consensusPrice: 25e10,
  observations: makeObservations(
    [25e10, 24995e7, 25005e7, 250025e6],
    "weth-usd"
  )
});
const insightDestination = await makeInsightAttestation({
  sourceAssetId: `eip155:${CHAIN_ID}/erc20:${USDC}`,
  destinationAssetId: `eip155:${CHAIN_ID}/erc20:${WETH}`,
  consensusPrice: 1e8,
  observations: makeObservations(
    [1e8, 9999e4, 10001e4, 1e8],
    "usdc-usd"
  )
});
const insightCommitment = insightPairCommitment(insightSource, insightDestination);
const governorPolicy = {
  schema: "web3-agent-kit.insight-composition-policy.v1",
  policyId: "wak-base-swap-insight-composition-v1",
  sourceCommit: WAK_COMMIT,
  authority: {
    finalPolicyDecisionPoint: "web3-agent-kit-governor",
    insightRole: "signed-advisory-risk-input",
    priorSealRole: "principal-authorization-and-execution-evidence"
  },
  nativePolicy: {
    allowedChains: ["base"],
    allowedActions: ["swap"],
    allowedContracts: [ROUTER],
    maxNativeValueWei: "5000000000000000",
    requireConfirmation: true
  },
  insightMapping: {
    PASS: "ELIGIBLE",
    CAUTION: "REQUIRE_PRINCIPAL_CONFIRMATION",
    DANGER: "DENY",
    BLOCK: "DENY",
    INVALID_MISSING_OR_STALE: "DENY"
  },
  composition: {
    nativeDeny: "DENY",
    insightDeny: "DENY",
    cautionWithValidNativePolicy: "REQUIRE_PRINCIPAL_CONFIRMATION",
    passWithNativeConfirmation: "PROCEED_TO_PRINCIPAL_AUTHORIZATION",
    passWithoutNativeConfirmation: "ALLOW_EXECUTION"
  },
  delayedSubmission: {
    rule: "REASSESS_AND_REAUTHORIZE",
    trigger: "submission would occur outside either signed Insight validity window"
  }
};
const governorPolicyDigest = sha256Canonical(governorPolicy);
const governorDecision = {
  schema: "web3-agent-kit.policy-decision-evidence.v1",
  decisionId: "wak-policy-decision-base-swap-0001",
  evaluatedAt: GOVERNOR_EVALUATED_AT,
  intentId: draft.intentId,
  policyId: governorPolicy.policyId,
  policyDigest: governorPolicyDigest,
  nativePolicyResult: {
    allowed: true,
    reasons: [],
    requiresConfirmation: true
  },
  insightResult: {
    sourceUid: insightSource.uid,
    destinationUid: insightDestination.uid,
    pairCommitment: insightCommitment.digest,
    sourceVerdict: insightSource.data.verdict,
    destinationVerdict: insightDestination.data.verdict,
    effect: "ELIGIBLE"
  },
  exactCall: {
    chainId: CHAIN_ID,
    executor: EXECUTOR,
    transactionNonce: NONCE,
    callTarget: ROUTER,
    calldataHash: draft.calldataHash,
    nativeValue: AMOUNT_IN_WEI
  },
  decision: "PROCEED_TO_PRINCIPAL_AUTHORIZATION",
  reasonCodes: [],
  confirmation: {
    required: true,
    statusAtDecision: "PENDING",
    satisfiedBy: "subsequent-priorseal-principal-authorization"
  }
};
const governorDecisionDigest = sha256Canonical(governorDecision);
const contextCommitments = [
  insightCommitment,
  {
    namespace: "web3-agent-kit.execution-policy.jcs.v1",
    algorithm: "sha256",
    digest: governorPolicyDigest
  },
  {
    namespace: "web3-agent-kit.policy-decision.jcs.v1",
    algorithm: "sha256",
    digest: governorDecisionDigest
  }
];
const intent = {
  schema: "priorseal.intent.v2",
  executionProfile: "priorseal.execution-profile.exact-call.v1",
  intentId: "wak-base-swap-8453-0001",
  chainId: CHAIN_ID,
  action: "CONTRACT_CALL",
  asset: `eip155:${CHAIN_ID}/native`,
  amount: AMOUNT_IN_WEI,
  sender: EXECUTOR,
  recipient: ROUTER,
  validUntil: AUTHORIZATION_VALID_UNTIL,
  nonce: NONCE,
  callTarget: ROUTER,
  calldataHash: draft.calldataHash,
  transactionValue: AMOUNT_IN_WEI,
  contextCommitments,
  constraints: { minConfirmations: 12, maxGasUsed: "250000" }
};
const authorizationDraft = buildAuthorization({
  intent,
  principal: {
    type: "user",
    id: "wak-fixture-user",
    account: principal.address
  },
  authorizer: { type: "eip712", address: principal.address },
  delegate: { agentId: "web3-agent-kit-fixture-agent", executor: EXECUTOR },
  issuedAt: AUTHORIZATION_TIME,
  notBefore: AUTHORIZATION_TIME,
  expiresAt: AUTHORIZATION_VALID_UNTIL,
  authorizationNonce: `0x${"01".repeat(32)}`,
  maxUses: "1",
  audience: "priorseal",
  policyHash: `0x${"0".repeat(64)}`
});
const authorization = buildAuthorization({
  ...authorizationDraft,
  signature: await principal.signTypedData(authorizationTypedData(authorizationDraft))
});
const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
  authorization,
  issuer: ISSUER,
  keyId: PRIORSEAL_KEY_ID,
  acceptedAt: AUTHORIZATION_TIME + 1
}), priorSealKey.privateKeyPem);
const execution = {
  schema: "priorseal.execution-observation.v1",
  chainId: CHAIN_ID,
  txHash: `0x${"ab".repeat(32)}`,
  status: "CONFIRMED",
  blockNumber: 33200001,
  blockHash: `0x${"cd".repeat(32)}`,
  executedAt: EXECUTED_AT,
  observedAt: OBSERVED_AT,
  action: "CONTRACT_CALL",
  nonce: NONCE,
  sender: EXECUTOR,
  recipient: ROUTER,
  target: ROUTER,
  calldataHash: draft.calldataHash,
  asset: `eip155:${CHAIN_ID}/native`,
  amount: AMOUNT_IN_WEI,
  transfers: [],
  transferMatchUnique: false,
  nativeValue: AMOUNT_IN_WEI,
  tokenValue: null,
  gasUsed: "180000",
  fee: null,
  executionDataAvailable: true,
  observationSource: "synthetic-fixture",
  finalityState: "CONFIRMED",
  confirmations: 12
};
const priorSealReceipt = signReceipt(buildAuthorizedReceipt({
  authorization,
  acceptance,
  execution,
  issuer: ISSUER,
  keyId: PRIORSEAL_KEY_ID,
  issuedAt: OBSERVED_AT
}), priorSealKey.privateKeyPem);
const insightKeyRegistry = {
  issuer: "https://www.oracleinsight.xyz",
  registryRevision: "synthetic-wak-fixture-1",
  public_keys: [
    {
      key_id: "insight-wak-fixture-eip712-1",
      public_key: insightAccount.address,
      algorithm: "EIP-712/secp256k1",
      validFrom: "2026-09-17T00:00:00.000Z",
      validUntil: iso(INSIGHT_ROTATION_AT),
      revoked: false,
      role: "attester"
    },
    {
      key_id: "insight-wak-fixture-eip712-2",
      public_key: successorInsightAccount.address,
      algorithm: "EIP-712/secp256k1",
      validFrom: iso(INSIGHT_ROTATION_AT),
      validUntil: null,
      revoked: false,
      role: "attester"
    }
  ],
  revoked_keys: []
};
const priorSealKeyRegistry = {
  schema: "priorseal.keys.v1",
  issuer: ISSUER,
  keys: [
    {
      issuer: ISSUER,
      keyId: PRIORSEAL_KEY_ID,
      algorithm: "Ed25519",
      publicKey: priorSealKey.publicKeyPem,
      status: "retired",
      validFrom: AUTHORIZATION_TIME - 86400,
      validUntil: INSIGHT_ROTATION_AT
    },
    {
      issuer: ISSUER,
      keyId: PRIORSEAL_SUCCESSOR_KEY_ID,
      algorithm: "Ed25519",
      publicKey: successorPriorSealKey.publicKeyPem,
      status: "active",
      validFrom: INSIGHT_ROTATION_AT,
      validUntil: null
    }
  ]
};
const unsignedBundle = {
  schema: "web3-agent-kit.base-swap-evidence.v1",
  fixtureMode: "SYNTHETIC_NO_BROADCAST",
  assembledAt: INSIGHT_ROTATION_AT + 3600,
  sources: {
    web3AgentKit: { repository: "https://github.com/ulsreall/web3-agent-kit", commit: WAK_COMMIT },
    insight: { repository: "https://github.com/imokokok/Insight", commit: INSIGHT_COMMIT },
    priorSeal: { repository: "https://github.com/imokokok/PriorSeal", commit: PRIORSEAL_COMMIT }
  },
  transactionDraft: draft,
  insight: {
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    sourceAttestation: insightSource,
    destinationAttestation: insightDestination,
    pairCommitment: insightCommitment,
    keyRegistry: insightKeyRegistry
  },
  governor: { policy: governorPolicy, decision: governorDecision },
  priorSeal: { receipt: priorSealReceipt, keyRegistry: priorSealKeyRegistry },
  limits: {
    synthetic: true,
    broadcastTimestampAttested: false,
    economicSafetyGuaranteed: false,
    adoptionOrIntegrationClaimed: false
  }
};
const evidenceBundle = { ...unsignedBundle, bundleHash: sha256Canonical(unsignedBundle) };
const trustRoots = {
  schema: "web3-agent-kit.base-swap-trust-roots.v1",
  fixtureMode: "SYNTHETIC_NO_BROADCAST",
  expectedSourceCommits: {
    web3AgentKit: WAK_COMMIT,
    insight: INSIGHT_COMMIT,
    priorSeal: PRIORSEAL_COMMIT
  },
  insight: {
    issuer: "https://www.oracleinsight.xyz",
    attester: insightAccount.address,
    historicalKeyId: "insight-wak-fixture-eip712-1"
  },
  priorSeal: {
    issuer: ISSUER,
    keyId: PRIORSEAL_KEY_ID,
    publicKeySpkiSha256: priorSealKey.fingerprint
  },
  warning: "Synthetic fixture roots. Production consumers must pin registry snapshots or key fingerprints through an independent trusted channel."
};
await writeJson("evidence-bundle.json", evidenceBundle);
await writeJson("trust-roots.json", trustRoots);
async function writeJson(name, value) {
  await writeFile(new URL(name, output), `${JSON.stringify(value, null, 2)}
`);
}
