import { readFile } from 'node:fs/promises';
import { verifyReceipt } from '../src/receipt.mjs';

const receiptPath = process.argv[2] ?? new URL('./receipt.json', import.meta.url).pathname;
const publicKeyPath = process.argv[3] ?? new URL('./public-key.pem', import.meta.url).pathname;
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const publicKeyPem = await readFile(publicKeyPath, 'utf8');
const result = verifyReceipt(receipt, publicKeyPem);

console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
