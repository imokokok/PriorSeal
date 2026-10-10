// Generates the frozen Open Evidence Lab exact-call matrix fixture.
//
// Every key material used here is a public, deterministic TEST value. None of
// it is a secret and none of it may be used in a deployment. The generator is
// committed so that any reader can re-derive the fixture byte for byte from
// this file plus the repository source at the pinned revision.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
} from '../../src/index.mjs';
import { signAuthorizationReceipt } from '../../src/domain/authorization.mjs';
import { normalizeExecution } from '../../src/domain/execution.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

// --- public, deterministic TEST identities -----------------------------------
// EIP-712 principal/authorizer. `0x11..11` is a deliberately public test scalar
// already used by the repository's own authorization tests.
const PRINCIPAL = privateKeyToAccount(`0x${'11'.repeat(32)}`);
// Ed25519 receipt issuer, derived from a fixed 32-byte seed so the fixture is
// reproducible without shipping any key file.
const ISSUER_SEED = `${'71'.repeat(32)}`;
const ISSUER_PRIVATE_KEY_PEM = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${ISSUER_SEED}`, 'hex'),
  format: 'der',
  type: 'pkcs8',
}).export({ type: 'pkcs8', format: 'pem' }).toString();
const ISSUER_PUBLIC_KEY_PEM = createPublicKey(ISSUER_PRIVATE_KEY_PEM)
  .export({ type: 'spki', format: 'pem' }).toString();

export const FIXTURE = {
  chainId: 8453,
  executor: '0x2222222222222222222222222222222222222222',
  callTarget: '0x3333333333333333333333333333333333333333',
  recipient: '0x4444444444444444444444444444444444444444',
  calldataHash: `0x${'5a'.repeat(32)}`,
  calldataHashChanged: `0x${'5b'.repeat(32)}`,
  otherTarget: '0x5555555555555555555555555555555555555555',
  transactionValue: '1000000000000000',
  changedTransactionValue: '2000000000000000',
  asset: 'eip155:8453/native',
  amount: '1000000000000000',
  nonce: '7',
  issuedAt: 1000,
  notBefore: 1000,
  expiresAt: 2000,
  validUntil: 2000,
  acceptedAt: 1000,
  issuer: 'oel-exact-call-fixture-issuer',
  keyId: 'oel-exact-call-fixture-key-1',
} as const;

const EXACT_CALL_PROFILE = 'priorseal.execution-profile.exact-call.v1';

function buildIntent() {
  return {
    schema: 'priorseal.intent.v2',
    executionProfile: EXACT_CALL_PROFILE,
    intentId: 'oel-exact-call-matrix-1',
    chainId: FIXTURE.chainId,
    action: 'CONTRACT_CALL',
    asset: FIXTURE.asset,
    amount: FIXTURE.amount,
    sender: FIXTURE.executor,
    recipient: FIXTURE.recipient,
    validUntil: FIXTURE.validUntil,
    nonce: FIXTURE.nonce,
    callTarget: FIXTURE.callTarget,
    calldataHash: FIXTURE.calldataHash,
    transactionValue: FIXTURE.transactionValue,
  };
}

export async function buildSourceRecord() {
  const draft = buildAuthorization({
    intent: buildIntent(),
    principal: { type: 'user', id: 'oel-fixture-principal', account: PRINCIPAL.address },
    authorizer: { type: 'eip712', address: PRINCIPAL.address },
    delegate: { agentId: 'oel-fixture-agent', executor: FIXTURE.executor },
    issuedAt: FIXTURE.issuedAt,
    notBefore: FIXTURE.notBefore,
    expiresAt: FIXTURE.expiresAt,
    authorizationNonce: `0x${'6a'.repeat(32)}`,
    maxUses: '1',
    audience: 'priorseal',
    policyHash: `0x${'0'.repeat(64)}`,
  });
  const authorization = buildAuthorization({
    ...draft,
    signature: await PRINCIPAL.signTypedData(authorizationTypedData(draft)),
  });
  const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
    authorization,
    issuer: FIXTURE.issuer,
    keyId: FIXTURE.keyId,
    acceptedAt: FIXTURE.acceptedAt,
  }), ISSUER_PRIVATE_KEY_PEM);
  return {
    schema: 'oel.source-record.v1',
    profile: EXACT_CALL_PROFILE,
    authorization,
    acceptance,
  };
}

type ExecutionEdits = Partial<{
  target: string;
  calldataHash: string;
  nativeValue: string;
  executionDataAvailable: boolean;
  status: string;
  finalityState: string;
  confirmations: number;
}>;

function observedEnvelope(caseId: string, index: number, edits: ExecutionEdits = {}) {
  return normalizeExecution({
    chainId: FIXTURE.chainId,
    txHash: `0x${(70 + index).toString(16).padStart(2, '0').repeat(32)}`,
    status: 'CONFIRMED',
    blockNumber: 1000 + index,
    blockHash: `0x${'ab'.repeat(32)}`,
    action: 'CONTRACT_CALL',
    nonce: FIXTURE.nonce,
    sender: FIXTURE.executor,
    recipient: FIXTURE.callTarget,
    target: FIXTURE.callTarget,
    calldataHash: FIXTURE.calldataHash,
    asset: FIXTURE.asset,
    amount: FIXTURE.amount,
    nativeValue: FIXTURE.transactionValue,
    transfers: [],
    transferMatchUnique: false,
    gasUsed: '21000',
    executedAt: 1100 + index,
    observedAt: 1101 + index,
    finalityState: 'CONFIRMED',
    confirmations: 12,
    observationSource: 'synthetic-offline-fixture',
    ...edits,
  });
}

export const CASES: ReadonlyArray<{ id: string; className: 'envelope-binding' | 'evidence-availability'; edits: ExecutionEdits }> = [
  { id: 'case-00-exact-call-observed-match', className: 'envelope-binding', edits: {} },
  { id: 'case-01-call-target-mismatch', className: 'envelope-binding', edits: { target: FIXTURE.otherTarget } },
  { id: 'case-02-calldata-mismatch', className: 'envelope-binding', edits: { calldataHash: FIXTURE.calldataHashChanged } },
  { id: 'case-03-transaction-value-mismatch', className: 'envelope-binding', edits: { nativeValue: FIXTURE.changedTransactionValue } },
  {
    id: 'case-04-execution-evidence-unavailable',
    className: 'evidence-availability',
    edits: { executionDataAvailable: false, status: 'NOT_FOUND', finalityState: 'UNKNOWN', confirmations: 0 },
  },
];

export function buildObservedEnvelopes() {
  return CASES.map((entry, index) => ({ ...entry, observed: observedEnvelope(entry.id, index, entry.edits) }));
}

export function testKeys() {
  return {
    schema: 'oel.test-keys.v1',
    notice: 'Public, deterministic TEST material. Not secrets. Never fund or deploy these identities.',
    authorizer: {
      scheme: 'EIP-712 (secp256k1)',
      address: PRINCIPAL.address,
      recoveryRule: 'digest = hashTypedData(typedData rebuilt from the documented PriorSealAuthorization v2 field list and domain {name:"PriorSeal", version:"2", chainId}); recover signer from (digest, signature) and require equality with authorization.authorizer.address',
      testPrivateKey: `0x${'11'.repeat(32)}`,
    },
    issuer: {
      scheme: 'Ed25519',
      keyId: FIXTURE.keyId,
      issuer: FIXTURE.issuer,
      publicKeyPem: ISSUER_PUBLIC_KEY_PEM,
      signingInput: 'base64url(Ed25519.sign(null, utf8(canonicalJson(acceptance without "signature"))))',
      testSeedHex: ISSUER_SEED,
    },
  };
}

function writeJson(relativePath: string, value: unknown) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

export async function generate() {
  const sourceRecord = await buildSourceRecord();
  const written = [
    writeJson(join('fixture', 'signed-authorization.json'), sourceRecord),
    writeJson(join('fixture', 'public-test-keys.json'), testKeys()),
    ...buildObservedEnvelopes().map((entry) => writeJson(join('fixture', 'observed', `${entry.id}.json`), entry.observed)),
  ];
  return { sourceRecord, written };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { written } = await generate();
  for (const path of written) process.stdout.write(`wrote ${path}\n`);
}
