import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildIntent, buildReceipt, signReceipt } from '../src/index.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

const intent = buildIntent({
  intentId: 'intent-example-001',
  chainId: 'eip155:8453',
  action: 'transfer',
  asset: 'eip155:8453/erc20:0x833589fCD6EDB6E08f4c7C32D4f71b54bdA02913',
  amount: '125000000',
  sender: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  validUntil: 1893456000,
});

const execution = {
  chainId: intent.chainId,
  txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'CONFIRMED',
  action: 'TRANSFER',
  executedAt: 1893455800,
  observedAt: 1893455900,
  sender: intent.sender,
  recipient: intent.recipient,
  asset: intent.asset,
  amount: intent.amount,
};

const unsignedReceipt = buildReceipt({ intent, execution, issuer: 'runproof-example-attester' });
const receipt = signReceipt(unsignedReceipt, privateKeyPem);

await mkdir(new URL('./receipt-artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('./receipt-artifacts/private-key.pem', import.meta.url), privateKeyPem);
await writeFile(new URL('./receipt-artifacts/public-key.pem', import.meta.url), publicKeyPem);
await writeFile(new URL('./receipt-artifacts/receipt.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);

console.log('RunProof receipt example complete');
console.log(`Intent hash: ${intent.intentHash}`);
console.log(`Receipt ID:  ${receipt.receiptId}`);
console.log(`Outcome:     ${receipt.outcome}`);
console.log('Run `npm run verify:receipt` to verify the receipt offline.');
