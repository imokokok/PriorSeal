// Generated from insight-priorseal-v3-local-drill.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  parseAbi,
  toBytes
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPriorSealClient,
  createV3SwapApproval,
  V3_SINGLE_SWAP_ABI
} from "../sdk/dist/index.js";
import {
  createDefiExecutionGateway,
  createDefiViemSubmitter,
  createPostgresDefiAttemptStore
} from "../sdk/dist/defi.js";
import { createHttpServer, createPostgresStore } from "../src/index.mjs";
import { observeEvm } from "../src/infrastructure/blockchain/evm/observer.mjs";
if (!process.env.GANACHE_MODULE) {
  throw new Error(
    "Set GANACHE_MODULE to a local ganache@7.9.2/dist/node/core.js path."
  );
}
const insightPath = resolve(
  fileURLToPath(new URL("../../insight/sdk/dist/index.js", import.meta.url))
);
const insightSourceRoot = resolve(
  fileURLToPath(new URL("../../insight", import.meta.url))
);
const insightFixturePrivateKey = `0x${"72".repeat(32)}`;
process.env.ATTESTATION_SIGNER_PRIVATE_KEY = insightFixturePrivateKey;
delete process.env.ATTESTATION_KEYS_CONFIG;
delete process.env.ATTESTATION_REVOKED_KEYS_CONFIG;
delete process.env.ATTESTATION_SAMPLE_SIGNER_PRIVATE_KEY;
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.VERCEL_ENV;
process.env.NODE_ENV = "development";
process.env.EXECUTION_RPC_8453 = "http://127.0.0.1:1";
for (const name of [
  "ALCHEMY_ETHEREUM_RPC",
  "ALCHEMY_ARBITRUM_RPC",
  "ALCHEMY_POLYGON_RPC",
  "ALCHEMY_BASE_RPC",
  "ALCHEMY_OPTIMISM_RPC",
  "ALCHEMY_LINEA_RPC"
]) {
  delete process.env[name];
}
const { InsightGuard, createPriorSealDefiSubmitter } = await import(pathToFileURL(insightPath).href);
function insightModuleExports(module) {
  if (!module || typeof module !== "object")
    throw new TypeError("Insight module failed to load");
  const value = module;
  const exports = value.default && typeof value.default === "object" ? value.default : value;
  return exports;
}
const [executionServiceModule, executionReceiptModule, executionPairModule] = await Promise.all([
  import(pathToFileURL(
    resolve(
      insightSourceRoot,
      "src/lib/execution/executionReceiptService.ts"
    )
  ).href),
  import(pathToFileURL(
    resolve(insightSourceRoot, "src/lib/attestations/executionReceipt.ts")
  ).href),
  import(pathToFileURL(
    resolve(insightSourceRoot, "src/lib/execution/verifyExecutionPair.ts")
  ).href)
]);
const issueExecutionReceipt = insightModuleExports(executionServiceModule).issueExecutionReceipt;
const verifyExecutionReceipt = insightModuleExports(executionReceiptModule).verifyExecutionReceipt;
const verifyExecutionPair = insightModuleExports(executionPairModule).verifyExecutionPair;
if (typeof issueExecutionReceipt !== "function" || typeof verifyExecutionReceipt !== "function" || typeof verifyExecutionPair !== "function") {
  throw new Error(
    "Insight execution issue/verify source exports were not loaded"
  );
}
const chainId = 8453;
const now = Math.floor(Date.now() / 1e3);
const quoteObservedAt = new Date((now - 5) * 1e3).toISOString();
const insightSigner = privateKeyToAccount(insightFixturePrivateKey);
const DECIMALS_ABI = parseAbi(["function decimals() view returns (uint8)"]);
const oracleDomain = {
  name: "Insight Oracle Safety",
  version: "3",
  chainId: 1
};
const oracleTypes = {
  OracleSafetyCheck: [
    { name: "verdict", type: "string" },
    { name: "sourceAssetId", type: "string" },
    { name: "destinationAssetId", type: "string" },
    { name: "subjectChainId", type: "uint256" },
    { name: "action", type: "string" },
    { name: "tradeAmountUsd", type: "uint256" },
    { name: "consensusPrice", type: "uint256" },
    { name: "maxDeviationBps", type: "uint256" },
    { name: "manipulationRiskBps", type: "uint256" },
    { name: "participantCount", type: "uint256" },
    { name: "requiredParticipantCount", type: "uint256" },
    { name: "coverageStatus", type: "string" },
    { name: "independenceStatus", type: "string" },
    { name: "sourceGroupCount", type: "uint256" },
    { name: "crossProviderAgreementBps", type: "uint256" },
    { name: "maxStablecoinDepegBps", type: "uint256" },
    { name: "maxDataAgeSeconds", type: "uint256" },
    { name: "recommendedMaxPositionUsd", type: "uint256" },
    { name: "reasonCodesHash", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "evaluationScope", type: "string" },
    { name: "evaluatedAssetIdsHash", type: "bytes32" },
    { name: "providerObservationsHash", type: "bytes32" },
    { name: "validUntil", type: "uint256" },
    { name: "checkedAt", type: "uint256" },
    { name: "schemaVersion", type: "uint256" },
    { name: "requiredSourceGroupCount", type: "uint256" }
  ]
};
const decisionDomain = {
  name: "Insight Decision Input Assessment",
  version: "1",
  chainId: 1
};
const decisionTypes = {
  DecisionInputAssessment: [
    { name: "assessmentHash", type: "bytes32" },
    { name: "linkedPreTradeUid", type: "bytes32" },
    { name: "verifyUrlHash", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "schemaVersion", type: "uint256" }
  ]
};
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
function assetId(address) {
  return `eip155:${chainId}/erc20:${address.toLowerCase()}`;
}
function localRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}
function validateExecutionIssueBody(value) {
  const body = localRecord(value, "Insight execution issue request");
  for (const field of ["preTradeUid", "requestHash", "txHash"]) {
    if (typeof body[field] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body[field])) {
      throw new TypeError(`${field} must be a 0x-prefixed 32-byte hex string`);
    }
  }
  for (const field of ["sourceAssetId", "destinationAssetId"]) {
    if (typeof body[field] !== "string" || body[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  for (const field of [
    "subjectChainId",
    "settlementChainId",
    "participantCount",
    "sourceGroupCount",
    "preTradeSignedAt"
  ]) {
    if (typeof body[field] !== "number" || !Number.isSafeInteger(body[field])) {
      throw new TypeError(`${field} must be a safe integer`);
    }
  }
  if (typeof body.quotedPrice !== "number" || !Number.isFinite(body.quotedPrice)) {
    throw new TypeError("quotedPrice must be a finite number");
  }
  const attestations = localRecord(
    body.preTradeAttestations,
    "preTradeAttestations"
  );
  localRecord(attestations.source, "preTradeAttestations.source");
  localRecord(attestations.destination, "preTradeAttestations.destination");
  return body;
}
async function signedPreTrade(inputAddress, outputAddress, tradeAmountUsd, side) {
  const checkedAt = now - 2;
  const validUntil = checkedAt + 900;
  const data = {
    verdict: "PASS",
    sourceAssetId: assetId(inputAddress),
    destinationAssetId: assetId(outputAddress),
    subjectChainId: chainId,
    action: "swap",
    tradeAmountUsd,
    consensusPrice: 1e8,
    maxDeviationBps: 100,
    manipulationRiskBps: 0,
    participantCount: 3,
    requiredParticipantCount: 3,
    coverageStatus: "SUFFICIENT",
    independenceStatus: "ASSESSED",
    sourceGroupCount: 2,
    crossProviderAgreementBps: 9900,
    maxStablecoinDepegBps: 0,
    maxDataAgeSeconds: 5,
    recommendedMaxPositionUsd: 1e4,
    reasonCodesHash: `0x${"1".repeat(64)}`,
    requestHash: `0x${side === "source" ? "a" : "b"}${"1".repeat(63)}`,
    evaluationScope: "SOURCE_ASSET_ONLY",
    evaluatedAssetIdsHash: `0x${"2".repeat(64)}`,
    providerObservationsHash: `0x${"3".repeat(64)}`,
    validUntil,
    checkedAt,
    schemaVersion: 3,
    requiredSourceGroupCount: 2
  };
  const message = Object.fromEntries(
    oracleTypes.OracleSafetyCheck.map(({ name, type }) => [
      name,
      type === "uint256" ? BigInt(data[name]) : data[name]
    ])
  );
  const typedData = {
    domain: oracleDomain,
    types: oracleTypes,
    primaryType: "OracleSafetyCheck",
    message
  };
  const uid = hashTypedData(typedData);
  const signature = await insightSigner.signTypedData(typedData);
  const decisionUnsigned = {
    schemaVersion: 1,
    status: "SUFFICIENT",
    eligibleToProceed: true,
    asset: side === "source" ? "TEST-IN" : "TEST-OUT",
    chainId,
    action: "swap",
    tradeAmountUsd,
    evaluatedAt: new Date((now - 2) * 1e3).toISOString(),
    operationRouteQuote: null,
    quoteInputHash: `0x${"4".repeat(64)}`,
    policy: {
      maxReferenceDeviationBps: 100,
      maxSlippageBps: 50,
      maxQuoteAgeSeconds: 30
    },
    prices: {
      decisionPriceUsd: 1,
      quotePriceUsd: 1.0001,
      quoteObservedAt,
      quoteAgeSeconds: 3,
      quoteDeviationBps: 1
    },
    evidence: { source: "isolated-local-fixture" },
    reasons: [],
    caveats: []
  };
  const assessmentHash = keccak256(toBytes(canonicalJson(decisionUnsigned)));
  const verifyUrl = "https://www.oracleinsight.xyz/api/v1/safety/decision-input/verify?uid=local";
  const decisionMessage = {
    assessmentHash,
    linkedPreTradeUid: uid,
    verifyUrlHash: keccak256(toBytes(verifyUrl)),
    issuedAt: BigInt(now - 2),
    validUntil: BigInt(now + 298),
    schemaVersion: 1n
  };
  const decisionTypedData = {
    domain: decisionDomain,
    types: decisionTypes,
    primaryType: "DecisionInputAssessment",
    message: decisionMessage
  };
  const decisionAttestation = {
    type: "DecisionInputAssessment",
    schemaVersion: 1,
    uid: hashTypedData(decisionTypedData),
    attester: insightSigner.address,
    attesterLabel: "Insight Decision Input Assessment attester",
    signedAt: new Date((now - 2) * 1e3).toISOString(),
    validForSeconds: 300,
    signature: await insightSigner.signTypedData(decisionTypedData),
    verifyUrl,
    data: {
      ...decisionMessage,
      issuedAt: now - 2,
      validUntil: now + 298,
      schemaVersion: 1
    },
    eip712: {
      domain: decisionDomain,
      types: decisionTypes,
      primaryType: "DecisionInputAssessment"
    }
  };
  return {
    verdict: "PASS",
    consensusPrice: 1,
    maxDeviationPct: 1,
    crossProviderAgreement: 0.99,
    recommendedMaxPositionUsd: 1e4,
    participantCount: 3,
    warnings: [],
    contributingFactors: [],
    evaluatedAt: new Date(checkedAt * 1e3).toISOString(),
    attestation: {
      uid,
      schemaVersion: 3,
      attester: insightSigner.address,
      signature,
      signedAt: new Date(checkedAt * 1e3).toISOString(),
      validUntil,
      validForSeconds: validUntil - checkedAt,
      verifyUrl: "https://www.oracleinsight.xyz/api/v1/safety/attestation/verify",
      eip712: {
        domain: oracleDomain,
        types: oracleTypes,
        primaryType: "OracleSafetyCheck"
      },
      data
    },
    decisionInputAssessment: {
      ...decisionUnsigned,
      attestation: decisionAttestation
    }
  };
}
const providerModule = await import(pathToFileURL(process.env.GANACHE_MODULE).href);
const ganache = providerModule.default;
const provider = ganache.provider({
  chain: { chainId, time: new Date(now * 1e3), hardfork: "shanghai" },
  logging: { quiet: true },
  wallet: { totalAccounts: 3 }
});
const db = new PGlite();
let server;
try {
  const chain = defineChain({
    id: chainId,
    name: "Isolated Insight PriorSeal drill",
    nativeCurrency: { name: "Test ETH", symbol: "TEST", decimals: 18 },
    rpcUrls: { default: { http: ["in-process-only"] } }
  });
  const accounts = Object.entries(provider.getInitialAccounts()).map(
    ([address, value]) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !value || typeof value !== "object" || !("secretKey" in value) || typeof value.secretKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.secretKey)) {
        throw new TypeError("Ganache returned an invalid local account record");
      }
      return [
        address.toLowerCase(),
        { secretKey: value.secretKey }
      ];
    }
  );
  if (accounts.length < 2)
    throw new Error("Ganache must provide at least two local accounts");
  const deployer = accounts[0][0];
  const sender = accounts[1][0];
  const receiver = sender;
  const transport = custom(provider, { retryCount: 0 });
  const deployerWallet = createWalletClient({
    chain,
    account: privateKeyToAccount(accounts[0][1].secretKey),
    transport
  });
  const senderAccount = privateKeyToAccount(accounts[1][1].secretKey);
  const senderWallet = createWalletClient({
    chain,
    account: senderAccount,
    transport
  });
  const publicClient = createPublicClient({ chain, transport });
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
}`;
  const compilation = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Simulation.sol": { content: source } },
        settings: {
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
        }
      })
    )
  );
  assert.ok(
    compilation.contracts?.["Simulation.sol"],
    "local swap contracts compile"
  );
  const contracts = compilation.contracts["Simulation.sol"];
  async function deploy(name, args = []) {
    const artifact = contracts[name];
    const hash = await deployerWallet.deployContract({
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      args
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    assert.ok(receipt.contractAddress);
    return receipt.contractAddress.toLowerCase();
  }
  const inputToken = await deploy("Token", [sender]);
  const outputToken = await deploy("Token", [deployer]);
  const router = await deploy("Router");
  await publicClient.waitForTransactionReceipt({
    hash: await deployerWallet.writeContract({
      address: outputToken,
      abi: contracts.Token.abi,
      functionName: "transfer",
      args: [router, 2000000n]
    })
  });
  await publicClient.waitForTransactionReceipt({
    hash: await senderWallet.writeContract({
      address: inputToken,
      abi: contracts.Token.abi,
      functionName: "approve",
      args: [router, 1000000n]
    })
  });
  const routerCode = await publicClient.getCode({ address: router });
  assert.ok(routerCode);
  const routerCodeHash = keccak256(routerCode);
  const transaction = {
    chainId,
    from: sender,
    to: router,
    nonce: String(await publicClient.getTransactionCount({ address: sender })),
    value: "0",
    data: encodeFunctionData({
      abi: V3_SINGLE_SWAP_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: inputToken,
          tokenOut: outputToken,
          fee: 3e3,
          recipient: receiver,
          deadline: BigInt(now + 240),
          amountIn: 1000000n,
          amountOutMinimum: 995000n,
          sqrtPriceLimitX96: 0n
        }
      ]
    }),
    sourceAmount: 1000000n
  };
  const approval = createV3SwapApproval(transaction, routerCodeHash);
  for (const file of (await readdir(new URL("../migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")
    );
  }
  const query = async (sql, values) => {
    const result2 = await db.query(sql, values);
    return { rows: result2.rows };
  };
  const pool = {
    query,
    connect: async () => ({ query, release() {
    } })
  };
  const issuerKeys = generateKeyPairSync("ed25519");
  const privateKeyPem = issuerKeys.privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const publicKeyPem = issuerKeys.publicKey.export({
    type: "spki",
    format: "pem"
  });
  const issuer = "local-insight-priorseal-drill";
  const audience = "local-insight-priorseal-drill";
  const keyId = "local-issuer-key";
  server = createHttpServer({
    store: createPostgresStore(pool),
    privateKeyPem,
    publicKeyPem,
    issuer,
    keyId,
    authorizationAudience: audience,
    observer: (input) => observeEvm({
      ...input,
      rpcUrls: ["in-process-evm"],
      rpcClient: {
        call: async (_url, method, params) => await provider.request({ method, params })
      }
    })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const priorSealClient = createPriorSealClient({ baseUrl });
  const acceptanceKey = {
    issuer,
    keyId,
    algorithm: "Ed25519",
    publicKey: publicKeyPem,
    status: "active",
    validFrom: null,
    validUntil: null
  };
  const authorizationStore = createPostgresStore(pool);
  const attempts = createPostgresDefiAttemptStore(pool);
  const chainReader = {
    getChainId: () => publicClient.getChainId(),
    getBytecode: ({ address }) => publicClient.getCode({ address })
  };
  const gateway = createDefiExecutionGateway(priorSealClient, {
    authorizationStore,
    attempts,
    chainReader,
    submit: createDefiViemSubmitter(senderWallet),
    clock: () => now + 3
  });
  const submitViaGateway = createPriorSealDefiSubmitter({
    gateway,
    approval,
    routerAddress: router,
    routerCodeHash,
    acceptanceKey
  });
  const submitTransaction = Object.assign(
    async (input) => {
      await provider.request({ method: "evm_increaseTime", params: [3] });
      await provider.request({ method: "evm_mine", params: [] });
      return submitViaGateway(input);
    },
    {
      authorizationContextCommitments: submitViaGateway.authorizationContextCommitments,
      assertAuthorizationTransaction: submitViaGateway.assertAuthorizationTransaction
    }
  );
  const sourceResult = await signedPreTrade(
    inputToken,
    outputToken,
    1e6,
    "source"
  );
  const destinationResult = await signedPreTrade(
    outputToken,
    inputToken,
    1e6,
    "destination"
  );
  const insightExecutionRequests = [];
  const insightExecutionChecks = [];
  const localExecutionRpcCalls = {
    receipt: 0,
    transaction: 0,
    block: 0,
    ethCall: 0
  };
  const localExecutionClient = {
    getTransactionReceipt: async (_key, _endpoints, txHash) => {
      localExecutionRpcCalls.receipt++;
      return await provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash]
      });
    },
    getTransactionByHash: async (_key, _endpoints, txHash) => {
      localExecutionRpcCalls.transaction++;
      return await provider.request({
        method: "eth_getTransactionByHash",
        params: [txHash]
      });
    },
    getBlockByNumber: async (_key, _endpoints, blockTag) => {
      localExecutionRpcCalls.block++;
      const tag = typeof blockTag === "number" ? `0x${blockTag.toString(16)}` : blockTag;
      return await provider.request({
        method: "eth_getBlockByNumber",
        params: [tag, false]
      });
    },
    ethCall: async (_key, _endpoints, to, data, _signal, blockTag = "latest") => {
      localExecutionRpcCalls.ethCall++;
      const tag = typeof blockTag === "number" ? `0x${blockTag.toString(16)}` : blockTag;
      return await provider.request({
        method: "eth_call",
        params: [{ to, data }, tag]
      });
    }
  };
  const localInsightFetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    if (url.pathname === "/api/v1/safety/pre-trade" && init?.method === "GET") {
      const data = url.searchParams.get("asset") === "TEST-IN" ? sourceResult : destinationResult;
      return Response.json({
        success: true,
        data,
        meta: { requestId: "local-insight-pretrade" }
      });
    }
    if (url.pathname === "/api/v1/execution/attestation/issue" && init?.method === "POST") {
      const body = validateExecutionIssueBody(
        JSON.parse(String(init.body ?? "{}"))
      );
      insightExecutionRequests.push(body);
      const issued = await issueExecutionReceipt({
        ...body,
        client: localExecutionClient
      });
      if (!issued.ok || !issued.receipt || !issued.facts || !issued.binding) {
        const code = issued.code ?? "INSIGHT_ISSUE_FAILED";
        const status = code === "UNSUPPORTED_CHAIN" || code === "PRE_TRADE_VERIFICATION_FAILED" ? 400 : 502;
        return Response.json(
          {
            success: false,
            error: {
              code,
              message: issued.message ?? "Receipt issuance failed"
            }
          },
          { status }
        );
      }
      const attestations = localRecord(
        body.preTradeAttestations,
        "preTradeAttestations"
      );
      const verification = await verifyExecutionReceipt(issued.receipt);
      const pair = await verifyExecutionPair(
        attestations.source,
        issued.receipt,
        attestations.destination
      );
      const executionStatus = String(
        issued.receipt.data.priceExecutionStatus ?? issued.receipt.data.executionStatus ?? "UNDETERMINED"
      );
      insightExecutionChecks.push({
        uid: issued.receipt.uid,
        schemaVersion: issued.receipt.schemaVersion,
        signatureValid: verification.valid && verification.cryptographicValid,
        pairValid: pair.pairedValid,
        closedLoopStatus: pair.closedLoopStatus,
        bindingMode: issued.receipt.data.bindingMode,
        executionStatus,
        verificationReason: verification.reason,
        pairReason: pair.reason,
        quotedPrice: issued.receipt.data.quotedPrice,
        executedPrice: issued.receipt.data.executedPrice,
        priceDeltaBps: issued.receipt.data.priceDeltaBps,
        reasonCodes: issued.receipt.data.reasonCodes,
        executedAt: issued.receipt.data.executedAt,
        preTradeSignedAt: issued.receipt.data.preTradeSignedAt,
        preTradeValidUntil: issued.receipt.data.preTradeValidUntil,
        sourceAmount: issued.facts.sourceAmount,
        destinationAmount: issued.facts.destinationAmount
      });
      return Response.json({
        success: true,
        data: {
          attestation: issued.receipt,
          executionStatus,
          bindingMode: issued.receipt.data.bindingMode,
          binding: issued.binding,
          selectedEvent: issued.facts.selectedEvent ?? null,
          note: "Locally issued with Insight executionReceiptService and verified against the local EVM settlement.",
          bindingNote: "Binding VERIFIED: both supplied pre-trade attestations were signature-checked and the receipt fields were derived from their signed payloads."
        },
        meta: { requestId: "local-insight-execution" }
      });
    }
    return Response.json(
      {
        success: false,
        error: { code: "LOCAL_DRILL_ROUTE_NOT_FOUND", message: url.pathname }
      },
      { status: 404 }
    );
  };
  const policy = {
    policyId: "local-v3-swap-policy",
    version: "1",
    assetIds: {
      "TEST-IN": assetId(inputToken),
      "TEST-OUT": assetId(outputToken)
    },
    maxReferenceDeviationBps: 100,
    maxSlippageBps: 50,
    maxQuoteAgeSeconds: 30
  };
  const decisionInputTrust = {
    keyRegistry: {
      public_keys: [
        {
          key_id: "local-insight-key",
          public_key: insightSigner.address,
          revoked: false,
          role: "attester",
          validFrom: (/* @__PURE__ */ new Date(0)).toISOString(),
          validUntil: null
        }
      ]
    },
    policy
  };
  const guard = new InsightGuard({
    apiKey: "local-only-placeholder",
    baseUrl: "http://127.0.0.1:0",
    fetch: localInsightFetch,
    timeoutMs: 5e3,
    decisionInputTrust
  });
  const reader = {
    getBlock: ({ blockTag }) => publicClient.getBlock({ blockTag }),
    getBytecode: ({
      address,
      blockNumber
    }) => publicClient.getCode({ address, blockNumber }),
    readContract: (input) => publicClient.readContract(input),
    call: async (input) => {
      const result2 = await publicClient.call(input);
      return { data: result2.data };
    }
  };
  const result = await guard.executeTrustedV3SwapWithPriorSeal({
    source: {
      asset: "TEST-IN",
      destinationAsset: "TEST-OUT",
      chainId,
      action: "swap",
      tradeAmountUsd: 1e6,
      decisionInput: {
        decisionPriceUsd: 1,
        quotePriceUsd: 1.0001,
        quoteObservedAt,
        maxReferenceDeviationBps: 100,
        maxSlippageBps: 50,
        maxQuoteAgeSeconds: 30
      }
    },
    destination: {
      asset: "TEST-OUT",
      destinationAsset: "TEST-IN",
      chainId,
      action: "swap",
      tradeAmountUsd: 1e6,
      decisionInput: {
        decisionPriceUsd: 1,
        quotePriceUsd: 1.0001,
        quoteObservedAt,
        maxReferenceDeviationBps: 100,
        maxSlippageBps: 50,
        maxQuoteAgeSeconds: 30
      }
    },
    receipt: { settlementChainId: chainId, maxSlippageBps: 50 },
    v3Risk: {
      routerAddress: router,
      routerCodeHash,
      reader,
      maxBlockAgeSeconds: 30
    },
    priorSeal: {
      client: createPriorSealClient({ baseUrl }),
      audience,
      principal: { type: "user", id: "local-user", account: sender },
      agentId: "local-v3-swap-agent",
      confirmations: 1,
      signAuthorization: async ({
        typedData
      }) => senderAccount.signTypedData(typedData)
    },
    prepareTransaction: async () => transaction,
    submitTransaction
  });
  assert.equal(result.status, "executed");
  if (result.status !== "executed")
    throw new Error("Strict V3 workflow did not execute.");
  assert.equal(result.transactionRisk.status, "ACCEPTABLE");
  assert.equal(result.evidenceStatus, "COMPLETE");
  assert.equal(result.evidenceAvailability, "COMPLETE");
  assert.equal(result.transactionCorrelation, true);
  assert.equal(result.assuranceValid, true);
  assert.equal(result.priorSealEvidence?.verification?.valid, true);
  assert.equal(
    result.priorSealEvidence?.receipt?.compliance?.status,
    "COMPLIANT",
    JSON.stringify(result.priorSealEvidence?.receipt?.compliance)
  );
  assert.equal(result.insightReceipt?.bindingMode, "VERIFIED");
  assert.equal(insightExecutionRequests.length, 1);
  assert.equal(insightExecutionRequests[0].txHash, result.transaction.txHash);
  assert.equal(insightExecutionChecks.length, 1);
  assert.equal(insightExecutionChecks[0].signatureValid, true);
  assert.equal(insightExecutionChecks[0].pairValid, true);
  assert.equal(
    insightExecutionChecks[0].closedLoopStatus,
    "PRICE_CLOSED_FAITHFUL",
    JSON.stringify(insightExecutionChecks[0])
  );
  assert.equal(insightExecutionChecks[0].bindingMode, "VERIFIED");
  assert.equal(insightExecutionChecks[0].executionStatus, "FAITHFUL");
  assert.equal(
    result.insightReceipt?.attestation.uid,
    insightExecutionChecks[0].uid
  );
  assert.equal(
    result.insightReceipt?.attestation.data.txHash,
    result.transaction.txHash
  );
  assert.equal(localExecutionRpcCalls.receipt, 1);
  assert.ok(localExecutionRpcCalls.block >= 1);
  assert.ok(localExecutionRpcCalls.ethCall >= 2);
  const balanceAbi = parseAbi([
    "function balanceOf(address) view returns(uint256)"
  ]);
  const receiverBalance = await publicClient.readContract({
    address: outputToken,
    abi: balanceAbi,
    functionName: "balanceOf",
    args: [receiver]
  });
  assert.equal(receiverBalance, 995000n);
  const attestedPretradePair = [
    result.sourcePreTrade,
    result.destinationPreTrade
  ].every((entry) => Boolean(entry.decisionInputAssessment?.attestation?.uid));
  assert.ok(attestedPretradePair);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        scope: "LOCAL_FIXTURE_SIGNERS_AND_GANACHE_ONLY; NONPRODUCTION; NOT_STAGING",
        decisionInputPairVerified: true,
        exactV3SimulationAcceptable: true,
        priorSealAuthorizationAccepted: true,
        localTestTransactionMined: true,
        insightExecutionResponseCorrelated: true,
        insightExecutionReceipt: {
          schemaVersion: insightExecutionChecks[0].schemaVersion,
          uid: insightExecutionChecks[0].uid,
          signerSignatureVerified: insightExecutionChecks[0].signatureValid,
          bindingMode: insightExecutionChecks[0].bindingMode,
          executionStatus: insightExecutionChecks[0].executionStatus,
          closedLoopStatus: insightExecutionChecks[0].closedLoopStatus
        },
        insightCollectorUsedLocalGanache: localExecutionRpcCalls,
        priorSealReceiptCryptographicallyVerified: true,
        transactionHashesCorrelated: true,
        evidenceStatus: result.evidenceStatus,
        workflowAssertionsPassed: true,
        receiverOutputTokenBalance: receiverBalance.toString()
      },
      null,
      2
    ) + "\n"
  );
} finally {
  if (server?.listening) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await db.close();
  await provider.disconnect();
}
