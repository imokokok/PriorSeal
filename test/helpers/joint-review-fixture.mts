import { generateKeyPairSync } from 'node:crypto';
import { concat, encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256, parseAbi, toBytes, type TypedDataDomain, type TypedDataParameter } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { V3_DOMAIN, V3_TYPES, V3_PRIMARY_TYPE } from 'verify-insight-receipt';
import { EXECUTION_DOMAIN, EXECUTION_PRIMARY_TYPE, EXECUTION_PROFILE_V1_ID, executionTypesForSchemaVersion } from '../../sdk/dist/insight-execution-v5.js';
import { createInsightProtocolTrust } from './insight-protocol-fixture.mjs';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, buildTransparencyEvidence, buildVerificationBundle, createMemoryStore, signReceipt } from '../../src/index.mjs';
import { buildReviewManifest } from '../../sdk/dist/verifier.js';

// Ephemeral test-only keys. No environment, live service, wallet or chain is used.
const insightSigner = privateKeyToAccount(generatePrivateKey());
const authorizer = privateKeyToAccount(generatePrivateKey());
const txHash = `0x${'1'.repeat(64)}`;
export const zeroHash = `0x${'0'.repeat(64)}`;
const executor = `0x${'a'.repeat(40)}`;
export const router = `0x${'b'.repeat(40)}`;
const sourceAssetId = 'eip155:8453/erc20:0x1111111111111111111111111111111111111111';
const destinationAssetId = 'eip155:8453/erc20:0x2222222222222222222222222222222222222222';

type FixtureData = Record<string, unknown>;
type InsightTypes = Record<string, readonly TypedDataParameter[]>;
type JointFixtureOptions = {
  priorChain?: number;
  c4Overrides?: FixtureData | ((source: Awaited<ReturnType<typeof pretrade>>, destination: Awaited<ReturnType<typeof pretrade>>) => FixtureData);
  sourceOverrides?: FixtureData;
  destinationOverrides?: FixtureData;
  c4Version?: number;
  withAnchor?: boolean;
  psExecutedAt?: number;
  commitmentOverride?: `0x${string}`;
  withDecisionInput?: boolean;
  withTransactionRisk?: boolean;
  router02Risk?: boolean;
};

const v3SwapAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]);
const router02SwapAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]);
const router02MulticallAbi = parseAbi(['function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)']);

function defaultData(fields: readonly TypedDataParameter[]): FixtureData {
  return Object.fromEntries(fields.map(({ name, type }) => [name, type === 'bool' ? false : type === 'address' ? executor : type === 'bytes32' ? zeroHash : type.startsWith('uint') || type.startsWith('int') ? 0 : '']));
}
async function signInsight(data: FixtureData, domain: TypedDataDomain, types: InsightTypes, primaryType: string) {
  const message = Object.fromEntries(types[primaryType].map(({ name, type }) => [name, type.startsWith('uint') || type.startsWith('int') ? BigInt(data[name] as string | number | bigint | boolean) : data[name]]));
  const typed = { domain, types, primaryType, message } as Parameters<typeof hashTypedData>[0];
  return { uid: hashTypedData(typed), schemaVersion: data.schemaVersion, data, attester: insightSigner.address, signature: await insightSigner.signTypedData(typed) };
}
async function pretrade(source = true, overrides: FixtureData = {}) {
  const data = {
    ...defaultData(V3_TYPES[V3_PRIMARY_TYPE]),
    schemaVersion: 3, verdict: 'PASS', sourceAssetId: source ? sourceAssetId : destinationAssetId, destinationAssetId: source ? destinationAssetId : sourceAssetId,
    subjectChainId: 8453, action: 'swap', tradeAmountUsd: 100000000000, consensusPrice: source ? 100000000 : 250000000000,
    checkedAt: 900, validUntil: 1600, participantCount: 3, requiredParticipantCount: 3, sourceGroupCount: 2, requiredSourceGroupCount: 2,
    coverageStatus: 'SUFFICIENT', independenceStatus: 'ASSESSED', evaluationScope: 'SOURCE_ASSET_ONLY', requestHash: `0x${(source ? '2' : '3').repeat(64)}`,
    ...overrides,
  };
  return signInsight(data, V3_DOMAIN, V3_TYPES, V3_PRIMARY_TYPE);
}
export async function createJointReviewFixture({ priorChain = 8453, c4Overrides = {}, sourceOverrides = {}, destinationOverrides = {}, c4Version = 5, withAnchor = false, psExecutedAt = 1100, commitmentOverride, withDecisionInput = false, withTransactionRisk = false, router02Risk = false }: JointFixtureOptions = {}) {
  const source = await pretrade(true, sourceOverrides);
  const destination = await pretrade(false, destinationOverrides);
  const decisionInputPolicy = {
    policyId: 'joint-fixture-consumer-policy', version: '1',
    assetIds: { AAA: sourceAssetId, BBB: destinationAssetId },
    maxReferenceDeviationBps: 100, maxSlippageBps: 50, maxQuoteAgeSeconds: 300,
  };
  const decisionInputDomain = { name: 'Insight Decision Input Assessment', version: '1', chainId: 1 } as const;
  const decisionInputTypes = {
    DecisionInputAssessment: [
      { name: 'assessmentHash', type: 'bytes32' }, { name: 'linkedPreTradeUid', type: 'bytes32' },
      { name: 'verifyUrlHash', type: 'bytes32' }, { name: 'issuedAt', type: 'uint256' },
      { name: 'validUntil', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' },
    ],
  } as const;
  const canonicalJson = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  };
  const signDecisionInput = async (asset: 'AAA' | 'BBB', linkedPreTradeUid: string) => {
    const issuedAt = 950, validUntil = issuedAt + 300, quoteObservedAt = 980;
    const unsigned = {
      schemaVersion: 1, status: 'SUFFICIENT', eligibleToProceed: true, asset, chainId: 8453,
      action: 'swap', tradeAmountUsd: 100000000000, evaluatedAt: new Date(990000).toISOString(),
      operationRouteQuote: null, quoteInputHash: `0x${'4'.repeat(64)}`,
      policy: { maxReferenceDeviationBps: 100, maxSlippageBps: 50, maxQuoteAgeSeconds: 300 },
      prices: { decisionPriceUsd: 1, quotePriceUsd: 1, quoteObservedAt: new Date(quoteObservedAt * 1000).toISOString(), quoteAgeSeconds: 10, quoteDeviationBps: 0 },
      evidence: { source: 'joint-review-fixture' }, reasons: [], caveats: [],
    };
    const assessmentHash = keccak256(toBytes(canonicalJson(unsigned)));
    const verifyUrl = 'https://oracleinsight.xyz/api/v1/safety/decision-input/verify?uid=joint-fixture';
    const verifyUrlHash = keccak256(toBytes(verifyUrl));
    const message = { assessmentHash, linkedPreTradeUid: linkedPreTradeUid as `0x${string}`, verifyUrlHash, issuedAt: BigInt(issuedAt), validUntil: BigInt(validUntil), schemaVersion: 1n };
    const typedData = { domain: decisionInputDomain, types: decisionInputTypes, primaryType: 'DecisionInputAssessment' as const, message };
    const proof = {
      type: 'DecisionInputAssessment', schemaVersion: 1, uid: hashTypedData(typedData), attester: insightSigner.address,
      attesterLabel: 'Insight Decision Input Assessment attester', signedAt: new Date(issuedAt * 1000).toISOString(),
      validForSeconds: 300, signature: await insightSigner.signTypedData(typedData), verifyUrl,
      data: { ...message, issuedAt, validUntil, schemaVersion: 1 },
      eip712: { domain: decisionInputDomain, types: decisionInputTypes, primaryType: 'DecisionInputAssessment' },
    };
    return { ...unsigned, attestation: proof };
  };
  const sourceDecisionInput = withDecisionInput ? await signDecisionInput('AAA', source.uid) : undefined;
  const destinationDecisionInput = withDecisionInput ? await signDecisionInput('BBB', destination.uid) : undefined;
  const decisionInputCommitment = sourceDecisionInput && destinationDecisionInput
    ? {
      namespace: 'insight.decision-input-pair.v1', algorithm: 'keccak256',
      digest: keccak256(encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
        [
          sourceDecisionInput.attestation.uid as `0x${string}`,
          destinationDecisionInput.attestation.uid as `0x${string}`,
          sourceDecisionInput.attestation.data.assessmentHash as `0x${string}`,
          destinationDecisionInput.attestation.data.assessmentHash as `0x${string}`,
          sourceDecisionInput.attestation.data.linkedPreTradeUid as `0x${string}`,
          destinationDecisionInput.attestation.data.linkedPreTradeUid as `0x${string}`,
          keccak256(toBytes(canonicalJson({
            policyId: decisionInputPolicy.policyId, version: decisionInputPolicy.version,
            assetIds: decisionInputPolicy.assetIds, maxReferenceDeviationBps: decisionInputPolicy.maxReferenceDeviationBps,
            maxSlippageBps: decisionInputPolicy.maxSlippageBps, maxQuoteAgeSeconds: decisionInputPolicy.maxQuoteAgeSeconds,
          }))),
        ],
      )),
    }
    : undefined;
  if (withTransactionRisk && (!sourceDecisionInput || !destinationDecisionInput || !decisionInputCommitment)) throw new TypeError('Transaction risk fixture requires the signed Decision Input pair');
  const transactionRisk = withTransactionRisk && sourceDecisionInput && destinationDecisionInput && decisionInputCommitment
    ? (() => {
      const callProfile = router02Risk ? 'UNISWAP_V3_SWAP_ROUTER02_DEADLINE_MULTICALL' : 'UNISWAP_V3_SWAP_ROUTER';
      const directCalldata = encodeFunctionData({
        abi: v3SwapAbi,
        functionName: 'exactInputSingle',
        args: [{ tokenIn: '0x1111111111111111111111111111111111111111', tokenOut: '0x2222222222222222222222222222222222222222', fee: 500, recipient: executor as `0x${string}`, deadline: 2000n, amountIn: 100000000000n, amountOutMinimum: 99500000000n, sqrtPriceLimitX96: 0n }],
      });
      const calldata = router02Risk
        ? encodeFunctionData({ abi: router02MulticallAbi, functionName: 'multicall', args: [2000n, [encodeFunctionData({ abi: router02SwapAbi, functionName: 'exactInputSingle', args: [{ tokenIn: '0x1111111111111111111111111111111111111111', tokenOut: '0x2222222222222222222222222222222222222222', fee: 500, recipient: executor as `0x${string}`, amountIn: 100000000000n, amountOutMinimum: 99500000000n, sqrtPriceLimitX96: 0n }] })]] })
        : directCalldata;
      const routerCodeHash = keccak256('0x6001600155');
      return {
        schema: 'insight.swap-transaction-risk.v1' as const,
        status: 'ACCEPTABLE' as const,
        reasonCodes: [],
        transaction: {
          chainId: 8453, from: executor, router, calldata, calldataHash: keccak256(calldata),
          inputToken: '0x1111111111111111111111111111111111111111', outputToken: '0x2222222222222222222222222222222222222222',
          recipient: executor, fee: 500, amountIn: '100000000000', amountOutMinimum: '99500000000', deadline: 2000, callProfile,
        },
        evidence: {
          blockNumber: '99', blockHash: `0x${'d'.repeat(64)}`, blockTimestamp: 990,
          simulatedAmountOut: '100000000000', oracleExpectedAmountOut: '100000000000', oracleDeviationBps: 0,
          actualTradeAmountUsdMicros: '100000000000', assessedTradeAmountUsdMicros: '100000000000', tradeAmountDeviationBps: 0,
          allowedSlippageBps: 50, routerCodeHash,
          sourceAttestationUid: source.uid, destinationAttestationUid: destination.uid,
          decisionInputPair: {
            sourceUid: sourceDecisionInput.attestation.uid, destinationUid: destinationDecisionInput.attestation.uid,
            sourceAssessmentHash: sourceDecisionInput.attestation.data.assessmentHash,
            destinationAssessmentHash: destinationDecisionInput.attestation.data.assessmentHash, policyDigest: decisionInputCommitment.digest,
          },
        },
        validUntil: 1010,
        signed: false as const,
      };
    })()
    : undefined;
  const transactionRiskCommitment = transactionRisk
    ? { namespace: 'insight.swap-transaction-risk.v1', algorithm: 'keccak256' as const, digest: keccak256(toBytes(canonicalJson(transactionRisk))) }
    : undefined;
  const types = executionTypesForSchemaVersion(c4Version);
  if (!types) throw new TypeError('Unsupported execution schema version');
  const data = {
    ...defaultData(types[EXECUTION_PRIMARY_TYPE]), schemaVersion: c4Version, bindingMode: 'VERIFIED', claimRole: 'FIRST_PARTY_EXECUTION', subject: executor, taker: executor,
    preTradeUid: source.uid, destinationPreTradeUid: destination.uid, preTradeUidsHash: keccak256(concat([source.uid, destination.uid])),
    requestHash: source.data.requestHash, sourceAssetId, destinationAssetId, subjectChainId: 8453, settlementChainId: 8453, action: 'SWAP',
    quotedPrice: 40000, executedPrice: 40000, priceScale: 8, maxSlippageBps: 50, slippageSatisfied: true, fillStatus: 'FULL', priceExecutionStatus: 'FAITHFUL', executionStatus: 'FAITHFUL',
    txHash, blockNumber: 100, executedAt: psExecutedAt, preTradeSignedAt: 900, attestationAgeAtExecSeconds: psExecutedAt - 900, participantCount: 3, requiredParticipantCount: 3, sourceGroupCount: 2, requiredSourceGroupCount: 2, independenceSatisfied: true, validUntil: 2000, environment: 'production', ...(c4Version === 5 ? { profileId: EXECUTION_PROFILE_V1_ID } : {}), ...(typeof c4Overrides === 'function' ? c4Overrides(source, destination) : c4Overrides),
  };
  const execution = await signInsight(data, EXECUTION_DOMAIN, types, EXECUTION_PRIMARY_TYPE);
  const commitment = { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256', digest: commitmentOverride ?? keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }], [source.uid, destination.uid, source.data.requestHash as `0x${string}`, destination.data.requestHash as `0x${string}`, 50])) };
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const key = { issuer: 'joint-test', keyId: 'joint-key', algorithm: 'Ed25519', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), status: 'active', validFrom: null, validUntil: null };
  const authorizationExpiry = withTransactionRisk ? 1010 : decisionInputCommitment ? 1150 : 1500;
  const intent = { schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1', intentId: 'joint-review', chainId: priorChain, action: 'CONTRACT_CALL', asset: sourceAssetId.replace('8453', String(priorChain)), amount: '1000', sender: executor, recipient: router, validUntil: authorizationExpiry, nonce: '7', callTarget: router, calldataHash: transactionRisk?.transaction?.calldataHash ?? keccak256('0x1234'), transactionValue: '0', contextCommitments: [commitment, ...(decisionInputCommitment ? [decisionInputCommitment] : []), ...(transactionRiskCommitment ? [transactionRiskCommitment] : [])] };
  const draft = buildAuthorization({ intent, principal: { type: 'user', id: 'fixture-user', account: authorizer.address }, authorizer: { type: 'eip712', address: authorizer.address }, delegate: { agentId: 'fixture-agent', executor }, issuedAt: 1000, notBefore: 1000, expiresAt: authorizationExpiry, authorizationNonce: `0x${'9'.repeat(64)}`, maxUses: '1', audience: 'joint-review-test', policyHash: zeroHash });
  const authorization = buildAuthorization({ ...draft, signature: await authorizer.signTypedData(authorizationTypedData(draft)) });
  const store = createMemoryStore({ clock: () => 1001000 });
  const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem: privateKey, issuer: key.issuer, keyId: key.keyId, audience: 'joint-review-test', now: () => 1001000 });
  const psExecution = { chainId: priorChain, txHash, status: 'CONFIRMED', action: 'CONTRACT_CALL', sender: executor, recipient: router, target: router, calldataHash: intent.calldataHash, nativeValue: '0', asset: intent.asset, amount: intent.amount, nonce: '7', executedAt: psExecutedAt, observedAt: psExecutedAt + 1, confirmations: 12, gasUsed: '100000', transfers: [], finalityState: 'CONFIRMED' };
  const entries = await store.listAuthorizationLog();
  const transparency = withAnchor ? buildTransparencyEvidence({ entries, acceptance: accepted.response.acceptance, issuer: key.issuer, keyId: key.keyId, privateKeyPem: privateKey, issuedAt: 1099, before: psExecutedAt, anchor: { type: 'eip155', chainId: priorChain, contract: router, txHash: `0x${'8'.repeat(64)}`, blockNumber: 99, anchoredAt: 1099, size: 1, headEntryHash: entries[0].entryHash } }) : undefined;
  const receipt = signReceipt(buildAuthorizedReceipt({ authorization: accepted.response.authorization, acceptance: accepted.response.acceptance, policyEvidence: accepted.response.policyEvidence as Parameters<typeof buildAuthorizedReceipt>[0]['policyEvidence'], ...(transparency ? { transparency } : {}), execution: psExecution, issuer: key.issuer, keyId: key.keyId, issuedAt: psExecutedAt + 1 }), privateKey);
  const bundle = buildVerificationBundle({ receipt, keyRegistry: { schema: 'priorseal.keys.v1', issuer: key.issuer, keys: [key] }, assembledAt: psExecutedAt + 2 });
  const insightKeyRegistry = { keys: [{ key_id: 'fixture-insight-key', public_key: insightSigner.address, validFrom: new Date(0).toISOString(), validUntil: null, revoked: false, role: 'attester' }] };
  const attachments = [source, destination, execution].map((proof, index) => ({ id: ['source', 'destination', 'execution'][index], role: `insight.${['source', 'destination', 'execution'][index]}`, profile: index === 2 ? `insight.execution.v${c4Version}` : 'insight.pretrade.v3', rawJson: JSON.stringify(proof) }));
  if (sourceDecisionInput && destinationDecisionInput) attachments.push(
    { id: 'decision-input-source', role: 'insight.decision-input.source', profile: 'insight.decision-input.v1', rawJson: JSON.stringify(sourceDecisionInput) },
    { id: 'decision-input-destination', role: 'insight.decision-input.destination', profile: 'insight.decision-input.v1', rawJson: JSON.stringify(destinationDecisionInput) },
  );
  if (transactionRisk) attachments.push({ id: 'transaction-risk', role: 'insight.swap-transaction-risk', profile: 'insight.swap-transaction-risk.v1', rawJson: JSON.stringify(transactionRisk) });
  const manifest = await buildReviewManifest({ bundle: bundle as Parameters<typeof buildReviewManifest>[0]['bundle'], attachments, expectedTxHash: txHash, assembledAt: psExecutedAt + 2 });
  const insightSwapRiskPolicy = {
    policyId: 'joint-fixture-v3-router-policy', version: '1',
    deployments: [{ chainId: 8453, routerAddress: router, routerCodeHash: keccak256('0x6001600155') }],
    maxBlockAgeSeconds: 30, maxTradeAmountDeviationBps: 100,
  };
  return { manifest, attachments, bundle, transactionRisk, options: { trustedKeys: key, insightKeyRegistry, insightProtocolTrust: createInsightProtocolTrust({ signer: insightSigner, version: c4Version }), ...(withDecisionInput ? { insightDecisionInputPolicy: decisionInputPolicy } : {}), ...(withTransactionRisk ? { insightSwapRiskPolicy } : {}), expectedAudience: 'joint-review-test', now: psExecutedAt + 3 } };
}
