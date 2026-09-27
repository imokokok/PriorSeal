import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, type WalletClient, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createRwaViemSubmitter } from '../../src/index.mjs';

const account = privateKeyToAccount(('0x' + '12'.repeat(32)) as Hex);
const tx = { chainId: 8453, from: account.address.toLowerCase(), to: '0x' + '22'.repeat(20), nonce: '7', value: '0', data: '0x1234' };
async function setup(mode = 'valid') {
  let broadcasts = 0, signed = 0;
  const raw = await account.signTransaction({ chainId: tx.chainId, to: tx.to as Hex, nonce: 7, value: 0n, data: tx.data as Hex, gas: 100000n, gasPrice: 1n });
  const client = { account, chain: { id: 8453 }, transport: { type: 'custom' }, request: async (args: { method: string; params?: unknown[] }, options?: { retryCount?: number }) => {
    if (args.method === 'eth_chainId') return mode === 'wrong-rpc-chain' ? '0x1' : '0x2105';
    assert.equal(args.method, 'eth_sendRawTransaction'); assert.equal(options?.retryCount, 0); broadcasts++;
    assert.deepEqual(args.params, [raw]);
    if (mode === 'lost-response') throw new Error('response lost');
    return mode === 'wrong-hash' ? '0x' + 'ff'.repeat(32) : keccak256(raw);
  }, prepareTransactionRequest: async () => ({}), signTransaction: async () => {
    signed++;
    if (mode === 'changed-call') return account.signTransaction({ chainId: 8453, to: tx.to as Hex, nonce: 7, value: 0n, data: '0x5678', gas: 100000n, gasPrice: 1n });
    return raw;
  } } as unknown as WalletClient;
  return { submit: createRwaViemSubmitter(client), broadcasts: () => broadcasts, signed: () => signed, raw };
}
test('Viem signer validates every signed call field and broadcasts exactly the decoded raw bytes', async () => {
  const x = await setup(); let gates = 0;
  assert.equal(await x.submit(tx, async () => { gates++; }), keccak256(x.raw));
  assert.equal(gates, 2); assert.equal(x.broadcasts(), 1); assert.equal(x.signed(), 1);
});
for (const mode of ['wrong-rpc-chain','changed-call']) test('Viem signer does not broadcast on ' + mode, async () => {
  const x = await setup(mode);
  await assert.rejects(x.submit(tx, async () => {})); assert.equal(x.broadcasts(), 0);
});
for (const mode of ['lost-response','wrong-hash']) test('Viem signer never retries on ' + mode, async () => {
  const x = await setup(mode);
  await assert.rejects(x.submit(tx, async () => {})); assert.equal(x.broadcasts(), 1);
});
test('Viem signer rejects expiry/revocation after gas preparation and after signing', async () => {
  for (const failAt of [1, 2]) {
    const x = await setup(); let gates = 0;
    await assert.rejects(x.submit(tx, async () => { if (++gates === failAt) throw new Error('RWA_EXPIRED_OR_REVOKED'); }), /EXPIRED_OR_REVOKED/);
    assert.equal(x.broadcasts(), 0); assert.equal(x.signed(), failAt - 1);
  }
});
test('Viem signer rejects wrong delegate, chain and unsafe nonce before signing', async () => {
  const x = await setup();
  for (const changed of [{ ...tx, from: '0x' + '33'.repeat(20) }, { ...tx, chainId: 1 }, { ...tx, nonce: '9007199254740992' }]) await assert.rejects(x.submit(changed, async () => {}), /SIGNER_SCOPE/);
  assert.equal(x.broadcasts(), 0); assert.equal(x.signed(), 0);
});
test('Viem signer rejects fallback transports that may rebroadcast despite request retryCount=0', () => {
  assert.throws(() => createRwaViemSubmitter({ account, chain: { id: 8453 }, transport: { type: 'fallback' } } as unknown as WalletClient), /SINGLE_TRANSPORT_REQUIRED/);
});
