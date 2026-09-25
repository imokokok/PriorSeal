import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  http,
  keccak256,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  canonicalize,
  verifyAuthorization,
  verifyAuthorizationReceipt,
} from '../src/index.mjs';
import { signAuthorizationReceipt } from '../src/domain/authorization.mjs';

const CHAIN_ID = 84_532;
const ROUTER: Address = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
const QUOTER: Address = '0xC5290058841028F1614F3A6F0F5816cAd0df5E27';
const FACTORY: Address = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
const WETH: Address = '0x4200000000000000000000000000000000000006';
const USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const WETH_ID = `eip155:${CHAIN_ID}/erc20:${WETH}`;
const USDC_ID = `eip155:${CHAIN_ID}/erc20:${USDC}`;
const FEE = 3_000;
const AMOUNT_IN = 1_000_000_000_000n;
const MAX_SLIPPAGE_BPS = 500;
const MIN_CONFIRMATIONS = 2;
const BROADCAST_MARGIN_SECONDS = 180;
const EXPECTED_PRIORSEAL_ISSUER = 'priorseal-local';
const EXPECTED_PRIORSEAL_KEY_ID = 'default';
const EXPECTED_PRIORSEAL_TRUST_KEY_SHA256 = 'd79930ec4fbadb5d3c4268fec2badd2d77149712370bc3855472636dd43a7fe7';
const PUBLIC_DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const EXPECTED_PUBLIC_DEV_ACCOUNT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    ['verdict', 'string'], ['sourceAssetId', 'string'], ['destinationAssetId', 'string'],
    ['subjectChainId', 'uint256'], ['action', 'string'], ['tradeAmountUsd', 'uint256'],
    ['consensusPrice', 'uint256'], ['maxDeviationBps', 'uint256'],
    ['manipulationRiskBps', 'uint256'], ['participantCount', 'uint256'],
    ['requiredParticipantCount', 'uint256'], ['coverageStatus', 'string'],
    ['independenceStatus', 'string'], ['sourceGroupCount', 'uint256'],
    ['crossProviderAgreementBps', 'uint256'], ['maxStablecoinDepegBps', 'uint256'],
    ['maxDataAgeSeconds', 'uint256'], ['recommendedMaxPositionUsd', 'uint256'],
    ['reasonCodesHash', 'bytes32'], ['requestHash', 'bytes32'],
    ['evaluationScope', 'string'], ['evaluatedAssetIdsHash', 'bytes32'],
    ['providerObservationsHash', 'bytes32'], ['validUntil', 'uint256'],
    ['checkedAt', 'uint256'], ['schemaVersion', 'uint256'],
    ['requiredSourceGroupCount', 'uint256'],
  ].map(([name, type]) => ({ name, type })),
} as const;
const UINT_FIELDS = new Set(
  INSIGHT_TYPES.OracleSafetyCheck.filter(({ type }) => type === 'uint256').map(({ name }) => name)
);

const EXACT_INPUT_SINGLE_ABI = [{
  type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }], outputs: [{ name: 'amountOut', type: 'uint256' }],
}] as const;
const QUOTER_ABI = [{
  type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }],
  outputs: [
    { name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' },
  ],
}] as const;
const FACTORY_ABI = [{
  type: 'function', name: 'getPool', stateMutability: 'view',
  inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }],
  outputs: [{ name: 'pool', type: 'address' }],
}] as const;
const POOL_ABI = [{
  type: 'function', name: 'liquidity', stateMutability: 'view',
  inputs: [], outputs: [{ name: 'liquidity', type: 'uint128' }],
}] as const;

type JsonRecord = Record<string, unknown>;
type InsightEnvelope = {
  uid: Hex;
  schemaVersion: number;
  attester: Address;
  signature: Hex;
  validUntil: number;
  data: JsonRecord & {
    verdict: string;
    sourceAssetId: string;
    destinationAssetId: string;
    subjectChainId: number;
    requestHash: Hex;
    checkedAt: number;
    validUntil: number;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function parseArgs(argv: string[]): { insightDir: string; output: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    assert(name?.startsWith('--') && value, `invalid argument near ${name ?? '<end>'}`);
    assert(!values.has(name), `duplicate argument: ${name}`);
    values.set(name, value);
  }
  assert(values.size === 2, 'only --insight-dir and --output are supported');
  const insightDir = values.get('--insight-dir');
  const output = values.get('--output');
  assert(insightDir && output, '--insight-dir and --output are required');
  return { insightDir: resolve(insightDir), output: resolve(output) };
}

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function domainDigest(namespace: string, payload: unknown): `0x${string}` {
  return `0x${sha256(`${namespace}\0${canonicalize(payload)}`)}`;
}

function insightTypedData(envelope: InsightEnvelope) {
  return {
    domain: { name: 'Insight Oracle Safety', version: '3', chainId: 1 },
    types: INSIGHT_TYPES,
    primaryType: 'OracleSafetyCheck' as const,
    message: Object.fromEntries(
      Object.entries(envelope.data).map(([key, value]) => [key, UINT_FIELDS.has(key) ? BigInt(String(value)) : value])
    ),
  };
}

function insightPairCommitment(source: InsightEnvelope, destination: InsightEnvelope): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint16' }],
    [source.uid, destination.uid, source.data.requestHash, destination.data.requestHash, MAX_SLIPPAGE_BPS]
  ));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2);
  await writeFile(path, `${serialized}\n`, { flag: 'wx', mode: 0o644 });
}

async function validateInsight(
  envelope: InsightEnvelope,
  expectedSource: string,
  expectedDestination: string,
  registry: JsonRecord
): Promise<void> {
  assert(envelope.schemaVersion === 3 && envelope.data.schemaVersion === 3, 'Insight schema must be v3');
  assert(envelope.data.verdict === 'PASS', 'Insight verdict must be PASS');
  assert(envelope.data.subjectChainId === CHAIN_ID, 'Insight subject chain must be Base Sepolia');
  assert(envelope.data.sourceAssetId === expectedSource, 'Insight source asset mismatch');
  assert(envelope.data.destinationAssetId === expectedDestination, 'Insight destination asset mismatch');
  assert(envelope.validUntil === envelope.data.validUntil, 'Insight validity fields disagree');
  const typedData = insightTypedData(envelope);
  assert(hashTypedData(typedData) === envelope.uid, 'Insight UID mismatch');
  assert(await verifyTypedData({ ...typedData, address: envelope.attester, signature: envelope.signature }), 'Insight signature invalid');
  const keys = registry.public_keys;
  assert(Array.isArray(keys), 'Insight registry public_keys missing');
  const key = keys.map((entry) => record(entry, 'registry key')).find((entry) =>
    String(entry.public_key).toLowerCase() === envelope.attester.toLowerCase()
  );
  assert(key && key.revoked === false && key.role !== 'sample', 'Insight attester is not an active production key');
}

const { insightDir, output } = parseArgs(process.argv.slice(2));
const source = await readJson(`${insightDir}/source-oracle-safety-check-v3.json`) as InsightEnvelope;
const destination = await readJson(`${insightDir}/destination-oracle-safety-check-v3.json`) as InsightEnvelope;
const registry = record(await readJson(`${insightDir}/oracle-keys.json`), 'Insight registry');
await Promise.all([
  validateInsight(source, WETH_ID, USDC_ID, registry),
  validateInsight(destination, USDC_ID, WETH_ID, registry),
]);
assert(source.attester.toLowerCase() === destination.attester.toLowerCase(), 'Insight pair uses different attesters');
const now = Math.floor(Date.now() / 1_000);
const validUntil = Math.min(source.validUntil, destination.validUntil);
assert(validUntil - now >= 120, 'Insight evidence has less than 120 seconds remaining');

const account = mnemonicToAccount(PUBLIC_DEV_MNEMONIC, { addressIndex: 5 });
assert(account.address.toLowerCase() === EXPECTED_PUBLIC_DEV_ACCOUNT.toLowerCase(), 'public test account mismatch');
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || 'https://sepolia.base.org';
const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 30_000 }) });
assert(await client.getChainId() === CHAIN_ID, 'RPC chain ID mismatch');
const [routerCode, quoterCode, factoryCode, wethCode, usdcCode, balance, nonce, pool, blockNumber] = await Promise.all([
  client.getCode({ address: ROUTER }), client.getCode({ address: QUOTER }),
  client.getCode({ address: FACTORY }), client.getCode({ address: WETH }),
  client.getCode({ address: USDC }), client.getBalance({ address: account.address }),
  client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'getPool', args: [WETH, USDC, FEE] }),
  client.getBlockNumber(),
]);
for (const [name, code] of Object.entries({ routerCode, quoterCode, factoryCode, wethCode, usdcCode }))
  assert(code && code !== '0x', `${name} is not deployed`);
assert(pool !== '0x0000000000000000000000000000000000000000', 'WETH/USDC 0.3% pool is unavailable');
const poolLiquidity = await client.readContract({ address: pool, abi: POOL_ABI, functionName: 'liquidity' });
assert(poolLiquidity > 0n, 'WETH/USDC 0.3% pool has no liquidity');

const quoteParams = { tokenIn: WETH, tokenOut: USDC, amountIn: AMOUNT_IN, fee: FEE, sqrtPriceLimitX96: 0n };
const quote = await client.simulateContract({
  account, address: QUOTER, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [quoteParams],
});
const [quotedAmountOut, sqrtPriceX96After, initializedTicksCrossed, quoteGasEstimate] = quote.result;
const amountOutMinimum = quotedAmountOut * BigInt(10_000 - MAX_SLIPPAGE_BPS) / 10_000n;
assert(amountOutMinimum > 0n, 'quote is too small for a positive minimum output');
const swapParams = {
  tokenIn: WETH, tokenOut: USDC, fee: FEE, recipient: account.address,
  amountIn: AMOUNT_IN, amountOutMinimum, sqrtPriceLimitX96: 0n,
};
const data = encodeFunctionData({ abi: EXACT_INPUT_SINGLE_ABI, functionName: 'exactInputSingle', args: [swapParams] });
assert(data.startsWith('0x04e45aaf'), 'SwapRouter02 exactInputSingle selector mismatch');
const calldataHash = keccak256(data);
const gasEstimate = await client.estimateGas({ account: account.address, to: ROUTER, data, value: AMOUNT_IN });
const gas = gasEstimate * 120n / 100n;
const fees = await client.estimateFeesPerGas();
assert(fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null, 'RPC did not return EIP-1559 fees');
assert(balance > AMOUNT_IN + gas * fees.maxFeePerGas, 'public test account lacks sufficient Base Sepolia ETH');

const envelopePayload = {
  schema: 'agent-call-envelope.v1', chainId: CHAIN_ID, executionProfile: 'call',
  executor: account.address, nonce: String(nonce), calldataHash,
  nativeValue: AMOUNT_IN.toString(), target: ROUTER.toLowerCase() as Address,
};
const envelopeDigest = domainDigest('agent-call-envelope.v1', envelopePayload);
const pairCommitment = insightPairCommitment(source, destination);
const evaluatedAt = Math.floor(Date.now() / 1_000);
const policyPayload = {
  schema: 'web3-agent-kit.policy-decision.v1', callIdentity: envelopeDigest,
  policyId: 'wak-insight-priorseal-spike-v1', policyVersion: '1', verdict: 'allow',
  reasonCodes: [], evaluatedAt,
};
const policyDigest = domainDigest('web3-agent-kit.policy-decision.v1', policyPayload);
const intent = {
  schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1',
  intentId: `wak-p1-${evaluatedAt}`, chainId: CHAIN_ID, action: 'CONTRACT_CALL',
  asset: `eip155:${CHAIN_ID}/native`, amount: AMOUNT_IN.toString(), sender: account.address,
  recipient: ROUTER, validUntil, nonce: String(nonce), callTarget: ROUTER,
  calldataHash, transactionValue: AMOUNT_IN.toString(),
  contextCommitments: [
    { namespace: 'agent-call-envelope.v1', algorithm: 'sha256', digest: envelopeDigest },
    { namespace: 'web3-agent-kit.policy-decision.v1', algorithm: 'sha256', digest: policyDigest },
    { namespace: 'insight.pretrade-pair.v1', algorithm: 'keccak256', digest: pairCommitment },
  ],
  constraints: { minConfirmations: MIN_CONFIRMATIONS, maxGasUsed: gas.toString() },
};
const draft = buildAuthorization({
  intent,
  principal: { type: 'user', id: 'public-hardhat-test-account-5', account: account.address },
  authorizer: { type: 'eip712', address: account.address },
  delegate: { agentId: 'web3-agent-kit-p1', executor: account.address },
  issuedAt: evaluatedAt, notBefore: evaluatedAt, expiresAt: validUntil,
  authorizationNonce: `0x${randomBytes(32).toString('hex')}`, maxUses: '1',
  audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`,
});
const authorization = buildAuthorization({
  ...draft,
  signature: await account.signTypedData(authorizationTypedData(draft)),
});
const authorizationCheck = await verifyAuthorization(authorization, { now: evaluatedAt, audience: 'priorseal' });
assert(authorizationCheck.valid, `PriorSeal authorization invalid: ${authorizationCheck.code}`);

const issuer = string(process.env.PRIORSEAL_ISSUER, 'PRIORSEAL_ISSUER');
const keyId = string(process.env.PRIORSEAL_KEY_ID, 'PRIORSEAL_KEY_ID');
assert(issuer === EXPECTED_PRIORSEAL_ISSUER, 'PriorSeal issuer differs from the approved static input');
assert(keyId === EXPECTED_PRIORSEAL_KEY_ID, 'PriorSeal key ID differs from the approved static input');
const privateKeyPath = string(process.env.PRIORSEAL_PRIVATE_KEY_FILE, 'PRIORSEAL_PRIVATE_KEY_FILE');
const publicKeyPath = string(process.env.PRIORSEAL_PUBLIC_KEY_FILE, 'PRIORSEAL_PUBLIC_KEY_FILE');
const [privateKeyPem, publicKeyPem] = await Promise.all([
  readFile(resolve(privateKeyPath), 'utf8'), readFile(resolve(publicKeyPath), 'utf8'),
]);
const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
  authorization, issuer, keyId, acceptedAt: Math.floor(Date.now() / 1_000),
}), privateKeyPem);
assert(verifyAuthorizationReceipt(acceptance, publicKeyPem), 'PriorSeal acceptance signature invalid');
const trustKeyFingerprint = sha256(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }));
assert(trustKeyFingerprint === EXPECTED_PRIORSEAL_TRUST_KEY_SHA256, 'PriorSeal trust key differs from the approved static pin');
const broadcastCutoff = Math.min(validUntil, Number(authorization.expiresAt)) - BROADCAST_MARGIN_SECONDS;
assert(broadcastCutoff - Math.floor(Date.now() / 1_000) >= 60, 'less than 60 seconds remain before the broadcast cutoff');

const runSheet = {
  schema: 'wak-insight-priorseal.p1-run-sheet.v1',
  status: 'PRE_GO_REVIEW_REQUIRED',
  authorization: 'NO_GO_TRANSACTION_SIGNING_AND_BROADCAST_PROHIBITED',
  generatedAt: Math.floor(Date.now() / 1_000),
  expiresAt: validUntil,
  offChainValidity: {
    rule: 'Broadcast the signed transaction no later than the cutoff; WAK must enforce this before its single broadcast call.',
    insightValidUntil: validUntil,
    priorSealAuthorizationExpiresAt: authorization.expiresAt,
    broadcastMarginSeconds: BROADCAST_MARGIN_SECONDS,
    latestBroadcastAt: broadcastCutoff,
    onChainDeadlineInDirectCall: false,
  },
  volatileFields: ['insightEvidence', 'nonce', 'quote', 'amountOutMinimum', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'authorization', 'acceptance', 'offChainValidity.latestBroadcastAt'],
  regenerationRule: 'Regenerate the complete sheet if any volatile field expires or changes; do not patch individual fields.',
  network: {
    name: 'Base Sepolia', chainId: CHAIN_ID, rpc: 'https://sepolia.base.org',
    rpcCredentialIncluded: false, confirmationRule: `${MIN_CONFIRMATIONS} confirmations`,
    receiptTimeoutSeconds: 180,
    finalityRule: 'receipt status success and block remains canonical after two confirmations',
    rpcSnapshotBlock: blockNumber.toString(),
  },
  roles: {
    authorizer: account.address, executor: account.address, transactionSigner: account.address,
    custody: 'PUBLIC_HARDHAT_TEST_ACCOUNT_5_NONPRODUCTION_ONLY',
    priorSealIssuer: issuer, priorSealKeyId: keyId,
  },
  approvedTest: {
    path: 'WETH_TO_USDC_EXACT_INPUT_SINGLE', amountInWei: AMOUNT_IN.toString(),
    amountInEth: '0.000001', maximumNativeValueWei: AMOUNT_IN.toString(),
    maxSlippageBps: MAX_SLIPPAGE_BPS, feeTier: FEE,
    productionFunds: false, testnetOnly: true,
  },
  contracts: { router: ROUTER, quoter: QUOTER, factory: FACTORY, pool, poolLiquidity: poolLiquidity.toString(), weth: WETH, usdc: USDC },
  quote: {
    quotedAmountOut: quotedAmountOut.toString(), amountOutMinimum: amountOutMinimum.toString(),
    sqrtPriceX96After: sqrtPriceX96After.toString(), initializedTicksCrossed,
    quoteGasEstimate: quoteGasEstimate.toString(),
  },
  transaction: {
    chainId: CHAIN_ID, type: 'eip1559', from: account.address, to: ROUTER,
    data, calldataHash, value: AMOUNT_IN.toString(), nonce: String(nonce), gas: gas.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
  },
  routerCall: { functionName: 'exactInputSingle', selector: '0x04e45aaf', deadlineInCalldata: false },
  insight: {
    sourceUid: source.uid, destinationUid: destination.uid, attester: source.attester,
    sourceVerdict: source.data.verdict, destinationVerdict: destination.data.verdict,
    subjectChainId: CHAIN_ID, pairCommitment, maxSlippageBps: MAX_SLIPPAGE_BPS,
  },
  wak: { envelope: envelopePayload, envelopeDigest, policyDecision: policyPayload, policyCommitmentDigest: policyDigest },
  priorSeal: {
    authorization, acceptance,
    trustRoot: { issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, publicKeySpkiSha256: trustKeyFingerprint },
  },
  boundaries: {
    expectedCounts: { authorizationProvider: 1, signer: 1, broadcast: 1, receipt: 1 },
    order: ['authorizationProvider', 'signer', 'broadcast', 'receipt'],
    transactionSigned: false, transactionBroadcast: false, receiptIssued: false,
  },
  postRunEvidence: ['txHash', 'blockNumber', 'finalTransactionFields', 'actualCounts', 'priorSealReceipt', 'localVerifierOutput', 'exportedBundleSha256'],
  secretsIncluded: false,
};

await mkdir(output, { recursive: false, mode: 0o700 });
await Promise.all([
  writeJson(`${output}/p1-run-sheet.json`, runSheet),
  writeJson(`${output}/insight-source-oracle-safety-check-v3.json`, source),
  writeJson(`${output}/insight-destination-oracle-safety-check-v3.json`, destination),
  writeJson(`${output}/insight-oracle-keys.json`, registry),
]);
const files = ['p1-run-sheet.json', 'insight-source-oracle-safety-check-v3.json', 'insight-destination-oracle-safety-check-v3.json', 'insight-oracle-keys.json'];
const manifestFiles: Record<string, { sha256: string; byteLength: number }> = {};
for (const name of files) {
  const bytes = await readFile(`${output}/${name}`);
  manifestFiles[name] = { sha256: sha256(bytes), byteLength: bytes.length };
}
await writeJson(`${output}/manifest.json`, {
  schema: 'wak-insight-priorseal.p1-preflight-manifest.v1',
  status: 'PRE_GO_REVIEW_REQUIRED', files: manifestFiles,
  privateKeyIncluded: false, apiKeyIncluded: false, transactionSignatureIncluded: false,
});
process.stdout.write(`${JSON.stringify({
  status: 'PASS', output, expiresAt: validUntil, envelopeDigest, policyDigest,
  trustKeyFingerprint, transactionSigned: false, transactionBroadcast: false,
}, null, 2)}\n`);
