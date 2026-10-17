/**
 * Pays for exactly one known PriorSeal staging receipt bundle and verifies the
 * returned portable evidence locally. This is deliberately not a general
 * payment client: the origin, network, asset, payee, price, and method are
 * fixed, while the caller supplies only one receipt ID after explicit GO.
 */
import { createHash } from 'node:crypto';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';
import type { KeyEntry } from '../sdk/dist/types.js';
import { verifyVerificationBundleLocally } from '../sdk/dist/verifier.js';
import { verifyX402PaymentEvidence } from '../src/domain/x402-payment-evidence.mjs';
import { prepareX402EvidencePack } from './x402-evidence-pack.mjs';

const RECEIPT_FLAG = '--receipt-id';
const EVIDENCE_OUTPUT_FLAG = '--evidence-out';
const CONFIRMATION_FLAG = '--confirm-single-payment';
const STAGING_ORIGIN = 'https://priorseal-staging.priorseal.workers.dev';
const NETWORK = 'eip155:84532' as const;
const ASSET = '0x036CbD53842c5426634e7929541eC2318F3dCF7e';
const PAY_TO = '0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231';
const AMOUNT = '10000'; // $0.01 USDC with 6 decimals.
const ISSUER = 'priorseal-staging';
const KEY_ID = 'staging-1';

if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new TypeError('x402 staging bundle rehearsal requires Node.js 22 or newer');
}
if (process.argv.length !== 7 || process.argv[2] !== RECEIPT_FLAG || !/^psr_[0-9a-f]{32}$/.test(process.argv[3]) || process.argv[4] !== EVIDENCE_OUTPUT_FLAG || !process.argv[5] || process.argv[6] !== CONFIRMATION_FLAG) {
  throw new TypeError(`Refusing to sign a payment. Rerun with ${RECEIPT_FLAG} psr_<32-lowercase-hex> ${EVIDENCE_OUTPUT_FLAG} /absolute/new/local-directory ${CONFIRMATION_FLAG} after an explicit GO.`);
}

const receiptId = process.argv[3];
const evidenceOutput = process.argv[5];
const targetUrl = `${STAGING_ORIGIN}/v1/receipts/${receiptId}/bundle`;
const rawKey = process.env.X402_E2E_PRIVATE_KEY?.trim();
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
  throw new TypeError('X402_E2E_PRIVATE_KEY must be a dedicated 32-byte 0x-prefixed Base Sepolia test-wallet key');
}

const signer = privateKeyToAccount(rawKey as `0x${string}`);
const trustedKey = await loadPinnedStagingKey();
// Allocate and permission-check the destination before a signed request is
// possible. This is intentionally outside the repository and newly created.
const evidencePack = await prepareX402EvidencePack(evidenceOutput);
let signedRequestCount = 0;

const guardedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, { ...init, redirect: 'error' });
  if (request.url !== targetUrl || request.method !== 'GET' || request.body !== null) {
    throw new TypeError('Refusing a payment-client request outside the fixed staging receipt-bundle rehearsal');
  }
  if (request.headers.has('payment-signature')) {
    signedRequestCount++;
    if (signedRequestCount > 1) throw new TypeError('Refusing more than one signed payment request');
  }
  const response = await fetch(request);
  if (response.status === 402) assertExpectedChallenge(response.headers.get('payment-required'), targetUrl);
  return response;
};

const initial = await guardedFetch(targetUrl, { headers: { accept: 'application/json' } });
if (initial.status !== 402) throw new TypeError(`Expected the initial staging quote to be HTTP 402, got ${initial.status}`);
const paymentRequiredHeader = initial.headers.get('payment-required');
const challenge = assertExpectedChallenge(paymentRequiredHeader, targetUrl);
await initial.body?.cancel();
console.log(JSON.stringify({ stage: 'quote-validated', receiptId, network: NETWORK, asset: ASSET, payTo: PAY_TO, amount: AMOUNT }));

const client = x402Client.fromConfig({
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer), x402Version: 2 }],
});
const paidFetch = wrapFetchWithPayment(guardedFetch, client);
const response = await paidFetch(targetUrl, { headers: { accept: 'application/json' } });
if (!response.ok) {
  const text = await response.text();
  throw new TypeError(`Paid staging bundle request failed with HTTP ${response.status}: ${safeErrorText(text)}`);
}
if (signedRequestCount !== 1) throw new TypeError('Expected exactly one signed payment request');

const body: unknown = await response.json();
const bundle = requireRecord(body, 'Paid staging response was not a JSON object');
if (bundle.schema !== 'priorseal.verification-bundle.v1' || typeof bundle.bundleHash !== 'string' || !/^[0-9a-f]{64}$/.test(bundle.bundleHash)) {
  throw new TypeError('Paid staging response was not a valid verification bundle');
}

const paymentEvidence = requireRecord(bundle.paymentEvidence, 'Paid receipt bundle is missing x402 payment evidence');
const settlementHeader = response.headers.get('payment-response');
const settlement = decodeBase64Json(settlementHeader, 'PAYMENT-RESPONSE');
const transaction = settlement.transaction;
const payer = settlement.payer;
if (
  settlement.success !== true ||
  settlement.network !== NETWORK ||
  (settlement.amount !== undefined && settlement.amount !== AMOUNT) ||
  typeof transaction !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(transaction) ||
  typeof payer !== 'string' || payer.toLowerCase() !== signer.address.toLowerCase()
) {
  throw new TypeError('Paid staging response did not contain a matching successful settlement receipt');
}
await evidencePack.captureResponse({
  receiptId,
  resourceUrl: targetUrl,
  paymentRequiredHeader: requiredString(paymentRequiredHeader, 'PAYMENT-REQUIRED'),
  challenge,
  bundle,
  settlement,
  payer,
  network: NETWORK,
  asset: ASSET,
  amount: AMOUNT,
  payTo: PAY_TO,
});

const localResult = await verifyVerificationBundleLocally(body, { trustedKeys: trustedKey, expectedAudience: 'priorseal-staging' });
const evidenceResult = verifyX402PaymentEvidence(paymentEvidence, trustedKey.publicKey);
const paymentEvidenceId = evidenceResult.paymentEvidenceId;
if (!localResult.valid || localResult.code !== 'OK' || localResult.receiptId !== receiptId) {
  throw new TypeError(`Portable verification bundle did not verify locally: ${localResult.code}`);
}
if (!evidenceResult.valid || evidenceResult.code !== 'OK' || typeof paymentEvidenceId !== 'string') {
  throw new TypeError(`x402 payment evidence did not verify locally: ${evidenceResult.code}`);
}
assertEvidenceBindings(paymentEvidence, targetUrl, signer.address);
const evidenceSettlement = nested(paymentEvidence, ['payment', 'settlement']);
if (!evidenceSettlement || evidenceSettlement.transaction !== transaction || typeof evidenceSettlement.payer !== 'string' || evidenceSettlement.payer.toLowerCase() !== signer.address.toLowerCase()) {
  throw new TypeError('Signed payment evidence does not match the facilitator settlement receipt');
}
const persisted = await evidencePack.complete({
  receiptId,
  resourceUrl: targetUrl,
  bundleHash: bundle.bundleHash,
  paymentEvidenceId,
  localVerification: { valid: localResult.valid, code: localResult.code, receiptId: localResult.receiptId },
  paymentEvidenceVerification: { valid: evidenceResult.valid, code: evidenceResult.code, paymentEvidenceId },
});

console.log(JSON.stringify({
  stage: 'bundle-settlement-confirmed',
  status: response.status,
  receiptId,
  bundleHash: bundle.bundleHash,
  paymentEvidenceId,
  resourceUrl: targetUrl,
  network: NETWORK,
  asset: ASSET,
  amount: AMOUNT,
  receiptAmount: settlement.amount ?? null,
  payTo: PAY_TO,
  payer,
  transaction,
  localVerification: localResult.code,
  paymentEvidenceVerification: evidenceResult.code,
  evidencePack: persisted.manifestPath,
}));

async function loadPinnedStagingKey(): Promise<KeyEntry> {
  const expectedFingerprint = process.env.PRIORSEAL_STAGING_ISSUER_PUBLIC_KEY_SHA256?.trim().toLowerCase();
  if (!expectedFingerprint || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new TypeError('PRIORSEAL_STAGING_ISSUER_PUBLIC_KEY_SHA256 must contain the out-of-band SHA-256 fingerprint of the staging issuer public key');
  }
  const response = await fetch(`${STAGING_ORIGIN}/.well-known/priorseal-keys.json`, {
    headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new TypeError(`Unable to read the staging issuer key registry: HTTP ${response.status}`);
  const registry = requireRecord(await response.json(), 'Staging issuer key registry is not a JSON object');
  if (registry.schema !== 'priorseal.keys.v1' || registry.issuer !== ISSUER || !Array.isArray(registry.keys)) {
    throw new TypeError('Staging issuer key registry has an unexpected identity');
  }
  const matches = registry.keys.filter((entry) => isRecord(entry) && entry.issuer === ISSUER && entry.keyId === KEY_ID && entry.status === 'active' && typeof entry.publicKey === 'string' && publicKeyFingerprint(entry.publicKey) === expectedFingerprint);
  if (matches.length !== 1) throw new TypeError('Deployed staging issuer key does not match the out-of-band pinned public-key fingerprint');
  return { issuer: ISSUER, keyId: KEY_ID, algorithm: 'Ed25519', publicKey: matches[0].publicKey as string, status: 'active', validFrom: null, validUntil: null };
}

function assertExpectedChallenge(header: string | null, expectedTargetUrl: string) {
  const challenge = decodeBase64Json(header, 'PAYMENT-REQUIRED');
  const resource = isRecord(challenge.resource) ? challenge.resource : null;
  if (challenge.x402Version !== 2 || !resource || resource.url !== expectedTargetUrl || !Array.isArray(challenge.accepts) || challenge.accepts.length !== 1) {
    throw new TypeError('Staging payment challenge does not describe exactly one expected resource and requirement');
  }
  const requirement = isRecord(challenge.accepts[0]) ? challenge.accepts[0] : null;
  if (requirement?.scheme !== 'exact' || requirement.network !== NETWORK || requirement.amount !== AMOUNT || !sameAddress(requirement.asset, ASSET) || !sameAddress(requirement.payTo, PAY_TO)) {
    throw new TypeError('Staging payment challenge differs from the approved Base Sepolia $0.01 USDC rehearsal terms');
  }
  return challenge;
}

function assertEvidenceBindings(evidence: Record<string, unknown>, expectedTargetUrl: string, expectedPayer: string) {
  if (evidence.issuer !== ISSUER || evidence.keyId !== KEY_ID) throw new TypeError('Payment evidence issuer metadata does not match the pinned staging issuer');
  const requirement = nested(evidence, ['payment', 'requirement']);
  const settlement = nested(evidence, ['payment', 'settlement']);
  const service = nested(evidence, ['service']);
  const evidencePayer = settlement?.payer;
  if (!requirement || !settlement || !service || requirement.scheme !== 'exact' || requirement.network !== NETWORK || requirement.amount !== AMOUNT || !sameAddress(requirement.asset, ASSET) || !sameAddress(requirement.payTo, PAY_TO) || settlement.success !== true || settlement.network !== NETWORK || typeof evidencePayer !== 'string' || evidencePayer.toLowerCase() !== expectedPayer.toLowerCase() || service.resourceUrl !== expectedTargetUrl || service.responseStatus !== 200) {
    throw new TypeError('Payment evidence does not bind the approved requirement, settlement, and bundle response');
  }
}

function decodeBase64Json(header: string | null, name: string): Record<string, unknown> {
  if (!header) throw new TypeError(`${name} header is missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown; }
  catch { throw new TypeError(`${name} header is not base64 JSON`); }
  return requireRecord(parsed, `${name} header is not a JSON object`);
}

function nested(value: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function sameAddress(left: unknown, right: string) {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function publicKeyFingerprint(publicKey: string) {
  return createHash('sha256').update(publicKey).digest('hex');
}

function safeErrorText(value: string) {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 512);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} is missing`);
  return value;
}
