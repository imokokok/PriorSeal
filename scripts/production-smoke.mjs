import { randomBytes, randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalize, verifyAuthorization, verifyAuthorizationReceipt, verifyTimestampEvidence } from '../src/index.mjs';

const baseUrl = new URL(process.env.PRIORSEAL_BASE_URL ?? 'https://priorseal.xyz');
const expectedVersion = process.env.PRIORSEAL_EXPECTED_VERSION ?? 'cloudflare-';
const runPendingFlow = process.argv.includes('--pending');
const resumedPendingJobId = process.env.PRIORSEAL_PENDING_JOB_ID?.trim();
const pendingTimeoutMs = Number(process.env.PRIORSEAL_PENDING_TIMEOUT_MS ?? 720_000);

if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
  throw new Error('PRIORSEAL_BASE_URL must use HTTPS outside local development');
}
if (!Number.isSafeInteger(pendingTimeoutMs) || pendingTimeoutMs < 90_000 || pendingTimeoutMs > 900_000) {
  throw new Error('PRIORSEAL_PENDING_TIMEOUT_MS must be an integer between 90000 and 900000');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init) {
  let lastError;
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
    const body = await response.json().catch(() => null);
    if (response.ok) return { response, body };
    const code = body?.error?.code ?? body?.code ?? 'REQUEST_FAILED';
    const message = body?.error?.message ?? body?.message ?? response.statusText;
    const error = new Error(`${response.status} ${code}: ${message}`);
    if (![502, 503, 504].includes(response.status) || attempt === 3) throw error;
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError;
}

async function post(path, body, idempotencyKey) {
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
assert(ready.body.status === 'ready' && ready.body.storage === 'postgresql', 'PostgreSQL readiness check failed');
assert(version.body.service === 'priorseal' && version.body.version.startsWith(expectedVersion), `Unexpected production build: ${version.body.version}`);
assert(!version.response.headers.has('x-render-origin-server') && !version.response.headers.has('rndr-id'), 'Request still reached Render');
assert(home.ok && /PriorSeal/i.test(homeText), 'Production console is unavailable');
assert(registry.body.keys?.some((key) => key.status === 'active'), 'No active issuer key is published');

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
const signature = await account.signTypedData(prepared.typedData);
const accepted = (await post('/v1/authorizations', { ...prepared.authorization, signature }, `smoke-${suffix}`)).body;
const stored = (await request(`/v1/authorizations/${encodeURIComponent(accepted.authorization.authorizationId)}`)).body;
const key = registry.body.keys.find((candidate) => candidate.keyId === accepted.acceptance.keyId && candidate.issuer === accepted.acceptance.issuer);

assert(key, 'Production issuer key is not published');
const authorizationCheck = await verifyAuthorization(accepted.authorization, { now: accepted.acceptance.acceptedAt, audience: 'priorseal.xyz' });
assert(authorizationCheck.valid, `Authorization verification failed: ${authorizationCheck.code}`);
assert(verifyAuthorizationReceipt(accepted.acceptance, key.publicKey), 'Issuer acceptance signature is invalid');
assert(accepted.policy?.allowed && accepted.policyEvidence?.document?.policyId === 'priorseal-public-beta-v1', 'Public beta policy was not applied');
assert(accepted.timestampEvidence, 'RFC 3161 timestamp evidence is missing');
const timestampCheck = await verifyTimestampEvidence(
  accepted.timestampEvidence,
  new TextEncoder().encode(canonicalize(accepted.authorization)),
  accepted.policyEvidence.document.timestampPolicy,
  { authorizationHash: accepted.acceptance.authorizationHash, requestedAt: accepted.acceptance.acceptedAt, before: expiresAt },
);
assert(timestampCheck.valid, `Timestamp verification failed: ${timestampCheck.code}`);
assert(stored.authorization.authorizationId === accepted.authorization.authorizationId, 'Persisted authorization does not match the accepted response');
assert(stored.acceptance.entryHash === accepted.acceptance.entryHash, 'Persisted acceptance does not match the accepted response');

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
    assert(observed.receipt?.outcome === 'UNDETERMINED', 'Pending execution was incorrectly classified');
    assert(observed.observationJob?.jobId, 'Pending execution did not return a durable job');
    receiptId = observed.receipt.receiptId;
    job = observed.observationJob;
  }

  const deadline = Date.now() + pendingTimeoutMs;
  let reportedAttempts = -1;
  while (!['COMPLETED', 'UNDETERMINED', 'FAILED'].includes(job.state) && Date.now() < deadline) {
    if (job.attempts !== reportedAttempts) {
      console.error(JSON.stringify({ event: 'pending-progress', jobId: job.jobId, state: job.state, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt }));
      reportedAttempts = job.attempts;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    job = (await request(`/v1/observation-jobs/${encodeURIComponent(job.jobId)}`)).body;
  }
  assert(job.state === 'UNDETERMINED' && job.attempts > 0, `Pending job did not close safely within ${pendingTimeoutMs} ms: ${job.state}`);
  pending = { receiptId, jobId: job.jobId, state: job.state, attempts: job.attempts };
}

console.log(JSON.stringify({
  ok: true,
  baseUrl: baseUrl.origin,
  version: version.body.version,
  authorizationId: accepted.authorization.authorizationId,
  issuer: accepted.acceptance.issuer,
  keyId: accepted.acceptance.keyId,
  policyId: accepted.policyEvidence.document.policyId,
  timestampProfile: accepted.timestampEvidence.profile,
  timestampVerified: true,
  persisted: true,
  pending,
}, null, 2));
