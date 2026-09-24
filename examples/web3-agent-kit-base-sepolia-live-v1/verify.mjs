#!/usr/bin/env node
// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";
import { baseSepolia } from "viem/chains";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
function record(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}
function string(value, path) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  return value;
}
function number(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer`);
  }
  return value;
}
function hex(value, path) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError(`${path} must be hex bytes`);
  }
  return value;
}
function hash(value, path) {
  const bytes = hex(value, path);
  if (!/^0x[0-9a-fA-F]{64}$/.test(bytes)) throw new TypeError(`${path} must be a 32-byte hash`);
  return bytes;
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function canonicalize(value) {
  if (value === void 0) throw new TypeError("undefined is not canonical JSON");
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("non-finite number is not canonical JSON");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === void 0) throw new TypeError("unsupported canonical JSON value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = record(value, "canonical JSON");
  return `{${Object.keys(object).sort().map((key2) => `${JSON.stringify(key2)}:${canonicalize(object[key2])}`).join(",")}}`;
}
const sha256Canonical = (value) => `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
const fingerprint = (pem) => createHash("sha256").update(createPublicKey(pem).export({ type: "spki", format: "der" })).digest("hex");
const directory = dirname(fileURLToPath(import.meta.url));
const bundle = record(readJson(resolve(directory, "evidence-bundle.json")), "evidence bundle");
const roots = record(readJson(resolve(directory, "trust-roots.json")), "trust roots");
const network = record(bundle.network, "bundle.network");
const chainResult = record(bundle.chainResult, "bundle.chainResult");
const transactionDraft = record(bundle.transactionDraft, "bundle.transactionDraft");
const governor = record(bundle.governor, "bundle.governor");
const policy = record(governor.policy, "bundle.governor.policy");
const decision = record(governor.decision, "bundle.governor.decision");
const limits = record(bundle.limits, "bundle.limits");
const priorSeal = record(bundle.priorSeal, "bundle.priorSeal");
const rootPriorSeal = record(roots.priorSeal, "roots.priorSeal");
const keyRegistry = record(priorSeal.keyRegistry, "bundle.priorSeal.keyRegistry");
if (!Array.isArray(keyRegistry.keys)) throw new TypeError("bundle.priorSeal.keyRegistry.keys must be an array");
const keys = keyRegistry.keys.map((entry, index) => record(entry, `bundle.priorSeal.keyRegistry.keys[${index}]`));
const receipt = record(priorSeal.receipt, "bundle.priorSeal.receipt");
const execution = record(receipt.execution, "bundle.priorSeal.receipt.execution");
const compliance = record(receipt.compliance, "bundle.priorSeal.receipt.compliance");
const binding = record(receipt.binding, "bundle.priorSeal.receipt.binding");
const txHash = hash(chainResult.txHash, "bundle.chainResult.txHash");
const calldata = hex(transactionDraft.data, "bundle.transactionDraft.data");
const calldataHash = hash(transactionDraft.calldataHash, "bundle.transactionDraft.calldataHash");
const draftFrom = string(transactionDraft.from, "bundle.transactionDraft.from");
const draftTo = string(transactionDraft.to, "bundle.transactionDraft.to");
const draftValue = string(transactionDraft.value, "bundle.transactionDraft.value");
const draftNonce = string(transactionDraft.nonce, "bundle.transactionDraft.nonce");
const rootTxHash = hash(roots.txHash, "roots.txHash");
const rootKeyId = string(rootPriorSeal.keyId, "roots.priorSeal.keyId");
const rootKeyFingerprint = string(rootPriorSeal.publicKeySpkiSha256, "roots.priorSeal.publicKeySpkiSha256");
const blockNumber = number(chainResult.blockNumber, "bundle.chainResult.blockNumber");
const assembledAt = number(bundle.assembledAt, "bundle.assembledAt");
const failures = [];
const requireClaim = (condition, code) => {
  if (!condition) failures.push(code);
};
requireClaim(bundle.schema === "web3-agent-kit.base-sepolia-live-evidence.v1", "BUNDLE_SCHEMA_UNSUPPORTED");
const { bundleHash, ...unsigned } = bundle;
requireClaim(bundleHash === sha256Canonical(unsigned), "BUNDLE_HASH_MISMATCH");
requireClaim(network.chainId === 84532 && roots.chainId === 84532, "CHAIN_MISMATCH");
requireClaim(txHash === rootTxHash, "TX_HASH_MISMATCH");
requireClaim(calldataHash === keccak256(calldata), "CALLDATA_HASH_MISMATCH");
requireClaim(policy.noAuthorizationBypass === true, "AUTHORIZATION_GATE_BYPASS");
requireClaim(decision.decision === "PROCEED_TO_PRINCIPAL_AUTHORIZATION", "GOVERNOR_DECISION_MISMATCH");
requireClaim(limits.insightLiveAssessmentPerformed === false, "INSIGHT_BOUNDARY_MISREPRESENTED");
const key = keys.find((entry) => entry.keyId === rootKeyId);
requireClaim(Boolean(key), "PRIORSEAL_KEY_UNKNOWN");
if (key) requireClaim(fingerprint(string(key.publicKey, "key.publicKey")) === rootKeyFingerprint, "PRIORSEAL_KEY_FINGERPRINT_MISMATCH");
const receiptVerification = await verifyReceiptLocally(receipt, {
  trustedKeys: keyRegistry,
  now: assembledAt
});
requireClaim(receiptVerification.valid && receiptVerification.code === "OK", `PRIORSEAL_${receiptVerification.code}`);
requireClaim(compliance.status === "COMPLIANT" && binding.bound === true, "PRIORSEAL_NOT_COMPLIANT");
const comparisons = [
  [execution.txHash, txHash, "RECEIPT_TX_HASH_MISMATCH"],
  [execution.target, draftTo, "RECEIPT_TARGET_MISMATCH"],
  [execution.calldataHash, calldataHash, "RECEIPT_CALLDATA_MISMATCH"],
  [execution.nativeValue, draftValue, "RECEIPT_VALUE_MISMATCH"],
  [execution.nonce, draftNonce, "RECEIPT_NONCE_MISMATCH"]
];
for (const [left, right, code] of comparisons) {
  requireClaim(String(left).toLowerCase() === String(right).toLowerCase(), code);
}
let online = null;
if (process.argv.includes("--online")) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org", { timeout: 3e4 })
  });
  const [transaction, chainReceipt] = await Promise.all([
    client.getTransaction({ hash: txHash }),
    client.getTransactionReceipt({ hash: txHash })
  ]);
  online = {
    status: chainReceipt.status,
    blockNumber: Number(chainReceipt.blockNumber),
    from: transaction.from,
    to: transaction.to,
    nonce: String(transaction.nonce),
    value: transaction.value.toString(),
    calldataHash: keccak256(transaction.input)
  };
  requireClaim(chainReceipt.status === "success", "ONLINE_TX_REVERTED");
  requireClaim(online.blockNumber === blockNumber, "ONLINE_BLOCK_MISMATCH");
  requireClaim(online.from.toLowerCase() === draftFrom.toLowerCase(), "ONLINE_SENDER_MISMATCH");
  requireClaim(online.to?.toLowerCase() === draftTo.toLowerCase(), "ONLINE_TARGET_MISMATCH");
  requireClaim(online.nonce === draftNonce, "ONLINE_NONCE_MISMATCH");
  requireClaim(online.value === draftValue, "ONLINE_VALUE_MISMATCH");
  requireClaim(online.calldataHash === calldataHash, "ONLINE_CALLDATA_MISMATCH");
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  failures,
  txHash,
  explorerUrl: chainResult.explorerUrl,
  offline: {
    bundleHashVerified: bundleHash === sha256Canonical(unsigned),
    priorSealReceipt: receiptVerification.code,
    exactCallBound: binding.bound,
    compliance: compliance.status,
    insightLiveAssessmentPerformed: limits.insightLiveAssessmentPerformed
  },
  ...online ? { online } : {}
};
process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
if (failures.length) process.exitCode = 1;
