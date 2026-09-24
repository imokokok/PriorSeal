// Produces only PriorSeal-side test artifacts. APS inputs are never regenerated.
import { createHash, createPrivateKey } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import type { Intent } from 'priorseal-sdk';
import {
  authorizationTypedData, buildAuthorization, buildAuthorizationReceipt,
  buildAuthorizedReceipt, signReceipt,
} from '../../src/index.mjs';
import { signAuthorizationReceipt } from '../../src/domain/authorization.mjs';
import { authorizeFromAps, loadApsCase } from './adapter.mjs';
import { PRIORSEAL_KEY, REFERENCE_TIME } from './trust.mjs';

// Public, deterministic TEST keys. Never fund them or use them in a deployment.
const principal = privateKeyToAccount(`0x${'1'.repeat(64)}`);
export const EXECUTOR = '0x2222222222222222222222222222222222222222';
const issuerKey = createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${'71'.repeat(32)}`, 'hex'), format: 'der', type: 'pkcs8' })
  .export({ type: 'pkcs8', format: 'pem' }).toString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reference = Date.parse(REFERENCE_TIME) / 1000;
type CoreAuthorization = ReturnType<typeof buildAuthorization>;
type ExecutionEdits = Partial<{ sender: string; nativeValue: string }>;
type MakeTestReceiptOptions = {
  apsCase?: string;
  name?: string;
  nonce?: string;
  editIntent?: (intent: Intent) => Intent;
  executionEdits?: ExecutionEdits;
};

export async function signTestAuthorization(intent: Intent, name: string, edits: Record<string, unknown> = {}) {
  const unsigned = buildAuthorization({ intent,
    principal: { type: 'user', id: 'aps-163-test-principal', account: principal.address },
    authorizer: { type: 'eip712', address: principal.address },
    delegate: { agentId: 'aps-163-test-agent', executor: EXECUTOR },
    issuedAt: reference, notBefore: reference, expiresAt: intent.validUntil,
    authorizationNonce: `0x${hash(`authorization:${name}`)}`, maxUses: '1', audience: 'priorseal',
    ...edits,
  });
  return buildAuthorization({ ...unsigned, signature: await principal.signTypedData(authorizationTypedData(unsigned)) });
}

export function receiptFromAuthorization(
  authorization: CoreAuthorization,
  name: string,
  executionEdits: ExecutionEdits = {},
) {
  const intent = authorization.intent;
  const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({ authorization,
    issuer: PRIORSEAL_KEY.issuer, keyId: PRIORSEAL_KEY.keyId, acceptedAt: authorization.issuedAt }), issuerKey);
  const execution = {
    schema: 'priorseal.execution-observation.v1', chainId: intent.chainId,
    txHash: `0x${hash(`synthetic:${name}`)}`, status: 'CONFIRMED', blockNumber: 163,
    blockHash: `0x${'a'.repeat(64)}`, executedAt: reference, observedAt: reference,
    action: 'CONTRACT_CALL', nonce: intent.nonce, sender: EXECUTOR,
    recipient: intent.callTarget, target: intent.callTarget, calldataHash: intent.calldataHash,
    asset: intent.asset, amount: intent.amount, transfers: [], transferMatchUnique: false,
    nativeValue: intent.transactionValue, tokenValue: null, gasUsed: '21000', fee: null,
    executionDataAvailable: true, observationSource: 'fixture', finalityState: 'CONFIRMED', confirmations: 1,
    ...executionEdits,
  };
  return signReceipt(buildAuthorizedReceipt({ authorization, acceptance, execution,
    issuer: PRIORSEAL_KEY.issuer, keyId: PRIORSEAL_KEY.keyId, issuedAt: reference }), issuerKey);
}

export async function makeTestReceipt({ apsCase = 'permit', name = apsCase, nonce = '7',
  editIntent = (intent) => intent, executionEdits = {} }: MakeTestReceiptOptions = {}) {
  const result = await authorizeFromAps(loadApsCase(apsCase), {
    executor: EXECUTOR, nonce, intentId: `aps-163-${name}`,
    onAuthorize: (intent) => signTestAuthorization(editIntent(structuredClone(intent)), name),
  });
  if (!result.ok) throw new Error(result.code);
  return receiptFromAuthorization(result.authorization, name, executionEdits);
}

export async function generatePriorSealFixtures() {
  const fixtures = {
    permit: await makeTestReceipt(),
    narrow: await makeTestReceipt({ apsCase: 'narrow' }),
    'execution-mismatch': await makeTestReceipt({ name: 'execution-mismatch', executionEdits: { nativeValue: '2' } }),
    'decision-reused': await makeTestReceipt({ name: 'decision-reused', nonce: '8' }),
  };
  const directory = new URL('./priorseal-inputs/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(fixtures)) {
    writeFileSync(new URL(`${name}.json`, directory), `${JSON.stringify(value, null, 2)}\n`);
  }
  return fixtures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generatePriorSealFixtures();
