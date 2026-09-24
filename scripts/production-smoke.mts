import { randomBytes, randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalize, verifyAuthorization, verifyAuthorizationReceipt, verifyTimestampEvidence } from '../src/index.mjs';

type ApiBody = Record<string, unknown>;

function record(value: unknown, label: string): ApiBody {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  return value as ApiBody;
}

function optionalRecord(value: unknown): ApiBody | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ApiBody : null;
}

function string(value: unknown, label: string): string {
  assert(typeof value === 'string', `${label} must be a string`);
  return value;
}

function number(value: unknown, label: string): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value), `${label} must be a safe integer`);
  return value;
}

if (process.argv.includes('--read-only')) {
  const { runReadOnlySmoke } = await import('./production-smoke-readonly.mjs');
  await runReadOnlySmoke();
  process.exit(0);
}

const baseUrl = new URL(process.env.PRIORSEAL_BASE_URL ?? 'https://priorseal.xyz');
const expectedVersion = process.env.PRIORSEAL_EXPECTED_VERSION?.trim();
const runPendingFlow = process.argv.includes('--pending');
const resumedPendingJobId = process.env.PRIORSEAL_PENDING_JOB_ID?.trim();
const pendingTimeoutMs = Number(process.env.PRIORSEAL_PENDING_TIMEOUT_MS ?? 720_000);

if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
  throw new Error('PRIORSEAL_BASE_URL must use HTTPS outside local development');
}
if (!expectedVersion) throw new Error('PRIORSEAL_EXPECTED_VERSION must be the exact Git SHA used as the Worker version tag');
if (!Number.isSafeInteger(pendingTimeoutMs) || pendingTimeoutMs < 90_000 || pendingTimeoutMs > 900_000) {
  throw new Error('PRIORSEAL_PENDING_TIMEOUT_MS must be an integer between 90000 and 900000');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: ApiBody }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(new URL(path, baseUrl), init);
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      continue;
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return { response, body: record(body, `${path} response`) };
    const errorBody = optionalRecord(body);
    const detail = optionalRecord(errorBody?.error);
    const code = detail?.code ?? errorBody?.code ?? 'REQUEST_FAILED';
    const message = detail?.message ?? errorBody?.message ?? response.statusText;
    const error = new Error(`${response.status} ${code}: ${message}`);
    if (![502, 503, 504].includes(response.status) || attempt === 3) throw error;
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError;
}

async function post(path: string, body: unknown, idempotencyKey?: string) {
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

function randomHex(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

const live = await request('/health/live');
const ready = await request('/health/ready');
const version = await request('/v1/version');
const registry = await request('/.well-known/priorseal-keys.json');
const home = await fetch(baseUrl);
const homeText = await home.text();

assert(live.body.status === 'ok', 'Liveness check failed');
assert(ready.body.status === 'ready' && ready.body.storage === 'd1', 'D1 readiness check failed');
assert(version.body.service === 'priorseal' && version.body.version === expectedVersion, `Unexpected production build: ${String(version.body.version)}`);
assert(!version.response.headers.has('x-render-origin-server') && !version.response.headers.has('rndr-id'), 'Request still reached Render');
assert(home.ok && /PriorSeal/i.test(homeText), 'Production console is unavailable');
assert(Array.isArray(registry.body.keys) && registry.body.keys.some((key) => optionalRecord(key)?.status === 'active'), 'No active issuer key is published');

const account = privateKeyToAccount(`0x${randomHex()}`);
const now = Math.floor(Date.now() / 1000);
const expiresAt = now + 600;
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const draft = {
  intent: {
    intentId: `smoke-${suffix}`,
    chainId: 8453,
    action: 'TRANSFER',
    asset: 'eip155:8453/native',
    amount: '0',
    sender: account.address,
    recipient: account.address,
    validUntil: expiresAt,
    nonce: '0',
    constraints: { minConfirmations: 12 },
  },
  principal: { type: 'user', id: `synthetic-smoke-${suffix}`, account: account.address },
  authorizer: { type: 'eip712', address: account.address },
  delegate: { agentId: `synthetic-agent-${suffix}`, executor: account.address },
  issuedAt: now,
  notBefore: now,
  expiresAt,
  authorizationNonce: `0x${randomHex()}`,
  maxUses: '1',
  audience: 'priorseal.xyz',
};

const prepared = (await post('/v1/authorizations/prepare', draft)).body;
const typedData = record(prepared.typedData, 'Prepared EIP-712 typed data');
record(typedData.domain, 'Prepared EIP-712 domain');
record(typedData.types, 'Prepared EIP-712 types');
record(typedData.message, 'Prepared EIP-712 message');
string(typedData.primaryType, 'Prepared EIP-712 primaryType');
const signature = await account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]);
const preparedAuthorization = record(prepared.authorization, 'Prepared authorization');
const accepted = (await post('/v1/authorizations', { ...preparedAuthorization, signature }, `smoke-${suffix}`)).body;
const authorization = record(accepted.authorization, 'Accepted authorization');
const acceptance = record(accepted.acceptance, 'Authorization acceptance');
const authorizationId = string(authorization.authorizationId, 'Authorization id');
const acceptedAt = number(acceptance.acceptedAt, 'Acceptance time');
const keyId = string(acceptance.keyId, 'Acceptance key id');
const issuer = string(acceptance.issuer, 'Acceptance issuer');
const entryHash = string(acceptance.entryHash, 'Acceptance entry hash');
const stored = (await request(`/v1/authorizations/${encodeURIComponent(authorizationId)}`)).body;
const storedAuthorization = record(stored.authorization, 'Stored authorization');
const storedAcceptance = record(stored.acceptance, 'Stored acceptance');
const keys = registry.body.keys as unknown[];
const key = keys.map((candidate) => optionalRecord(candidate)).find((candidate) => candidate?.keyId === keyId && candidate.issuer === issuer);

assert(key, 'Production issuer key is not published');
const publicKey = string(key.publicKey, 'Issuer public key');
const authorizationCheck = await verifyAuthorization(authorization, { now: acceptedAt, audience: 'priorseal.xyz' });
assert(authorizationCheck.valid, `Authorization verification failed: ${authorizationCheck.code}`);
assert(verifyAuthorizationReceipt(acceptance, publicKey), 'Issuer acceptance signature is invalid');
const policy = record(accepted.policy, 'Applied policy');
const policyEvidence = record(accepted.policyEvidence, 'Policy evidence');
const policyDocument = record(policyEvidence.document, 'Policy document');
assert(policy.allowed === true && policyDocument.policyId === 'priorseal-public-beta-v1', 'Public beta policy was not applied');
const timestampEvidence = record(accepted.timestampEvidence, 'RFC 3161 timestamp evidence');
for (const field of ['schema', 'domain', 'profile', 'tsaUrl', 'authorizationHash', 'nonce', 'serialNumber', 'policyOid', 'digestAlgorithm', 'responseHash', 'response'] as const) string(timestampEvidence[field], `Timestamp ${field}`);
number(timestampEvidence.requestedAt, 'Timestamp request time');
number(timestampEvidence.timestamp, 'Timestamp time');
const authorizationHash = string(acceptance.authorizationHash, 'Acceptance authorization hash');
const timestampCheck = await verifyTimestampEvidence(
  timestampEvidence as NonNullable<Parameters<typeof verifyTimestampEvidence>[0]>,
  new TextEncoder().encode(canonicalize(authorization)),
  policyDocument.timestampPolicy,
  { authorizationHash, requestedAt: acceptedAt, before: expiresAt },
);
assert(timestampCheck.valid, `Timestamp verification failed: ${timestampCheck.code}`);
assert(storedAuthorization.authorizationId === authorizationId, 'Persisted authorization does not match the accepted response');
assert(storedAcceptance.entryHash === entryHash, 'Persisted acceptance does not match the accepted response');

let pending = null;
if (runPendingFlow) {
  let receiptId = null;
  let job;
  if (resumedPendingJobId) {
    job = (await request(`/v1/observation-jobs/${encodeURIComponent(resumedPendingJobId)}`)).body;
  } else {
    const pendingSuffix = `${Date.now()}-${suffix}`;
    const intent = {
      intentId: `smoke-pending-${pendingSuffix}`,
      chainId: 8453,
      action: 'TRANSFER',
      asset: 'eip155:8453/native',
      amount: '1',
      sender: `0x${'2'.repeat(40)}`,
      recipient: `0x${'3'.repeat(40)}`,
      validUntil: now + 3600,
      nonce: '1',
      constraints: { minConfirmations: 12 },
    };
    await post('/v1/intents', intent, `smoke-pending-intent-${pendingSuffix}`);
    const observed = (await post('/v1/executions/observe', {
      intentId: intent.intentId,
      chainId: 8453,
      txHash: `0x${'f'.repeat(64)}`,
      confirmations: 12,
    }, `smoke-pending-observe-${pendingSuffix}`)).body;
    const observation = record(observed.observation, 'Execution observation');
    const receipt = record(observed.receipt, 'Execution receipt');
    const expectedOutcome = observation.status === 'PENDING' ? 'PENDING' : 'UNDETERMINED';
    assert(receipt.outcome === expectedOutcome, 'Non-final execution was incorrectly classified');
    if (receipt.schema === 'priorseal.execution-receipt.v1') {
      assert(receipt.compliance === undefined, 'Legacy receipt unexpectedly included v3 compliance claims');
    } else {
      assert(receipt.schema === 'priorseal.execution-receipt.v3' && optionalRecord(receipt.compliance)?.status === 'NOT_ASSESSABLE', 'Non-final execution was incorrectly assessed for compliance');
    }
    assert(observed.authorizationAssociation !== 'FINAL', 'Non-final execution incorrectly claimed the authorization');
    job = record(observed.observationJob, 'Observation job');
    string(job.jobId, 'Observation job id');
    receiptId = string(receipt.receiptId, 'Execution receipt id');
  }

  const deadline = Date.now() + pendingTimeoutMs;
  let reportedAttempts = -1;
  while (!['COMPLETED', 'UNDETERMINED', 'FAILED'].includes(string(job.state, 'Observation job state')) && Date.now() < deadline) {
    const attempts = number(job.attempts, 'Observation job attempts');
    if (attempts !== reportedAttempts) {
      console.error(JSON.stringify({ event: 'pending-progress', jobId: job.jobId, state: job.state, attempts, nextAttemptAt: job.nextAttemptAt }));
      reportedAttempts = attempts;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    job = (await request(`/v1/observation-jobs/${encodeURIComponent(string(job.jobId, 'Observation job id'))}`)).body;
  }
  assert(job.state === 'UNDETERMINED' && number(job.attempts, 'Observation job attempts') > 0, `Pending job did not close safely within ${pendingTimeoutMs} ms: ${String(job.state)}`);
  pending = { receiptId, jobId: job.jobId, state: job.state, attempts: job.attempts };
}

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  version: version.body.version,
  authorizationId,
  issuer,
  keyId,
  policyId: policyDocument.policyId,
  timestampProfile: timestampEvidence.profile,
  timestampVerified: true,
  persisted: true,
  pending,
}, null, 2));
