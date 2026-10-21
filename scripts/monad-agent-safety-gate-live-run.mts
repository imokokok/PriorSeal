#!/usr/bin/env node

/**
 * Prepares the Monad Agent Safety Gate live run.
 *
 * Default mode is offline. --quote performs one unsigned HTTP 402 probe.
 * --pay requires explicit confirmation and makes exactly one signed x402 retry.
 * This tool never signs or broadcasts the subject transaction.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { hashTypedData, keccak256, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizationTypedData, buildAuthorization, canonicalize } from '../src/index.mjs';

const CHAIN_ID = 143;
const NETWORK = 'eip155:143';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const DEFAULT_ORIGIN = 'https://www.oracleinsight.xyz';
const DEFAULT_MAX_PAYMENT_ATOMIC = '20000';
const MAX_RESPONSE_BYTES = 1_000_000;
const INSIGHT_USD_SCALE = 1_000_000;
const INSIGHT_DOMAIN = { name: 'Insight Oracle Safety', version: '3', chainId: 1 } as const;
const INSIGHT_TYPES = {
  OracleSafetyCheck: [
    { name: 'verdict', type: 'string' }, { name: 'sourceAssetId', type: 'string' }, { name: 'destinationAssetId', type: 'string' },
    { name: 'subjectChainId', type: 'uint256' }, { name: 'action', type: 'string' }, { name: 'tradeAmountUsd', type: 'uint256' },
    { name: 'consensusPrice', type: 'uint256' }, { name: 'maxDeviationBps', type: 'uint256' }, { name: 'manipulationRiskBps', type: 'uint256' },
    { name: 'participantCount', type: 'uint256' }, { name: 'requiredParticipantCount', type: 'uint256' }, { name: 'coverageStatus', type: 'string' },
    { name: 'independenceStatus', type: 'string' }, { name: 'sourceGroupCount', type: 'uint256' }, { name: 'crossProviderAgreementBps', type: 'uint256' },
    { name: 'maxStablecoinDepegBps', type: 'uint256' }, { name: 'maxDataAgeSeconds', type: 'uint256' }, { name: 'recommendedMaxPositionUsd', type: 'uint256' },
    { name: 'reasonCodesHash', type: 'bytes32' }, { name: 'requestHash', type: 'bytes32' }, { name: 'evaluationScope', type: 'string' },
    { name: 'evaluatedAssetIdsHash', type: 'bytes32' }, { name: 'providerObservationsHash', type: 'bytes32' }, { name: 'validUntil', type: 'uint256' },
    { name: 'checkedAt', type: 'uint256' }, { name: 'schemaVersion', type: 'uint256' }, { name: 'requiredSourceGroupCount', type: 'uint256' },
  ],
} as const;
const UINT_FIELDS = new Set([
  'subjectChainId', 'tradeAmountUsd', 'consensusPrice', 'maxDeviationBps', 'manipulationRiskBps', 'participantCount', 'requiredParticipantCount',
  'sourceGroupCount', 'crossProviderAgreementBps', 'maxStablecoinDepegBps', 'maxDataAgeSeconds', 'recommendedMaxPositionUsd', 'validUntil', 'checkedAt',
  'schemaVersion', 'requiredSourceGroupCount',
]);

type Json = Record<string, unknown>;
type Intent = {
  agentId: string;
  principal: { id: string; account: `0x${string}` };
  executor: `0x${string}`;
  call: { target: `0x${string}`; calldata: `0x${string}`; valueWei: string; nonce: string };
  safetyCheck: { asset: string; destinationAsset: string; action: 'swap' | 'borrow' | 'lend' | 'liquidate' | 'repay'; tradeAmountUsd: number; protocolId?: string };
  authorization: { validForSeconds: number };
};
type Attestation = {
  uid: `0x${string}`; schemaVersion: 3; attester: `0x${string}`; signature: `0x${string}`; validUntil: number;
  data: Json & { verdict: 'PASS' | 'CAUTION' | 'DANGER' | 'BLOCK'; subjectChainId: number; action: string; tradeAmountUsd: number; validUntil: number; checkedAt: number; schemaVersion: number };
};
type PaymentSelection = { requirement: Json; amount: string; asset: `0x${string}`; payTo: `0x${string}` };

function fail(code: string): never { throw new Error(code); }
function object(value: unknown, code: string): Json { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code); return value as Json; }
function fields(value: Json, allowed: readonly string[], code: string) { if (Object.keys(value).some((key) => !allowed.includes(key))) fail(code); }
function text(value: unknown, code: string) { if (typeof value !== 'string' || !value) fail(code); return value; }
function int(value: unknown, code: string, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(code); return Number(value); }
function integerText(value: unknown, code: string) { const result = text(value, code); if (!/^(0|[1-9][0-9]*)$/.test(result)) fail(code); return result; }
function address(value: unknown, code: string): `0x${string}` { const result = text(value, code); if (!/^0x[0-9a-fA-F]{40}$/.test(result)) fail(code); return result as `0x${string}`; }
function hex(value: unknown, code: string): `0x${string}` { const result = text(value, code); if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) fail(code); return result as `0x${string}`; }
function bytes32(value: unknown, code: string): `0x${string}` { const result = hex(value, code); if (!/^0x[0-9a-fA-F]{64}$/.test(result)) fail(code); return result; }
function identifier(value: unknown, code: string) { const result = text(value, code); if (!/^[A-Za-z0-9._:-]{1,128}$/.test(result)) fail(code); return result; }
function parseJson(value: string, code: string): unknown { try { return JSON.parse(value) as unknown; } catch { return fail(code); } }
function hashCanonical(value: unknown): `0x${string}` { return `0x${createHash('sha256').update(canonicalize(value)).digest('hex')}`; }
function json(value: unknown) { return JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2); }

function parseIntent(value: unknown): Intent {
  const root = object(value, 'LIVE_INTENT_NOT_OBJECT');
  fields(root, ['schema', 'agentId', 'principal', 'executor', 'call', 'safetyCheck', 'authorization'], 'LIVE_INTENT_UNKNOWN_FIELD');
  if (root.schema !== 'monad.agent-safety-gate-live-intent.v1') fail('LIVE_INTENT_SCHEMA_UNSUPPORTED');
  const principal = object(root.principal, 'LIVE_INTENT_PRINCIPAL_INVALID'); fields(principal, ['id', 'account'], 'LIVE_INTENT_PRINCIPAL_UNKNOWN_FIELD');
  const call = object(root.call, 'LIVE_INTENT_CALL_INVALID'); fields(call, ['target', 'calldata', 'valueWei', 'nonce'], 'LIVE_INTENT_CALL_UNKNOWN_FIELD');
  const safetyCheck = object(root.safetyCheck, 'LIVE_INTENT_SAFETY_CHECK_INVALID'); fields(safetyCheck, ['asset', 'destinationAsset', 'action', 'tradeAmountUsd', 'protocolId'], 'LIVE_INTENT_SAFETY_CHECK_UNKNOWN_FIELD');
  const authorization = object(root.authorization, 'LIVE_INTENT_AUTHORIZATION_INVALID'); fields(authorization, ['validForSeconds'], 'LIVE_INTENT_AUTHORIZATION_UNKNOWN_FIELD');
  const action = text(safetyCheck.action, 'LIVE_INTENT_ACTION_INVALID');
  if (!['swap', 'borrow', 'lend', 'liquidate', 'repay'].includes(action)) fail('LIVE_INTENT_ACTION_INVALID');
  const asset = text(safetyCheck.asset, 'LIVE_INTENT_ASSET_INVALID'); const destinationAsset = text(safetyCheck.destinationAsset, 'LIVE_INTENT_DESTINATION_ASSET_INVALID');
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(asset) || !/^[A-Za-z0-9._-]{2,32}$/.test(destinationAsset)) fail('LIVE_INTENT_ASSET_INVALID');
  const tradeAmountUsd = Number(safetyCheck.tradeAmountUsd);
  if (!Number.isFinite(tradeAmountUsd) || tradeAmountUsd <= 0 || tradeAmountUsd > 1_000_000_000 || !Number.isSafeInteger(Math.round(tradeAmountUsd * INSIGHT_USD_SCALE)) || Math.abs(tradeAmountUsd * INSIGHT_USD_SCALE - Math.round(tradeAmountUsd * INSIGHT_USD_SCALE)) > 0.000001) fail('LIVE_INTENT_TRADE_AMOUNT_INVALID');
  return {
    agentId: identifier(root.agentId, 'LIVE_INTENT_AGENT_ID_INVALID'),
    principal: { id: identifier(principal.id, 'LIVE_INTENT_PRINCIPAL_ID_INVALID'), account: address(principal.account, 'LIVE_INTENT_PRINCIPAL_ACCOUNT_INVALID') },
    executor: address(root.executor, 'LIVE_INTENT_EXECUTOR_INVALID'),
    call: { target: address(call.target, 'LIVE_INTENT_TARGET_INVALID'), calldata: hex(call.calldata, 'LIVE_INTENT_CALLDATA_INVALID'), valueWei: integerText(call.valueWei, 'LIVE_INTENT_VALUE_INVALID'), nonce: integerText(call.nonce, 'LIVE_INTENT_NONCE_INVALID') },
    safetyCheck: { asset, destinationAsset, action: action as Intent['safetyCheck']['action'], tradeAmountUsd, ...(safetyCheck.protocolId === undefined ? {} : { protocolId: identifier(safetyCheck.protocolId, 'LIVE_INTENT_PROTOCOL_ID_INVALID') }) },
    authorization: { validForSeconds: int(authorization.validForSeconds, 'LIVE_INTENT_VALIDITY_INVALID', 60, 1_800) },
  };
}

function parseOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.pathname !== '' && url.pathname !== '/')) fail('ORACLE_ORIGIN_MUST_BE_CREDENTIAL_FREE_HTTPS');
  return url.origin;
}
function preTradeUrl(origin: string, intent: Intent) {
  const url = new URL('/api/v1/safety/pre-trade', origin);
  for (const [key, value] of Object.entries({ asset: intent.safetyCheck.asset, destinationAsset: intent.safetyCheck.destinationAsset, chainId: String(CHAIN_ID), action: intent.safetyCheck.action, tradeAmountUsd: String(intent.safetyCheck.tradeAmountUsd), schemaVersion: '3', workflowTag: 'monad-agent-safety-gate-live-v1', ...(intent.safetyCheck.protocolId ? { protocolId: intent.safetyCheck.protocolId } : {}) })) url.searchParams.set(key, value);
  return url.toString();
}
function decodeHeader(value: string | null, code: string) { if (!value) fail(code); return object(parseJson(Buffer.from(value, 'base64').toString('utf8'), code), code); }
function selectMonadPayment(challenge: Json, resourceUrl: string, maxAmount: string): PaymentSelection {
  if (challenge.x402Version !== 2) fail('PAYMENT_REQUIRED_VERSION_UNSUPPORTED');
  if (object(challenge.resource, 'PAYMENT_REQUIRED_RESOURCE_INVALID').url !== resourceUrl) fail('PAYMENT_REQUIRED_RESOURCE_MISMATCH');
  if (!Array.isArray(challenge.accepts)) fail('PAYMENT_REQUIRED_ACCEPTS_INVALID');
  const matches = challenge.accepts.filter((candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) && (candidate as Json).scheme === 'exact' && (candidate as Json).network === NETWORK);
  if (matches.length !== 1) fail('MONAD_EXACT_PAYMENT_OPTION_NOT_UNIQUE');
  const requirement = object(matches[0], 'MONAD_PAYMENT_REQUIREMENT_INVALID');
  const amount = integerText(requirement.amount, 'MONAD_PAYMENT_AMOUNT_INVALID');
  if (BigInt(amount) === 0n || BigInt(amount) > BigInt(maxAmount)) fail('MONAD_PAYMENT_AMOUNT_EXCEEDS_CAP');
  const asset = address(requirement.asset, 'MONAD_PAYMENT_ASSET_INVALID');
  if (asset.toLowerCase() !== USDC.toLowerCase()) fail('MONAD_PAYMENT_ASSET_UNPINNED');
  return { requirement, amount, asset, payTo: address(requirement.payTo, 'MONAD_PAYMENT_PAYEE_INVALID') };
}

function typedAttestation(attestation: Attestation) {
  const message: Record<string, string | bigint> = {};
  for (const [field, value] of Object.entries(attestation.data)) message[field] = UINT_FIELDS.has(field) ? BigInt(int(value, `INSIGHT_${field.toUpperCase()}_INVALID`)) : text(value, `INSIGHT_${field.toUpperCase()}_INVALID`);
  return { domain: INSIGHT_DOMAIN, types: INSIGHT_TYPES, primaryType: 'OracleSafetyCheck' as const, message };
}
function extractAttestation(value: unknown): Attestation {
  const response = object(value, 'INSIGHT_RESPONSE_INVALID'); if (response.success !== true) fail('INSIGHT_RESPONSE_NOT_SUCCESS');
  const result = object(response.data, 'INSIGHT_RESPONSE_DATA_INVALID'); const candidate = object(result.attestation, 'INSIGHT_ATTESTATION_MISSING'); const data = object(candidate.data, 'INSIGHT_ATTESTATION_DATA_INVALID');
  for (const field of UINT_FIELDS) int(data[field], `INSIGHT_${field.toUpperCase()}_INVALID`);
  for (const field of ['reasonCodesHash', 'requestHash', 'evaluatedAssetIdsHash', 'providerObservationsHash']) bytes32(data[field], `INSIGHT_${field.toUpperCase()}_INVALID`);
  if (candidate.schemaVersion !== 3 || data.schemaVersion !== 3 || !['PASS', 'CAUTION', 'DANGER', 'BLOCK'].includes(text(data.verdict, 'INSIGHT_VERDICT_INVALID'))) fail('INSIGHT_SCHEMA_OR_VERDICT_INVALID');
  return { uid: bytes32(candidate.uid, 'INSIGHT_UID_INVALID'), schemaVersion: 3, attester: address(candidate.attester, 'INSIGHT_ATTESTER_INVALID'), signature: hex(candidate.signature, 'INSIGHT_SIGNATURE_INVALID'), validUntil: int(candidate.validUntil, 'INSIGHT_VALID_UNTIL_INVALID', 1), data: data as Attestation['data'] };
}
async function trustedAttester(path: string) {
  const roots = object(parseJson(await readFile(path, 'utf8'), 'TRUST_ROOTS_JSON_INVALID'), 'TRUST_ROOTS_INVALID');
  if (roots.schema !== 'monad.agent-safety-gate-live-trust-roots.v1') fail('TRUST_ROOTS_SCHEMA_UNSUPPORTED');
  return address(object(roots.insight, 'TRUST_ROOTS_INSIGHT_INVALID').attester, 'TRUST_ROOTS_INSIGHT_ATTESTER_INVALID');
}
async function verifyInsight(attestation: Attestation, root: `0x${string}`, intent: Intent, now: number) {
  if (attestation.attester.toLowerCase() !== root.toLowerCase()) fail('INSIGHT_ATTESTER_NOT_TRUSTED');
  if (attestation.validUntil !== attestation.data.validUntil || now >= attestation.data.validUntil) fail('INSIGHT_ATTESTATION_EXPIRED');
  if (attestation.data.subjectChainId !== CHAIN_ID || attestation.data.action !== intent.safetyCheck.action || attestation.data.tradeAmountUsd !== Math.round(intent.safetyCheck.tradeAmountUsd * INSIGHT_USD_SCALE)) fail('INSIGHT_ATTESTATION_SCOPE_MISMATCH');
  const typedData = typedAttestation(attestation);
  if (hashTypedData(typedData as Parameters<typeof hashTypedData>[0]) !== attestation.uid) fail('INSIGHT_ATTESTATION_UID_MISMATCH');
  if (!await verifyTypedData({ ...typedData, address: attestation.attester, signature: attestation.signature } as Parameters<typeof verifyTypedData>[0])) fail('INSIGHT_ATTESTATION_SIGNATURE_INVALID');
}
function authorizationRequest(intent: Intent, attestation: Attestation, now: number) {
  const effect = attestation.data.verdict === 'PASS' ? 'PREPARE_PRINCIPAL_AUTHORIZATION' : attestation.data.verdict === 'CAUTION' ? 'REQUIRE_ADDITIONAL_PRINCIPAL_CONFIRMATION' : 'DENY';
  const policy = { schema: 'monad.agent-safety-gate-policy.v1', finalDecisionPoint: 'integrator-owned-agent-policy', insightRole: 'signed-advisory-risk-input', priorSealRole: 'principal-authorization-and-execution-evidence', allowedChainId: CHAIN_ID, allowedExecutor: intent.executor, allowedCallTarget: intent.call.target, verdictMapping: { PASS: 'PREPARE_PRINCIPAL_AUTHORIZATION', CAUTION: 'REQUIRE_ADDITIONAL_PRINCIPAL_CONFIRMATION', DANGER: 'DENY', BLOCK: 'DENY' } };
  const decision = { schema: 'monad.agent-safety-gate-decision.v1', evaluatedAt: now, attestationUid: attestation.uid, verdict: attestation.data.verdict, effect, requiresPrincipalAuthorization: true, policyDigest: hashCanonical(policy) };
  if (effect === 'DENY') return { policy, decision, authorization: null, typedData: null };
  const expiresAt = Math.min(attestation.data.validUntil, now + intent.authorization.validForSeconds);
  if (expiresAt <= now + 30) fail('AUTHORIZATION_WINDOW_TOO_SHORT');
  const authorization = buildAuthorization({
    intent: { schema: 'priorseal.intent.v2', executionProfile: 'priorseal.execution-profile.exact-call.v1', intentId: `monad-live-${randomBytes(12).toString('hex')}`, chainId: CHAIN_ID, action: 'CONTRACT_CALL', asset: `eip155:${CHAIN_ID}/native`, amount: intent.call.valueWei, sender: intent.executor, recipient: intent.call.target, validUntil: expiresAt, nonce: intent.call.nonce, callTarget: intent.call.target, calldataHash: keccak256(intent.call.calldata), transactionValue: intent.call.valueWei, contextCommitments: [{ namespace: 'insight.oracle-safety-attestation.v3', algorithm: 'sha256', digest: hashCanonical(attestation) }, { namespace: 'monad.agent-safety-gate-decision.v1', algorithm: 'sha256', digest: hashCanonical(decision) }], constraints: { minConfirmations: 1 } },
    principal: { type: 'user', id: intent.principal.id, account: intent.principal.account }, authorizer: { type: 'eip712', address: intent.principal.account }, delegate: { agentId: intent.agentId, executor: intent.executor }, issuedAt: now, notBefore: now, expiresAt, authorizationNonce: `0x${randomBytes(32).toString('hex')}`, maxUses: '1', audience: 'priorseal', policyHash: decision.policyDigest,
  });
  return { policy, decision, authorization, typedData: authorizationTypedData(authorization) };
}

type Args = { intentPath: string; outputDirectory: string; origin: string; quote: boolean; pay: boolean; trustRootsPath?: string; maxPaymentAtomic: string; payerKeyEnv: string };
function args(argv: string[]): Args {
  const valueFlags = new Set(['--intent', '--out', '--oracle-origin', '--trust-roots', '--max-payment-atomic', '--payer-key-env']); const allowed = new Set([...valueFlags, '--quote', '--pay', '--confirm-x402-payment']); const values = new Map<string, string>(); const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) { const flag = argv[index]; if (!allowed.has(flag)) fail(`UNKNOWN_ARGUMENT:${flag}`); if (valueFlags.has(flag)) { const value = argv[++index]; if (!value || value.startsWith('--') || values.has(flag)) fail(`ARGUMENT_VALUE_REQUIRED:${flag}`); values.set(flag, value); } else { if (switches.has(flag)) fail(`ARGUMENT_DUPLICATED:${flag}`); switches.add(flag); } }
  const intentPath = values.get('--intent'); const outputDirectory = values.get('--out'); if (!intentPath || !outputDirectory || !isAbsolute(intentPath) || !isAbsolute(outputDirectory)) fail('INTENT_AND_OUTPUT_MUST_BE_ABSOLUTE_PATHS');
  const quote = switches.has('--quote'); const pay = switches.has('--pay'); if (quote && pay) fail('QUOTE_AND_PAY_ARE_SEPARATE_MODES'); if (pay && !switches.has('--confirm-x402-payment')) fail('X402_PAYMENT_REQUIRES_CONFIRM_X402_PAYMENT');
  const trustRootsPath = values.get('--trust-roots'); if (pay && (!trustRootsPath || !isAbsolute(trustRootsPath))) fail('PAYMENT_RUN_REQUIRES_ABSOLUTE_TRUST_ROOTS_PATH');
  const maxPaymentAtomic = integerText(values.get('--max-payment-atomic') ?? DEFAULT_MAX_PAYMENT_ATOMIC, 'MAX_PAYMENT_ATOMIC_INVALID'); if (BigInt(maxPaymentAtomic) === 0n) fail('MAX_PAYMENT_ATOMIC_INVALID');
  const payerKeyEnv = values.get('--payer-key-env') ?? 'MONAD_LIVE_RUN_PAYER_PRIVATE_KEY'; if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(payerKeyEnv)) fail('PAYER_KEY_ENV_INVALID');
  return { intentPath, outputDirectory, origin: parseOrigin(values.get('--oracle-origin') ?? DEFAULT_ORIGIN), quote, pay, trustRootsPath, maxPaymentAtomic, payerKeyEnv };
}
async function write(directory: string, name: string, value: unknown) { await writeFile(resolve(directory, name), `${json(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
async function boundedJson(response: Response) { const length = response.headers.get('content-length'); if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE'); const body = await response.text(); if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE'); return parseJson(body, 'RESPONSE_NOT_JSON'); }
async function quote(resourceUrl: string, maxAmount: string) { const response = await fetch(resourceUrl, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) }); if (response.status !== 402) fail(`UNPAID_QUOTE_EXPECTED_402_GOT_${response.status}`); const header = response.headers.get('payment-required'); const challenge = decodeHeader(header, 'PAYMENT_REQUIRED_HEADER_INVALID'); const selection = selectMonadPayment(challenge, resourceUrl, maxAmount); await response.body?.cancel(); return { header: header!, challenge, selection }; }
async function payOnce(resourceUrl: string, paymentHeader: string, selection: PaymentSelection, keyEnv: string) {
  const key = process.env[keyEnv]?.trim(); if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) fail(`PAYER_KEY_MISSING:${keyEnv}`); const signer = privateKeyToAccount(key as `0x${string}`); let signedRequests = 0;
  const guardedFetch: typeof fetch = async (input, init) => { const request = new Request(input, { ...init, redirect: 'error' }); if (request.url !== resourceUrl || request.method !== 'GET' || request.body !== null) fail('PAYMENT_CLIENT_REQUEST_SCOPE_VIOLATION'); if (request.headers.has('payment-signature') && ++signedRequests > 1) fail('PAYMENT_CLIENT_REFUSES_SECOND_SIGNED_REQUEST'); return fetch(request); };
  const client = x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer), x402Version: 2 }] }); const response = await wrapFetchWithPayment(guardedFetch, client)(resourceUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) fail(`PAID_PRETRADE_REQUEST_FAILED_HTTP_${response.status}`); if (signedRequests !== 1) fail('PAYMENT_CLIENT_SIGNED_REQUEST_COUNT_INVALID'); const settlement = decodeHeader(response.headers.get('payment-response'), 'PAYMENT_RESPONSE_HEADER_INVALID');
  if (settlement.success !== true || settlement.network !== NETWORK || settlement.amount !== undefined && settlement.amount !== selection.amount || typeof settlement.transaction !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction) || typeof settlement.payer !== 'string' || settlement.payer.toLowerCase() !== signer.address.toLowerCase()) fail('PAYMENT_SETTLEMENT_RESPONSE_INVALID');
  return { payer: signer.address, paymentHeader, settlement, response: await boundedJson(response) };
}

async function main() {
  const options = args(process.argv.slice(2)); const intent = parseIntent(parseJson(await readFile(options.intentPath, 'utf8'), 'LIVE_INTENT_JSON_INVALID')); const resourceUrl = preTradeUrl(options.origin, intent); await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
  await write(options.outputDirectory, 'run-plan.json', { schema: 'monad.agent-safety-gate-live-run-plan.v1', mode: options.pay ? 'X402_PAYMENT_ARMED' : options.quote ? 'QUOTE_ONLY' : 'DRY_RUN', subjectChain: { chainId: CHAIN_ID, network: NETWORK }, resourceUrl, intent, paymentBoundary: { maxPaymentAtomic: options.maxPaymentAtomic, asset: USDC, paymentAttempted: false, payerPrivateKeyLoaded: false }, authorizationBoundary: { principalSignatureCaptured: false, subjectTransactionBroadcast: false, executorMustBeIntegrationOwned: true }, limits: { noSubjectTransactionSignature: true, noSubjectTransactionBroadcast: true, economicSafetyGuaranteed: false } });
  if (!options.quote && !options.pay) return void process.stdout.write(`${JSON.stringify({ status: 'DRY_RUN_READY', output: options.outputDirectory, resourceUrl })}\n`);
  const initialQuote = await quote(resourceUrl, options.maxPaymentAtomic); await write(options.outputDirectory, 'x402-quote.json', { resourceUrl, paymentRequiredHeader: initialQuote.header, challenge: initialQuote.challenge, selectedMonadPayment: initialQuote.selection });
  if (options.quote) return void process.stdout.write(`${JSON.stringify({ status: 'QUOTE_VALIDATED_NO_PAYMENT', output: options.outputDirectory, amount: initialQuote.selection.amount, payTo: initialQuote.selection.payTo })}\n`);
  const paid = await payOnce(resourceUrl, initialQuote.header, initialQuote.selection, options.payerKeyEnv); const attestation = extractAttestation(paid.response); const now = Math.floor(Date.now() / 1_000); await verifyInsight(attestation, await trustedAttester(options.trustRootsPath!), intent, now); const request = authorizationRequest(intent, attestation, now);
  await write(options.outputDirectory, 'x402-payment-and-response.json', { resourceUrl, payer: paid.payer, selectedMonadPayment: initialQuote.selection, paymentRequiredHeader: paid.paymentHeader, settlement: paid.settlement, response: paid.response }); await write(options.outputDirectory, 'insight-attestation.json', attestation); await write(options.outputDirectory, 'priorseal-authorization-request.json', { schema: 'monad.agent-safety-gate-priorseal-authorization-request.v1', gate: { policy: request.policy, decision: request.decision }, authorization: request.authorization, typedData: request.typedData, nextAction: request.authorization ? 'USER_MUST_REVIEW_AND_SIGN_TYPED_DATA_OUTSIDE_THIS_TOOL' : 'DENY_DO_NOT_REQUEST_OR_BROADCAST_A_SUBJECT_TRANSACTION' });
  process.stdout.write(`${JSON.stringify({ status: request.authorization ? 'PAYMENT_AND_ATTESTATION_VALIDATED_AWAITING_PRINCIPAL_SIGNATURE' : 'PAYMENT_VALIDATED_GATE_DENIED', output: options.outputDirectory, verdict: attestation.data.verdict, settlementTransaction: paid.settlement.transaction })}\n`);
}

await main();
