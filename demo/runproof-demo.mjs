import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { buildIntent, buildReceipt, signReceipt } from '../src/receipt.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

const intent = buildIntent({
  intentId: 'intent-demo-001',
  chainId: 'eip155:8453',
  action: 'transfer',
  asset: 'eip155:8453/erc20:0xUSDC',
  amount: '125000000',
  sender: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
  validUntil: 1893456000,
});

const execution = {
  chainId: 'eip155:8453',
  txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'CONFIRMED',
  observedAt: 1893455900,
  sender: intent.sender,
  recipient: intent.recipient,
  asset: intent.asset,
  amount: intent.amount,
};

const unsignedReceipt = buildReceipt({ intent, execution, issuer: 'runproof-demo-attester' });
const receipt = signReceipt(unsignedReceipt, privateKeyPem);

await writeFile(new URL('./private-key.pem', import.meta.url), privateKeyPem);
await writeFile(new URL('./public-key.pem', import.meta.url), publicKeyPem);
await writeFile(new URL('./receipt.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);

console.log('RunProof demo complete');
console.log(`Intent hash: ${intent.intentHash}`);
console.log(`Receipt ID:  ${receipt.receiptId}`);
console.log(`Outcome:     ${receipt.outcome}`);
console.log('Run `npm run verify` to verify the receipt offline.');
