// Generated from verify.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { encodeFunctionData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { V3_SINGLE_SWAP_ABI, assertV3SwapAuthorization, buildV3SwapIntent, compareV3SwapReplan, createV3SwapApproval } from "../../sdk/dist/index.js";
const account = privateKeyToAccount(`0x${"7".repeat(64)}`);
const router = `0x${"2".repeat(40)}`;
const tokenIn = `0x${"3".repeat(40)}`;
const tokenOut = `0x${"4".repeat(40)}`;
const recipient = `0x${"5".repeat(40)}`;
const code = "0x60006000";
const now = 18e8;
const params = { tokenIn, tokenOut, fee: 3e3, recipient, deadline: BigInt(now + 120), amountIn: 1000000n, amountOutMinimum: 900000n, sqrtPriceLimitX96: 0n };
const makeTransaction = (swap) => ({ chainId: 8453, from: account.address.toLowerCase(), to: router, nonce: "7", value: "0", data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: "exactInputSingle", args: [swap] }) });
const original = makeTransaction(params);
const approval = createV3SwapApproval(original, keccak256(code));
const intent = buildV3SwapIntent({ approval, transaction: original, intentId: "approved-swap", validUntil: now + 90, now });
assertV3SwapAuthorization({ approval, transaction: original, intent, routerBytecode: code, now });
console.log("Approved: one exact ERC-20 swap.");
for (const [label, change] of [
  ["recipient", { recipient: account.address }],
  ["input amount", { amountIn: 1100000n }],
  ["minimum output", { amountOutMinimum: 800000n }],
  ["pool fee", { fee: 500 }]
]) {
  const proposed2 = makeTransaction({ ...params, ...change });
  const diff = compareV3SwapReplan({ approval, originalTransaction: original, proposedTransaction: proposed2, intent });
  assert.equal(diff.sameApprovedCall, false);
  assert.ok(diff.changes.some((entry) => entry.field === label));
  assert.throws(() => assertV3SwapAuthorization({ approval, transaction: proposed2, intent, routerBytecode: code, now }));
  console.log(`Rejected ${label} replan: ${diff.changes.map((entry) => entry.field).join(", ")}`);
}
const proposed = makeTransaction({ ...params, recipient: account.address });
const newApproval = createV3SwapApproval(proposed, keccak256(code));
const newIntent = buildV3SwapIntent({ approval: newApproval, transaction: proposed, intentId: "new-swap", validUntil: now + 90, now });
assertV3SwapAuthorization({ approval: newApproval, transaction: proposed, intent: newIntent, routerBytecode: code, now });
assert.notEqual(newIntent.calldataHash, intent.calldataHash);
console.log("A fresh intent for the changed recipient passes the local guard; it would still require a new principal signature and acceptance.");
console.log("No transaction was sent.");
