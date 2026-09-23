import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { encodeFunctionData } from 'viem';
import { buildMerkleTransparencyEvidence, buildTransparencyEvidence, createMemoryStore, hashJson, verifyTransparencyEvidence } from '../../src/index.mjs';
import { verifyTransparencyAnchor, type TransparencyAnchor } from '../../src/infrastructure/transparency/file-anchor-provider.mjs';

type AnchorRpcClient = Parameters<typeof verifyTransparencyAnchor>[1]['rpcClient'];
const mockRpcClient = (handler: (url: string, method: string, params: unknown[]) => unknown | Promise<unknown>): AnchorRpcClient => ({
  async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
    return await handler(url, method, params) as T;
  },
});
const logEntry = (sequence: number, authorizationHash: string, acceptedAt: number, previousEntryHash: string | null) => {
  const entry = { sequence, authorizationHash, acceptedAt, previousEntryHash };
  return { ...entry, entryHash: hashJson(entry) };
};
const hasCode = (error: unknown, code: string) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('transparency evidence links an acceptance entry to a signed checkpoint', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const first = logEntry(1, 'a'.repeat(64), 100, null);
  const second = logEntry(2, 'b'.repeat(64), 101, first.entryHash);
  const acceptance = { sequence: 1, entryHash: first.entryHash, acceptedAt: 100, issuer: 'test', keyId: 'k1' };
  const evidence = buildTransparencyEvidence({ entries: [first, second], acceptance, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 102 });
  assert.equal(verifyTransparencyEvidence(evidence, acceptance, publicKeyPem), true);
  assert.equal(verifyTransparencyEvidence({ ...evidence, chain: [{ ...first, authorizationHash: 'c'.repeat(64) }, second] }, acceptance, publicKeyPem), false);
  const wrongIssuer = buildTransparencyEvidence({ entries: [first, second], acceptance, issuer: 'lookalike', keyId: 'k1', privateKeyPem, issuedAt: 102 });
  assert.equal(verifyTransparencyEvidence(wrongIssuer, acceptance, publicKeyPem), false);
});

test('Merkle checkpoints provide a bounded inclusion proof and bind a root anchor', async () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const store = createMemoryStore();
  const first = await store.appendAuthorizationLog({ authorizationHash: 'a'.repeat(64), acceptedAt: 100 });
  for (let sequence = 2; sequence <= 1024; sequence += 1) await store.appendAuthorizationLog({ authorizationHash: sequence.toString(16).padStart(64, '0'), acceptedAt: 101 });
  const acceptance = { ...first, issuer: 'test', keyId: 'k1' };
  const snapshot = await store.getAuthorizationMerkleSnapshot(acceptance);
  const anchor = { type: 'eip155', chainId: 8453, contract: `0x${'1'.repeat(40)}`, txHash: `0x${'2'.repeat(64)}`, blockNumber: 100, anchoredAt: 102, size: snapshot.size, headEntryHash: snapshot.headEntryHash, merkleRoot: snapshot.merkleRoot } satisfies TransparencyAnchor;
  const evidence = buildMerkleTransparencyEvidence({ acceptance, snapshot, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 103, anchor, before: 104 });
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 2_000);
  assert.equal(verifyTransparencyEvidence(evidence, acceptance, publicKeyPem, { before: 104 }), true);
  assert.equal(verifyTransparencyEvidence({ ...evidence, proof: [{ ...evidence.proof[0], side: 'left' }, ...evidence.proof.slice(1)] }, acceptance, publicKeyPem), false);
  assert.equal(verifyTransparencyEvidence(evidence, acceptance, publicKeyPem, { before: 101 }), false);
  assert.throws(() => buildMerkleTransparencyEvidence({ acceptance, snapshot, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 103, anchor: { ...anchor, merkleRoot: 'f'.repeat(64) } }), /anchor/);
});

test('an external anchor is accepted only when its successful on-chain call matches', async () => {
  const contract = `0x${'1'.repeat(40)}`;
  const txHash = `0x${'2'.repeat(64)}`;
  const blockHash = `0x${'3'.repeat(64)}`;
  const headEntryHash = '4'.repeat(64);
  const anchor = { type: 'eip155', chainId: 8453, contract, txHash, blockNumber: 100, anchoredAt: 1_000, size: 7, headEntryHash } satisfies TransparencyAnchor;
  const data = encodeFunctionData({ abi: [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }], functionName: 'anchor', args: [7n, `0x${headEntryHash}`] });
  const rpcClient = mockRpcClient(async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, to: contract, blockNumber: '0x64', blockHash, input: data };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0x64', blockHash };
    if (method === 'eth_blockNumber') return '0x70';
    return { hash: blockHash, timestamp: '0x3e8' };
  });
  assert.deepEqual(await verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls: ['https://rpc.invalid'], minConfirmations: 12 }), anchor);
  const merkleRoot = '5'.repeat(64);
  const merkleAnchor = { ...anchor, merkleRoot } satisfies TransparencyAnchor;
  const merkleData = encodeFunctionData({ abi: [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }], functionName: 'anchor', args: [7n, `0x${merkleRoot}`] });
  const merkleRpc = mockRpcClient((url, method, params) => method === 'eth_getTransactionByHash' ? Promise.resolve({ hash: txHash, to: contract, blockNumber: '0x64', blockHash, input: merkleData }) : rpcClient.call(url, method, params));
  assert.deepEqual(await verifyTransparencyAnchor(merkleAnchor, { rpcClient: merkleRpc, rpcUrls: ['https://rpc.invalid'], minConfirmations: 12 }), merkleAnchor);
  await assert.rejects(() => verifyTransparencyAnchor(merkleAnchor, { rpcClient, rpcUrls: ['https://rpc.invalid'], minConfirmations: 12 }), /could not be verified/);
  await assert.rejects(() => verifyTransparencyAnchor({ ...anchor, size: 8 }, { rpcClient, rpcUrls: ['https://rpc.invalid'] }), /could not be verified/);
});

test('external anchors require the declared chain and configured finality', async () => {
  const contract = `0x${'1'.repeat(40)}`;
  const txHash = `0x${'2'.repeat(64)}`;
  const blockHash = `0x${'3'.repeat(64)}`;
  const headEntryHash = '4'.repeat(64);
  const anchor = { type: 'eip155', chainId: 8453, contract, txHash, blockNumber: 100, anchoredAt: 1_000, size: 7, headEntryHash } satisfies TransparencyAnchor;
  const data = encodeFunctionData({ abi: [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }], functionName: 'anchor', args: [7n, `0x${headEntryHash}`] });
  const rpcClient = mockRpcClient(async (url, method) => {
    if (method === 'eth_chainId') return url === 'wrong-chain' ? '0x1' : '0x2105';
    if (method === 'eth_getTransactionByHash') return { hash: txHash, to: contract, blockNumber: '0x64', blockHash, input: data };
    if (method === 'eth_getTransactionReceipt') return { transactionHash: txHash, status: '0x1', blockNumber: '0x64', blockHash };
    if (method === 'eth_blockNumber') return url === 'under-confirmed' ? '0x64' : '0x70';
    return { hash: blockHash, timestamp: '0x3e8' };
  });
  await assert.rejects(() => verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls: ['wrong-chain'], minConfirmations: 1 }), /could not be verified/);
  await assert.rejects(() => verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls: ['under-confirmed'], minConfirmations: 12 }), /could not be verified/);
  assert.deepEqual(await verifyTransparencyAnchor(anchor, { rpcClient, rpcUrls: ['wrong-chain', 'finalized'], minConfirmations: 12 }), anchor);
});

test('an anchor recorded after execution cannot serve as pre-execution evidence', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const entry = logEntry(1, 'a'.repeat(64), 100, null);
  const acceptance = { sequence: 1, entryHash: entry.entryHash, acceptedAt: 100, issuer: 'test', keyId: 'k1' };
  const anchor = { type: 'eip155', chainId: 8453, contract: `0x${'1'.repeat(40)}`, txHash: `0x${'2'.repeat(64)}`, blockNumber: 100, anchoredAt: 200, size: 1, headEntryHash: entry.entryHash };
  const evidence = buildTransparencyEvidence({ entries: [entry], acceptance, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 201, anchor });
  assert.equal(verifyTransparencyEvidence(evidence, acceptance, publicKeyPem, { before: 199 }), false);
  assert.throws(() => buildTransparencyEvidence({ entries: [entry], acceptance, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 201, anchor, before: 199 }), (error) => hasCode(error, 'TRANSPARENCY_AFTER_EXECUTION'));
});

test('a valid but older anchor does not claim to cover a newer authorization', () => {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const first = logEntry(1, 'a'.repeat(64), 100, null);
  const second = logEntry(2, 'b'.repeat(64), 101, first.entryHash);
  const evidence = buildTransparencyEvidence({ entries: [first, second], acceptance: { sequence: 2, entryHash: second.entryHash }, issuer: 'test', keyId: 'k1', privateKeyPem, issuedAt: 102, anchor: { type: 'eip155', chainId: 8453, contract: `0x${'1'.repeat(40)}`, txHash: `0x${'2'.repeat(64)}`, blockNumber: 100, anchoredAt: 100, size: 1, headEntryHash: first.entryHash } });
  assert.equal(evidence.checkpoint.anchor, null);
  assert.equal(evidence.checkpoint.size, 2);
});
