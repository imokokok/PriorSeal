#!/usr/bin/env node
// Generated from run-wak-base-sepolia-live.mts by npm run core:build. Do not edit directly.
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes
} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256
} from "viem";
import { baseSepolia } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  buildAuthorization,
  buildAuthorizationReceipt,
  buildAuthorizedReceipt,
  canonicalize,
  signReceipt
} from "../src/index.mjs";
import { signAuthorizationReceipt } from "../src/domain/authorization.mjs";
import { verifyReceiptLocally } from "../sdk/dist/verifier.js";
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = 84532;
const WAK_COMMIT = "b673b82e4e90dfc86942fd59533a6b3e5f32598c";
const INSIGHT_COMMIT = "840b376525d340672f4a0b18d1fd1723a74768da";
const PRIORSEAL_COMMIT = "56d05c783f8ce0b9e040f6ef6d9f87b2ac04367e";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const QUOTER = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";
const FACTORY = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FEE = 3e3;
const AMOUNT_IN = 1000000000000n;
const MAX_SLIPPAGE_BPS = 500n;
const OUTPUT = new URL("../examples/web3-agent-kit-base-sepolia-live-v1/", import.meta.url);
const PUBLIC_DEV_MNEMONIC = "test test test test test test test test test test test junk";
const EXPECTED_PUBLIC_DEV_ACCOUNT = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ISSUER = "priorseal.base-sepolia-live-test";
const KEY_ID = "priorseal-base-sepolia-live-ephemeral-1";
const EXACT_INPUT_SINGLE_ABI = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" }
    ]
  }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}];
const QUOTER_ABI = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceLimitX96", type: "uint160" }
    ]
  }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" },
    { name: "gasEstimate", type: "uint256" }
  ]
}];
const FACTORY_ABI = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }],
  outputs: [{ name: "pool", type: "address" }]
}];
const ERC20_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }]
}];
function sha256Canonical(value) {
  return `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
function publicKeyFingerprint(publicKeyPem2) {
  return createHash("sha256").update(createPublicKey(publicKeyPem2).export({ type: "spki", format: "der" })).digest("hex");
}
function serializable(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
}
async function writeJson(name, value) {
  await writeFile(new URL(name, OUTPUT), `${JSON.stringify(serializable(value), null, 2)}
`);
}
if (!process.argv.includes("--unsafe-public-dev-key")) {
  throw new Error("Refusing to broadcast. Re-run with --unsafe-public-dev-key to use Hardhat public account #5 on Base Sepolia only.");
}
const account = mnemonicToAccount(PUBLIC_DEV_MNEMONIC, { addressIndex: 5 });
if (account.address.toLowerCase() !== EXPECTED_PUBLIC_DEV_ACCOUNT.toLowerCase()) {
  throw new Error(`Unexpected public development account: ${account.address}`);
}
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL, { timeout: 3e4 }) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`Expected Base Sepolia ${CHAIN_ID}, got ${chainId}`);
const [routerCode, quoterCode, factoryCode, wethCode, usdcCode, balance, nonce, pool] = await Promise.all([
  client.getCode({ address: ROUTER }),
  client.getCode({ address: QUOTER }),
  client.getCode({ address: FACTORY }),
  client.getCode({ address: WETH }),
  client.getCode({ address: USDC }),
  client.getBalance({ address: account.address }),
  client.getTransactionCount({ address: account.address, blockTag: "pending" }),
  client.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [WETH, USDC, FEE] })
]);
for (const [name, code] of Object.entries({ routerCode, quoterCode, factoryCode, wethCode, usdcCode })) {
  if (!code || code === "0x") throw new Error(`${name} is not deployed`);
}
if (pool === "0x0000000000000000000000000000000000000000") throw new Error("No WETH/USDC 0.3% pool");
const quoteParams = { tokenIn: WETH, tokenOut: USDC, amountIn: AMOUNT_IN, fee: FEE, sqrtPriceLimitX96: 0n };
const quoteSimulation = await client.simulateContract({
  account,
  address: QUOTER,
  abi: QUOTER_ABI,
  functionName: "quoteExactInputSingle",
  args: [quoteParams]
});
const [quotedAmountOut, sqrtPriceX96After, initializedTicksCrossed, quoteGasEstimate] = quoteSimulation.result;
const amountOutMinimum = quotedAmountOut * (10000n - MAX_SLIPPAGE_BPS) / 10000n;
if (amountOutMinimum <= 0n) throw new Error("Quote is too small to enforce a positive minimum output");
const swapParams = {
  tokenIn: WETH,
  tokenOut: USDC,
  fee: FEE,
  recipient: account.address,
  amountIn: AMOUNT_IN,
  amountOutMinimum,
  sqrtPriceLimitX96: 0n
};
const data = encodeFunctionData({ abi: EXACT_INPUT_SINGLE_ABI, functionName: "exactInputSingle", args: [swapParams] });
const calldataHash = keccak256(data);
const gasEstimate = await client.estimateGas({ account: account.address, to: ROUTER, data, value: AMOUNT_IN });
const gas = gasEstimate * 120n / 100n;
const fees = await client.estimateFeesPerGas();
const maxFeePerGas = fees.maxFeePerGas;
const maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
if (maxFeePerGas == null || maxPriorityFeePerGas == null) throw new Error("Base Sepolia did not return EIP-1559 fee estimates");
if (balance <= AMOUNT_IN + gas * maxFeePerGas) throw new Error("Public Base Sepolia test account lacks sufficient test ETH");
const issuedAt = Math.floor(Date.now() / 1e3);
const validUntil = issuedAt + 600;
const liveAssessment = {
  schema: "web3-agent-kit.base-sepolia-chain-quote.v1",
  mode: "CHAIN_QUOTE_ONLY_NO_INSIGHT_ATTESTATION",
  chainId: CHAIN_ID,
  pool,
  tokenIn: WETH,
  tokenOut: USDC,
  fee: FEE,
  amountIn: AMOUNT_IN.toString(),
  quotedAmountOut: quotedAmountOut.toString(),
  amountOutMinimum: amountOutMinimum.toString(),
  maxSlippageBps: Number(MAX_SLIPPAGE_BPS),
  sqrtPriceX96After: sqrtPriceX96After.toString(),
  initializedTicksCrossed,
  quoteGasEstimate: quoteGasEstimate.toString(),
  observedAt: issuedAt
};
const governorPolicy = {
  schema: "web3-agent-kit.insight-composition-policy.v2",
  policyId: "wak-base-sepolia-live-test-v1",
  scope: "NONPRODUCTION_BASE_SEPOLIA_BINDING_TEST",
  insightRequirement: "NOT_SATISFIED_NO_LIVE_API_CREDENTIAL",
  executableOutcome: "PROCEED_TO_PRINCIPAL_AUTHORIZATION",
  noAuthorizationBypass: true
};
const governorDecision = {
  schema: "web3-agent-kit.policy-decision-evidence.v2",
  decisionId: `wak-base-sepolia-${issuedAt}`,
  evaluatedAt: issuedAt,
  policyId: governorPolicy.policyId,
  policyDigest: sha256Canonical(governorPolicy),
  evidenceMode: liveAssessment.mode,
  exactCall: {
    chainId: CHAIN_ID,
    executor: account.address,
    transactionNonce: String(nonce),
    callTarget: ROUTER,
    calldataHash,
    nativeValue: AMOUNT_IN.toString()
  },
  decision: "PROCEED_TO_PRINCIPAL_AUTHORIZATION",
  reasonCodes: ["NONPRODUCTION_TEST_ONLY", "NO_LIVE_INSIGHT_ATTESTATION"]
};
const contextCommitments = [
  { namespace: "base-sepolia.chain-quote.jcs.v1", algorithm: "sha256", digest: sha256Canonical(liveAssessment) },
  { namespace: "web3-agent-kit.execution-policy.jcs.v2", algorithm: "sha256", digest: sha256Canonical(governorPolicy) },
  { namespace: "web3-agent-kit.policy-decision.jcs.v2", algorithm: "sha256", digest: sha256Canonical(governorDecision) }
];
const intent = {
  schema: "priorseal.intent.v2",
  executionProfile: "priorseal.execution-profile.exact-call.v1",
  intentId: `wak-base-sepolia-${issuedAt}`,
  chainId: CHAIN_ID,
  action: "CONTRACT_CALL",
  asset: `eip155:${CHAIN_ID}/native`,
  amount: AMOUNT_IN.toString(),
  sender: account.address,
  recipient: ROUTER,
  validUntil,
  nonce: String(nonce),
  callTarget: ROUTER,
  calldataHash,
  transactionValue: AMOUNT_IN.toString(),
  contextCommitments,
  constraints: { minConfirmations: 1, maxGasUsed: gas.toString() }
};
const authorizationDraft = buildAuthorization({
  intent,
  principal: { type: "user", id: "public-hardhat-test-account-5", account: account.address },
  authorizer: { type: "eip712", address: account.address },
  delegate: { agentId: "web3-agent-kit-base-sepolia-test", executor: account.address },
  issuedAt,
  notBefore: issuedAt,
  expiresAt: validUntil,
  authorizationNonce: `0x${randomBytes(32).toString("hex")}`,
  maxUses: "1",
  audience: "priorseal",
  policyHash: `0x${"0".repeat(64)}`
});
const authorization = buildAuthorization({
  ...authorizationDraft,
  signature: await account.signTypedData(authorizationTypedData(authorizationDraft))
});
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const acceptedAt = Math.floor(Date.now() / 1e3);
const acceptance = signAuthorizationReceipt(buildAuthorizationReceipt({
  authorization,
  issuer: ISSUER,
  keyId: KEY_ID,
  acceptedAt
}), privateKeyPem);
const usdcBalanceBefore = await client.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
const rawTransaction = await account.signTransaction({
  chainId: CHAIN_ID,
  type: "eip1559",
  to: ROUTER,
  data,
  value: AMOUNT_IN,
  nonce,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas
});
const txHash = await client.sendRawTransaction({ serializedTransaction: rawTransaction });
const chainReceipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 18e4 });
if (chainReceipt.status !== "success") throw new Error(`Swap reverted: ${txHash}`);
const [transaction, block, usdcBalanceAfter] = await Promise.all([
  client.getTransaction({ hash: txHash }),
  client.getBlock({ blockHash: chainReceipt.blockHash }),
  client.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })
]);
const observedAt = Math.floor(Date.now() / 1e3);
const execution = {
  schema: "priorseal.execution-observation.v1",
  chainId: CHAIN_ID,
  txHash,
  status: "CONFIRMED",
  blockNumber: Number(chainReceipt.blockNumber),
  blockHash: chainReceipt.blockHash,
  executedAt: Number(block.timestamp),
  observedAt,
  action: "CONTRACT_CALL",
  nonce: String(transaction.nonce),
  sender: transaction.from,
  recipient: transaction.to,
  target: transaction.to,
  calldataHash: keccak256(transaction.input),
  asset: `eip155:${CHAIN_ID}/native`,
  amount: transaction.value.toString(),
  transfers: [],
  transferMatchUnique: false,
  nativeValue: transaction.value.toString(),
  tokenValue: null,
  gasUsed: chainReceipt.gasUsed.toString(),
  fee: (chainReceipt.gasUsed * chainReceipt.effectiveGasPrice).toString(),
  executionDataAvailable: true,
  observationSource: "base-sepolia-public-rpc",
  finalityState: "CONFIRMED",
  confirmations: 1
};
const priorSealReceipt = signReceipt(buildAuthorizedReceipt({
  authorization,
  acceptance,
  execution,
  issuer: ISSUER,
  keyId: KEY_ID,
  issuedAt: observedAt
}), privateKeyPem);
const keyRegistry = {
  schema: "priorseal.keys.v1",
  issuer: ISSUER,
  keys: [{
    issuer: ISSUER,
    keyId: KEY_ID,
    algorithm: "Ed25519",
    publicKey: publicKeyPem,
    status: "active",
    validFrom: issuedAt - 1,
    validUntil: null
  }]
};
const verification = await verifyReceiptLocally(priorSealReceipt, { trustedKeys: keyRegistry, now: observedAt });
if (!verification.valid || verification.code !== "OK" || verification.complianceStatus !== "COMPLIANT") {
  throw new Error(`Local PriorSeal verification failed: ${verification.code}`);
}
const unsignedBundle = serializable({
  schema: "web3-agent-kit.base-sepolia-live-evidence.v1",
  mode: "LIVE_TESTNET_EXECUTION_NONPRODUCTION_EVIDENCE",
  assembledAt: observedAt,
  sources: {
    web3AgentKit: { repository: "https://github.com/ulsreall/web3-agent-kit", commit: WAK_COMMIT },
    insight: { repository: "https://github.com/imokokok/Insight", commit: INSIGHT_COMMIT },
    priorSeal: { repository: "https://github.com/imokokok/PriorSeal", commit: PRIORSEAL_COMMIT }
  },
  network: { name: "Base Sepolia", chainId: CHAIN_ID, rpcSource: "https://sepolia.base.org" },
  contracts: { router: ROUTER, quoter: QUOTER, factory: FACTORY, pool, weth: WETH, usdc: USDC },
  quote: liveAssessment,
  transactionDraft: {
    from: account.address,
    to: ROUTER,
    data,
    calldataHash,
    value: AMOUNT_IN.toString(),
    nonce: String(nonce),
    gas: gas.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString()
  },
  governor: { policy: governorPolicy, decision: governorDecision },
  priorSeal: { receipt: priorSealReceipt, keyRegistry, localVerification: verification },
  chainResult: {
    txHash,
    explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
    blockNumber: Number(chainReceipt.blockNumber),
    blockHash: chainReceipt.blockHash,
    status: chainReceipt.status,
    gasUsed: chainReceipt.gasUsed.toString(),
    effectiveGasPrice: chainReceipt.effectiveGasPrice.toString(),
    feePaidWei: (chainReceipt.gasUsed * chainReceipt.effectiveGasPrice).toString(),
    usdcBalanceBefore: usdcBalanceBefore.toString(),
    usdcBalanceAfter: usdcBalanceAfter.toString(),
    usdcReceived: (usdcBalanceAfter - usdcBalanceBefore).toString()
  },
  limits: {
    testnetOnly: true,
    publicDevelopmentKey: true,
    insightLiveAssessmentPerformed: false,
    insightExecutionReceiptIssued: false,
    economicSafetyGuaranteed: false,
    wakAdoptionClaimed: false,
    priorSealIssuerKeyMode: "EPHEMERAL_LOCAL_TEST_KEY"
  }
});
const evidenceBundle = { ...unsignedBundle, bundleHash: sha256Canonical(unsignedBundle) };
const trustRoots = {
  schema: "web3-agent-kit.base-sepolia-live-trust-roots.v1",
  mode: "NONPRODUCTION_TEST_ROOTS",
  chainId: CHAIN_ID,
  txHash,
  priorSeal: {
    issuer: ISSUER,
    keyId: KEY_ID,
    publicKeySpkiSha256: publicKeyFingerprint(publicKeyPem)
  },
  warning: "Nonproduction test roots. The public signer and ephemeral PriorSeal issuer key are unsuitable for production trust."
};
await mkdir(OUTPUT, { recursive: true });
await writeJson("evidence-bundle.json", evidenceBundle);
await writeJson("trust-roots.json", trustRoots);
if (!priorSealReceipt.compliance) throw new Error("Authorized receipt is missing compliance evidence");
process.stdout.write(`${JSON.stringify({
  status: "PASS",
  txHash,
  explorerUrl: evidenceBundle.chainResult.explorerUrl,
  blockNumber: evidenceBundle.chainResult.blockNumber,
  usdcReceived: evidenceBundle.chainResult.usdcReceived,
  authorizationId: authorization.authorizationId,
  receiptId: priorSealReceipt.receiptId,
  exactCallBound: priorSealReceipt.binding.bound,
  compliance: priorSealReceipt.compliance.status
}, null, 2)}
`);
