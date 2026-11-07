// Generated from x402-staging-target-readiness-rehearsal.mts by npm run core:build:operations. Do not edit directly.
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
const CONFIRMATION_FLAG = "--confirm-single-payment";
const STAGING_ORIGIN = "https://priorseal-staging.priorseal.workers.dev";
const NETWORK = "eip155:84532";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_TO = "0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231";
const AMOUNT = "10000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
if (Number(process.versions.node.split(".")[0]) < 22) throw new TypeError("x402 staging target-readiness rehearsal requires Node.js 22 or newer");
if (process.argv.length !== 3 || process.argv[2] !== CONFIRMATION_FLAG) throw new TypeError(`Refusing to sign a payment. Rerun with ${CONFIRMATION_FLAG} after an explicit GO.`);
const rawKey = process.env.X402_E2E_PRIVATE_KEY?.trim();
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) throw new TypeError("X402_E2E_PRIVATE_KEY must be a dedicated 32-byte 0x-prefixed Base Sepolia test-wallet key");
const signer = privateKeyToAccount(rawKey);
const subjectAddress = signer.address.toLowerCase();
if (subjectAddress === ZERO_ADDRESS) throw new TypeError("The staging payer address must be a non-zero public EVM target");
const targetUrl = new URL("/v1/integration-readiness", STAGING_ORIGIN);
targetUrl.searchParams.set("chainId", "84532");
targetUrl.searchParams.set("subjectAddress", subjectAddress);
const TARGET_URL = targetUrl.toString();
let signedRequestCount = 0;
const guardedFetch = async (input, init) => {
  const request = new Request(input, { ...init, redirect: "error" });
  if (request.url !== TARGET_URL || request.method !== "GET" || request.body !== null) throw new TypeError("Refusing a payment-client request outside the fixed staging real-target readiness rehearsal");
  if (request.headers.has("payment-signature")) {
    signedRequestCount += 1;
    if (signedRequestCount > 1) throw new TypeError("Refusing more than one signed payment request");
  }
  const response2 = await fetch(request);
  if (response2.status === 402) assertExpectedChallenge(response2.headers.get("payment-required"));
  return response2;
};
const initial = await guardedFetch(TARGET_URL, { headers: { accept: "application/json" } });
if (initial.status !== 402) throw new TypeError(`Expected the initial staging quote to be HTTP 402, got ${initial.status}`);
await initial.body?.cancel();
console.log(JSON.stringify({ stage: "quote-validated", resourceUrl: TARGET_URL, subjectAddress, network: NETWORK, asset: ASSET, payTo: PAY_TO, amount: AMOUNT }));
const client = x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer), x402Version: 2 }] });
const response = await wrapFetchWithPayment(guardedFetch, client)(TARGET_URL, { headers: { accept: "application/json" } });
if (!response.ok) throw new TypeError(`Paid staging request failed with HTTP ${response.status}: ${safeErrorText(await response.text())}`);
if (signedRequestCount !== 1) throw new TypeError("Expected exactly one signed payment request");
const report = await response.json();
assertReadinessReport(report, subjectAddress);
const receipt = decodeBase64Json(response.headers.get("payment-response"), "PAYMENT-RESPONSE");
if (receipt.success !== true || receipt.network !== NETWORK || receipt.amount !== void 0 && receipt.amount !== AMOUNT || typeof receipt.transaction !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction) || typeof receipt.payer !== "string" || receipt.payer.toLowerCase() !== subjectAddress) throw new TypeError("Paid staging response did not contain a matching successful settlement receipt");
console.log(JSON.stringify({ stage: "target-readiness-confirmed", status: response.status, resourceUrl: TARGET_URL, subjectAddress, network: NETWORK, asset: ASSET, amount: AMOUNT, receiptAmount: receipt.amount ?? null, payTo: PAY_TO, payer: receipt.payer, transaction: receipt.transaction, readinessId: report.readinessId }));
function assertExpectedChallenge(header) {
  const challenge = decodeBase64Json(header, "PAYMENT-REQUIRED");
  if (challenge.x402Version !== 2 || !record(challenge.resource) || challenge.resource.url !== TARGET_URL || !Array.isArray(challenge.accepts)) throw new TypeError("Staging payment challenge does not describe the expected target-readiness resource");
  const requirements = challenge.accepts.filter((candidate) => record(candidate) && candidate.scheme === "exact" && candidate.network === NETWORK);
  if (requirements.length !== 1) throw new TypeError("Staging payment challenge must contain exactly one Base Sepolia exact requirement");
  const requirement = requirements[0];
  if (!record(requirement) || requirement.scheme !== "exact" || requirement.network !== NETWORK || requirement.amount !== AMOUNT || !sameAddress(requirement.asset, ASSET) || !sameAddress(requirement.payTo, PAY_TO)) throw new TypeError("Staging payment challenge differs from the approved Base Sepolia $0.01 USDC rehearsal terms");
}
function assertReadinessReport(value, expectedSubject) {
  if (!record(value) || value.schema !== "priorseal.integration-readiness.v1" || !record(value.input) || value.input.subjectAddress !== expectedSubject || !record(value.workflow) || value.workflow.stage !== "TARGET_INSPECTED" || !record(value.activation) || value.activation.state !== "READY_FOR_CONTROLLED_ACTION" || !Array.isArray(value.activation.boundaries) || !value.activation.boundaries.includes("A payment for readiness does not create authorization, Agent credits, or an execution right.")) throw new TypeError("Paid staging response was not the expected real-target readiness report");
}
function decodeBase64Json(header, name) {
  if (!header) throw new TypeError(`${name} header is missing`);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new TypeError(`${name} header is not base64 JSON`);
  }
  if (!record(parsed)) throw new TypeError(`${name} header is not a JSON object`);
  return parsed;
}
function sameAddress(left, right) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}
function safeErrorText(value) {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 512);
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
