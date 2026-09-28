import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import solc from 'solc'
import { createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData, keccak256, parseAbi, type Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createHttpServer, createPostgresStore } from '../src/index.mjs'
import { observeEvm } from '../src/infrastructure/blockchain/evm/observer.mjs'
import { assertV3SwapAuthorization, buildV3SwapIntent, createPriorSealClient, createV3SwapApproval, V3_SINGLE_SWAP_ABI } from '../sdk/dist/index.js'
import { verifyReceiptLocally } from '../sdk/dist/verifier.js'
import type { Eip1193Provider, WalletAuthorizationInput } from '../sdk/dist/index.js'

// Only an in-process EVM, generated accounts and valueless test tokens are used.
// The optional Ganache dependency is installed outside the product workspace.
if (!process.env.GANACHE_MODULE) throw new Error('Set GANACHE_MODULE to a local ganache@7.9.2/dist/node/core.js path')
const { default: ganache } = await import(pathToFileURL(process.env.GANACHE_MODULE).href) as { default: { provider(options: unknown): { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>; getInitialAccounts(): Record<string, { secretKey: Hex }>; disconnect(): Promise<void> } } }
const now = Math.floor(Date.now() / 1000)
const provider = ganache.provider({ chain: { chainId: 8453, time: new Date(now * 1000), hardfork: 'shanghai' }, logging: { quiet: true }, wallet: { totalAccounts: 3 } })
const db = new PGlite()
let server: Server | undefined
try {
  const chain = defineChain({ id: 8453, name: 'Isolated swap simulation', nativeCurrency: { name: 'Test ETH', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: ['in-process-only'] } } })
  const accounts = Object.entries(provider.getInitialAccounts())
  const sender = accounts[1][0].toLowerCase() as Hex
  const receiver = accounts[2][0].toLowerCase() as Hex
  const transport = custom(provider, { retryCount: 0 })
  const deployerWallet = createWalletClient({ chain, account: privateKeyToAccount(accounts[0][1].secretKey), transport })
  const senderAccount = privateKeyToAccount(accounts[1][1].secretKey)
  const senderWallet = createWalletClient({ chain, account: senderAccount, transport })
  const publicClient = createPublicClient({ chain, transport })
  const source = `pragma solidity ^0.8.0;
contract Token {
  mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
  event Transfer(address indexed from,address indexed to,uint amount);
  constructor(address owner){balanceOf[owner]=1000000000;}
  function approve(address spender,uint amount) external returns(bool){allowance[msg.sender][spender]=amount;return true;}
  function transfer(address to,uint amount) external returns(bool){move(msg.sender,to,amount);return true;}
  function transferFrom(address from,address to,uint amount) external returns(bool){require(allowance[from][msg.sender]>=amount);allowance[from][msg.sender]-=amount;move(from,to,amount);return true;}
  function move(address from,address to,uint amount) internal {require(balanceOf[from]>=amount);balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}
contract Router {
  struct Params{address tokenIn;address tokenOut;uint24 fee;address recipient;uint deadline;uint amountIn;uint amountOutMinimum;uint160 sqrtPriceLimitX96;}
  function exactInputSingle(Params calldata p) external payable returns(uint){require(block.timestamp<=p.deadline && p.fee==3000 && p.sqrtPriceLimitX96==0 && msg.value==0);require(Token(p.tokenIn).transferFrom(msg.sender,address(this),p.amountIn));require(Token(p.tokenOut).transfer(p.recipient,p.amountOutMinimum));return p.amountOutMinimum;}
}`
  const compiled: unknown = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Simulation.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })))
  if (!compiled || typeof compiled !== 'object' || !('contracts' in compiled)) throw new Error('Local simulation compilation failed')
  const contracts = (compiled as { contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>> }).contracts['Simulation.sol']
  async function deploy(name: string, args: Hex[] = []) {
    const artifact = contracts[name]
    const hash = await deployerWallet.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'success'); assert.ok(receipt.contractAddress)
    return receipt.contractAddress.toLowerCase() as Hex
  }
  const inputToken = await deploy('Token', [sender])
  const outputToken = await deploy('Token', [accounts[0][0] as Hex])
  const router = await deploy('Router')
  await publicClient.waitForTransactionReceipt({ hash: await deployerWallet.writeContract({ address: outputToken, abi: contracts.Token.abi, functionName: 'transfer', args: [router, 2_000_000n] }) })
  await publicClient.waitForTransactionReceipt({ hash: await senderWallet.writeContract({ address: inputToken, abi: contracts.Token.abi, functionName: 'approve', args: [router, 1_000_000n] }) })
  const bytecode = await publicClient.getCode({ address: router })
  assert.ok(bytecode)
  const params = { tokenIn: inputToken, tokenOut: outputToken, fee: 3000, recipient: receiver, deadline: BigInt(now + 300), amountIn: 1_000_000n, amountOutMinimum: 900_000n, sqrtPriceLimitX96: 0n }
  const transaction = { chainId: 8453, from: sender, to: router, nonce: String(await publicClient.getTransactionCount({ address: sender })), value: '0', data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [params] }) }
  const approval = createV3SwapApproval(transaction, keccak256(bytecode))
  const intent = buildV3SwapIntent({ approval, transaction, intentId: 'local-swap-approval', validUntil: now + 240, constraints: { minConfirmations: 1 }, now })
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const pool = { query: (sql: string, values?: unknown[]) => db.query(sql, values), connect: async () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values), release() {} }) } as unknown as Pool
  const keys = generateKeyPairSync('ed25519')
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const issuer = 'local-swap-drill', audience = 'local-swap-drill', keyId = 'local-key'
  server = createHttpServer({ store: createPostgresStore(pool), privateKeyPem, publicKeyPem, issuer, keyId, authorizationAudience: audience,
    observer: (input) => observeEvm({ ...input, rpcUrls: ['in-process-evm'], rpcClient: { call: async <T,>(_url: string, method: string, args: unknown[]): Promise<T> => await provider.request({ method, params: args }) as T } }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const client = createPriorSealClient({ baseUrl })
  const wallet: Eip1193Provider = { request: async ({ method, params }) => {
    assert.equal(method, 'eth_signTypedData_v4')
    assert.ok(params && typeof params[1] === 'string')
    return senderAccount.signTypedData(JSON.parse(params[1]))
  } }
  const request: WalletAuthorizationInput = { intent, account: sender, principal: { type: 'user', id: 'local-swap-user' }, delegate: { agentId: 'local-swap-agent', executor: sender }, issuedAt: now, notBefore: now, expiresAt: now + 240, audience }
  const authorized = await client.authorizeWithWallet(request, wallet)
  assert.equal(authorized.accepted.acceptance.status, 'ACCEPTED')
  assertV3SwapAuthorization({ approval, transaction, intent: authorized.accepted.authorization.intent, routerBytecode: await publicClient.getCode({ address: router }), now })
  const changedData = encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [{ ...params, recipient: sender }] })
  assert.throws(() => assertV3SwapAuthorization({ approval, transaction: { ...transaction, data: changedData }, intent: authorized.accepted.authorization.intent, routerBytecode: bytecode, now }))
  await provider.request({ method: 'evm_increaseTime', params: [2] })
  const txHash = await senderWallet.sendTransaction({ to: router, data: transaction.data, value: 0n, nonce: Number(transaction.nonce) })
  const mined = await publicClient.waitForTransactionReceipt({ hash: txHash })
  assert.equal(mined.status, 'success')
  const observed = await client.observeExecutionUntilFinal({ authorizationId: authorized.accepted.authorization.authorizationId, chainId: 8453, txHash, confirmations: 1 }, { pollIntervalMs: 50, timeoutMs: 10_000 })
  assert.equal(observed.receipt?.compliance?.status, 'COMPLIANT')
  assert.equal(observed.receipt?.executionStatus, 'CONFIRMED')
  assert.ok(observed.receipt)
  const verified = await verifyReceiptLocally(observed.receipt, { expectedAudience: audience, trustedKeys: { issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null } })
  assert.equal(verified.valid, true, JSON.stringify(verified))
  assertV3SwapAuthorization({ approval, transaction, intent: observed.receipt.authorizationEvidence!.authorization.intent, routerBytecode: bytecode, now })
  const balanceAbi = parseAbi(['function balanceOf(address) view returns(uint256)'])
  assert.equal(await publicClient.readContract({ address: outputToken, abi: balanceAbi, functionName: 'balanceOf', args: [receiver] }), 900_000n)
  process.stdout.write(JSON.stringify({ ok: true, scope: 'ISOLATED_LOCAL_EVM_TEST_TOKENS', authorizationAccepted: true, changedRecipientRejected: true, transactionMined: true, receiptCompliant: true, receiptIndependentlyVerified: true, outputBalance: '900000' }, null, 2) + '\n')
} finally {
  if (server?.listening) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed }
  await db.close()
  await provider.disconnect()
}
