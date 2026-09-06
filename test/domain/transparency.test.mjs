import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { encodeFunctionData } from 'viem';
import { buildTransparencyEvidence, hashJson, verifyTransparencyEvidence } from '../../src/index.mjs';
import { verifyTransparencyAnchor } from '../../src/infrastructure/transparency/file-anchor-provider.mjs';

test('transparency evidence links an acceptance entry to a signed checkpoint', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const first = { sequence: 1, authorizationHash: 'a'.repeat(64), acceptedAt: 100, previousEntryHash: null };
  first.entryHash = hashJson(first);
  const second = { sequence: 2, authorizationHash: 'b'.repeat(64), acceptedAt: 101, previousEntryHash: first.entryHash };
  second.entryHash = hashJson(second);
  const acceptance = { sequence: 1, entryHash: first.entryHash };
  const evidence = buildTransparencyEvidence({ entries: [first, second], acceptance, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 102 });
  assert.equal(verifyTransparencyEvidence(evidence, acceptance, publicKeyPem), true);
  assert.equal(verifyTransparencyEvidence({ ...evidence, chain: [{ ...first, authorizationHash: 'c'.repeat(64) }, second] }, acceptance, publicKeyPem), false);
});

test('an external anchor is accepted only when its successful on-chain call matches', async () => {
  const contract = `0x${'1'.repeat(40)}`;
  const txHash = `0x${'2'.repeat(64)}`;
  const blockHash = `0x${'3'.repeat(64)}`;
  const headEntryHash = '4'.repeat(64);
  const anchor = { type: 'eip155', chainId: 8453, contract, txHash, blockNumber: 100, anchoredAt: 1_000, size: 7, headEntryHash };
  const data = encodeFunctionData({ abi: [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }], functionName: 'anchor', args: [7n, `0x${headEntryHash}`] });
  const rpcClient = { async call(_url, method) {
    if (method === 'eth_getTransactionByHash') return { hash: txHash, to: contract, blockNumber: '0x64', input: data };
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x64', blockHash };
    return { hash: blockHash, timestamp: '0x3e8' };
  } };
  assert.deepEqual(await verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls: ['https://rpc.invalid'] }), anchor);
  await assert.rejects(() => verifyTransparencyAnchor({ ...anchor, size: 8 }, { rpcClient, rpcUrls: ['https://rpc.invalid'] }), /could not be verified/);
});

test('a valid but older anchor does not claim to cover a newer authorization', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const first = { sequence: 1, authorizationHash: 'a'.repeat(64), acceptedAt: 100, previousEntryHash: null };
  first.entryHash = hashJson(first);
  const second = { sequence: 2, authorizationHash: 'b'.repeat(64), acceptedAt: 101, previousEntryHash: first.entryHash };
  second.entryHash = hashJson(second);
  const evidence = buildTransparencyEvidence({ entries: [first, second], acceptance: { sequence: 2, entryHash: second.entryHash }, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 102, anchor: { type: 'eip155', chainId: 8453, contract: `0x${'1'.repeat(40)}`, txHash: `0x${'2'.repeat(64)}`, blockNumber: 100, anchoredAt: 100, size: 1, headEntryHash: first.entryHash } });
  assert.equal(evidence.checkpoint.anchor, null);
  assert.equal(evidence.checkpoint.size, 2);
});
