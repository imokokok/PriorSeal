// Generated from rwa-local-execution-drill.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import solc from "solc";
import { createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as sdk from "../sdk/dist/index.js";
import { inspectRwaReceiptBundle as browserInspect } from "../sdk/dist/verifier.js";
import { createPostgresStore, createPostgresRwaAttemptStore, createRwaViemSubmitter, executeRwaAuthorized, reconcileRwaAttempt } from "../src/index.mjs";
import { observeEvm } from "../src/infrastructure/blockchain/evm/observer.mjs";
import { rwaV2Fixture } from "../examples/rwa-v2/fixture.mjs";
import { workflowFixture } from "../examples/rwa-v2/workflow-fixture.mjs";
if (!process.env.GANACHE_MODULE) throw new Error("Set GANACHE_MODULE to ganache@7.9.2/dist/node/core.js");
const { default: ganache } = await import(pathToFileURL(process.env.GANACHE_MODULE).href);
const now = 18e8;
const provider = ganache.provider({ chain: { chainId: 8453, time: new Date(now * 1e3), hardfork: "shanghai" }, logging: { quiet: true }, wallet: { totalAccounts: 3 } });
let db = new PGlite();
try {
  const chain = defineChain({ id: 8453, name: "Isolated RWA simulation", nativeCurrency: { name: "Test ETH", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: ["in-process-only"] } } });
  const entries = Object.entries(provider.getInitialAccounts()), [deployer, delegate, receiver] = entries.map(([address]) => address.toLowerCase());
  const transport = custom(provider, { retryCount: 0 });
  const deployWallet = createWalletClient({ chain, account: privateKeyToAccount(entries[0][1].secretKey), transport });
  const delegateWallet = createWalletClient({ chain, account: privateKeyToAccount(entries[1][1].secretKey), transport });
  const publicClient = createPublicClient({ chain, transport });
  const source = `pragma solidity ^0.8.0;
contract TestToken {
  mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
  event Transfer(address indexed from,address indexed to,uint amount);
  constructor(address owner){balanceOf[owner]=1000000000;}
  function approve(address spender,uint amount) external returns(bool){allowance[msg.sender][spender]=amount;return true;}
  function transfer(address to,uint amount) external returns(bool){move(msg.sender,to,amount);return true;}
  function transferFrom(address from,address to,uint amount) external returns(bool){require(allowance[from][msg.sender]>=amount);allowance[from][msg.sender]-=amount;move(from,to,amount);return true;}
  function move(address from,address to,uint amount) internal {require(balanceOf[from]>=amount);balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);}
}
contract TestRouter {
  struct Params{address tokenIn;address tokenOut;uint24 fee;address recipient;uint deadline;uint amountIn;uint amountOutMinimum;uint160 sqrtPriceLimitX96;}
  function exactInputSingle(Params calldata p) external payable returns(uint){require(block.timestamp<=p.deadline && p.fee==3000 && p.sqrtPriceLimitX96==0 && msg.value==0);require(TestToken(p.tokenIn).transferFrom(msg.sender,address(this),p.amountIn));require(TestToken(p.tokenOut).transfer(p.recipient,p.amountOutMinimum));return p.amountOutMinimum;}
}`;
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "Simulation.sol": { content: source } }, settings: { evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
  if (!compiled || typeof compiled !== "object" || !("contracts" in compiled)) throw new Error("Simulation compilation failed");
  const contracts = compiled.contracts["Simulation.sol"];
  async function deploy(name, args = []) {
    const artifact = contracts[name];
    if (!artifact || !Array.isArray(artifact.abi) || !/^[0-9a-f]+$/i.test(artifact.evm.bytecode.object)) throw new Error("Invalid simulation compiler artifact");
    const hash = await deployWallet.deployContract({ abi: artifact.abi, bytecode: "0x" + artifact.evm.bytecode.object, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    assert.ok(receipt.contractAddress);
    return receipt.contractAddress.toLowerCase();
  }
  const inputToken = await deploy("TestToken", [delegate]), outputToken = await deploy("TestToken", [deployer]), router = await deploy("TestRouter");
  await publicClient.waitForTransactionReceipt({ hash: await deployWallet.writeContract({ address: outputToken, abi: contracts.TestToken.abi, functionName: "transfer", args: [router, 100000000n] }) });
  await publicClient.waitForTransactionReceipt({ hash: await delegateWallet.writeContract({ address: inputToken, abi: contracts.TestToken.abi, functionName: "approve", args: [router, 1000000n] }) });
  const f = rwaV2Fixture(sdk, now);
  f.input.instrument.tokenAddress = outputToken;
  const instrumentId = sdk.rwaInstrumentId(f.input.instrument);
  f.policy.instrumentId = instrumentId;
  f.input.request.instrumentId = instrumentId;
  f.input.prices.forEach((p) => {
    p.instrumentId = instrumentId;
  });
  f.input.market.instrumentId = instrumentId;
  f.input.evidence.forEach((e) => {
    e.instrumentId = instrumentId;
    e.subject = e.kind === "eligibility" ? delegate : instrumentId;
  });
  f.receiverEvidence.instrumentId = instrumentId;
  f.receiverEvidence.subject = receiver;
  f.transaction.from = delegate;
  f.transaction.to = router;
  f.transaction.nonce = String(await publicClient.getTransactionCount({ address: delegate }));
  f.transaction.data = encodeFunctionData({ abi: sdk.RWA_SWAP_ABI, functionName: "exactInputSingle", args: [{ tokenIn: inputToken, tokenOut: outputToken, fee: 3e3, recipient: receiver, deadline: BigInt(now + 120), amountIn: 1000000n, amountOutMinimum: 900000n, sqrtPriceLimitX96: 0n }] });
  f.input.request.call = { chainId: 8453, from: delegate, to: router, calldataHash: keccak256(f.transaction.data), value: "0", nonce: f.transaction.nonce };
  Object.assign(f.callProfile, { target: router, instrumentId, quoteToken: inputToken });
  const x = await workflowFixture(sdk, sdk, f);
  for (const name of (await readdir(new URL("../migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"));
  const pool = () => ({ query: (sql, values) => db.query(sql, values) });
  const authorizationStore = createPostgresStore(pool());
  await authorizationStore.saveIntent(x.authorization.intent);
  const accepted = await x.store.getAuthorization(x.input.authorizationId);
  assert.ok(accepted);
  await authorizationStore.saveAuthorization(accepted);
  const attempts = createPostgresRwaAttemptStore(pool()), realSubmit = createRwaViemSubmitter(delegateWallet);
  let broadcasts = 0;
  const deps = { authorizationStore, attempts, clock: () => now, submit: async (tx, guard) => {
    broadcasts++;
    return realSubmit(tx, guard);
  } };
  const input = x.input;
  const result = await executeRwaAuthorized(input, deps);
  assert.ok(result.attempt.txHash);
  const observed = await observeEvm({ chainId: 8453, txHash: result.attempt.txHash, confirmations: 1, rpcUrls: ["isolated"], rpcClient: { call: async (_url, method, params) => await provider.request({ method, params }) } });
  assert.equal(observed.status, "CONFIRMED");
  assert.equal(observed.transfers?.length, 2);
  for (const inspect of [sdk.inspectRwaReceiptBundle, browserInspect]) {
    const report = await inspect({ receipt: x.receipt({ ...observed, chainId: 8453, txHash: result.attempt.txHash, status: "CONFIRMED" }), authority: input.authority.proof, execution: input.execution.proof }, input.authority.trust, { ...x.options, now: now + 20 });
    assert.equal(report.admissible, true, JSON.stringify(report));
    assert.equal(report.execution, "SATISFIED");
  }
  const balanceAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
  assert.equal(await publicClient.readContract({ address: outputToken, abi: balanceAbi, functionName: "balanceOf", args: [receiver] }), 900000n);
  const snapshot = await db.dumpDataDir();
  await db.close();
  db = new PGlite({ loadDataDir: snapshot });
  const recoveredAttempts = createPostgresRwaAttemptStore(pool()), recoveredAuthorizations = createPostgresStore(pool());
  const replay = await executeRwaAuthorized(input, { ...deps, authorizationStore: recoveredAuthorizations, attempts: recoveredAttempts });
  assert.equal(replay.replay, true);
  assert.equal(broadcasts, 1);
  const reconciled = await reconcileRwaAttempt(input.authorizationId, { attempts: recoveredAttempts, authorizationStore: recoveredAuthorizations, clock: () => now + 20, observe: async () => ({ transaction: f.transaction, txHash: result.attempt.txHash, status: "CONFIRMED", finalized: true }) });
  assert.equal(reconciled.status, "CONFIRMED");
  process.stdout.write(JSON.stringify({ ok: true, scope: "ISOLATED_LOCAL_EVM_AND_EMBEDDED_POSTGRES_NOT_PRODUCTION_RWA", broadcasts, actualTokenTransfers: observed.transfers?.length, minimumOutputObserved: "900000", receiverBalanceChecked: true, rawSignedCallChecked: true, receiptNodeAndBrowserEntryVerified: true, databaseRestoreReplayBlocked: true }, null, 2) + "\n");
} finally {
  await db.close();
  await provider.disconnect();
}
