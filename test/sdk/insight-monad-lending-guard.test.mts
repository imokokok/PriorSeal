import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData, hashTypedData, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildMonadLendingGuardBoundIntent,
  monadLendingGuardIntentAsset,
  verifyInsightMonadLendingGuardDecision,
} from "../../sdk/dist/index.js";

const signer = privateKeyToAccount(`0x${"11".repeat(32)}` as `0x${string}`);
const now = 1_792_252_800;
const account = "0x1111111111111111111111111111111111111111" as const;
const aavePool = "0x69a5f9ad4f96ebf0a0c792dd42a01cc5c0102fef" as const;
const usdc = "0x754704bc059f8c67012fed69bc8a327a5aafb603" as const;
const domain = { name: "Insight Monad Lending Guard", version: "1", chainId: 143 } as const;
const types = {
  MonadLendingGuardDecision: [
    { name: "decisionHash", type: "bytes32" }, { name: "calldataHash", type: "bytes32" },
    { name: "account", type: "address" }, { name: "chainId", type: "uint256" },
    { name: "verdict", type: "uint8" }, { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" }, { name: "schemaVersion", type: "uint256" },
  ],
} as const;
const abi = [{
  type: "function", name: "borrow", stateMutability: "nonpayable",
  inputs: [
    { name: "asset", type: "address" }, { name: "amount", type: "uint256" },
    { name: "interestRateMode", type: "uint256" }, { name: "referralCode", type: "uint16" },
    { name: "onBehalfOf", type: "address" },
  ], outputs: [],
}] as const;
const transaction = {
  chainId: 143 as const, from: account, to: aavePool,
  data: encodeFunctionData({ abi, functionName: "borrow", args: [usdc, 1_000_000n, 2n, 0, account] }),
  nonce: "7", value: "0",
};
const keyRegistry = { keys: [{
  key_id: "insight-test", public_key: signer.address, validFrom: new Date(0).toISOString(),
  validUntil: null, revoked: false, role: "attester" as const,
}] };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

async function decision(protocolId: "aave-v3-monad" | "morpho-blue-monad" = "aave-v3-monad") {
  const action = {
    protocolId, action: "borrow" as const, target: aavePool, calldataHash: keccak256(transaction.data),
    amount: "1000000", account, receiver: account, asset: usdc, marketId: null,
  };
  const guard = {
    schema: "insight.monad-lending-guard.v1" as const, verdict: "ALLOW" as const, protocolId,
    action: "borrow" as const, evaluatedAt: new Date(now * 1000).toISOString(),
    scope: { chainId: 143 as const, transactionAuthority: "none", valuation: "caller_declared_post_action_usd" },
    market: { marketId: null, collateralSymbol: "WETH", loanSymbol: "USDC", maxLtv: 0.8,
      liquidationLtv: 0.83, parameterSource: "aave-live", oracleAddress: null },
    projected: { collateralValueUsd: 10_000, debtValueUsd: 4_000, ltv: 0.4, liquidationBufferPct: 50, conservativeMaxDebtUsd: 7200 },
    oracleChecks: {
      collateral: { verdict: "PASS", maxDeviationPct: 0, staleDataRisk: false, participantCount: 4, attestationUid: null, attester: null },
      loan: { verdict: "PASS", maxDeviationPct: 0, staleDataRisk: false, participantCount: 4, attestationUid: null, attester: null },
    }, reasons: ["offline test vector"],
    next: { execution: "not_performed", priorSeal: "Bind this decision to an exact, user-authorized transaction before execution." },
  };
  const decisionHash = keccak256(toBytes(canonical({
    schema: "insight.monad-lending-guard-decision.v1", guard, transaction, action,
  })));
  const data = { decisionHash, calldataHash: action.calldataHash, account, chainId: 143 as const,
    verdict: 0 as const, issuedAt: now, validUntil: now + 300, schemaVersion: 1 as const };
  const typedData = { domain, types, primaryType: "MonadLendingGuardDecision" as const,
    message: { ...data, chainId: 143n, issuedAt: BigInt(now), validUntil: BigInt(now + 300), schemaVersion: 1n } };
  return {
    schema: "insight.monad-lending-guard-decision.v1" as const, guard, transaction, action, decisionHash,
    attestation: {
      type: "MonadLendingGuardDecision" as const, schemaVersion: 1 as const, uid: hashTypedData(typedData),
      attester: signer.address, attesterLabel: "Insight Monad Lending Guard attester" as const,
      signedAt: new Date(now * 1000).toISOString(), validForSeconds: 300 as const,
      signature: await signer.signTypedData(typedData),
      verifyUrl: "https://www.oracleinsight.xyz/api/v1/safety/monad-lending-guard/verify",
      data, eip712: { domain, types, primaryType: "MonadLendingGuardDecision" },
    },
  };
}

test("verifies Monad Insight evidence and binds exactly one PriorSeal call", async () => {
  const proof = await decision();
  const verification = await verifyInsightMonadLendingGuardDecision(proof, { keyRegistry, now });
  assert.equal(verification.valid, true);
  const intent = await buildMonadLendingGuardBoundIntent({
    transaction, intentId: "monad-lending-test", asset: monadLendingGuardIntentAsset("aave-v3-monad"),
    amount: proof.action.amount, validUntil: now + 500,
  }, proof, { keyRegistry, now });
  assert.equal(intent.validUntil, now + 300);
  assert.equal(intent.asset, "eip155:143/lending:aave-v3-monad");
  assert.deepEqual(intent.contextCommitments, [{
    namespace: "insight.monad-lending-guard.v1", algorithm: "keccak256", digest: proof.decisionHash,
  }]);
});

test("rejects tampered Monad calldata before authorization preparation", async () => {
  const proof = await decision();
  proof.transaction.data = "0x1234";
  await assert.rejects(buildMonadLendingGuardBoundIntent({
    transaction, intentId: "monad-lending-test", asset: monadLendingGuardIntentAsset("aave-v3-monad"),
    amount: proof.action.amount, validUntil: now + 100,
  }, proof, { keyRegistry, now }));
});
