#!/usr/bin/env node

import { createHash, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient, decodeFunctionData, encodeFunctionData, http, keccak256, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { bindIntentExecution } from '../../src/domain/binding.mjs';
import { verifyAuthorization } from '../../src/domain/authorization.mjs';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';

const bundle = JSON.parse(await readFile(new URL('./evidence-bundle.json', import.meta.url), 'utf8'));
const roots = JSON.parse(await readFile(new URL('./trust-roots.json', import.meta.url), 'utf8'));
const failures: string[] = [];
const check = (condition: unknown, code: string) => { if (!condition) failures.push(code); };
const same = (left: unknown, right: unknown) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();
const sha256 = (value: string) => `0x${createHash('sha256').update(value, 'utf8').digest('hex')}`;
const TRANSFER_ABI = [{
  type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }],
  outputs: [{ name: 'success', type: 'bool' }],
}] as const;

check(bundle.schema === 'payment-draft.base-sepolia-priorseal-evidence.v1', 'BUNDLE_SCHEMA');
check(bundle.mode === 'LIVE_TESTNET_EXECUTION_LOCAL_EPHEMERAL_ISSUER', 'BUNDLE_MODE');
check(bundle.draft.initial.id === roots.draftId && bundle.draft.final.id === roots.draftId, 'DRAFT_ID');
check(bundle.chain.txHash === roots.txHash && same(bundle.draft.final.paidTxId, roots.txHash), 'TX_HASH');
check(bundle.chain.chainId === 84532 && bundle.draft.initial.network === 'BaseSepolia', 'CHAIN_ID');
check(bundle.draft.initial.currency === 'Usdc' && bundle.draft.final.status === 'Confirmed', 'SEND21_STATUS');
for (const field of ['receiverAddress', 'tokenAddress', 'amountBaseUnits']) {
  check(same(bundle.draft.initial[field], bundle.draft.final[field]), `DRAFT_${field.toUpperCase()}_CHANGED`);
}
check(Date.parse(bundle.draft.initial.expiresAt) === Date.parse(bundle.draft.final.expiresAt), 'DRAFT_EXPIRY_CHANGED');
check(same(bundle.draft.initial.tokenAddress, roots.tokenAddress), 'TOKEN_ADDRESS');
check(same(bundle.derivedCall.payer, roots.payer), 'PAYER');
check(same(bundle.derivedCall.recipient, bundle.draft.initial.receiverAddress), 'RECIPIENT');
check(same(bundle.derivedCall.to, bundle.draft.initial.tokenAddress), 'TARGET');
check(bundle.derivedCall.amountBaseUnits === String(bundle.draft.initial.amountBaseUnits), 'AMOUNT');
check(bundle.derivedCall.value === '0', 'NATIVE_VALUE');
check(bundle.derivedCall.contextDigest === sha256(bundle.draft.initial.id), 'DRAFT_ID_COMMITMENT');
let decoded: ReturnType<typeof decodeFunctionData> | null = null;
try { decoded = decodeFunctionData({ abi: TRANSFER_ABI, data: bundle.derivedCall.data }); }
catch { failures.push('INVALID_TRANSFER_CALLDATA'); }
check(decoded?.functionName === 'transfer', 'TRANSFER_FUNCTION');
if (decoded?.functionName === 'transfer') {
  check(same(decoded.args?.[0], bundle.draft.initial.receiverAddress), 'TRANSFER_RECIPIENT');
  check(String(decoded.args?.[1]) === String(bundle.draft.initial.amountBaseUnits), 'TRANSFER_AMOUNT');
}
const expectedData = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer',
  args: [bundle.draft.initial.receiverAddress as Address, BigInt(bundle.draft.initial.amountBaseUnits)] });
check(same(bundle.derivedCall.data, expectedData), 'TRANSFER_ENCODING');
check(same(bundle.derivedCall.calldataHash, keccak256(expectedData)), 'CALLDATA_HASH');

const { authorization, acceptance, receipt, keyRegistry } = bundle.priorSeal;
const intent = authorization.intent;
check(intent.schema === 'priorseal.intent.v2' && intent.executionProfile === 'priorseal.execution-profile.exact-call.v1', 'INTENT_PROFILE');
check(intent.chainId === 84532 && intent.nonce === bundle.derivedCall.nonce, 'INTENT_NONCE');
check(same(intent.sender, bundle.derivedCall.payer) && same(authorization.delegate.executor, bundle.derivedCall.payer), 'INTENT_EXECUTOR');
check(same(intent.callTarget, bundle.derivedCall.to), 'INTENT_TARGET');
check(same(intent.calldataHash, bundle.derivedCall.calldataHash), 'INTENT_CALLDATA');
check(intent.transactionValue === '0', 'INTENT_NATIVE_VALUE');
check(intent.validUntil === Math.floor(Date.parse(bundle.draft.initial.expiresAt) / 1000), 'INTENT_EXPIRY');
check(intent.contextCommitments?.length === 1 && intent.contextCommitments[0].namespace === 'payment-draft.id.utf8.v1' &&
  intent.contextCommitments[0].algorithm === 'sha256' && same(intent.contextCommitments[0].digest, bundle.derivedCall.contextDigest), 'INTENT_CONTEXT');
check(authorization.expiresAt === intent.validUntil, 'AUTHORIZATION_EXPIRY');
check(bundle.testRecord.authorizationSignedAt <= bundle.testRecord.locallyAcceptedAt &&
  bundle.testRecord.locallyAcceptedAt <= bundle.testRecord.broadcastAt, 'SCRIPT_EVENT_ORDER');
const authorizationResult = await verifyAuthorization(authorization, { now: bundle.testRecord.authorizationSignedAt });
check(authorizationResult.valid && authorizationResult.code === 'OK', `AUTHORIZATION_${authorizationResult.code}`);
const key = keyRegistry.keys.find((entry: { keyId: string }) => entry.keyId === receipt.keyId);
check(Boolean(key), 'ISSUER_KEY');
if (key) {
  const fingerprint = createHash('sha256').update(createPublicKey(key.publicKey).export({ type: 'spki', format: 'der' })).digest('hex');
  check(fingerprint === roots.issuerKeySpkiSha256, 'ISSUER_KEY_FINGERPRINT');
}
check(acceptance.acceptedAt === bundle.testRecord.locallyAcceptedAt, 'ACCEPTANCE_TIME');
const receiptResult = await verifyReceiptLocally(receipt, { trustedKeys: keyRegistry, now: bundle.testRecord.observedAt });
check(receiptResult.valid && receiptResult.code === 'OK', `PRIORSEAL_${receiptResult.code}`);
check(receiptResult.complianceStatus === 'COMPLIANT' && receipt.binding.bound === true, 'POSITIVE_COMPLIANCE');
check(same(receipt.execution.txHash, roots.txHash) && same(receipt.execution.calldataHash, bundle.derivedCall.calldataHash), 'RECEIPT_EXECUTION');
const positive = bindIntentExecution(intent, receipt.execution, bundle.testRecord.observedAt);
check(positive.bound && positive.reasonCodes.length === 0, 'POSITIVE_BINDING');
const negative = bindIntentExecution(intent, { ...receipt.execution, calldataHash: keccak256('0xdeadbeef') }, bundle.testRecord.observedAt);
check(!negative.bound && negative.reasonCodes.includes('CALLDATA_MISMATCH'), 'NEGATIVE_CALLDATA_FAIL_CLOSED');
check(bundle.chain.executedAt <= intent.validUntil && bundle.chain.executedAt >= authorization.issuedAt, 'EXECUTION_WINDOW');
check(bundle.limits.testnetOnly === true && bundle.limits.localEphemeralIssuer === true &&
  bundle.limits.publicDevelopmentWallet === true && bundle.limits.productionIntegrationClaimed === false, 'CLAIM_BOUNDARY');

let online: Record<string, unknown> | undefined;
if (process.argv.includes('--online')) {
  const client = createPublicClient({ chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org', { timeout: 30_000 }) });
  check(await client.getChainId() === 84532, 'ONLINE_CHAIN');
  const [transaction, chainReceipt, block, send21Response] = await Promise.all([
    client.getTransaction({ hash: roots.txHash }),
    client.getTransactionReceipt({ hash: roots.txHash }),
    client.getBlock({ blockNumber: BigInt(bundle.chain.blockNumber) }),
    fetch(`https://send21.io/api/v1/demo/drafts/${encodeURIComponent(roots.draftId)}`, { signal: AbortSignal.timeout(20_000) }),
  ]);
  check(send21Response.ok, 'ONLINE_SEND21_HTTP');
  const liveValue: unknown = send21Response.ok ? await send21Response.json() : null;
  const liveDraft = liveValue && typeof liveValue === 'object' && !Array.isArray(liveValue)
    ? liveValue as Record<string, unknown> : null;
  check(liveDraft?.status === 'Confirmed' && same(liveDraft?.paidTxId, roots.txHash), 'ONLINE_SEND21_STATUS');
  check(chainReceipt.status === 'success' && same(chainReceipt.blockHash, roots.blockHash), 'ONLINE_RECEIPT');
  check(same(block.hash, roots.blockHash) && Number(block.timestamp) === bundle.chain.executedAt, 'ONLINE_BLOCK');
  check(same(transaction.from, roots.payer) && same(transaction.to, roots.tokenAddress), 'ONLINE_PARTIES');
  check(String(transaction.nonce) === bundle.derivedCall.nonce, 'ONLINE_NONCE');
  check(transaction.value === 0n && same(transaction.input, expectedData), 'ONLINE_CALL');
  online = { send21Status: liveDraft?.status, txStatus: chainReceipt.status, blockNumber: Number(chainReceipt.blockNumber) };
}

const result = { status: failures.length ? 'FAIL' : 'PASS', failures, draftId: roots.draftId,
  txHash: roots.txHash, authorization: authorizationResult.code, receipt: receiptResult.code,
  compliance: receiptResult.complianceStatus, positive: positive.bound ? 'PASS' : 'FAIL',
  negative: negative.reasonCodes, ...(online ? { online } : {}) };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
