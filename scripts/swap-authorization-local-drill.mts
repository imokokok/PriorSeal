import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import solc from 'solc'
import { createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData, keccak256, parseAbi, type Abi, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createDefiExecutionGateway, createDefiViemSubmitter, createPostgresDefiAttemptStore, executeDefiAuthorized } from 'priorseal-sdk/defi'
import { buildVerificationBundle, createHttpServer, createPostgresRwaAttemptStore, createPostgresStore } from '../src/index.mjs'
import { observeEvm } from '../src/infrastructure/blockchain/evm/observer.mjs'
import { assertV3SwapAuthorization, createPriorSealClient, createV3SwapApproval, generateAuthorizationNonce, swapApprovalCommitment, V3_SINGLE_SWAP_ABI } from '../sdk/dist/index.js'
import { verifyReceiptLocally, verifyVerificationBundleLocally } from '../sdk/dist/verifier.js'
import { createInsightLocalDecisionInputFixture } from './insight-local-decision-input-fixture.mjs'
import type { GuardOptions, PriorSealAcceptedAuthorization, PriorSealGuardedSwapResult, PriorSealPreparedAuthorization, TrustedV3PriorSealGuardedSwapRequest } from '../../insight/sdk/dist/types.js'
import type { createPriorSealDefiSubmitter as CreatePriorSealDefiSubmitter } from '../../insight/sdk/dist/priorseal-defi-gateway.js'

// Only an in-process EVM, generated accounts and valueless test tokens are used.
// The optional Ganache dependency is installed outside the product workspace.
if (!process.env.GANACHE_MODULE) throw new Error('Set GANACHE_MODULE to a local ganache@7.9.2/dist/node/core.js path')
const { default: ganache } = await import(pathToFileURL(process.env.GANACHE_MODULE).href) as { default: { provider(options: unknown): { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>; getInitialAccounts(): Record<string, { secretKey: Hex }>; disconnect(): Promise<void> } } }
const now = Math.floor(Date.now() / 1000)
const outputDirectory = process.env.PRIORSEAL_PILOT_OUTPUT_DIR?.trim() || null
const outputDirectoryPath = outputDirectory ? resolve(outputDirectory) : null
if (outputDirectoryPath) {
  await mkdir(outputDirectoryPath, { recursive: true, mode: 0o700 })
  if ((await readdir(outputDirectoryPath)).length > 0) throw new Error(`PILOT_OUTPUT_DIRECTORY_NOT_EMPTY:${outputDirectoryPath}`)
}
let authorizationClockMs = now * 1000
const insightModulePath = process.env.INSIGHT_SDK_MODULE ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../../insight/sdk/dist/index.js')
const insightSdk = await import(pathToFileURL(insightModulePath).href) as {
  InsightGuard: new (options: GuardOptions) => { executeTrustedV3SwapWithPriorSeal(request: TrustedV3PriorSealGuardedSwapRequest): Promise<PriorSealGuardedSwapResult> }
  createPriorSealDefiSubmitter: typeof CreatePriorSealDefiSubmitter
}
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
  function decimals() external pure returns(uint8){return 6;}
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
  const params = { tokenIn: inputToken, tokenOut: outputToken, fee: 3000, recipient: receiver, deadline: BigInt(now + 300), amountIn: 1_000_000n, amountOutMinimum: 995_000n, sqrtPriceLimitX96: 0n }
  const gatewayTransaction = { chainId: 8453, from: sender, to: router, nonce: String(await publicClient.getTransactionCount({ address: sender })), value: '0', data: encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [params] }) }
  const transaction = { ...gatewayTransaction, sourceAmount: 1_000_000n }
  const approval = createV3SwapApproval(gatewayTransaction, keccak256(bytecode))
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const pool = { query: (sql: string, values?: unknown[]) => db.query(sql, values), connect: async () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values), release() {} }) } as unknown as Pool
  const keys = generateKeyPairSync('ed25519')
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const issuer = 'local-swap-drill', audience = 'local-swap-drill', keyId = 'local-key'
  server = createHttpServer({ store: createPostgresStore(pool), privateKeyPem, publicKeyPem, issuer, keyId, authorizationAudience: audience,
    now: () => authorizationClockMs,
    observer: (input) => observeEvm({ ...input, rpcUrls: ['in-process-evm'], rpcClient: { call: async <T,>(_url: string, method: string, args: unknown[]): Promise<T> => await provider.request({ method, params: args }) as T } }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const client = createPriorSealClient({ baseUrl })
  const authorizationStore = createPostgresStore(pool)
  const attempts = createPostgresDefiAttemptStore(pool)
  const chainReader = { getChainId: () => publicClient.getChainId(), getBytecode: ({ address }: { address: Hex }) => publicClient.getCode({ address }) }
  const submit = createDefiViemSubmitter(senderWallet)
  const deps: Parameters<typeof executeDefiAuthorized>[1] = { authorizationStore, attempts, chainReader, submit, clock: () => now + 2 }
  const gateway = createDefiExecutionGateway(client, deps)
  authorizationClockMs = Number((await publicClient.getBlock({ blockTag: 'latest' })).timestamp) * 1000
  const fixture = await createInsightLocalDecisionInputFixture({ chainId: 8453, inputToken, outputToken, tradeAmountUsd: 1_000_000, now })
  const insightGuard = new insightSdk.InsightGuard({ apiKey: 'local-chain-drill', fetch: fixture.fetch, decisionInputTrust: fixture.decisionInputTrust })
  const submitThroughPriorSeal = insightSdk.createPriorSealDefiSubmitter({
    gateway,
    approval,
    routerAddress: router,
    routerCodeHash: keccak256(bytecode),
    acceptanceKey: { issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null },
  })
  const insightPriorSealClient: TrustedV3PriorSealGuardedSwapRequest['priorSeal']['client'] = {
    prepareAuthorization: async (input, signal) => {
      const result = await client.prepareAuthorization(input, { signal })
      if (result.authorization.schema !== 'priorseal.authorization.v2') throw new Error('PriorSeal returned an unsupported authorization schema')
      return result as unknown as PriorSealPreparedAuthorization
    },
    acceptAuthorization: async (authorization, signal) => {
      const result = await client.acceptAuthorization(authorization, { signal })
      if (result.authorization.schema !== 'priorseal.authorization.v2') throw new Error('PriorSeal accepted an unsupported authorization schema')
      return result as unknown as PriorSealAcceptedAuthorization
    },
    observeExecution: (input, signal) => client.observeExecution(input, { signal }),
    getObservationJob: (jobId, signal) => client.getObservationJob(jobId, { signal }),
    waitForObservationJob: (jobId, options) => client.waitForObservationJob(jobId, options),
  }
  const joint = await insightGuard.executeTrustedV3SwapWithPriorSeal({
    source: fixture.source,
    destination: fixture.destination,
    receipt: { settlementChainId: 8453, maxSlippageBps: 50 },
    v3Risk: {
      routerAddress: router,
      routerCodeHash: keccak256(bytecode),
      maxOracleDeviationBps: 100,
      maxSlippageBps: 50,
      maxBlockAgeSeconds: 30,
      reader: {
        getBlock: ({ blockTag }: { blockTag: 'latest' }) => publicClient.getBlock({ blockTag }),
        getBytecode: ({ address, blockNumber }: { address: Hex; blockNumber: bigint }) => publicClient.getCode({ address, blockNumber }),
        readContract: ({ address, abi, functionName, blockNumber }: { address: Hex; abi: Abi; functionName: 'decimals'; blockNumber: bigint }) => publicClient.readContract({ address, abi, functionName, blockNumber }),
        call: ({ account, to, data, value, blockNumber }: { account: Hex; to: Hex; data: Hex; value: bigint; blockNumber: bigint }) => publicClient.call({ account, to, data, value, blockNumber }),
      },
    },
    priorSeal: {
      client: insightPriorSealClient,
      principal: { type: 'user', id: 'local-swap-user', account: sender },
      agentId: 'local-swap-agent',
      issuedAt: now,
      confirmations: 1,
      audience,
      signAuthorization: ({ typedData }: { typedData: unknown }) => senderAccount.signTypedData(typedData as Parameters<typeof senderAccount.signTypedData>[0]),
    },
    prepareTransaction: async () => transaction,
    submitTransaction: submitThroughPriorSeal,
  })
  assert.equal(joint.status, 'executed')
  if (!joint.transactionRisk) throw new Error('Strict V3 flow did not return transaction-risk evidence')
  assert.equal(joint.evidenceStatus, 'COMPLETE')
  assert.equal(joint.assuranceValid, true)
  assert.equal(joint.transactionCorrelation, true)
  assert.equal(joint.independentVerificationPerformed, false)
  const authorized = joint.priorSealAuthorization
  assert.equal(authorized.acceptance.status, 'ACCEPTED')
  const approvalCommitments = authorized.authorization.intent.contextCommitments?.filter((entry: { namespace: string }) => entry.namespace === 'priorseal.swap-approval.v1') ?? []
  assert.equal(approvalCommitments.length, 1)
  assert.deepEqual(approvalCommitments[0], swapApprovalCommitment(approval))
  assertV3SwapAuthorization({ approval, transaction: gatewayTransaction, intent: authorized.authorization.intent, routerBytecode: await publicClient.getCode({ address: router }), now })
  const changedData = encodeFunctionData({ abi: V3_SINGLE_SWAP_ABI, functionName: 'exactInputSingle', args: [{ ...params, recipient: sender }] })
  assert.throws(() => assertV3SwapAuthorization({ approval, transaction: { ...gatewayTransaction, data: changedData }, intent: authorized.authorization.intent, routerBytecode: bytecode, now }))
  const executionInput: Parameters<typeof executeDefiAuthorized>[0] = {
    authorizationId: authorized.authorization.authorizationId, audience,
    intent: authorized.authorization.intent, transaction: gatewayTransaction,
    acceptanceKey: { issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null },
    adapter: { kind: 'uniswap-v3-single', approval },
  }
  await assert.rejects(gateway.execute({ ...executionInput, transaction: { ...gatewayTransaction, data: changedData } }))
  await provider.request({ method: 'evm_increaseTime', params: [2] })
  const txHash = joint.transaction.txHash as Hex
  assert.ok(txHash)
  const mined = await publicClient.waitForTransactionReceipt({ hash: txHash })
  assert.equal(mined.status, 'success')
  const replay = await gateway.execute(executionInput)
  assert.equal(replay.replay, true)
  assert.equal((await gateway.status(executionInput.authorizationId))?.txHash, txHash)
  const crossRouteClaim = await createPostgresRwaAttemptStore(pool).reserve({ authorizationId: `auth_${'f'.repeat(32)}`,
    transaction: gatewayTransaction, executionDigest: `0x${'a'.repeat(64)}`, now: now + 3 })
  assert.equal(crossRouteClaim.claimed, false)
  assert.equal(crossRouteClaim.code, 'RWA_NONCE_ALREADY_RESERVED')
  const finalized = await gateway.recover(executionInput.authorizationId,
    async () => ({ transaction: gatewayTransaction, txHash, status: 'CONFIRMED', finalized: true }))
  assert.equal(finalized.status, 'CONFIRMED')
  const observed = await client.observeExecutionUntilFinal({ authorizationId: authorized.authorization.authorizationId, chainId: 8453, txHash, confirmations: 1 }, { pollIntervalMs: 50, timeoutMs: 10_000 })
  assert.equal(observed.receipt?.compliance?.status, 'COMPLIANT', JSON.stringify(observed.receipt?.compliance, null, 2))
  assert.equal(observed.receipt?.executionStatus, 'CONFIRMED')
  assert.ok(observed.receipt)
  const trustRoot = { issuer, keyId, algorithm: 'Ed25519', publicKey: publicKeyPem, status: 'active', validFrom: null, validUntil: null } as const
  const verified = await verifyReceiptLocally(observed.receipt, { expectedAudience: audience, trustedKeys: trustRoot })
  assert.equal(verified.valid, true, JSON.stringify(verified))
  const evidencePack = buildVerificationBundle({
    receipt: observed.receipt,
    keyRegistry: { schema: 'priorseal.keys.v1', issuer, keys: [trustRoot] },
    assembledAt: now + 2,
  })
  const verifiedPack = await verifyVerificationBundleLocally(evidencePack, { expectedAudience: audience, trustedKeys: trustRoot })
  assert.equal(verifiedPack.valid, true, JSON.stringify(verifiedPack))
  assertV3SwapAuthorization({ approval, transaction: gatewayTransaction, intent: observed.receipt.authorizationEvidence!.authorization.intent, routerBytecode: bytecode, now })
  const balanceAbi = parseAbi(['function balanceOf(address) view returns(uint256)'])
  assert.equal(await publicClient.readContract({ address: outputToken, abi: balanceAbi, functionName: 'balanceOf', args: [receiver] }), 995_000n)
  // A second nonce tests a router change during gas preparation. The guard
  // must refuse broadcast and keep the nonce claimed as UNCERTAIN.
  const nextTransaction = { ...gatewayTransaction, nonce: String(await publicClient.getTransactionCount({ address: sender })) }
  const nextPrepared = await gateway.prepare({ approval, transaction: nextTransaction, intentId: 'local-swap-router-change', validUntil: now + 240,
    authorization: { principal: { type: 'user', id: 'local-swap-user', account: sender }, authorizer: { type: 'eip712', address: sender },
      delegate: { agentId: 'local-swap-agent', executor: sender }, issuedAt: now, notBefore: now, expiresAt: now + 240,
      authorizationNonce: generateAuthorizationNonce(), maxUses: '1', audience } })
  const nextSignature = await senderAccount.signTypedData(nextPrepared.typedData as Parameters<typeof senderAccount.signTypedData>[0])
  const nextAccepted = await gateway.authorize({ ...nextPrepared.authorization, signature: nextSignature })
  let codeReads = 0, unsafeBroadcasts = 0
  const guardedGateway = createDefiExecutionGateway(client, { ...deps,
    chainReader: { getChainId: () => publicClient.getChainId(), getBytecode: async ({ address }) => ++codeReads > 2 ? '0x6000' : publicClient.getCode({ address }) },
    submit: async (_tx, guard) => { await guard(); unsafeBroadcasts++; return `0x${'a'.repeat(64)}` },
  })
  const guardedInput: Parameters<typeof executeDefiAuthorized>[0] = { ...executionInput, authorizationId: nextAccepted.authorization.authorizationId,
    intent: nextAccepted.authorization.intent, transaction: nextTransaction }
  await assert.rejects(guardedGateway.execute(guardedInput), /ROUTER_CODE_MISMATCH/)
  assert.equal(unsafeBroadcasts, 0)
  assert.equal((await guardedGateway.status(guardedInput.authorizationId))?.status, 'UNCERTAIN')
  assert.equal((await guardedGateway.execute(guardedInput)).replay, true)
  const summary = {
    schema: 'priorseal.restricted-automation-pilot-run.v1',
    scope: 'ISOLATED_LOCAL_EVM_TEST_TOKENS',
    evidencePack: { schema: evidencePack.schema, bundleHash: evidencePack.bundleHash, receiptId: observed.receipt.receiptId },
    operation: {
      executionProfile: authorized.authorization.intent.executionProfile,
      chainId: transaction.chainId,
      sender,
      router,
      inputToken,
      outputToken,
      recipient: receiver,
      txHash,
    },
    checks: {
      strictInsightAssessmentAccepted: true,
      trustedDecisionInputPairVerified: true,
      exactCallRiskAccepted: joint.transactionRisk.status === 'ACCEPTABLE',
      approvalCommitmentBound: true,
      authorizationAccepted: true,
      changedRecipientRejected: true,
      durableExecutorSubmitted: true,
      replayBlocked: replay.replay,
      crossRouteNonceClaimBlocked: true,
      recoveredFinality: true,
      preBroadcastRouterMutationBlocked: true,
      uncertainNonceNotRetried: true,
      transactionMined: true,
      receiptCompliant: verified.valid,
      priorSealReceiptCryptographicallyVerified: verified.valid,
      insightReceiptMocked: true,
      serviceResponseReportOnly: joint.independentVerificationPerformed === false,
      jointEvidenceCompleteAgainstTestFixture: joint.evidenceStatus === 'COMPLETE',
      evidencePackIndependentlyVerified: true,
      outputBalance: '995000',
    },
    limits: {
      localEvmOnly: true,
      testTokensOnly: true,
      ephemeralIssuer: true,
      productionReadinessClaimed: false,
    },
  }
  if (outputDirectoryPath) {
    const directory = outputDirectoryPath
    await Promise.all([
      writeFile(resolve(directory, 'evidence-pack.json'), `${JSON.stringify(evidencePack, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
      writeFile(resolve(directory, 'trust-root.json'), `${JSON.stringify({
        schema: 'priorseal.pilot-trust-root.v1',
        audience,
        key: trustRoot,
        testOnly: true,
        notice: 'Pin this key through an independent channel before relying on a real deployment. This local run generates an ephemeral test key.',
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
      writeFile(resolve(directory, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
    ])
  }
  process.stdout.write(JSON.stringify({ ok: true, ...summary, outputDirectory }, null, 2) + '\n')
} finally {
  if (server?.listening) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed }
  await db.close()
  await provider.disconnect()
}
