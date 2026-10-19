import test from 'node:test';
import assert from 'node:assert/strict';
import { PriorSealApiError, createPriorSealClient, selfServeClaimMessage, selfServeTopup } from '../../sdk/dist/index.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const PAY_TO = '0x5fbbbcbf2ade44f5c604e5e55f11945e1addd231';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TX_HASH = `0x${'a'.repeat(64)}`;
const ACCOUNT = { accountId: 'selfserve-1bf19c0e', provisionedCredits: '150', remainingCredits: '150', status: 'active' };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function capabilitiesBody(claim: unknown) {
  return {
    schema: 'priorseal.capabilities.v1', issuer: 'priorseal', audience: 'priorseal',
    executionProfiles: ['priorseal.intent.v1'], chains: [8453], authorizers: ['eip712'],
    proofMode: 'issuer', policyHash: `0x${'0'.repeat(64)}`, minConfirmations: 0,
    maxToleratedReorgDepth: null, finalityRequirement: 'CONFIRMATIONS',
    dependencies: { issuer: 'configured', timestamp: 'not_required', rpc: 'configured', storage: 'available' },
    workflowReady: true, chainReadiness: [{ chainId: 8453, rpc: 'configured' }],
    readinessScope: 'Configuration only', checkedAt: 1_800_000_000,
    archive: { enabled: false, retention: 'operator_defined', scope: 'project_uploaded_evidence' },
    payments: {
      x402: { configured: false, networks: [], routes: [] },
      agentCredits: { configured: true, creditUnitUsd: '0.01', credentialHeader: 'x-priorseal-agent-key', accountStatusPath: '/v1/agent-accounts/self', usagePath: '/v1/agent-accounts/self/usage', routes: [] },
      selfserveClaim: claim,
    },
  };
}

test('selfServeClaimMessage commits to the deployment payTo and tx hash in lowercase', () => {
  assert.equal(selfServeClaimMessage('0x5FBBbcBF2ade44F5C604e5E55F11945E1adDd231', `0x${'A'.repeat(64)}`), `priorseal-selfserve-claim-v1:${PAY_TO}:0x${'a'.repeat(64)}`);
});

test('selfServeTopup transfers once, signs the claim message, and returns the credential', async () => {
  const bodies: unknown[] = [];
  const client = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async (_url, init = {}) => {
    if (init.body) bodies.push(JSON.parse(String(init.body)));
    const path = new URL(String(_url)).pathname;
    if (path === '/v1/capabilities') return response(capabilitiesBody({ configured: true, method: 'POST', path: '/v1/selfserve/claim', chainId: 8453, asset: USDC, payTo: PAY_TO, minPayUsd: '1.00', creditUnitUsd: '0.01' }));
    return response({ account: ACCOUNT, credential: 'psa_claimed', credits: '150', txHash: TX_HASH, requestId: 'r1' });
  } });
  let transfers = 0;
  const account = privateKeyToAccount(generatePrivateKey());
  const result = await selfServeTopup({
    client,
    amountUsdc: '1.50',
    payer: {
      transfer: async (request) => {
        transfers += 1;
        assert.deepEqual(request, { payTo: PAY_TO, asset: USDC, chainId: 8453, amountUsdc: '1.50' });
        return { txHash: TX_HASH };
      },
      signMessage: async (message) => {
        assert.equal(message, selfServeClaimMessage(PAY_TO, TX_HASH));
        return account.signMessage({ message });
      },
    },
  });
  assert.equal(transfers, 1);
  assert.equal(result.credential, 'psa_claimed');
  assert.equal(result.credits, '150');
  assert.equal(result.accountId, ACCOUNT.accountId);
  const claimBody = bodies[0] as Record<string, unknown>;
  assert.deepEqual(claimBody, { txHash: TX_HASH, signature: claimBody.signature });
  assert.match(claimBody.signature as string, /^0x[0-9a-fA-F]{130}$/);
});

test('selfServeTopup retries only an unseen transaction and never re-transfers', async () => {
  let claimCalls = 0;
  const client = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async (_url, init = {}) => {
    const path = new URL(String(_url)).pathname;
    if (path === '/v1/capabilities') return response(capabilitiesBody({ configured: true, method: 'POST', path: '/v1/selfserve/claim', chainId: 8453, asset: USDC, payTo: PAY_TO, minPayUsd: '1.00', creditUnitUsd: '0.01' }));
    claimCalls += 1;
    if (claimCalls < 3) return response({ error: { code: 'CLAIM_TX_NOT_FOUND', message: 'not yet' } }, 404);
    return response({ account: ACCOUNT, credential: 'psa_claimed', credits: '150', txHash: TX_HASH });
  } });
  const result = await selfServeTopup({
    client,
    amountUsdc: '1.00',
    retries: 3,
    retryDelayMs: 1,
    payer: { transfer: async () => ({ txHash: TX_HASH }), signMessage: async (message) => `0x${'ab'.repeat(65)}` },
  });
  assert.equal(result.credential, 'psa_claimed');
  assert.equal(claimCalls, 3);
});

test('selfServeTopup refuses disabled deployments, sub-minimum amounts, and malformed wallets', async () => {
  const disabled = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async () => response(capabilitiesBody({ configured: false })) });
  await assert.rejects(selfServeTopup({ client: disabled, amountUsdc: '1.00', payer: { transfer: async () => ({ txHash: TX_HASH }), signMessage: async () => '0x00' } }), /does not enable self-serve funding/);
  const minimum = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async () => response(capabilitiesBody({ configured: true, method: 'POST', path: '/v1/selfserve/claim', chainId: 8453, asset: USDC, payTo: PAY_TO, minPayUsd: '1.00', creditUnitUsd: '0.01' })) });
  await assert.rejects(selfServeTopup({ client: minimum, amountUsdc: '0.02', payer: { transfer: async () => ({ txHash: TX_HASH }), signMessage: async () => '0x00' } }), /below the deployment minimum/);
  const finalError = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async (_url, init = {}) => {
    const path = new URL(String(_url)).pathname;
    if (path === '/v1/capabilities') return response(capabilitiesBody({ configured: true, method: 'POST', path: '/v1/selfserve/claim', chainId: 8453, asset: USDC, payTo: PAY_TO, minPayUsd: '1.00', creditUnitUsd: '0.01' }));
    return response({ error: { code: 'CLAIM_SIGNATURE_INVALID', message: 'bad signature' } }, 400);
  } });
  await assert.rejects(selfServeTopup({ client: finalError, amountUsdc: '1.00', payer: { transfer: async () => ({ txHash: TX_HASH }), signMessage: async () => `0x${'ab'.repeat(65)}` } }), (error: unknown) => error instanceof PriorSealApiError && error.code === 'CLAIM_SIGNATURE_INVALID');
  const client = createPriorSealClient({ baseUrl: 'https://priorseal.test', fetch: async (_url, init = {}) => {
    const path = new URL(String(_url)).pathname;
    if (path === '/v1/capabilities') return response(capabilitiesBody({ configured: true, method: 'POST', path: '/v1/selfserve/claim', chainId: 8453, asset: USDC, payTo: PAY_TO, minPayUsd: '1.00', creditUnitUsd: '0.01' }));
    if (init.body) void JSON.parse(String(init.body));
    return response({ account: { ...ACCOUNT, provisionedCredits: '0', remainingCredits: '0' }, credential: 'psa_claimed', credits: '150', txHash: TX_HASH });
  } });
  await assert.rejects(selfServeTopup({ client, amountUsdc: '1.00', payer: { transfer: async () => ({ txHash: 'nothex' }), signMessage: async () => '0x00' } }), { name: 'TypeError' });
});
