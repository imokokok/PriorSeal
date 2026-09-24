// Generated from generate-web3-agent-kit-integration-spike-v1.mts by npm run core:build. Do not edit directly.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  verifyAuthorization
} from "../src/domain/authorization.mjs";
import { signAuthorizationReceipt } from "../src/domain/authorization.mjs";
const insightSigner = privateKeyToAccount(`0x${"4".repeat(64)}`);
const principal = privateKeyToAccount(`0x${"1".repeat(64)}`);
const priorSealPrivate = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from("88".repeat(32), "hex")
  ]),
  format: "der",
  type: "pkcs8"
});
const priorSealPublic = createPublicKey(priorSealPrivate);
const priorSealPublicPem = priorSealPublic.export({ type: "spki", format: "pem" });
const root = new URL("../examples/web3-agent-kit-integration-spike-v1/", import.meta.url);
const fixture = new URL("fixture/", root);
function record(value2, path) {
  if (value2 === null || typeof value2 !== "object" || Array.isArray(value2)) throw new TypeError(`${path} must be an object`);
  return value2;
}
function hex32(value2, path) {
  if (typeof value2 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value2)) throw new TypeError(`${path} must be a 32-byte hex value`);
  return value2;
}
function attestation(value2, path) {
  const input = record(value2, path);
  const data2 = record(input.data, `${path}.data`);
  if (!Number.isSafeInteger(data2.validUntil) || typeof data2.verdict !== "string") throw new TypeError(`${path}.data has invalid fields`);
  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature)) throw new TypeError(`${path}.signature must be hex`);
  if (input.reasonCodes !== void 0 && (!Array.isArray(input.reasonCodes) || !input.reasonCodes.every((code) => typeof code === "string"))) throw new TypeError(`${path}.reasonCodes must be strings`);
  return {
    ...input,
    uid: hex32(input.uid, `${path}.uid`),
    signature: input.signature,
    data: {
      ...data2,
      requestHash: hex32(data2.requestHash, `${path}.data.requestHash`),
      validUntil: data2.validUntil,
      verdict: data2.verdict,
      reasonCodesHash: hex32(data2.reasonCodesHash, `${path}.data.reasonCodesHash`)
    },
    ...input.reasonCodes === void 0 ? {} : { reasonCodes: input.reasonCodes }
  };
}
const previousValue = JSON.parse(await readFile(new URL("../examples/web3-agent-kit-base-swap-v2/evidence-bundle.json", import.meta.url), "utf8"));
const previousInsight = record(record(previousValue, "previous bundle").insight, "previous bundle.insight");
const sourceAttestation = attestation(previousInsight.sourceAttestation, "previous bundle.insight.sourceAttestation");
const destinationAttestation = attestation(previousInsight.destinationAttestation, "previous bundle.insight.destinationAttestation");
const previousKeyRegistry = record(previousInsight.keyRegistry, "previous bundle.insight.keyRegistry");
const evaluatedAt = 1789639170;
const issuedAt = 1789639200;
const validUntil = 1789639380;
const executor = `0x${"a".repeat(40)}`;
const router = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const weth = "0x4200000000000000000000000000000000000006";
const usdc = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const nonce = "2048";
const value = "1000000000000000";
const issuer = "priorseal.web3-agent-kit-spike-synthetic";
const keyId = "priorseal-wak-spike-synthetic-1";
const insightTypes = {
  OracleSafetyCheck: [
    ["verdict", "string"],
    ["sourceAssetId", "string"],
    ["destinationAssetId", "string"],
    ["subjectChainId", "uint256"],
    ["action", "string"],
    ["tradeAmountUsd", "uint256"],
    ["consensusPrice", "uint256"],
    ["maxDeviationBps", "uint256"],
    ["manipulationRiskBps", "uint256"],
    ["participantCount", "uint256"],
    ["requiredParticipantCount", "uint256"],
    ["coverageStatus", "string"],
    ["independenceStatus", "string"],
    ["sourceGroupCount", "uint256"],
    ["crossProviderAgreementBps", "uint256"],
    ["maxStablecoinDepegBps", "uint256"],
    ["maxDataAgeSeconds", "uint256"],
    ["recommendedMaxPositionUsd", "uint256"],
    ["reasonCodesHash", "bytes32"],
    ["requestHash", "bytes32"],
    ["evaluationScope", "string"],
    ["evaluatedAssetIdsHash", "bytes32"],
    ["providerObservationsHash", "bytes32"],
    ["validUntil", "uint256"],
    ["checkedAt", "uint256"],
    ["schemaVersion", "uint256"],
    ["requiredSourceGroupCount", "uint256"]
  ].map(([name, type]) => ({ name, type }))
};
const uintFields = new Set(insightTypes.OracleSafetyCheck.filter(({ type }) => type === "uint256").map(({ name }) => name));
function canonical(value2) {
  if (Array.isArray(value2)) return `[${value2.map(canonical).join(",")}]`;
  if (value2 && typeof value2 === "object") {
    const record2 = value2;
    return `{${Object.keys(record2).sort().map((key) => `${JSON.stringify(key)}:${canonical(record2[key])}`).join(",")}}`;
  }
  return JSON.stringify(value2);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function domainDigest(namespace, payload) {
  return `0x${sha256(`${namespace}\0${canonical(payload)}`)}`;
}
function typedData(input) {
  return {
    domain: { name: "Insight Oracle Safety", version: "3", chainId: 1 },
    types: insightTypes,
    primaryType: "OracleSafetyCheck",
    message: Object.fromEntries(Object.entries(input.data).map(([key, entry]) => {
      if (!uintFields.has(key)) return [key, entry];
      if (typeof entry !== "string" && typeof entry !== "number") throw new TypeError(`${key} must be a decimal integer`);
      return [key, BigInt(entry)];
    }))
  };
}
function pair(source2, destination2) {
  return {
    namespace: "insight.pretrade-pair.v1",
    algorithm: "keccak256",
    digest: keccak256(encodeAbiParameters([
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint16" }
    ], [source2.uid, destination2.uid, source2.data.requestHash, destination2.data.requestHash, 50]))
  };
}
async function writeJson(name, value2) {
  await writeFile(new URL(name, fixture), `${JSON.stringify(value2, null, 2)}
`);
}
const source = sourceAttestation;
const destination = destinationAttestation;
const blockedDestination = structuredClone(destination);
blockedDestination.data.verdict = "BLOCK";
blockedDestination.data.reasonCodesHash = keccak256(encodeAbiParameters(
  [{ type: "string[]" }],
  [["SYNTHETIC_SIGNED_BLOCK"]]
));
blockedDestination.reasonCodes = ["SYNTHETIC_SIGNED_BLOCK"];
blockedDestination.uid = hashTypedData(typedData(blockedDestination));
blockedDestination.signature = await insightSigner.signTypedData(typedData(blockedDestination));
const swapAbi = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{ type: "tuple", name: "params", components: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ] }],
  outputs: [{ type: "uint256" }]
}];
const data = encodeFunctionData({
  abi: swapAbi,
  functionName: "exactInputSingle",
  args: [{
    tokenIn: weth,
    tokenOut: usdc,
    fee: 3e3,
    recipient: executor,
    amountIn: BigInt(value),
    amountOutMinimum: 2487500n,
    sqrtPriceLimitX96: 0n
  }]
});
const transaction = { chainId: 84532, from: executor, to: router, data, value, nonce };
const envelopePayload = {
  schema: "agent-call-envelope.v1",
  chainId: transaction.chainId,
  executionProfile: "call",
  executor,
  nonce,
  calldataHash: keccak256(data),
  nativeValue: value,
  target: router
};
const envelopeDigest = domainDigest("agent-call-envelope.v1", envelopePayload);
const policyPayload = {
  schema: "web3-agent-kit.policy-decision.v1",
  callIdentity: envelopeDigest,
  policyId: "wak-insight-priorseal-spike-v1",
  policyVersion: "1",
  verdict: "allow",
  reasonCodes: [],
  evaluatedAt
};
const policyDigest = domainDigest("web3-agent-kit.policy-decision.v1", policyPayload);
const positivePair = pair(source, destination);
const blockedPair = pair(source, blockedDestination);
const contextCommitments = [
  { namespace: "agent-call-envelope.v1", algorithm: "sha256", digest: envelopeDigest },
  positivePair,
  { namespace: "web3-agent-kit.policy-decision.v1", algorithm: "sha256", digest: policyDigest }
];
const intent = {
  schema: "priorseal.intent.v2",
  executionProfile: "priorseal.execution-profile.exact-call.v1",
  intentId: "wak-insight-priorseal-spike-synthetic-v1",
  chainId: 84532,
  action: "CONTRACT_CALL",
  asset: "eip155:84532/native",
  amount: value,
  sender: executor,
  recipient: router,
  validUntil,
  nonce,
  callTarget: router,
  calldataHash: keccak256(data),
  transactionValue: value,
  contextCommitments
};
const draft = buildAuthorization({
  intent,
  principal: { type: "user", id: "wak-spike-synthetic-principal", account: principal.address },
  authorizer: { type: "eip712", address: principal.address },
  delegate: { agentId: "wak-spike-synthetic-agent", executor },
  issuedAt,
  notBefore: issuedAt,
  expiresAt: validUntil,
  authorizationNonce: `0x${"01".repeat(32)}`,
  maxUses: "1",
  audience: "priorseal",
  policyHash: `0x${"0".repeat(64)}`
});
const authorization = buildAuthorization({
  ...draft,
  signature: await principal.signTypedData(authorizationTypedData(draft))
});
const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
  authorization,
  issuer,
  keyId,
  acceptedAt: issuedAt + 1
}), priorSealPrivate.export({ type: "pkcs8", format: "pem" }));
const expectedEvidenceBase = {
  authorization_id: authorization.authorizationId,
  envelope_digest: envelopeDigest,
  executor,
  authorizer: principal.address.toLowerCase(),
  valid_from: authorization.notBefore,
  valid_until: authorization.expiresAt,
  nonce: authorization.authorizationNonce,
  policy_commitment_digest: policyDigest
};
const verification = await verifyAuthorization(authorization, { now: issuedAt, audience: "priorseal" });
if (!verification.valid) throw new Error(`Synthetic authorization did not verify: ${verification.code}`);
const verificationResult = { valid: true, code: verification.code };
const response = {
  schema: "priorseal.wak-authorization-response.v1",
  ...expectedEvidenceBase,
  signedAuthorization: authorization,
  verificationResult,
  acceptance
};
const expectedEvidence = { ...expectedEvidenceBase, raw: { signedAuthorization: authorization, verificationResult, acceptance } };
const baseline = {
  schema: "wak-insight-priorseal.fixture-baseline.v1",
  mode: "SYNTHETIC_NO_BROADCAST",
  evaluatedAt,
  issuedAt,
  transaction,
  wak: {
    sourceVersion: "1.18.4",
    callEnvelope: { payload: envelopePayload, digest: envelopeDigest },
    policyDecisionCommitment: { payload: policyPayload, digest: policyDigest }
  },
  insight: {
    subjectChainId: 8453,
    executionChainId: 84532,
    sourceAttestation: source,
    destinationAttestation: destination,
    blockedDestinationAttestation: blockedDestination,
    positivePairCommitment: positivePair,
    blockedPairCommitment: blockedPair,
    keyRegistry: previousKeyRegistry
  },
  priorSeal: { authorization, acceptance, response, expectedWakEvidence: expectedEvidence }
};
const cases = {
  schema: "wak-insight-priorseal.fixture-cases.v1",
  note: "These are expected outcomes, not observed WAK results. P1 requires a later live Base Sepolia run.",
  cases: [
    { id: "N1", input: { insightVariant: "signed-block", now: evaluatedAt }, terminal: "DENIED_BEFORE_AUTHORIZATION", reason: "INSIGHT_BLOCK", counts: { authorizationProvider: 0, signer: 0, broadcast: 0, receipt: 0 } },
    { id: "N2", input: { insightVariant: "signed-pass", now: source.data.validUntil }, terminal: "REASSESS_AND_REAUTHORIZE", reason: "INSIGHT_STALE", counts: { authorizationProvider: 0, signer: 0, broadcast: 0, receipt: 0 } },
    { id: "N3", input: { insightVariant: "signed-pass", now: issuedAt + 2, mutateAfterAuthorization: { field: "data", value: `${data.slice(0, -2)}01` } }, terminal: "DENIED_BEFORE_SIGNING", reason: "AUTHORIZATION_CALL_MISMATCH", counts: { authorizationProvider: 1, signer: 0, broadcast: 0, receipt: 0 } },
    { id: "N4", input: { insightVariant: "signed-pass", now: issuedAt + 2, mutateAfterAuthorization: { field: "nonce", value: "2049" } }, terminal: "DENIED_BEFORE_SIGNING", reason: "NONCE_MISMATCH", counts: { authorizationProvider: 1, signer: 0, broadcast: 0, receipt: 0 } },
    { id: "N5a", input: { insightVariant: "signed-pass", now: issuedAt + 2, attempts: 2, providerReconstructed: false }, terminal: "FIRST_USE_ONLY", reason: "AUTHORIZATION_REPLAYED", counts: { authorizationProvider: 2, signer: 1, broadcast: 1, receipt: 1 } },
    { id: "N5b", input: { insightVariant: "signed-pass", now: issuedAt + 2, attempts: 2, providerReconstructed: true, persistedAcceptanceRequired: true }, terminal: "FIRST_USE_ONLY", reason: "AUTHORIZATION_REPLAYED", counts: { authorizationProvider: 2, signer: 1, broadcast: 1, receipt: 1 } },
    { id: "P1", conditionalOn: ["N1", "N2", "N3", "N4", "N5a", "N5b"], input: { freshEvidenceRequired: true, actualBaseSepoliaExecutionRequired: true }, terminal: "LIVE_RECEIPT_VERIFIED", reason: "OK", counts: { authorizationProvider: 1, signer: 1, broadcast: 1, receipt: 1 } }
  ]
};
const baselineSha256 = sha256(Buffer.from(`${JSON.stringify(baseline, null, 2)}
`));
for (const entry of cases.cases) {
  entry.wakVersion = "1.18.4";
  entry.inputArtifactHashes = {
    baselineSha256,
    caseInputSha256: sha256(Buffer.from(canonical(entry.input)))
  };
}
const roots = {
  schema: "wak-insight-priorseal.trust-roots.v1",
  synthetic: true,
  insight: { attester: insightSigner.address, historicalKeyId: "insight-wak-fixture-eip712-1" },
  priorSeal: {
    issuer,
    keyId,
    publicKeyPem: priorSealPublicPem,
    publicKeySpkiSha256: sha256(priorSealPublic.export({ type: "spki", format: "der" }))
  }
};
await mkdir(fixture, { recursive: true });
await writeJson("baseline.json", baseline);
await writeJson("cases.json", cases);
await writeJson("trust-roots.json", roots);
process.stdout.write(`${JSON.stringify({ status: "GENERATED", files: 3, baselineDigest: envelopeDigest })}
`);
