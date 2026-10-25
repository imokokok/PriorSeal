import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData, hashTypedData, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  baseLendingGuardIntentAsset,
  buildBaseLendingGuardBoundIntent,
  verifyBaseLendingGuardAuthorizationBinding,
  verifyInsightBaseLendingGuardDecision,
} from "../../sdk/dist/index.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}` as `0x${string}`);
const now = 1_792_252_800;
const account = "0x1111111111111111111111111111111111111111" as const;
const aavePool = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const domain = {
  name: "Insight Base Lending Guard",
  version: "1",
  chainId: 1,
} as const;
const types = {
  BaseLendingGuardDecision: [
    { name: "decisionHash", type: "bytes32" },
    { name: "calldataHash", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
  ],
} as const;
const abi = [
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
] as const;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

const transaction = {
  chainId: 8453 as const,
  from: account,
  to: aavePool,
  data: encodeFunctionData({
    abi,
    functionName: "borrow",
    args: [usdc, 1_000_000n, 2n, 0, account],
  }),
  nonce: "7",
  value: "0",
};
const keyRegistry = {
  keys: [
    {
      key_id: "insight-test",
      public_key: signer.address,
      validFrom: new Date(0).toISOString(),
      validUntil: null,
      revoked: false,
      role: "attester" as const,
    },
  ],
};

async function decision(
  protocolId:
    | "aave-v3-base"
    | "morpho-blue-base"
    | "compound-v3-base"
    | "moonwell-base" = "aave-v3-base",
) {
  const action = {
    protocolId,
    action: "borrow" as const,
    target: aavePool.toLowerCase(),
    calldataHash: keccak256(transaction.data),
    amount: "1000000",
    account,
    receiver: account,
    asset: usdc,
    marketId: null,
  };
  const guard = {
    schema: "insight.base-lending-guard.v1" as const,
    verdict: "ALLOW" as const,
    protocolId,
    action: "borrow" as const,
    evaluatedAt: new Date(now * 1000).toISOString(),
    scope: {
      chainId: 8453 as const,
      transactionAuthority: "none",
      valuation: "caller_declared_post_action_usd",
    },
    market: {
      marketId: null,
      collateralSymbol: "WETH",
      loanSymbol: "USDC",
      maxLtv: 0.8,
      liquidationLtv: 0.83,
      parameterSource: "on-chain",
      oracleAddress: null,
    },
    projected: {
      collateralValueUsd: 10_000,
      debtValueUsd: 4_000,
      ltv: 0.4,
      liquidationBufferPct: 50,
      conservativeMaxDebtUsd: 7200,
    },
    oracleChecks: {
      collateral: {
        verdict: "PASS",
        maxDeviationPct: 0,
        staleDataRisk: false,
        participantCount: 4,
        attestationUid: null,
        attester: null,
      },
      loan: {
        verdict: "PASS",
        maxDeviationPct: 0,
        staleDataRisk: false,
        participantCount: 4,
        attestationUid: null,
        attester: null,
      },
    },
    reasons: ["offline test vector"],
    next: {
      execution: "not_performed",
      priorSeal:
        "Bind this decision to an exact, user-authorized transaction before execution.",
    },
  };
  const decisionHash = keccak256(
    toBytes(
      canonical({
        schema: "insight.base-lending-guard-decision.v1",
        guard,
        transaction,
        action,
      }),
    ),
  );
  const data = {
    decisionHash,
    calldataHash: action.calldataHash,
    account,
    chainId: 8453 as const,
    verdict: 0 as const,
    issuedAt: now,
    validUntil: now + 300,
    schemaVersion: 1 as const,
  };
  const typedData = {
    domain,
    types,
    primaryType: "BaseLendingGuardDecision" as const,
    message: {
      ...data,
      chainId: 8453n,
      issuedAt: BigInt(now),
      validUntil: BigInt(now + 300),
      schemaVersion: 1n,
    },
  };
  return {
    schema: "insight.base-lending-guard-decision.v1" as const,
    guard,
    transaction,
    action,
    decisionHash,
    attestation: {
      type: "BaseLendingGuardDecision" as const,
      schemaVersion: 1 as const,
      uid: hashTypedData(typedData),
      attester: signer.address,
      attesterLabel: "Insight Base Lending Guard attester" as const,
      signedAt: new Date(now * 1000).toISOString(),
      validForSeconds: 300 as const,
      signature: await signer.signTypedData(typedData),
      verifyUrl:
        "https://www.oracleinsight.xyz/api/v1/safety/base-lending-guard/verify",
      data,
      eip712: { domain, types, primaryType: "BaseLendingGuardDecision" },
    },
  };
}

test("binds an independently verified Insight ALLOW decision to the single exact PriorSeal call", async () => {
  const proof = await decision();
  const verification = await verifyInsightBaseLendingGuardDecision(proof, {
    keyRegistry,
    now,
  });
  assert.equal(verification.valid, true);
  const intent = await buildBaseLendingGuardBoundIntent(
    {
      transaction,
      intentId: "base-lending-test",
      asset: baseLendingGuardIntentAsset("aave-v3-base"),
      amount: proof.action.amount,
      validUntil: now + 500,
    },
    proof,
    { keyRegistry, now },
  );
  assert.equal(intent.validUntil, now + 300);
  assert.deepEqual(intent.contextCommitments, [
    {
      namespace: "insight.base-lending-guard.v1",
      algorithm: "keccak256",
      digest: proof.decisionHash,
    },
  ]);
});

for (const protocolId of ["compound-v3-base", "moonwell-base"] as const)
  test(`accepts a fully verified Insight ${protocolId} decision`, async () => {
    const proof = await decision(protocolId);
    const verification = await verifyInsightBaseLendingGuardDecision(proof, {
      keyRegistry,
      now,
    });
    assert.equal(verification.valid, true);
    const intent = await buildBaseLendingGuardBoundIntent(
      {
        transaction,
        intentId: `base-lending-${protocolId}`,
        asset: baseLendingGuardIntentAsset(protocolId),
        amount: proof.action.amount,
        validUntil: now + 300,
      },
      proof,
      { keyRegistry, now },
    );
    assert.equal(intent.asset, `eip155:8453/lending:${protocolId}`);
  });

for (const mutation of [
  "calldata",
  "untrusted",
  "caution",
  "duplicate-namespace",
] as const)
  test(`rejects ${mutation} before a user authorization can be prepared`, async () => {
    const proof = await decision();
    const trust = mutation === "untrusted" ? { keys: [] } : keyRegistry;
    if (mutation === "calldata") proof.transaction.data = "0x1234";
    if (mutation === "caution") {
      (proof.guard as { verdict: "ALLOW" | "CAUTION" | "BLOCK" }).verdict = "CAUTION";
    }
    const input = {
      transaction,
      intentId: "base-lending-test",
      asset: baseLendingGuardIntentAsset("aave-v3-base"),
      amount: proof.action.amount,
      validUntil: now + 100,
      ...(mutation === "duplicate-namespace"
        ? {
            contextCommitments: [
              {
                namespace: "insight.base-lending-guard.v1",
                algorithm: "keccak256" as const,
                digest: proof.decisionHash,
              },
            ],
          }
        : {}),
    };
    await assert.rejects(
      buildBaseLendingGuardBoundIntent(input, proof, {
        keyRegistry: trust,
        now,
      }),
    );
  });

test("does not accept an authorization that outlives the Insight decision", async () => {
  const proof = await decision();
  const intent = await buildBaseLendingGuardBoundIntent(
    {
      transaction,
      intentId: "base-lending-test",
      asset: baseLendingGuardIntentAsset("aave-v3-base"),
      amount: proof.action.amount,
      validUntil: now + 300,
    },
    proof,
    { keyRegistry, now },
  );
  const result = await verifyBaseLendingGuardAuthorizationBinding(
    { intent, issuedAt: now, expiresAt: now + 301 },
    proof,
    { keyRegistry, now },
  );
  assert.deepEqual(result, {
    valid: false,
    reason: "AUTHORIZATION_OUTLIVES_INSIGHT_DECISION",
  });
});
