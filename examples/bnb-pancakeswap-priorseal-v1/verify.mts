import assert from "node:assert/strict";
import {
  hashTypedData,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  baseAgentSwapGuardIntentAsset,
  buildBaseAgentSwapGuardBoundIntents,
  verifyBaseAgentSwapGuardAuthorizationBundle,
  verifyInsightBaseAgentSwapGuardDecision,
} from "../../sdk/dist/index.js";
import type { ExactCallIntentInput } from "../../sdk/dist/index.js";

const chainId = 56;
const now = 1_792_252_800;
const account = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const token = `0x${"56".repeat(20)}` as `0x${string}`;
const router = `0x${"65".repeat(20)}` as `0x${string}`;
const approvalData = "0x095ea7b3" as `0x${string}`;
const swapData = "0x414bf389" as `0x${string}`;
const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const domain = {
  name: "Insight Base Agent Swap Guard",
  version: "1",
  chainId: 1,
};
const types = {
  BaseAgentSwapGuardDecision: [
    { name: "decisionHash", type: "bytes32" },
    { name: "approvalCalldataHash", type: "bytes32" },
    { name: "swapCalldataHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
  ],
} as const;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
};

const guard = {
  schema: "insight.base-agent-swap-guard.v1",
  verdict: "ALLOW",
  validUntil: now + 60,
  scope: {
    chainId,
    profileId: "bnb-pancakeswap-v3-usdt-usdc-100",
    transactionAuthority: "none",
  },
  market: { exactInput: { amountInRaw: "1000000000000000000" } },
  binding: {
    chainId,
    recipient: account,
    approval: {
      token,
      spender: router,
      amountRaw: "1000000000000000000",
      calldataHash: keccak256(approvalData),
    },
    swap: { to: router, value: "0x0", calldataHash: keccak256(swapData) },
  },
  transactionsToSign: {
    approval: { to: token, value: "0x0", data: approvalData },
    swap: { to: router, value: "0x0", data: swapData },
  },
};
const decisionHash = keccak256(toBytes(canonical(guard)));
const data = {
  decisionHash,
  approvalCalldataHash: keccak256(approvalData),
  swapCalldataHash: keccak256(swapData),
  recipient: account,
  chainId,
  verdict: 0,
  issuedAt: now,
  validUntil: now + 60,
  schemaVersion: 1,
};
const typedData = {
  domain,
  types,
  primaryType: "BaseAgentSwapGuardDecision" as const,
  message: {
    ...data,
    chainId: BigInt(chainId),
    issuedAt: BigInt(now),
    validUntil: BigInt(now + 60),
    schemaVersion: 1n,
  },
} as const;
const decision = {
  schema: "insight.base-agent-swap-guard-decision.v1",
  guard: { ...guard, decisionHash },
  decisionHash,
  attestation: {
    type: "BaseAgentSwapGuardDecision",
    schemaVersion: 1,
    uid: hashTypedData(typedData),
    attester: signer.address,
    attesterLabel: "Insight Base Agent Swap Guard attester",
    signedAt: new Date(now * 1000).toISOString(),
    validForSeconds: 60,
    signature: await signer.signTypedData(typedData),
    verifyUrl: "https://www.oracleinsight.xyz/api/v1/safety/base-agent-swap-guard/verify",
    data,
    eip712: { domain, types, primaryType: "BaseAgentSwapGuardDecision" },
  },
};
const keyRegistry = {
  keys: [{
    key_id: "insight-test",
    public_key: signer.address,
    validFrom: new Date(0).toISOString(),
    validUntil: null,
    revoked: false,
    role: "attester" as const,
  }],
};
const trust = { keyRegistry, now };
assert.equal((await verifyInsightBaseAgentSwapGuardDecision(decision, trust)).valid, true);

const asset = baseAgentSwapGuardIntentAsset(token, chainId);
const inputs: { approval: ExactCallIntentInput; swap: ExactCallIntentInput } = {
  approval: {
    transaction: { chainId, from: account, to: token, data: approvalData, nonce: "7", value: "0" },
    intentId: "bnb-pancake-approval",
    asset,
    amount: "1000000000000000000",
    validUntil: now + 60,
  },
  swap: {
    transaction: { chainId, from: account, to: router, data: swapData, nonce: "8", value: "0" },
    intentId: "bnb-pancake-swap",
    asset,
    amount: "1000000000000000000",
    validUntil: now + 60,
  },
};
const intents = await buildBaseAgentSwapGuardBoundIntents(inputs, decision, trust);
assert.equal(intents.approval.chainId, chainId);
assert.equal(BigInt(String(intents.swap.nonce)) - BigInt(String(intents.approval.nonce)), 1n);

const authorization = {
  approval: { intent: intents.approval, issuedAt: now + 1, expiresAt: now + 60 },
  swap: { intent: intents.swap, issuedAt: now + 1, expiresAt: now + 60 },
  decision,
};
assert.deepEqual(
  await verifyBaseAgentSwapGuardAuthorizationBundle(authorization, trust),
  { valid: true, reason: "OK" },
);

await assert.rejects(() => buildBaseAgentSwapGuardBoundIntents({
  approval: inputs.approval,
  swap: { ...inputs.swap, transaction: { ...inputs.swap.transaction, data: "0xdeadbeef" } },
}, decision, trust));

console.log(JSON.stringify({ result: "PASS", chainId, profileId: guard.scope.profileId }));

