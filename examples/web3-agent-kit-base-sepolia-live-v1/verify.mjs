#!/usr/bin/env node

import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256 } from 'viem';
import { baseSepolia } from 'viem/chains';
import { verifyReceiptLocally } from '../../sdk/dist/verifier.js';

const directory = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(resolve(directory, 'evidence-bundle.json'), 'utf8'));
const roots = JSON.parse(readFileSync(resolve(directory, 'trust-roots.json'), 'utf8'));
const failures = [];
const requireClaim = (condition, code) => { if (!condition) failures.push(code); };
function canonicalize(value) {
  if (value === undefined) throw new TypeError('undefined is not canonical JSON');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number is not canonical JSON');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
const sha256Canonical = (value) => `0x${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
const fingerprint = (pem) => createHash('sha256')
  .update(createPublicKey(pem).export({ type: 'spki', format: 'der' }))
  .digest('hex');

requireClaim(bundle.schema === 'web3-agent-kit.base-sepolia-live-evidence.v1', 'BUNDLE_SCHEMA_UNSUPPORTED');
const { bundleHash, ...unsigned } = bundle;
requireClaim(bundleHash === sha256Canonical(unsigned), 'BUNDLE_HASH_MISMATCH');
requireClaim(bundle.network.chainId === 84532 && roots.chainId === 84532, 'CHAIN_MISMATCH');
requireClaim(bundle.chainResult.txHash === roots.txHash, 'TX_HASH_MISMATCH');
requireClaim(bundle.transactionDraft.calldataHash === keccak256(bundle.transactionDraft.data), 'CALLDATA_HASH_MISMATCH');
requireClaim(bundle.governor.policy.noAuthorizationBypass === true, 'AUTHORIZATION_GATE_BYPASS');
requireClaim(bundle.governor.decision.decision === 'PROCEED_TO_PRINCIPAL_AUTHORIZATION', 'GOVERNOR_DECISION_MISMATCH');
requireClaim(bundle.limits.insightLiveAssessmentPerformed === false, 'INSIGHT_BOUNDARY_MISREPRESENTED');
const receipt = bundle.priorSeal.receipt;
const key = bundle.priorSeal.keyRegistry.keys.find((entry) => entry.keyId === roots.priorSeal.keyId);
requireClaim(Boolean(key), 'PRIORSEAL_KEY_UNKNOWN');
if (key) requireClaim(fingerprint(key.publicKey) === roots.priorSeal.publicKeySpkiSha256, 'PRIORSEAL_KEY_FINGERPRINT_MISMATCH');
const receiptVerification = await verifyReceiptLocally(receipt, {
  trustedKeys: bundle.priorSeal.keyRegistry,
  now: bundle.assembledAt,
});
requireClaim(receiptVerification.valid && receiptVerification.code === 'OK', `PRIORSEAL_${receiptVerification.code}`);
requireClaim(receipt.compliance.status === 'COMPLIANT' && receipt.binding.bound === true, 'PRIORSEAL_NOT_COMPLIANT');
for (const [left, right, code] of [
  [receipt.execution.txHash, bundle.chainResult.txHash, 'RECEIPT_TX_HASH_MISMATCH'],
  [receipt.execution.target, bundle.transactionDraft.to, 'RECEIPT_TARGET_MISMATCH'],
  [receipt.execution.calldataHash, bundle.transactionDraft.calldataHash, 'RECEIPT_CALLDATA_MISMATCH'],
  [receipt.execution.nativeValue, bundle.transactionDraft.value, 'RECEIPT_VALUE_MISMATCH'],
  [receipt.execution.nonce, bundle.transactionDraft.nonce, 'RECEIPT_NONCE_MISMATCH'],
]) requireClaim(String(left).toLowerCase() === String(right).toLowerCase(), code);

let online = null;
if (process.argv.includes('--online')) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org', { timeout: 30_000 }),
  });
  const [transaction, chainReceipt] = await Promise.all([
    client.getTransaction({ hash: bundle.chainResult.txHash }),
    client.getTransactionReceipt({ hash: bundle.chainResult.txHash }),
  ]);
  online = {
    status: chainReceipt.status,
    blockNumber: Number(chainReceipt.blockNumber),
    from: transaction.from,
    to: transaction.to,
    nonce: String(transaction.nonce),
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input),
  };
  requireClaim(chainReceipt.status === 'success', 'ONLINE_TX_REVERTED');
  requireClaim(online.blockNumber === bundle.chainResult.blockNumber, 'ONLINE_BLOCK_MISMATCH');
  requireClaim(online.from.toLowerCase() === bundle.transactionDraft.from.toLowerCase(), 'ONLINE_SENDER_MISMATCH');
  requireClaim(online.to?.toLowerCase() === bundle.transactionDraft.to.toLowerCase(), 'ONLINE_TARGET_MISMATCH');
  requireClaim(online.nonce === bundle.transactionDraft.nonce, 'ONLINE_NONCE_MISMATCH');
  requireClaim(online.value === bundle.transactionDraft.value, 'ONLINE_VALUE_MISMATCH');
  requireClaim(online.calldataHash === bundle.transactionDraft.calldataHash, 'ONLINE_CALLDATA_MISMATCH');
}

const result = {
  status: failures.length ? 'FAIL' : 'PASS',
  failures,
  txHash: bundle.chainResult.txHash,
  explorerUrl: bundle.chainResult.explorerUrl,
  offline: {
    bundleHashVerified: bundleHash === sha256Canonical(unsigned),
    priorSealReceipt: receiptVerification.code,
    exactCallBound: receipt.binding.bound,
    compliance: receipt.compliance.status,
    insightLiveAssessmentPerformed: bundle.limits.insightLiveAssessmentPerformed,
  },
  ...(online ? { online } : {}),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
