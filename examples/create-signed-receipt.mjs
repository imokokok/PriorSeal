import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizationTypedData, authorizeIntent, buildAuthorization, buildAuthorizedReceipt, createMemoryStore, signReceipt } from '../src/index.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const executor = `0x${'a'.repeat(40)}`;
const now = Math.floor(Date.now() / 1000);

const intent = {
  intentId: 'intent-example-001',
  chainId: 8453,
  action: 'TRANSFER',
  asset: 'eip155:8453/erc20:0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913',
  amount: '125000000',
  sender: executor,
  recipient: '0x2222222222222222222222222222222222222222',
  validUntil: now + 3600,
  nonce: '7',
};

const draft = buildAuthorization({
  intent,
  principal: { type: 'user', id: 'example-user', account: account.address },
  authorizer: { type: 'eip712', address: account.address },
  delegate: { agentId: 'example-agent', executor },
  issuedAt: now - 60,
  notBefore: now - 60,
  expiresAt: now + 3600,
  authorizationNonce: `0x${'2'.repeat(64)}`,
  maxUses: '1',
  audience: 'priorseal',
  policyHash: `0x${'0'.repeat(64)}`,
});
const authorization = buildAuthorization({ ...draft, signature: await account.signTypedData(authorizationTypedData(draft)) });
const store = createMemoryStore({ clock: () => (now - 30) * 1000 });
const accepted = await authorizeIntent({ input: authorization, store, privateKeyPem, issuer: 'priorseal-example-attester', keyId: 'example-1', now: () => (now - 30) * 1000 });

const execution = {
  chainId: 8453,
  txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'CONFIRMED',
  action: 'TRANSFER',
  executedAt: now - 10,
  observedAt: now,
  sender: executor,
  recipient: intent.recipient,
  asset: intent.asset,
  amount: intent.amount,
  nonce: intent.nonce,
  confirmations: 12,
  gasUsed: '21000',
  transfers: [],
  finalityState: 'CONFIRMED',
};

const unsignedReceipt = buildAuthorizedReceipt({
  authorization: accepted.response.authorization,
  acceptance: accepted.response.acceptance,
  policyEvidence: accepted.response.policyEvidence,
  execution,
  issuer: 'priorseal-example-attester',
  keyId: 'example-1',
  issuedAt: now,
});
const receipt = signReceipt(unsignedReceipt, privateKeyPem);

await mkdir(new URL('./receipt-artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('./receipt-artifacts/private-key.pem', import.meta.url), privateKeyPem);
await writeFile(new URL('./receipt-artifacts/public-key.pem', import.meta.url), publicKeyPem);
await writeFile(new URL('./receipt-artifacts/receipt.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);

console.log('PriorSeal receipt example complete');
console.log(`Intent hash: ${accepted.response.authorization.intent.intentHash}`);
console.log(`Receipt ID:  ${receipt.receiptId}`);
console.log(`Compliance:  ${receipt.compliance.status}`);
console.log(`Outcome:     ${receipt.outcome}`);
console.log('Run `npm run verify:receipt` to verify the receipt offline.');
