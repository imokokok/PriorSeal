import test from 'node:test';
import assert from 'node:assert/strict';

import { hashTypedData, keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyInsightDecisionInputPair } from '../../sdk/dist/insight-decision-input.js';
import { createJointReviewFixture } from '../helpers/joint-review-fixture.mjs';

const domain = {
  name: 'Insight Decision Input Assessment',
  version: '1',
  chainId: 1,
} as const;
const types = {
  DecisionInputAssessment: [
    { name: 'assessmentHash', type: 'bytes32' },
    { name: 'linkedPreTradeUid', type: 'bytes32' },
    { name: 'verifyUrlHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'schemaVersion', type: 'uint256' },
  ],
} as const;
const policy = {
  policyId: 'priorseal-consumer-policy',
  version: '1',
  assetIds: {
    AAA: 'eip155:8453/erc20:0x1111111111111111111111111111111111111111',
    BBB: 'eip155:8453/erc20:0x2222222222222222222222222222222222222222',
  },
  maxReferenceDeviationBps: 100,
  maxSlippageBps: 50,
  maxQuoteAgeSeconds: 90,
};
const signer = privateKeyToAccount(generatePrivateKey());

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

async function signedDecisionInput(
  asset: 'AAA' | 'BBB',
  linkedPreTradeUid: string,
  options: { issuedAt?: number; quoteObservedAt?: number } = {},
) {
  const issuedAt = options.issuedAt ?? 950;
  const validUntil = issuedAt + 300;
  const quoteObservedAt = options.quoteObservedAt ?? 970;
  const unsigned = {
    schemaVersion: 1 as const,
    status: 'SUFFICIENT' as const,
    eligibleToProceed: true,
    asset,
    chainId: 8453,
    action: 'swap' as const,
    tradeAmountUsd: 100_000_000_000,
    evaluatedAt: new Date(980 * 1000).toISOString(),
    operationRouteQuote: null,
    quoteInputHash: `0x${'4'.repeat(64)}`,
    policy: {
      maxReferenceDeviationBps: policy.maxReferenceDeviationBps,
      maxSlippageBps: policy.maxSlippageBps,
      maxQuoteAgeSeconds: policy.maxQuoteAgeSeconds,
    },
    prices: {
      decisionPriceUsd: 1,
      quotePriceUsd: 1,
      quoteObservedAt: new Date(quoteObservedAt * 1000).toISOString(),
      quoteAgeSeconds: 980 - quoteObservedAt,
      quoteDeviationBps: 0,
    },
    evidence: { source: 'offline-test-fixture' },
    reasons: [],
    caveats: [],
  };
  const assessmentHash = keccak256(toBytes(canonicalJson(unsigned)));
  const verifyUrl = 'https://oracleinsight.xyz/api/v1/safety/decision-input/verify?uid=fixture';
  const verifyUrlHash = keccak256(toBytes(verifyUrl));
  const message = {
    assessmentHash,
    linkedPreTradeUid: linkedPreTradeUid as `0x${string}`,
    verifyUrlHash,
    issuedAt: BigInt(issuedAt),
    validUntil: BigInt(validUntil),
    schemaVersion: 1n,
  };
  const typedData = { domain, types, primaryType: 'DecisionInputAssessment' as const, message };
  const proof = {
    type: 'DecisionInputAssessment',
    schemaVersion: 1,
    uid: hashTypedData(typedData),
    attester: signer.address,
    attesterLabel: 'Insight Decision Input Assessment attester',
    signedAt: new Date(issuedAt * 1000).toISOString(),
    validForSeconds: 300,
    signature: await signer.signTypedData(typedData),
    verifyUrl,
    data: { ...message, issuedAt, validUntil, schemaVersion: 1 },
    eip712: { domain, types, primaryType: 'DecisionInputAssessment' },
  };
  return { ...unsigned, attestation: proof };
}

async function fixture() {
  const base = await createJointReviewFixture();
  const sourcePreTrade = JSON.parse(base.attachments[0].rawJson);
  const destinationPreTrade = JSON.parse(base.attachments[1].rawJson);
  const sourceDecisionInput = await signedDecisionInput('AAA', sourcePreTrade.uid);
  const destinationDecisionInput = await signedDecisionInput('BBB', destinationPreTrade.uid);
  const keyRegistry = {
    keys: [{
      key_id: 'decision-input-unit-test',
      public_key: signer.address,
      validFrom: new Date(0).toISOString(),
      validUntil: null,
      revoked: false,
      role: 'attester' as const,
    }],
  };
  return {
    sourcePreTrade,
    destinationPreTrade,
    sourceDecisionInput,
    destinationDecisionInput,
    keyRegistry,
  };
}

test('offline verifier checks signed Decision Input pair against signed pre-trade scope and policy', async () => {
  const f = await fixture();
  const commitment = await verifyInsightDecisionInputPair(
    f.sourceDecisionInput,
    f.destinationDecisionInput,
    f.sourcePreTrade,
    f.destinationPreTrade,
    { keyRegistry: f.keyRegistry, policy, issuedAt: 1000, expiresAt: 1050 },
  );
  assert.equal(commitment.namespace, 'insight.decision-input-pair.v1');
  assert.match(commitment.digest, /^0x[0-9a-f]{64}$/);
});

test('offline verifier rejects wrong proof links, policy drift and authorization beyond quote freshness', async () => {
  const f = await fixture();
  await assert.rejects(() => verifyInsightDecisionInputPair(
    { ...f.sourceDecisionInput, attestation: { ...f.sourceDecisionInput.attestation, data: {
      ...f.sourceDecisionInput.attestation.data,
      linkedPreTradeUid: f.destinationPreTrade.uid,
    } } },
    f.destinationDecisionInput,
    f.sourcePreTrade,
    f.destinationPreTrade,
    { keyRegistry: f.keyRegistry, policy, issuedAt: 1000, expiresAt: 1050 },
  ));
  await assert.rejects(() => verifyInsightDecisionInputPair(
    f.sourceDecisionInput,
    f.destinationDecisionInput,
    f.sourcePreTrade,
    f.destinationPreTrade,
    { keyRegistry: f.keyRegistry, policy: { ...policy, maxSlippageBps: 40 }, issuedAt: 1000, expiresAt: 1050 },
  ));
  await assert.rejects(() => verifyInsightDecisionInputPair(
    f.sourceDecisionInput,
    f.destinationDecisionInput,
    f.sourcePreTrade,
    f.destinationPreTrade,
    { keyRegistry: f.keyRegistry, policy, issuedAt: 1000, expiresAt: 1061 },
  ));
});
