#!/usr/bin/env node
// Generated from verify.mts by npm run core:build. Do not edit directly.
import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  http,
  keccak256
} from "viem";
import { baseSepolia } from "viem/chains";
import { bindIntentExecution } from "../../src/domain/binding.mjs";
import { verifyAuthorization } from "../../src/domain/authorization.mjs";
import { verifyReceiptLocally } from "../../sdk/dist/verifier.js";
const bundle = JSON.parse(
  await readFile(new URL("./evidence-bundle.json", import.meta.url), "utf8")
);
const roots = JSON.parse(
  await readFile(new URL("./trust-roots.json", import.meta.url), "utf8")
);
function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
}
function requireHex(value, bytes, label) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new TypeError(`${label} must be ${bytes}-byte hex`);
  }
}
function validateInputShape(bundleValue, rootsValue) {
  requireRecord(bundleValue, "evidence bundle");
  requireRecord(rootsValue, "trust roots");
  const bundle2 = bundleValue;
  const roots2 = rootsValue;
  requireRecord(bundle2.draft, "draft");
  requireRecord(bundle2.draft.initial, "initial draft");
  requireRecord(bundle2.draft.final, "final draft");
  requireRecord(bundle2.chain, "chain");
  requireRecord(bundle2.derivedCall, "derived call");
  requireRecord(bundle2.testRecord, "test record");
  requireRecord(bundle2.priorSeal, "PriorSeal evidence");
  requireRecord(bundle2.priorSeal.authorization, "authorization");
  requireRecord(bundle2.priorSeal.authorization.intent, "intent");
  requireRecord(bundle2.priorSeal.acceptance, "acceptance");
  requireRecord(bundle2.priorSeal.receipt, "receipt");
  requireRecord(bundle2.priorSeal.receipt.execution, "execution");
  requireRecord(bundle2.priorSeal.keyRegistry, "key registry");
  if (!Array.isArray(bundle2.priorSeal.keyRegistry.keys))
    throw new TypeError("key registry keys must be an array");
  requireRecord(bundle2.limits, "limits");
  if (typeof bundle2.draft.initial.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(bundle2.draft.initial.id))
    throw new TypeError("Invalid draft ID");
  if (typeof bundle2.draft.initial.amountBaseUnits !== "number" || !Number.isSafeInteger(bundle2.draft.initial.amountBaseUnits) || bundle2.draft.initial.amountBaseUnits <= 0)
    throw new TypeError("Invalid draft amount");
  if (typeof bundle2.draft.initial.expiresAt !== "string" || !Number.isFinite(Date.parse(bundle2.draft.initial.expiresAt)))
    throw new TypeError("Invalid draft expiry");
  for (const [label, value] of [
    ["draft receiver", bundle2.draft.initial.receiverAddress],
    ["draft token", bundle2.draft.initial.tokenAddress],
    ["payer", bundle2.derivedCall.payer],
    ["root payer", roots2.payer],
    ["root token", roots2.tokenAddress]
  ])
    requireHex(value, 20, label);
  for (const [label, value] of [
    ["root transaction", roots2.txHash],
    ["root block", roots2.blockHash],
    ["calldata hash", bundle2.derivedCall.calldataHash],
    ["context digest", bundle2.derivedCall.contextDigest]
  ])
    requireHex(value, 32, label);
  if (typeof bundle2.derivedCall.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bundle2.derivedCall.data))
    throw new TypeError("Invalid calldata");
  if (typeof bundle2.derivedCall.nonce !== "string" || !/^(0|[1-9][0-9]*)$/.test(bundle2.derivedCall.nonce))
    throw new TypeError("Invalid wallet nonce");
}
validateInputShape(bundle, roots);
const failures = [];
const check = (condition, code) => {
  if (!condition) failures.push(code);
};
const same = (left, right) => String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
const sha256 = (value) => `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" }
    ],
    outputs: [{ name: "success", type: "bool" }]
  }
];
check(
  bundle.schema === "payment-draft.base-sepolia-priorseal-evidence.v1",
  "BUNDLE_SCHEMA"
);
check(
  bundle.mode === "LIVE_TESTNET_EXECUTION_LOCAL_EPHEMERAL_ISSUER",
  "BUNDLE_MODE"
);
check(
  bundle.draft.initial.id === roots.draftId && bundle.draft.final.id === roots.draftId,
  "DRAFT_ID"
);
check(
  bundle.chain.txHash === roots.txHash && same(bundle.draft.final.paidTxId, roots.txHash),
  "TX_HASH"
);
check(
  bundle.chain.chainId === 84532 && bundle.draft.initial.network === "BaseSepolia",
  "CHAIN_ID"
);
check(
  bundle.draft.initial.currency === "Usdc" && bundle.draft.final.status === "Confirmed",
  "SEND21_STATUS"
);
for (const field of ["receiverAddress", "tokenAddress", "amountBaseUnits"]) {
  check(
    same(bundle.draft.initial[field], bundle.draft.final[field]),
    `DRAFT_${field.toUpperCase()}_CHANGED`
  );
}
check(
  Date.parse(bundle.draft.initial.expiresAt) === Date.parse(bundle.draft.final.expiresAt),
  "DRAFT_EXPIRY_CHANGED"
);
check(
  same(bundle.draft.initial.tokenAddress, roots.tokenAddress),
  "TOKEN_ADDRESS"
);
check(same(bundle.derivedCall.payer, roots.payer), "PAYER");
check(
  same(bundle.derivedCall.recipient, bundle.draft.initial.receiverAddress),
  "RECIPIENT"
);
check(same(bundle.derivedCall.to, bundle.draft.initial.tokenAddress), "TARGET");
check(
  bundle.derivedCall.amountBaseUnits === String(bundle.draft.initial.amountBaseUnits),
  "AMOUNT"
);
check(bundle.derivedCall.value === "0", "NATIVE_VALUE");
check(
  bundle.derivedCall.contextDigest === sha256(bundle.draft.initial.id),
  "DRAFT_ID_COMMITMENT"
);
let decoded = null;
try {
  decoded = decodeFunctionData({
    abi: TRANSFER_ABI,
    data: bundle.derivedCall.data
  });
} catch {
  failures.push("INVALID_TRANSFER_CALLDATA");
}
check(decoded?.functionName === "transfer", "TRANSFER_FUNCTION");
if (decoded?.functionName === "transfer") {
  check(
    same(decoded.args?.[0], bundle.draft.initial.receiverAddress),
    "TRANSFER_RECIPIENT"
  );
  check(
    String(decoded.args?.[1]) === String(bundle.draft.initial.amountBaseUnits),
    "TRANSFER_AMOUNT"
  );
}
const expectedData = encodeFunctionData({
  abi: TRANSFER_ABI,
  functionName: "transfer",
  args: [
    bundle.draft.initial.receiverAddress,
    BigInt(bundle.draft.initial.amountBaseUnits)
  ]
});
check(same(bundle.derivedCall.data, expectedData), "TRANSFER_ENCODING");
check(
  same(bundle.derivedCall.calldataHash, keccak256(expectedData)),
  "CALLDATA_HASH"
);
const { authorization, acceptance, receipt, keyRegistry } = bundle.priorSeal;
const intent = authorization.intent;
check(
  intent.schema === "priorseal.intent.v2" && intent.executionProfile === "priorseal.execution-profile.exact-call.v1",
  "INTENT_PROFILE"
);
check(
  intent.chainId === 84532 && intent.nonce === bundle.derivedCall.nonce,
  "INTENT_NONCE"
);
check(
  same(intent.sender, bundle.derivedCall.payer) && same(authorization.delegate.executor, bundle.derivedCall.payer),
  "INTENT_EXECUTOR"
);
check(same(intent.callTarget, bundle.derivedCall.to), "INTENT_TARGET");
check(
  same(intent.calldataHash, bundle.derivedCall.calldataHash),
  "INTENT_CALLDATA"
);
check(intent.transactionValue === "0", "INTENT_NATIVE_VALUE");
check(
  intent.validUntil === Math.floor(Date.parse(bundle.draft.initial.expiresAt) / 1e3),
  "INTENT_EXPIRY"
);
check(
  intent.contextCommitments?.length === 1 && intent.contextCommitments[0].namespace === "payment-draft.id.utf8.v1" && intent.contextCommitments[0].algorithm === "sha256" && same(intent.contextCommitments[0].digest, bundle.derivedCall.contextDigest),
  "INTENT_CONTEXT"
);
check(authorization.expiresAt === intent.validUntil, "AUTHORIZATION_EXPIRY");
check(
  bundle.testRecord.authorizationSignedAt <= bundle.testRecord.locallyAcceptedAt && bundle.testRecord.locallyAcceptedAt <= bundle.testRecord.broadcastAt,
  "SCRIPT_EVENT_ORDER"
);
const authorizationResult = await verifyAuthorization(authorization, {
  now: bundle.testRecord.authorizationSignedAt
});
check(
  authorizationResult.valid && authorizationResult.code === "OK",
  `AUTHORIZATION_${authorizationResult.code}`
);
const key = keyRegistry.keys.find(
  (entry) => entry.keyId === receipt.keyId
);
check(Boolean(key), "ISSUER_KEY");
if (key) {
  const fingerprint = createHash("sha256").update(
    createPublicKey(key.publicKey).export({ type: "spki", format: "der" })
  ).digest("hex");
  check(fingerprint === roots.issuerKeySpkiSha256, "ISSUER_KEY_FINGERPRINT");
}
check(
  acceptance.acceptedAt === bundle.testRecord.locallyAcceptedAt,
  "ACCEPTANCE_TIME"
);
const receiptResult = await verifyReceiptLocally(receipt, {
  trustedKeys: keyRegistry,
  now: bundle.testRecord.observedAt
});
check(
  receiptResult.valid && receiptResult.code === "OK",
  `PRIORSEAL_${receiptResult.code}`
);
check(
  receiptResult.complianceStatus === "COMPLIANT" && receipt.binding.bound === true,
  "POSITIVE_COMPLIANCE"
);
check(
  same(receipt.execution.txHash, roots.txHash) && same(receipt.execution.calldataHash, bundle.derivedCall.calldataHash),
  "RECEIPT_EXECUTION"
);
const positive = bindIntentExecution(
  intent,
  receipt.execution,
  bundle.testRecord.observedAt
);
check(positive.bound && positive.reasonCodes.length === 0, "POSITIVE_BINDING");
const negative = bindIntentExecution(
  intent,
  { ...receipt.execution, calldataHash: keccak256("0xdeadbeef") },
  bundle.testRecord.observedAt
);
check(
  !negative.bound && negative.reasonCodes.includes("CALLDATA_MISMATCH"),
  "NEGATIVE_CALLDATA_FAIL_CLOSED"
);
check(
  bundle.chain.executedAt <= intent.validUntil && bundle.chain.executedAt >= authorization.issuedAt,
  "EXECUTION_WINDOW"
);
check(
  bundle.limits.testnetOnly === true && bundle.limits.localEphemeralIssuer === true && bundle.limits.publicDevelopmentWallet === true && bundle.limits.productionIntegrationClaimed === false,
  "CLAIM_BOUNDARY"
);
let online;
if (process.argv.includes("--online")) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(
      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      { timeout: 3e4 }
    )
  });
  check(await client.getChainId() === 84532, "ONLINE_CHAIN");
  const [transaction, chainReceipt, block, send21Response] = await Promise.all([
    client.getTransaction({ hash: roots.txHash }),
    client.getTransactionReceipt({ hash: roots.txHash }),
    client.getBlock({ blockNumber: BigInt(bundle.chain.blockNumber) }),
    fetch(
      `https://send21.io/api/v1/demo/drafts/${encodeURIComponent(roots.draftId)}`,
      { signal: AbortSignal.timeout(2e4) }
    )
  ]);
  check(send21Response.ok, "ONLINE_SEND21_HTTP");
  const liveValue = send21Response.ok ? await send21Response.json() : null;
  const liveDraft = liveValue && typeof liveValue === "object" && !Array.isArray(liveValue) ? liveValue : null;
  check(
    liveDraft?.status === "Confirmed" && same(liveDraft?.paidTxId, roots.txHash),
    "ONLINE_SEND21_STATUS"
  );
  check(
    chainReceipt.status === "success" && same(chainReceipt.blockHash, roots.blockHash),
    "ONLINE_RECEIPT"
  );
  check(
    same(block.hash, roots.blockHash) && Number(block.timestamp) === bundle.chain.executedAt,
    "ONLINE_BLOCK"
  );
  check(
    same(transaction.from, roots.payer) && same(transaction.to, roots.tokenAddress),
    "ONLINE_PARTIES"
  );
  check(String(transaction.nonce) === bundle.derivedCall.nonce, "ONLINE_NONCE");
  check(
    transaction.value === 0n && same(transaction.input, expectedData),
    "ONLINE_CALL"
  );
  online = {
    send21Status: liveDraft?.status,
    txStatus: chainReceipt.status,
    blockNumber: Number(chainReceipt.blockNumber)
  };
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  failures,
  draftId: roots.draftId,
  txHash: roots.txHash,
  authorization: authorizationResult.code,
  receipt: receiptResult.code,
  compliance: receiptResult.complianceStatus,
  positive: positive.bound ? "PASS" : "FAIL",
  negative: negative.reasonCodes,
  ...online ? { online } : {}
};
process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
if (failures.length) process.exitCode = 1;
