#!/usr/bin/env node

/**
 * Prepares and verifies a wallet-controlled, zero-value Monad exact-call demo.
 *
 * `prepare` never loads a private key, signs, or broadcasts. An optional RPC
 * read can obtain the wallet's pending deployment nonce immediately before use.
 * It writes two unsigned wallet transactions plus an EIP-712 PriorSeal request:
 * deploy MonadPriorSealPing, then record a random run id with zero native value.
 *
 * `verify` is read-only. It verifies a separately supplied principal signature,
 * then compares the supplied transaction hashes and emitted event with the exact
 * prepared bundle.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import solc from 'solc';
import {
  createPublicClient,
  encodeFunctionData,
  getContractAddress,
  http,
  isAddress,
  keccak256,
  stringToHex,
  verifyTypedData,
} from 'viem';
import { authorizationTypedData, buildAuthorization, canonicalize } from '../src/index.mjs';

const CHAIN_ID = 143;
const NETWORK = 'eip155:143';
const DEFAULT_VALID_FOR_SECONDS = 900;
const PING_ABI = [
  {
    type: 'function',
    name: 'record',
    stateMutability: 'payable',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'RunRecorded',
    anonymous: false,
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
    ],
  },
] as const;

type Json = Record<string, unknown>;
type ContractArtifact = { sourceHash: string; bytecode: `0x${string}`; abi: typeof PING_ABI; compiler: string };
type PrepareOptions = {
  principal: `0x${string}`;
  deploymentNonce: string | null;
  rpcUrl: string | null;
  outputDirectory: string;
  label: string;
  runId: `0x${string}`;
  validForSeconds: number;
};
type VerifyOptions = { bundleDirectory: string; outputDirectory: string; rpcUrl: string; deploymentTx: `0x${string}`; callTx: `0x${string}`; signature: `0x${string}` };

function fail(code: string): never { throw new Error(code); }
function object(value: unknown, code: string): Json { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code); return value as Json; }
function only(value: Json, allowed: readonly string[], code: string) { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(code); }
function text(value: unknown, code: string) { if (typeof value !== 'string' || value.length === 0) fail(code); return value; }
function integerText(value: unknown, code: string) { const result = text(value, code); if (!/^(0|[1-9][0-9]*)$/.test(result)) fail(code); return result; }
function natural(value: unknown, code: string, min: number, max: number) { if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < min || value > max) fail(code); return value; }
function hex(value: unknown, code: string): `0x${string}` { const result = text(value, code); if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) fail(code); return result as `0x${string}`; }
function bytes32(value: unknown, code: string): `0x${string}` { const result = hex(value, code); if (!/^0x[0-9a-fA-F]{64}$/.test(result)) fail(code); return result; }
function txHash(value: unknown, code: string): `0x${string}` { return bytes32(value, code); }
function address(value: unknown, code: string): `0x${string}` { const result = text(value, code); if (!isAddress(result)) fail(code); return result as `0x${string}`; }
function sameAddress(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }
function jsonSafe(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry)) as unknown; }
function json(value: unknown) { return `${JSON.stringify(jsonSafe(value), null, 2)}\n`; }
function hashCanonical(value: unknown): `0x${string}` { return `0x${createHash('sha256').update(canonicalize(jsonSafe(value))).digest('hex')}`; }
function fileHash(value: string) { return createHash('sha256').update(value).digest('hex'); }

function values(input: string[], allowed: readonly string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < input.length; index += 1) {
    const flag = input[index];
    if (!flag.startsWith('--') || !allowed.includes(flag)) fail('PING_ARGUMENT_UNSUPPORTED');
    const value = input[index + 1];
    if (value === undefined || value.startsWith('--') || result.has(flag)) fail('PING_ARGUMENT_INVALID');
    result.set(flag, value);
    index += 1;
  }
  return result;
}

function required(input: Map<string, string>, name: string) { return text(input.get(name), `PING_ARGUMENT_${name.slice(2).replaceAll('-', '_').toUpperCase()}_REQUIRED`); }
function absolutePath(value: string, code: string) { if (!isAbsolute(value)) fail(code); return resolve(value); }
function safeLabel(value: string) { if (value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) fail('PING_LABEL_INVALID'); return value; }
function rpcUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) fail('PING_RPC_MUST_BE_CREDENTIAL_FREE_HTTPS');
  return url.toString();
}

function parsePrepare(input: string[]): PrepareOptions {
  const args = values(input, ['--principal', '--deploy-nonce', '--rpc', '--out', '--label', '--run-id', '--valid-for-seconds']);
  const deploymentNonce = args.has('--deploy-nonce') ? integerText(required(args, '--deploy-nonce'), 'PING_DEPLOY_NONCE_INVALID') : null;
  const rpc = args.has('--rpc') ? rpcUrl(required(args, '--rpc')) : null;
  if (!deploymentNonce && !rpc) fail('PING_DEPLOY_NONCE_OR_RPC_REQUIRED');
  const validForSeconds = args.has('--valid-for-seconds') ? natural(Number(required(args, '--valid-for-seconds')), 'PING_VALID_FOR_SECONDS_INVALID', 120, 1_800) : DEFAULT_VALID_FOR_SECONDS;
  return {
    principal: address(required(args, '--principal'), 'PING_PRINCIPAL_INVALID'),
    deploymentNonce,
    rpcUrl: rpc,
    outputDirectory: absolutePath(required(args, '--out'), 'PING_OUT_MUST_BE_ABSOLUTE'),
    label: safeLabel(args.get('--label') ?? 'Monad PriorSeal zero-value demonstration'),
    runId: args.has('--run-id') ? bytes32(required(args, '--run-id'), 'PING_RUN_ID_INVALID') : `0x${randomBytes(32).toString('hex')}`,
    validForSeconds,
  };
}

function parseVerify(input: string[]): VerifyOptions {
  const args = values(input, ['--bundle', '--out', '--rpc', '--deployment-tx', '--call-tx', '--signature']);
  return {
    bundleDirectory: absolutePath(required(args, '--bundle'), 'PING_BUNDLE_MUST_BE_ABSOLUTE'),
    outputDirectory: absolutePath(required(args, '--out'), 'PING_OUT_MUST_BE_ABSOLUTE'),
    rpcUrl: rpcUrl(required(args, '--rpc')),
    deploymentTx: txHash(required(args, '--deployment-tx'), 'PING_DEPLOYMENT_TX_INVALID'),
    callTx: txHash(required(args, '--call-tx'), 'PING_CALL_TX_INVALID'),
    signature: hex(required(args, '--signature'), 'PING_SIGNATURE_INVALID'),
  };
}

async function loadPingArtifact(): Promise<ContractArtifact> {
  const sourcePath = new URL('../contracts/MonadPriorSealPing.sol', import.meta.url);
  const source = await readFile(sourcePath, 'utf8');
  const response = object(JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'MonadPriorSealPing.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
  }))), 'PING_COMPILER_RESPONSE_INVALID');
  const errors = Array.isArray(response.errors) ? response.errors : [];
  if (errors.some((entry) => object(entry, 'PING_COMPILER_DIAGNOSTIC_INVALID').severity === 'error')) fail('PING_CONTRACT_COMPILATION_FAILED');
  const contracts = object(response.contracts, 'PING_COMPILER_CONTRACTS_MISSING');
  const file = object(contracts['MonadPriorSealPing.sol'], 'PING_CONTRACT_FILE_MISSING');
  const contract = object(file.MonadPriorSealPing, 'PING_CONTRACT_ARTIFACT_MISSING');
  const evm = object(contract.evm, 'PING_CONTRACT_EVM_MISSING');
  const bytecode = object(evm.bytecode, 'PING_CONTRACT_BYTECODE_MISSING');
  const objectCode = text(bytecode.object, 'PING_CONTRACT_BYTECODE_INVALID');
  if (!/^[0-9a-fA-F]+$/.test(objectCode)) fail('PING_CONTRACT_BYTECODE_INVALID');
  return { sourceHash: fileHash(source), bytecode: `0x${objectCode}`, abi: PING_ABI, compiler: solc.version() };
}

async function writeJson(directory: string, name: string, value: unknown) { await writeFile(resolve(directory, name), json(value), { mode: 0o600 }); }

async function prepare(input: string[]) {
  const options = parsePrepare(input);
  const artifact = await loadPingArtifact();
  let deploymentNonceText = options.deploymentNonce;
  if (!deploymentNonceText) {
    const client = createPublicClient({ transport: http(options.rpcUrl!, { retryCount: 0, timeout: 30_000 }) });
    if (await client.getChainId() !== CHAIN_ID) fail('PING_RPC_CHAIN_ID_MISMATCH');
    deploymentNonceText = (await client.getTransactionCount({ address: options.principal, blockTag: 'pending' })).toString();
  }
  const deploymentNonce = BigInt(deploymentNonceText);
  const callNonce = deploymentNonce + 1n;
  const contract = getContractAddress({ from: options.principal, nonce: deploymentNonce });
  const calldata = encodeFunctionData({ abi: PING_ABI, functionName: 'record', args: [options.runId] });
  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = now + options.validForSeconds;
  const run = {
    schema: 'monad.priorseal-ping-run.v1',
    chainId: CHAIN_ID,
    network: NETWORK,
    label: options.label,
    runId: options.runId,
    principal: options.principal,
    expectedContract: contract,
    deploymentNonce: deploymentNonceText,
    callNonce: callNonce.toString(),
    createdAt: now,
    noAssetTransfer: true,
    insightAssessment: 'NOT_APPLICABLE_TO_NON_FINANCIAL_PING',
  };
  const deployment = {
    schema: 'monad.priorseal-ping-deployment.v1',
    chainId: CHAIN_ID,
    from: options.principal,
    to: null,
    data: artifact.bytecode,
    valueWei: '0',
    nonce: deploymentNonceText,
    predictedContract: contract,
  };
  const call = {
    schema: 'monad.priorseal-ping-call.v1',
    chainId: CHAIN_ID,
    from: options.principal,
    to: contract,
    data: calldata,
    valueWei: '0',
    nonce: callNonce.toString(),
    runId: options.runId,
  };
  const policy = {
    schema: 'monad.priorseal-ping-policy.v1',
    allowedChainId: CHAIN_ID,
    allowedExecutor: options.principal,
    allowedTarget: contract,
    requiredRunId: options.runId,
    requiredCalldataHash: keccak256(calldata),
    requiredNativeValue: '0',
    prohibitsTokenApproval: true,
    prohibitsAssetTransfer: true,
  };
  const authorization = buildAuthorization({
    intent: {
      schema: 'priorseal.intent.v2',
      executionProfile: 'priorseal.execution-profile.exact-call.v1',
      intentId: `monad-ping-${options.runId.slice(2, 18)}`,
      chainId: CHAIN_ID,
      action: 'CONTRACT_CALL',
      asset: `eip155:${CHAIN_ID}/native`,
      amount: '0',
      sender: options.principal,
      recipient: contract,
      validUntil: expiresAt,
      nonce: callNonce.toString(),
      callTarget: contract,
      calldataHash: keccak256(calldata),
      transactionValue: '0',
      contextCommitments: [{ namespace: 'monad.priorseal-ping-run.v1', algorithm: 'sha256', digest: hashCanonical(run) }],
      constraints: { minConfirmations: 1 },
    },
    principal: { type: 'user', id: `monad-wallet-${options.principal.toLowerCase()}`, account: options.principal },
    authorizer: { type: 'eip712', address: options.principal },
    delegate: { agentId: 'monad-priorseal-ping', executor: options.principal },
    issuedAt: now,
    notBefore: now,
    expiresAt,
    authorizationNonce: `0x${randomBytes(32).toString('hex')}`,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: hashCanonical(policy),
  });
  const typedData = authorizationTypedData(authorization);
  await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
  await writeJson(options.outputDirectory, 'contract-artifact.json', artifact);
  await writeJson(options.outputDirectory, 'run.json', run);
  await writeJson(options.outputDirectory, 'deployment-transaction.json', deployment);
  await writeJson(options.outputDirectory, 'record-transaction.json', call);
  await writeJson(options.outputDirectory, 'priorseal-policy.json', policy);
  await writeJson(options.outputDirectory, 'priorseal-authorization.json', authorization);
  await writeJson(options.outputDirectory, 'priorseal-typed-data.json', typedData);
  const manifest = {
    schema: 'monad.priorseal-ping-bundle.v1',
    chainId: CHAIN_ID,
    runId: options.runId,
    files: Object.fromEntries(Object.entries({ artifact, run, deployment, call, policy, authorization, typedData }).map(([name, value]) => [name, hashCanonical(value)])),
    boundaries: {
      privateKeyCollected: false,
      deploymentBroadcast: false,
      principalAuthorizationSignatureCollected: false,
      recordBroadcast: false,
      insightAttestationClaimed: false,
    },
  };
  await writeJson(options.outputDirectory, 'manifest.json', manifest);
  const handoff = [
    '# Monad PriorSeal Ping — wallet handoff',
    '',
    `This bundle is a **zero-value technical demonstration** on Monad (chain ID ${CHAIN_ID}). It does not perform a swap, pay Insight, evaluate market risk, approve a token, or transfer an asset. The only possible on-chain cost is the Monad network gas that your own wallet displays before each transaction.`,
    '',
    '## Preconditions',
    '',
    `- Use the wallet at \`${options.principal}\` on Monad mainnet.`,
    `- Do not send another transaction from this wallet between deployment and the \`record\` call. The bundle binds consecutive nonces \`${deploymentNonceText}\` and \`${callNonce}\`. If either changes, discard this bundle and generate a new one.`,
    '- Check the contract source in `contracts/MonadPriorSealPing.sol`; it only emits an event and rejects any native value.',
    '',
    '## Wallet sequence',
    '',
    '1. In your wallet, review and submit the deployment described by `deployment-transaction.json`. It has no `to` address, `valueWei: "0"`, and creation bytecode in `data`.',
    `   Confirm the nonce is \`${deploymentNonceText}\`.`,
    `2. Wait for the deployment receipt. Its contract address must equal \`${contract}\`.`,
    '3. Ask your wallet to sign the EIP-712 object in `priorseal-typed-data.json`. This is a message signature, not a transaction. Keep the resulting signature only long enough to run the read-only verifier; do not publish it unnecessarily.',
    `4. In your wallet, review and submit \`record-transaction.json\`. It calls \`${contract}\` with \`valueWei: "0"\` and nonce \`${callNonce}\`. The calldata records run ID \`${options.runId}\`.`,
    '5. Once both transaction hashes and the message signature are available, run `npm run monad:ping:verify` as described in the example README.',
    '',
    'A successful verification proves only that the independently reviewed zero-value call was authorized exactly as prepared and observed on Monad. It is not an Insight market-safety attestation, economic-safety guarantee, audit, or production custody system.',
    '',
  ].join('\n');
  await writeFile(resolve(options.outputDirectory, 'WALLET-HANDOFF.md'), handoff, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: 'PING_BUNDLE_READY_NO_SIGNING_OR_BROADCAST', output: options.outputDirectory, contract, runId: options.runId, deploymentNonce: deploymentNonceText, callNonce: callNonce.toString() })}\n`);
}

async function readJson(path: string, code: string) { try { return object(JSON.parse(await readFile(path, 'utf8')), code); } catch { return fail(code); } }
function rpcNumber(value: unknown, code: string) { if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value; if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value); return fail(code); }
function rpcBigint(value: unknown, code: string) { if (typeof value === 'bigint' && value >= 0n) return value; return fail(code); }
function txInput(value: unknown, code: string) { const tx = object(value, code); return hex(tx.input ?? tx.data, `${code}_INPUT_INVALID`); }

async function loadBundle(directory: string) {
  const run = await readJson(resolve(directory, 'run.json'), 'PING_RUN_JSON_INVALID');
  const deployment = await readJson(resolve(directory, 'deployment-transaction.json'), 'PING_DEPLOYMENT_JSON_INVALID');
  const call = await readJson(resolve(directory, 'record-transaction.json'), 'PING_CALL_JSON_INVALID');
  const policy = await readJson(resolve(directory, 'priorseal-policy.json'), 'PING_POLICY_JSON_INVALID');
  const rawAuthorization = await readJson(resolve(directory, 'priorseal-authorization.json'), 'PING_AUTHORIZATION_JSON_INVALID');
  const savedArtifact = await readJson(resolve(directory, 'contract-artifact.json'), 'PING_ARTIFACT_JSON_INVALID');
  only(run, ['schema', 'chainId', 'network', 'label', 'runId', 'principal', 'expectedContract', 'deploymentNonce', 'callNonce', 'createdAt', 'noAssetTransfer', 'insightAssessment'], 'PING_RUN_UNKNOWN_FIELD');
  only(deployment, ['schema', 'chainId', 'from', 'to', 'data', 'valueWei', 'nonce', 'predictedContract'], 'PING_DEPLOYMENT_UNKNOWN_FIELD');
  only(call, ['schema', 'chainId', 'from', 'to', 'data', 'valueWei', 'nonce', 'runId'], 'PING_CALL_UNKNOWN_FIELD');
  only(policy, ['schema', 'allowedChainId', 'allowedExecutor', 'allowedTarget', 'requiredRunId', 'requiredCalldataHash', 'requiredNativeValue', 'prohibitsTokenApproval', 'prohibitsAssetTransfer'], 'PING_POLICY_UNKNOWN_FIELD');
  only(savedArtifact, ['sourceHash', 'bytecode', 'abi', 'compiler'], 'PING_ARTIFACT_UNKNOWN_FIELD');
  if (run.schema !== 'monad.priorseal-ping-run.v1' || run.chainId !== CHAIN_ID || run.network !== NETWORK || run.noAssetTransfer !== true || run.insightAssessment !== 'NOT_APPLICABLE_TO_NON_FINANCIAL_PING') fail('PING_RUN_SCHEMA_INVALID');
  if (deployment.schema !== 'monad.priorseal-ping-deployment.v1' || deployment.chainId !== CHAIN_ID || deployment.to !== null || deployment.valueWei !== '0') fail('PING_DEPLOYMENT_SCHEMA_INVALID');
  if (call.schema !== 'monad.priorseal-ping-call.v1' || call.chainId !== CHAIN_ID || call.valueWei !== '0') fail('PING_CALL_SCHEMA_INVALID');
  if (policy.schema !== 'monad.priorseal-ping-policy.v1' || policy.allowedChainId !== CHAIN_ID || policy.requiredNativeValue !== '0' || policy.prohibitsTokenApproval !== true || policy.prohibitsAssetTransfer !== true) fail('PING_POLICY_SCHEMA_INVALID');
  const principal = address(run.principal, 'PING_RUN_PRINCIPAL_INVALID');
  const contract = address(run.expectedContract, 'PING_RUN_CONTRACT_INVALID');
  const runId = bytes32(run.runId, 'PING_RUN_ID_INVALID');
  const deploymentNonce = integerText(run.deploymentNonce, 'PING_RUN_DEPLOYMENT_NONCE_INVALID');
  const callNonce = integerText(run.callNonce, 'PING_RUN_CALL_NONCE_INVALID');
  if (BigInt(callNonce) !== BigInt(deploymentNonce) + 1n || !sameAddress(address(deployment.from, 'PING_DEPLOYMENT_FROM_INVALID'), principal) || !sameAddress(address(deployment.predictedContract, 'PING_DEPLOYMENT_CONTRACT_INVALID'), contract) || integerText(deployment.nonce, 'PING_DEPLOYMENT_NONCE_INVALID') !== deploymentNonce) fail('PING_DEPLOYMENT_BINDING_MISMATCH');
  if (!sameAddress(address(call.from, 'PING_CALL_FROM_INVALID'), principal) || !sameAddress(address(call.to, 'PING_CALL_TO_INVALID'), contract) || integerText(call.nonce, 'PING_CALL_NONCE_INVALID') !== callNonce || bytes32(call.runId, 'PING_CALL_RUN_ID_INVALID').toLowerCase() !== runId.toLowerCase()) fail('PING_CALL_BINDING_MISMATCH');
  const artifact = await loadPingArtifact();
  if (savedArtifact.sourceHash !== artifact.sourceHash || hex(savedArtifact.bytecode, 'PING_ARTIFACT_BYTECODE_INVALID').toLowerCase() !== artifact.bytecode.toLowerCase() || hex(deployment.data, 'PING_DEPLOYMENT_DATA_INVALID').toLowerCase() !== artifact.bytecode.toLowerCase()) fail('PING_ARTIFACT_MISMATCH');
  const expectedContract = getContractAddress({ from: principal, nonce: BigInt(deploymentNonce) });
  if (!sameAddress(expectedContract, contract)) fail('PING_CONTRACT_ADDRESS_MISMATCH');
  const expectedCalldata = encodeFunctionData({ abi: PING_ABI, functionName: 'record', args: [runId] });
  if (hex(call.data, 'PING_CALL_DATA_INVALID').toLowerCase() !== expectedCalldata.toLowerCase() || policy.requiredCalldataHash !== keccak256(expectedCalldata) || !sameAddress(address(policy.allowedExecutor, 'PING_POLICY_EXECUTOR_INVALID'), principal) || !sameAddress(address(policy.allowedTarget, 'PING_POLICY_TARGET_INVALID'), contract) || bytes32(policy.requiredRunId, 'PING_POLICY_RUN_ID_INVALID').toLowerCase() !== runId.toLowerCase()) fail('PING_POLICY_BINDING_MISMATCH');
  const authorization = buildAuthorization(rawAuthorization);
  if (authorization.intent.chainId !== CHAIN_ID || authorization.intent.nonce !== callNonce || !sameAddress(String(authorization.intent.sender), principal) || !sameAddress(String(authorization.intent.callTarget), contract) || String(authorization.intent.transactionValue) !== '0' || String(authorization.intent.calldataHash).toLowerCase() !== keccak256(expectedCalldata).toLowerCase() || !sameAddress(String(authorization.principal.account), principal) || !sameAddress(String(authorization.authorizer.address), principal) || !sameAddress(String(authorization.delegate.executor), principal)) fail('PING_AUTHORIZATION_BINDING_MISMATCH');
  return { run, deployment, call, policy, authorization, principal, contract, runId, deploymentNonce, callNonce, deploymentData: hex(deployment.data, 'PING_DEPLOYMENT_DATA_INVALID'), expectedCalldata };
}

function topicAddress(value: `0x${string}`) { return `0x${'0'.repeat(24)}${value.slice(2).toLowerCase()}`; }

async function verify(input: string[]) {
  const options = parseVerify(input);
  const bundle = await loadBundle(options.bundleDirectory);
  const typedData = authorizationTypedData(bundle.authorization);
  const signatureValid = await verifyTypedData({ ...typedData, address: bundle.principal, signature: options.signature } as Parameters<typeof verifyTypedData>[0]);
  if (!signatureValid) fail('PING_PRINCIPAL_SIGNATURE_INVALID');
  const client = createPublicClient({ transport: http(options.rpcUrl, { retryCount: 0, timeout: 30_000 }) });
  if (await client.getChainId() !== CHAIN_ID) fail('PING_RPC_CHAIN_ID_MISMATCH');
  const [deploymentTx, deploymentReceipt, callTx, callReceipt] = await Promise.all([
    client.getTransaction({ hash: options.deploymentTx }),
    client.getTransactionReceipt({ hash: options.deploymentTx }),
    client.getTransaction({ hash: options.callTx }),
    client.getTransactionReceipt({ hash: options.callTx }),
  ]);
  const deploymentRecord = object(deploymentTx, 'PING_DEPLOYMENT_RPC_INVALID');
  const callRecord = object(callTx, 'PING_CALL_RPC_INVALID');
  const deploymentReceiptRecord = object(deploymentReceipt, 'PING_DEPLOYMENT_RECEIPT_INVALID');
  const callReceiptRecord = object(callReceipt, 'PING_CALL_RECEIPT_INVALID');
  if (!sameAddress(address(deploymentRecord.from, 'PING_DEPLOYMENT_RPC_FROM_INVALID'), bundle.principal) || deploymentRecord.to !== null || txInput(deploymentRecord, 'PING_DEPLOYMENT_RPC_INVALID').toLowerCase() !== bundle.deploymentData.toLowerCase() || rpcBigint(deploymentRecord.value, 'PING_DEPLOYMENT_RPC_VALUE_INVALID') !== 0n || rpcNumber(deploymentRecord.nonce, 'PING_DEPLOYMENT_RPC_NONCE_INVALID') !== Number(bundle.deploymentNonce)) fail('PING_DEPLOYMENT_TRANSACTION_MISMATCH');
  if (deploymentReceiptRecord.status !== 'success' || !sameAddress(address(deploymentReceiptRecord.contractAddress, 'PING_DEPLOYMENT_RECEIPT_CONTRACT_INVALID'), bundle.contract)) fail('PING_DEPLOYMENT_RECEIPT_MISMATCH');
  if (!sameAddress(address(callRecord.from, 'PING_CALL_RPC_FROM_INVALID'), bundle.principal) || !sameAddress(address(callRecord.to, 'PING_CALL_RPC_TO_INVALID'), bundle.contract) || txInput(callRecord, 'PING_CALL_RPC_INVALID').toLowerCase() !== bundle.expectedCalldata.toLowerCase() || rpcBigint(callRecord.value, 'PING_CALL_RPC_VALUE_INVALID') !== 0n || rpcNumber(callRecord.nonce, 'PING_CALL_RPC_NONCE_INVALID') !== Number(bundle.callNonce)) fail('PING_CALL_TRANSACTION_MISMATCH');
  if (callReceiptRecord.status !== 'success') fail('PING_CALL_RECEIPT_MISMATCH');
  const code = await client.getCode({ address: bundle.contract });
  if (!code || code === '0x') fail('PING_CONTRACT_CODE_MISSING');
  const eventTopic = keccak256(stringToHex('RunRecorded(bytes32,address)')).toLowerCase();
  const logs = callReceiptRecord.logs;
  if (!Array.isArray(logs) || !logs.some((log) => {
    const entry = object(log, 'PING_LOG_INVALID');
    const topics = entry.topics;
    return sameAddress(address(entry.address, 'PING_LOG_ADDRESS_INVALID'), bundle.contract)
      && Array.isArray(topics)
      && topics.length === 3
      && String(topics[0]).toLowerCase() === eventTopic
      && String(topics[1]).toLowerCase() === bundle.runId.toLowerCase()
      && String(topics[2]).toLowerCase() === topicAddress(bundle.principal);
  })) fail('PING_RUN_RECORDED_EVENT_MISSING');
  const blockHash = txHash(callReceiptRecord.blockHash, 'PING_CALL_BLOCK_HASH_INVALID');
  const block = await client.getBlock({ blockHash });
  const blockTimestamp = rpcNumber(object(block, 'PING_BLOCK_INVALID').timestamp, 'PING_BLOCK_TIMESTAMP_INVALID');
  if (blockTimestamp < bundle.authorization.notBefore || blockTimestamp > bundle.authorization.expiresAt) fail('PING_AUTHORIZATION_TIME_WINDOW_MISMATCH');
  await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
  const report = {
    schema: 'monad.priorseal-ping-verification-report.v1',
    verifiedAt: Math.floor(Date.now() / 1_000),
    chainId: CHAIN_ID,
    network: NETWORK,
    bundleDirectory: options.bundleDirectory,
    runId: bundle.runId,
    principal: bundle.principal,
    contract: bundle.contract,
    deploymentTx: options.deploymentTx,
    callTx: options.callTx,
    signatureValid: true,
    exactCallMatched: true,
    zeroNativeValue: true,
    runRecordedEventMatched: true,
    callBlockTimestamp: blockTimestamp,
    insightAttestation: 'NOT_CLAIMED_NON_FINANCIAL_PING',
  };
  await writeJson(options.outputDirectory, 'verification-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: 'PING_VERIFIED_ON_CHAIN', output: options.outputDirectory, contract: bundle.contract, runId: bundle.runId, callTx: options.callTx })}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'prepare') await prepare(args);
else if (command === 'verify') await verify(args);
else fail('Usage: monad-priorseal-ping.mjs <prepare|verify> [options]');
