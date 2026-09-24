#!/usr/bin/env node

import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, encodeFunctionData, http, keccak256, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  signReceipt,
} from '../../src/index.mjs';
import { assertIssuableAuthorization, signAuthorizationReceipt, verifyAuthorization } from '../../src/domain/authorization.mjs';
import { bindIntentExecution } from '../../src/domain/binding.mjs';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';

const CHAIN_ID = 84532;
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const DEMO_URL = 'https://send21.io/api/v1/demo';
const EXPECTED_USDC: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const EXPECTED_PAYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
// Hardhat's published development mnemonic. This account is public and is only
// suitable for valueless testnet funds; no user or production key is loaded.
const PUBLIC_DEV_MNEMONIC = 'test test test test test test test test test test test junk';
const OUTPUT = new URL('./evidence-bundle.json', import.meta.url);
const ISSUER = 'priorseal.payment-draft-base-sepolia-test';
const KEY_ID = 'priorseal-payment-draft-ephemeral-1';
const TRANSFER_ABI = [{
  type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }],
  outputs: [{ name: 'success', type: 'bool' }],
}] as const;
const BALANCE_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }],
}] as const;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function address(value: unknown, label: string): Address {
  requireValue(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value), `${label} is not an EVM address`);
  return value as Address;
}

function sha256(value: string): `0x${string}` {
  return `0x${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2);
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  requireValue(response.ok, `${url} returned HTTP ${response.status}`);
  return response.json();
}

function parseDraft(value: unknown) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Demo draft is not an object');
  const draft = value as Record<string, unknown>;
  requireValue(typeof draft.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(draft.id), 'Demo draft id is invalid');
  requireValue(draft.network === 'BaseSepolia' && draft.currency === 'Usdc', 'Demo draft network or currency changed');
  const receiver = address(draft.receiverAddress, 'receiverAddress');
  const token = address(draft.tokenAddress, 'tokenAddress');
  requireValue(token.toLowerCase() === EXPECTED_USDC.toLowerCase(), 'Demo USDC contract differs from independently pinned contract');
  requireValue(Number.isSafeInteger(draft.amountBaseUnits) && Number(draft.amountBaseUnits) > 0, 'Demo amount is invalid');
  requireValue(typeof draft.expiresAt === 'string' && Number.isFinite(Date.parse(draft.expiresAt)), 'Demo expiry is invalid');
  requireValue(typeof draft.createdAt === 'string' && Number.isFinite(Date.parse(draft.createdAt)), 'Demo creation time is invalid');
  return { id: draft.id, receiver, token, amount: BigInt(draft.amountBaseUnits as number),
    createdAt: Math.floor(Date.parse(draft.createdAt) / 1000), expiresAt: Math.floor(Date.parse(draft.expiresAt) / 1000), raw: draft };
}

if (!process.argv.includes('--use-public-test-wallet')) {
  throw new Error('Testnet broadcast requires --use-public-test-wallet; it uses published Hardhat account #1 only.');
}
const account = mnemonicToAccount(PUBLIC_DEV_MNEMONIC, { addressIndex: 1 });
requireValue(account.address.toLowerCase() === EXPECTED_PAYER.toLowerCase(), 'Unexpected public development account');
requireValue(!existsSync(OUTPUT), 'Frozen evidence bundle already exists; use a new fixture version for another run');
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL, { timeout: 30_000 }) });
requireValue(await client.getChainId() === CHAIN_ID, 'RPC is not Base Sepolia');

// Preflight before starting send21's 30-minute draft clock.
const [configValue, tokenCode, tokenBalance, nativeBalance] = await Promise.all([
  requestJson(`${DEMO_URL}/config`),
  client.getCode({ address: EXPECTED_USDC }),
  client.readContract({ address: EXPECTED_USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [account.address] }),
  client.getBalance({ address: account.address }),
]);
requireValue(tokenCode && tokenCode !== '0x', 'Pinned test USDC contract has no code');
requireValue(tokenBalance >= 100_000n, 'Public test wallet has insufficient USDC for demo preflight');
requireValue(nativeBalance >= 100_000_000_000_000n, 'Public test wallet has insufficient Base Sepolia ETH for gas');
requireValue(configValue !== null && typeof configValue === 'object' && !Array.isArray(configValue), 'Demo config is invalid');
const config = configValue as Record<string, unknown>;
requireValue(config.enabled === true && config.expiryMinutes === 30, 'Demo is disabled or expiry changed');
requireValue(Array.isArray(config.networks) && config.networks.some((item) =>
  item !== null && typeof item === 'object' && (item as Record<string, unknown>).network === 'BaseSepolia' &&
  Array.isArray((item as Record<string, unknown>).currencies) &&
  ((item as Record<string, unknown>).currencies as unknown[]).includes('Usdc')), 'Base Sepolia USDC demo is unavailable');

const draft = parseDraft(await requestJson(`${DEMO_URL}/drafts`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ network: 'BaseSepolia', currency: 'Usdc' }),
}));
const runDirectory = await mkdtemp(join(tmpdir(), 'priorseal-send21-'));
const journalPath = join(runDirectory, 'journal.json');
const issuerKeyPath = join(runDirectory, 'issuer-private.pem');
await writeFile(journalPath, `${json({ stage: 'DRAFT_CREATED', draft: draft.raw })}\n`, { mode: 0o600 });
process.stdout.write(`${json({ stage: 'DRAFT_CREATED', draftId: draft.id, recoveryJournal: journalPath })}\n`);
requireValue(draft.amount <= tokenBalance, 'Demo amount exceeds test wallet balance');
requireValue(draft.expiresAt - Math.floor(Date.now() / 1000) >= 300, 'Demo draft has too little time remaining');
const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [draft.receiver, draft.amount] });
const calldataHash = keccak256(data);
const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
const gasEstimate = await client.estimateGas({ account: account.address, to: draft.token, data, value: 0n });
const gas = gasEstimate * 125n / 100n;
const fees = await client.estimateFeesPerGas();
requireValue(fees.maxFeePerGas !== undefined && fees.maxPriorityFeePerGas !== undefined, 'EIP-1559 fees unavailable');
requireValue(nativeBalance > gas * fees.maxFeePerGas, 'Insufficient Base Sepolia ETH for estimated gas');
const issuedAt = Math.floor(Date.now() / 1000);
const intent = {
  schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1',
  intentId: `payment-draft-${draft.id}`, chainId: CHAIN_ID, action: 'CONTRACT_CALL',
  asset: `eip155:${CHAIN_ID}/erc20:${draft.token}`, amount: draft.amount.toString(),
  sender: account.address, recipient: draft.receiver, validUntil: draft.expiresAt,
  nonce: String(nonce), callTarget: draft.token, calldataHash, transactionValue: '0',
  contextCommitments: [{ namespace: 'payment-draft.id.utf8.v1', algorithm: 'sha256', digest: sha256(draft.id) }],
  constraints: { minConfirmations: 1 },
};
const authorizationDraft = assertIssuableAuthorization(buildAuthorization({
  intent, principal: { type: 'user', id: 'public-test-wallet', account: account.address },
  authorizer: { type: 'eip712', address: account.address },
  delegate: { agentId: 'payment-draft-fixture', executor: account.address },
  issuedAt, notBefore: issuedAt, expiresAt: draft.expiresAt,
  authorizationNonce: `0x${randomBytes(32).toString('hex')}`, maxUses: '1',
  audience: 'priorseal', policyHash: `0x${'0'.repeat(64)}`,
}));
const authorization = buildAuthorization({
  ...authorizationDraft, signature: await account.signTypedData(authorizationTypedData(authorizationDraft)),
});
const authorizationCheck = await verifyAuthorization(authorization, { now: issuedAt });
requireValue(authorizationCheck.valid, `PriorSeal authorization failed: ${authorizationCheck.code}`);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
await writeFile(issuerKeyPath, privateKeyPem, { mode: 0o600 });
const acceptedAt = Math.floor(Date.now() / 1000);
const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({ authorization, issuer: ISSUER, keyId: KEY_ID, acceptedAt }), privateKeyPem);
requireValue(acceptedAt < draft.expiresAt, 'Acceptance happened after draft expiry');
await writeFile(journalPath, `${json({ stage: 'AUTHORIZED', draft: draft.raw, authorization,
  acceptance, issuerPublicKey: publicKeyPem, issuerKeyPath })}\n`, { mode: 0o600 });

// The transaction signature and broadcast only occur after the independent
// PriorSeal authorization and signed local acceptance have been created.
const rawTransaction = await account.signTransaction({
  chainId: CHAIN_ID, type: 'eip1559', to: draft.token, data, value: 0n,
  nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
});
const broadcastAt = Math.floor(Date.now() / 1000);
const txHash = await client.sendRawTransaction({ serializedTransaction: rawTransaction });
await writeFile(journalPath, `${json({ stage: 'BROADCAST', draft: draft.raw, authorization,
  acceptance, issuerPublicKey: publicKeyPem, issuerKeyPath, broadcastAt, txHash })}\n`, { mode: 0o600 });
process.stdout.write(`${json({ stage: 'BROADCAST', draftId: draft.id, txHash })}\n`);
let chainReceipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 180_000 });
for (let attempt = 0; chainReceipt.blockHash === `0x${'0'.repeat(64)}` && attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  chainReceipt = await client.getTransactionReceipt({ hash: txHash });
}
requireValue(chainReceipt.blockHash !== `0x${'0'.repeat(64)}` && chainReceipt.blockNumber > 0n,
  'RPC did not return a canonical block for the transaction; use the recovery journal');
requireValue(chainReceipt.status === 'success', `Token transfer reverted: ${txHash}`);
const [transaction, block] = await Promise.all([
  client.getTransaction({ hash: txHash }), client.getBlock({ blockHash: chainReceipt.blockHash }),
]);
const observedAt = Math.floor(Date.now() / 1000);
const execution = {
  schema: 'priorseal.execution-observation.v1', chainId: CHAIN_ID, txHash,
  status: 'CONFIRMED', blockNumber: Number(chainReceipt.blockNumber), blockHash: chainReceipt.blockHash,
  executedAt: Number(block.timestamp), observedAt, action: 'CONTRACT_CALL',
  nonce: String(transaction.nonce), sender: transaction.from, recipient: transaction.to,
  target: transaction.to, calldataHash: keccak256(transaction.input),
  asset: `eip155:${CHAIN_ID}/erc20:${draft.token}`, amount: draft.amount.toString(),
  transfers: [], transferMatchUnique: false, nativeValue: transaction.value.toString(), tokenValue: draft.amount.toString(),
  gasUsed: chainReceipt.gasUsed.toString(), fee: (chainReceipt.gasUsed * chainReceipt.effectiveGasPrice).toString(),
  executionDataAvailable: true, observationSource: 'base-sepolia-public-rpc',
  finalityState: 'CONFIRMED', confirmations: 1,
};
requireValue(execution.executedAt <= draft.expiresAt, 'Execution block is later than demo expiry');
const negative = bindIntentExecution(authorization.intent, { ...execution, calldataHash: keccak256('0xdeadbeef') }, observedAt);
requireValue(!negative.bound && negative.reasonCodes.includes('CALLDATA_MISMATCH'), 'Changed calldata negative vector did not fail closed');
const receipt = signReceipt(buildAuthorizedReceipt({ authorization, acceptance, execution, issuer: ISSUER, keyId: KEY_ID, issuedAt: observedAt }), privateKeyPem);
const keyRegistry = { schema: 'priorseal.keys.v1', issuer: ISSUER, keys: [{
  issuer: ISSUER, keyId: KEY_ID, algorithm: 'Ed25519', publicKey: publicKeyPem,
  status: 'active', validFrom: issuedAt - 1, validUntil: null,
}] };
const verification = await verifyReceiptLocally(receipt, { trustedKeys: keyRegistry, now: observedAt });
requireValue(verification.valid && verification.code === 'OK' && verification.complianceStatus === 'COMPLIANT',
  `PriorSeal receipt verification failed: ${verification.code}`);

let finalDraft = draft.raw;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const snapshot = parseDraft(await requestJson(`${DEMO_URL}/drafts/${encodeURIComponent(draft.id)}`));
  finalDraft = snapshot.raw;
  if (snapshot.raw.status === 'Confirmed' || snapshot.raw.status === 'Expired') break;
  await new Promise((resolve) => setTimeout(resolve, 4_000));
}
requireValue(finalDraft.status === 'Confirmed', `send21 draft is not Confirmed: ${String(finalDraft.status)}`);
requireValue(typeof finalDraft.paidTxId === 'string' && finalDraft.paidTxId.toLowerCase() === txHash.toLowerCase(),
  'send21 reported a different paying transaction');
const fingerprint = createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex');
const bundle = {
  schema: 'payment-draft.base-sepolia-priorseal-evidence.v1',
  mode: 'LIVE_TESTNET_EXECUTION_LOCAL_EPHEMERAL_ISSUER',
  source: { demoConfigUrl: `${DEMO_URL}/config`, demoDraftUrl: `${DEMO_URL}/drafts/${draft.id}`,
    rpcSource: 'configured Base Sepolia RPC; endpoint and credentials not retained' },
  draft: { initial: draft.raw, final: finalDraft },
  derivedCall: { payer: account.address, nonce: String(nonce), to: draft.token, data, calldataHash, value: '0',
    amountBaseUnits: draft.amount.toString(), recipient: draft.receiver, contextDigest: sha256(draft.id) },
  priorSeal: { authorization, acceptance, receipt, keyRegistry, trustKeySpkiSha256: fingerprint },
  chain: { chainId: CHAIN_ID, txHash, blockNumber: Number(chainReceipt.blockNumber), blockHash: chainReceipt.blockHash,
    status: chainReceipt.status, executedAt: Number(block.timestamp), explorerUrl: `https://sepolia.basescan.org/tx/${txHash}` },
  testRecord: { authorizationSignedAt: issuedAt, locallyAcceptedAt: acceptedAt, broadcastAt, observedAt,
    authorizationSignature: authorizationCheck.code, receiptVerification: verification.code,
    positive: { result: 'PASS', binding: receipt.binding, compliance: receipt.compliance?.status },
    negative: { mutation: 'observed calldata hash replaced with keccak256(0xdeadbeef); no second transaction broadcast',
      result: 'PASS', binding: negative }, send21Status: finalDraft.status,
  },
  limits: { testnetOnly: true, localEphemeralIssuer: true, publicDevelopmentWallet: true,
    send21ReceiptSignatureAvailable: false, productionIntegrationClaimed: false },
};
await writeFile(OUTPUT, `${json(bundle)}\n`);
await rm(runDirectory, { recursive: true });
process.stdout.write(`${json({ status: 'PASS', draftId: draft.id, txHash, send21Status: finalDraft.status,
  priorSeal: verification.code, compliance: receipt.compliance?.status, negative: negative.reasonCodes,
  output: new URL(OUTPUT).pathname })}\n`);
