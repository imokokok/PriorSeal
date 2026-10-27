// Generated from x402-staging-credit-pack-rehearsal.mts by npm run core:build:operations. Do not edit directly.
import { createHash } from "node:crypto";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
const CONFIRMATION_FLAG = "--confirm-single-payment";
const STAGING_ORIGIN = "https://priorseal-staging.priorseal.workers.dev";
const PACK_ID = "staging-10";
const PATH = `/v1/agent-credit-packs/${PACK_ID}/checkout`;
const TARGET_URL = `${STAGING_ORIGIN}${PATH}`;
const NETWORK = "eip155:84532";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_TO = "0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231";
const AMOUNT = "100000";
const CREDITS = "10";
if (Number(process.versions.node.split(".")[0]) < 22) {
  throw new TypeError("x402 staging Credit-pack rehearsal requires Node.js 22 or newer");
}
if (process.argv.length !== 3 || process.argv[2] !== CONFIRMATION_FLAG) {
  throw new TypeError(`Refusing to sign a payment. Rerun with ${CONFIRMATION_FLAG} after an explicit GO.`);
}
const rawKey = process.env.X402_E2E_PRIVATE_KEY?.trim();
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  throw new TypeError("X402_E2E_PRIVATE_KEY must be a dedicated 32-byte 0x-prefixed Base Sepolia test-wallet key");
}
const signer = privateKeyToAccount(rawKey);
const agentCredential = `psa_staging_credit_pack_${createHash("sha256").update(`agent:${rawKey}`, "utf8").digest("hex")}`;
const accountBefore = await account();
let signedRequestCount = 0;
const guardedFetch = async (input, init) => {
  const request = new Request(input, { ...init, redirect: "error" });
  if (request.url !== TARGET_URL || request.method !== "GET" || request.body !== null || request.headers.get("x-priorseal-agent-key") !== agentCredential) {
    throw new TypeError("Refusing a payment-client request outside the fixed authenticated staging Credit-pack checkout");
  }
  if (request.headers.has("payment-signature")) {
    signedRequestCount++;
    if (signedRequestCount > 1) throw new TypeError("Refusing more than one signed payment request");
  }
  const response2 = await fetch(request);
  if (response2.status === 402) assertExpectedChallenge(response2.headers.get("payment-required"));
  return response2;
};
const initial = await guardedFetch(TARGET_URL, { headers: authenticatedHeaders() });
if (initial.status !== 402) throw new TypeError(`Expected the initial staging Credit-pack quote to be HTTP 402, got ${initial.status}`);
await initial.body?.cancel();
console.log(JSON.stringify({ stage: "quote-validated", packId: PACK_ID, network: NETWORK, asset: ASSET, payTo: PAY_TO, amount: AMOUNT, credits: CREDITS }));
const client = x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer), x402Version: 2 }] });
const paidFetch = wrapFetchWithPayment(guardedFetch, client);
const response = await paidFetch(TARGET_URL, { headers: authenticatedHeaders() });
if (!response.ok) throw new TypeError(`Paid staging Credit-pack request failed with HTTP ${response.status}: ${safeErrorText(await response.text())}`);
if (signedRequestCount !== 1) throw new TypeError("Expected exactly one signed payment request");
const body = requireRecord(await response.json(), "Paid staging Credit-pack response was not a JSON object");
const purchase = requireRecord(body.purchase, "Paid staging Credit-pack response is missing purchase data");
const creditedAccount = requireRecord(body.account, "Paid staging Credit-pack response is missing account data");
if (body.status !== "CREDITS_GRANTED" || purchase.packId !== PACK_ID || purchase.credits !== CREDITS || purchase.state !== "CREDITED" || typeof purchase.purchaseId !== "string" || !/^xcp_[0-9a-f]{32}$/.test(purchase.purchaseId) || creditedAccount.accountId !== accountBefore.accountId || creditedAccount.remainingCredits !== (BigInt(requiredString(accountBefore.remainingCredits, "account.remainingCredits")) + BigInt(CREDITS)).toString()) {
  throw new TypeError("Paid staging Credit-pack response does not show exactly one matching credit delivery");
}
const receipt = decodeBase64Json(response.headers.get("payment-response"), "PAYMENT-RESPONSE");
if (receipt.success !== true || receipt.network !== NETWORK || receipt.amount !== void 0 && receipt.amount !== AMOUNT || typeof receipt.transaction !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction) || typeof receipt.payer !== "string" || receipt.payer.toLowerCase() !== signer.address.toLowerCase()) {
  throw new TypeError("Paid staging Credit-pack response did not contain a matching successful settlement receipt");
}
const statusResponse = await fetch(`${STAGING_ORIGIN}/v1/agent-credit-packs/purchases/${purchase.purchaseId}`, { headers: authenticatedHeaders(), redirect: "error" });
if (!statusResponse.ok) throw new TypeError(`Credit-pack delivery status lookup failed with HTTP ${statusResponse.status}`);
const status = requireRecord(await statusResponse.json(), "Credit-pack delivery status was not a JSON object");
const statusPurchase = requireRecord(status.purchase, "Credit-pack delivery status is missing purchase data");
if (statusPurchase.purchaseId !== purchase.purchaseId || statusPurchase.state !== "CREDITED" || statusPurchase.credits !== CREDITS) throw new TypeError("Credit-pack delivery status does not reconcile with checkout delivery");
console.log(JSON.stringify({
  stage: "credit-pack-settlement-confirmed",
  status: response.status,
  packId: PACK_ID,
  credits: CREDITS,
  purchaseId: purchase.purchaseId,
  resourceUrl: TARGET_URL,
  network: NETWORK,
  asset: ASSET,
  amount: AMOUNT,
  receiptAmount: receipt.amount ?? null,
  payTo: PAY_TO,
  payer: receipt.payer,
  transaction: receipt.transaction,
  previousCredits: accountBefore.remainingCredits,
  resultingCredits: creditedAccount.remainingCredits
}));
async function account() {
  const response2 = await fetch(`${STAGING_ORIGIN}/v1/agent-accounts/self`, { headers: authenticatedHeaders(), redirect: "error" });
  if (!response2.ok) throw new TypeError(`Staging rehearsal Agent account lookup failed with HTTP ${response2.status}`);
  const body2 = requireRecord(await response2.json(), "Staging rehearsal Agent account response was not a JSON object");
  const account2 = requireRecord(body2.account, "Staging rehearsal Agent account response is missing account data");
  if (account2.accountId !== "staging:credit-pack-rehearsal" || !/^[1-9][0-9]*$/.test(requiredString(account2.remainingCredits, "account.remainingCredits"))) throw new TypeError("Staging rehearsal Agent account is invalid");
  return account2;
}
function authenticatedHeaders() {
  return { accept: "application/json", "x-priorseal-agent-key": agentCredential };
}
function assertExpectedChallenge(header) {
  const challenge = decodeBase64Json(header, "PAYMENT-REQUIRED");
  if (challenge.x402Version !== 2 || !isRecord(challenge.resource) || challenge.resource.url !== TARGET_URL || !Array.isArray(challenge.accepts) || challenge.accepts.length !== 1) throw new TypeError("Staging Credit-pack challenge does not describe exactly one expected resource and requirement");
  const requirement = requireRecord(challenge.accepts[0], "Staging Credit-pack challenge has an invalid requirement");
  if (requirement.scheme !== "exact" || requirement.network !== NETWORK || requirement.amount !== AMOUNT || !sameAddress(requirement.asset, ASSET) || !sameAddress(requirement.payTo, PAY_TO)) throw new TypeError("Staging Credit-pack challenge differs from the approved Base Sepolia $0.10 test-USDC terms");
}
function decodeBase64Json(header, name) {
  if (!header) throw new TypeError(`${name} header is missing`);
  try {
    return requireRecord(JSON.parse(Buffer.from(header, "base64").toString("utf8")), `${name} header is not a JSON object`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${name} header is not base64 JSON`);
  }
}
function sameAddress(left, right) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}
function safeErrorText(value) {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 512);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireRecord(value, message) {
  if (!isRecord(value)) throw new TypeError(message);
  return value;
}
function requiredString(value, label) {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} is missing`);
  return value;
}
