// Generated from run-interai-track1-direct-preflight.mts by npm run core:build. Do not edit directly.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  recoverTypedDataAddress
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  assertTrack1Registry,
  assertTrack1SignedDescriptor
} from "./interai-track1-registry.mjs";
const ENDPOINT = "https://api.interailabs.dev/verify";
const KEYCHAIN_SERVICE = "priorseal.interai.track1-pilot";
const KEYCHAIN_ACCOUNT = "YuTao Peng";
const WINDOW_START = Date.parse("2026-09-25T15:00:00Z");
const WINDOW_END = Date.parse("2026-09-25T15:30:00Z");
const EXECUTOR = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const WETH = "0x4200000000000000000000000000000000000006";
const AMOUNT_IN = 1000000000000000n;
process.umask(63);
const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
];
const EXACT_INPUT_SINGLE_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
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
      }
    ],
    outputs: [{ name: "amountOut", type: "uint256" }]
  }
];
function assert(value, message) {
  if (!value) throw new Error(message);
}
function object(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
  return value;
}
function string(value, label) {
  assert(
    typeof value === "string" && value.length > 0,
    `${label} must be a nonempty string`
  );
  return value;
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function equalJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equalJson(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aa = a;
    const bb = b;
    const keys = Object.keys(aa);
    return keys.length === Object.keys(bb).length && keys.every((key) => Object.hasOwn(bb, key) && equalJson(aa[key], bb[key]));
  }
  return false;
}
function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).filter(([, child]) => child !== void 0).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
async function jsonFile(file) {
  return object(JSON.parse(await readFile(file, "utf8")), file);
}
function options() {
  const args = process.argv.slice(2);
  assert(
    args.length % 2 === 0,
    "Usage: --candidate-dir DIR --request-file FILE --ready-file FILE --output-dir DIR [--proxy http://127.0.0.1:7890]"
  );
  const result = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i += 2) {
    assert(
      args[i]?.startsWith("--") && !result.has(args[i]),
      "Invalid or duplicate option"
    );
    result.set(args[i], string(args[i + 1], args[i]));
  }
  const allowed = /* @__PURE__ */ new Set([
    "--candidate-dir",
    "--request-file",
    "--ready-file",
    "--output-dir",
    "--proxy"
  ]);
  for (const key of result.keys())
    assert(allowed.has(key), `Unsupported option: ${key}`);
  for (const key of [
    "--candidate-dir",
    "--request-file",
    "--ready-file",
    "--output-dir"
  ])
    assert(result.has(key), `Missing ${key}`);
  if (result.has("--proxy"))
    assert(
      result.get("--proxy") === "http://127.0.0.1:7890",
      "Only the configured local proxy is permitted"
    );
  return result;
}
async function verifyChecksums(directory) {
  const manifest = await readFile(
    path.join(directory, "SHA256SUMS.txt"),
    "utf8"
  );
  const lines = manifest.trim().split(/\r?\n/);
  assert(lines.length >= 10, "Candidate checksum manifest is incomplete");
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    assert(match, "Invalid checksum manifest line");
    const bytes = await readFile(path.join(directory, match[2]));
    assert(
      sha256(bytes) === match[1],
      `Candidate artifact hash mismatch: ${match[2]}`
    );
  }
}
async function validateInputs(candidateDir, requestFile, readyFile) {
  const now = Date.now();
  assert(
    now >= WINDOW_START && now < WINDOW_END,
    "Outside proposed 2026-09-25 23:00\u201323:30 Asia/Shanghai window"
  );
  const ready = await jsonFile(readyFile);
  assert(
    ready.channel === "original-email-thread" && ready.message === "READY",
    "Alejandro READY in original email thread has not been recorded"
  );
  const readyAt = Date.parse(
    string(ready.receivedAtIso, "READY receivedAtIso")
  );
  assert(
    Number.isFinite(readyAt) && readyAt >= WINDOW_START && readyAt <= now && readyAt < WINDOW_END,
    "READY time is outside the agreed window"
  );
  await verifyChecksums(candidateDir);
  const candidate = await jsonFile(
    path.join(candidateDir, "candidate-run-package.json")
  );
  const packageId = string(candidate.packageId, "candidate.packageId");
  assert(
    /^interai-track1-base-sepolia-\d+-[0-9a-f-]{36}$/.test(packageId),
    "Unexpected candidate package ID"
  );
  assert(
    candidate.schema === "interai.track1.jit-direct-verify-candidate-package.v1" && candidate.hostPrerequisiteDisposition === "SATISFIED_AT_GENERATION",
    "Candidate prerequisite disposition is not satisfied"
  );
  const quote = object(candidate.quote, "candidate.quote");
  assert(
    typeof quote.expiresAt === "number" && quote.validForSeconds === 60 && typeof quote.observedAt === "number" && now - quote.observedAt * 1e3 <= 6e4 && quote.expiresAt === quote.observedAt + 60 && quote.expiresAt * 1e3 - now >= 15e3,
    "Quote has less than 15 seconds remaining"
  );
  const projection = object(
    candidate.interaiSixFieldProjection,
    "candidate.projection"
  );
  const action = object(candidate.canonicalAction, "candidate.canonicalAction");
  const args = object(action.arguments, "candidate.canonicalAction.arguments");
  assert(
    action.schema === "interai-canonical-action/v1" && action.tool_id === "wallet.send_transaction" && action.type === "evm_call" && action.operation === "eth_sendTransaction" && action.external_side_effect === true && action.irreversible === true && Object.keys(args).sort().join(",") === "amount_usd,calldataHash,chainId,currency,nonce,sender,target,value",
    "Canonical action semantics mismatch"
  );
  assert(
    args.chainId === 84532 && getAddress(string(args.sender, "action.sender")) === EXECUTOR && getAddress(string(args.target, "action.target")) === ROUTER,
    "Pinned EVM action mismatch"
  );
  assert(
    args.value === "0" && args.amount_usd === 4 && args.currency === "USD",
    "EVM value or economic declaration mismatch"
  );
  const sourceBinding = await jsonFile(
    path.join(candidateDir, "source-evidence-binding.json")
  );
  const destinationBinding = await jsonFile(
    path.join(candidateDir, "destination-evidence-binding.json")
  );
  const calldata = string(
    sourceBinding.exactCalldata,
    "source exact calldata"
  );
  assert(
    /^0x[0-9a-f]+$/i.test(calldata) && calldata.startsWith("0x04e45aaf") && destinationBinding.exactCalldata === calldata,
    "Unexpected calldata or selector"
  );
  assert(keccak256(calldata) === args.calldataHash, "Calldata hash mismatch");
  const decoded = decodeFunctionData({
    abi: EXACT_INPUT_SINGLE_ABI,
    data: calldata
  });
  assert(
    decoded.functionName === "exactInputSingle",
    "Unexpected router function"
  );
  const params = decoded.args[0];
  const swap = object(candidate.swap, "candidate.swap");
  assert(
    getAddress(params.tokenIn) === WETH && getAddress(params.tokenOut) === "0x036CbD53842c5426634e7929541eC2318f3dCF7e" && params.fee === 3e3 && getAddress(params.recipient) === EXECUTOR && params.amountIn === AMOUNT_IN && params.amountOutMinimum > 0n && params.amountOutMinimum === BigInt(string(swap.amountOutMinimum, "swap.amountOutMinimum")) && params.sqrtPriceLimitX96 === 0n,
    "SwapRouter02 exactInputSingle calldata mismatch"
  );
  assert(
    BigInt(string(quote.quotedAmountOut, "quote.quotedAmountOut")) * 9500n / 10000n === params.amountOutMinimum && swap.maxSlippageBps === 500,
    "Quote or slippage binding mismatch"
  );
  assert(
    projection.chainId === 84532 && projection.sender === args.sender && projection.target === args.target && projection.value === args.value && projection.calldataHash === args.calldataHash && String(projection.nonce) === args.nonce,
    "Six-field EVM projection mismatch"
  );
  const nonce = Number(args.nonce);
  assert(Number.isSafeInteger(nonce) && nonce >= 0, "Invalid pending nonce");
  const oracle = object(
    candidate.oracleSafetyCheckV3,
    "candidate.oracleSafetyCheckV3"
  );
  const sourceRef = object(oracle.source, "source assertion reference");
  const destinationRef = object(
    oracle.destination,
    "destination assertion reference"
  );
  const source = await jsonFile(
    path.join(candidateDir, "source-oracle-safety-check-v3.json")
  );
  const destination = await jsonFile(
    path.join(candidateDir, "destination-oracle-safety-check-v3.json")
  );
  const registryCurrent = await jsonFile(
    path.join(candidateDir, "oracle-registry-current.json")
  );
  const registryKeys = await jsonFile(
    path.join(candidateDir, "oracle-keys.json")
  );
  assertTrack1Registry(registryKeys, now);
  const releaseId = string(registryCurrent.releaseId, "registry release ID");
  const registryRelease = await jsonFile(
    path.join(candidateDir, `oracle-registry-release-${releaseId}.json`)
  );
  assert(
    registryRelease.releaseId === releaseId && object(registryKeys.registryRelease, "registryKeys.registryRelease").releaseId === releaseId && object(candidate.trustRoots, "candidate.trustRoots").registryReleaseId === releaseId,
    "Pinned registry release mismatch"
  );
  assert(
    registryKeys.attestation_enabled === true,
    "Insight attestation signing is disabled"
  );
  assert(
    Array.isArray(registryKeys.public_keys),
    "Registry public keys missing"
  );
  const signer = string(oracle.signer, "production signer");
  const activeSigner = registryKeys.public_keys.some((entry) => {
    const key = object(entry, "registry key");
    return key.public_key === signer && key.revoked === false && typeof key.validFrom === "string" && Date.parse(key.validFrom) <= now && (key.validUntil === null || typeof key.validUntil === "string" && Date.parse(key.validUntil) > now) && key.role !== "sample";
  });
  assert(activeSigner, "Production signer is not current and non-revoked");
  const audit = await jsonFile(
    path.join(candidateDir, "audit-persistence-proof.json")
  );
  assert(
    audit.expectedProductionSigner === signer && Array.isArray(audit.persistedRows) && audit.persistedRows.length === 2,
    "Audit persistence proof missing or signer mismatch"
  );
  for (const [label, assertion, ref] of [
    ["source", source, sourceRef],
    ["destination", destination, destinationRef]
  ]) {
    assertTrack1SignedDescriptor(assertion);
    assert(
      assertion.uid === ref.uid && assertion.attester === oracle.signer && assertion.validUntil === ref.validUntil,
      `${label} UID or signer mismatch`
    );
    assert(
      typeof assertion.validUntil === "number" && assertion.validUntil * 1e3 - now >= 3e4 && assertion.schemaVersion === 3 && assertion.validForSeconds === 600,
      `${label} assertion has less than 30 seconds remaining`
    );
    const data = object(assertion.data, `${label}.data`);
    assert(
      data.verdict === "PASS" && data.schemaVersion === 3 && data.subjectChainId === 84532 && data.action === "swap" && data.tradeAmountUsd === 4e6 && data.validUntil === assertion.validUntil && typeof data.checkedAt === "number" && data.checkedAt + 600 === assertion.validUntil && data.sourceAssetId?.toString().toLowerCase() === (label === "source" ? "eip155:84532/erc20:0x4200000000000000000000000000000000000006" : "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e") && data.destinationAssetId?.toString().toLowerCase() === (label === "source" ? "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" : "eip155:84532/erc20:0x4200000000000000000000000000000000000006"),
      `${label} assertion payload mismatch`
    );
    const eip712 = object(assertion.eip712, `${label}.eip712`);
    const typedData = {
      domain: object(eip712.domain, `${label}.domain`),
      types: object(eip712.types, `${label}.types`),
      primaryType: string(eip712.primaryType, `${label}.primaryType`),
      message: object(assertion.data, `${label}.data`)
    };
    assert(
      hashTypedData(typedData) === assertion.uid,
      `${label} EIP-712 digest mismatch`
    );
    const recovered = await recoverTypedDataAddress({
      ...typedData,
      signature: string(assertion.signature, `${label}.signature`)
    });
    assert(
      getAddress(recovered) === getAddress(signer),
      `${label} signature recovery mismatch`
    );
    const binding = label === "source" ? sourceBinding : destinationBinding;
    assert(
      binding.assertionUid === assertion.uid && binding.exactCalldata === calldata && binding.requestHash === object(assertion.data, `${label}.data`).requestHash && equalJson(binding.exactCall, projection) && equalJson(binding.economicDeclaration, {
        amount_usd: 4,
        currency: "USD"
      }),
      `${label} evidence binding mismatch`
    );
    const auditRow = audit.persistedRows.find(
      (entry) => object(entry, "audit row").attestation_uid === assertion.uid
    );
    assert(
      auditRow && object(auditRow, `${label} audit row`).verdict === "PASS" && object(auditRow, `${label} audit row`).signed === true,
      `${label} PASS audit row missing`
    );
  }
  const requestBytes = await readFile(requestFile);
  assert(
    requestBytes.length > 0 && requestBytes.length <= 1e6,
    "Request size outside bounds"
  );
  const request = object(
    JSON.parse(requestBytes.toString("utf8")),
    "InterAI request"
  );
  assert(
    request.use_case === "agent-before-tool-execution" && request.domain === "interai-priorseal-track1" && Object.keys(request).sort().join(",") === "action,authorization_ttl_seconds,context,domain,execution_context,external_evidence,policy,use_case",
    "Pilot request envelope mismatch"
  );
  assert(
    equalJson(request.action, action),
    "InterAI request action differs from the exact candidate action"
  );
  assert(
    request.authorization_ttl_seconds === 120,
    "Authorization TTL must be the agreed 120 seconds"
  );
  const context = object(
    request.execution_context,
    "InterAI execution_context"
  );
  assert(
    context.schema === "interai-host-execution-context/v1" && context.environment === "base-sepolia-testnet" && context.run_id === packageId && context.workspace_id === "interai-priorseal-track1" && context.actor_id === "agent:yutao:interai-track1" && Object.keys(context).sort().join(",") === "actor_id,environment,run_id,schema",
    "Host execution context mismatch"
  );
  assert(
    equalJson(request.context, {
      environment: "test",
      user_confirmation: true
    }) && equalJson(request.policy, {
      require_trust_receipt: true,
      require_user_confirmation_for_irreversible: true
    }),
    "Pilot context or policy mismatch"
  );
  assert(
    !Object.hasOwn(request, "payment_signature"),
    "x402 payment path is not permitted"
  );
  const evidence = request.external_evidence;
  assert(
    Array.isArray(evidence) && evidence.length === 2,
    "Exactly two pilot external-evidence items are required"
  );
  for (const [label, assertion, index] of [
    ["source", source, 0],
    ["destination", destination, 1]
  ]) {
    const item = object(evidence[index], `${label} pilot evidence`);
    const bound = object(item.binding, `${label} pilot binding`);
    assert(
      Object.keys(item).sort().join(",") === "attestation_json,binding,profile,registry_json" && item.profile === "insight.oracle-safety-check.v3.pilot/v1" && typeof item.attestation_json === "string" && equalJson(JSON.parse(item.attestation_json), assertion) && typeof item.registry_json === "string" && equalJson(JSON.parse(item.registry_json), registryKeys) && Object.keys(bound).join(",") === "calldata" && bound.calldata === calldata,
      `${label} pilot evidence wire mismatch`
    );
  }
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(
      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      { timeout: 1e4, retryCount: 0 }
    )
  });
  const [chainId, pendingNonce, allowance, wethBalance, ethBalance] = await Promise.all([
    client.getChainId(),
    client.getTransactionCount({ address: EXECUTOR, blockTag: "pending" }),
    client.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [EXECUTOR, ROUTER]
    }),
    client.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [EXECUTOR]
    }),
    client.getBalance({ address: EXECUTOR })
  ]);
  assert(
    chainId === 84532 && pendingNonce === nonce,
    "Chain ID or pending nonce changed"
  );
  assert(
    allowance === AMOUNT_IN && wethBalance >= AMOUNT_IN && ethBalance > 0n,
    "Exact allowance or executor balance gate failed"
  );
  assert(
    quote.expiresAt * 1e3 - Date.now() >= 15e3,
    "Quote expired during local checks"
  );
  return {
    requestBytes,
    packageId,
    quoteExpiresAt: quote.expiresAt * 1e3
  };
}
function curlConfig(token, requestPath, idempotencyKey, headerPath, proxy, endpoint = ENDPOINT) {
  assert(
    /^[A-Za-z0-9._~-]+$/.test(token),
    "Credential contains unsupported characters"
  );
  assert(/^[A-Za-z0-9._-]+$/.test(idempotencyKey), "Invalid idempotency key");
  for (const file of [requestPath, headerPath])
    assert(
      !file.includes('"') && !file.includes("\\") && !file.includes("\n"),
      "Unsafe transport path"
    );
  assert(
    endpoint === ENDPOINT || process.env.NODE_ENV === "test" && /^http:\/\/127\.0\.0\.1:\d+\/verify$/.test(endpoint),
    "Unpinned InterAI endpoint"
  );
  const config = [
    "silent",
    "show-error",
    'request = "POST"',
    `url = "${endpoint}"`,
    'header = "Content-Type: application/json"',
    `header = "Authorization: Bearer ${token}"`,
    `header = "X-Idempotency-Key: ${idempotencyKey}"`,
    `data-binary = "@${requestPath}"`,
    `dump-header = "${headerPath}"`,
    "max-time = 20",
    "max-filesize = 1048576",
    "retry = 0"
  ];
  if (proxy) config.push(`proxy = "${proxy}"`);
  return `${config.join("\n")}
`;
}
async function runCurl(config) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["--config", "-"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    child.stdout.on("data", (chunk) => {
      outputSize += chunk.length;
      if (outputSize > 11e5) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderr).length < 4096) stderr.push(chunk);
    });
    child.on("error", reject);
    child.on(
      "close",
      (code) => resolve({
        body: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? -1
      })
    );
    child.stdin.end(config);
  });
}
async function main() {
  const opts = options();
  const candidateDir = path.resolve(
    string(opts.get("--candidate-dir"), "--candidate-dir")
  );
  const requestFile = path.resolve(
    string(opts.get("--request-file"), "--request-file")
  );
  const readyFile = path.resolve(
    string(opts.get("--ready-file"), "--ready-file")
  );
  const outputDir = path.resolve(
    string(opts.get("--output-dir"), "--output-dir")
  );
  const { requestBytes, packageId, quoteExpiresAt } = await validateInputs(
    candidateDir,
    requestFile,
    readyFile
  );
  assert(
    !outputDir.startsWith(path.resolve(process.cwd(), ".git") + path.sep),
    "Output cannot be inside Git metadata"
  );
  await mkdir(outputDir, { recursive: true, mode: 448 });
  const requestPath = path.join(outputDir, `${packageId}.request.json`);
  const key = await new Promise((resolve, reject) => {
    const child = spawn(
      "security",
      [
        "find-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        KEYCHAIN_SERVICE,
        "-w"
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on(
      "close",
      (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8").trim()) : reject(new Error("Pilot credential unavailable in macOS Keychain"))
    );
  });
  assert(key.length > 0, "Empty pilot credential in Keychain");
  assert(
    quoteExpiresAt - Date.now() >= 15e3,
    "Quote expired while retrieving the pilot credential"
  );
  const attemptDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../partnerships/interai-collaboration/file/interai-track1-live-attempts"
  );
  await mkdir(attemptDir, { recursive: true, mode: 448 });
  const attemptPath = path.join(
    attemptDir,
    "2026-09-25-single-verify.attempt.json"
  );
  const attempt = await open(
    attemptPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    384
  );
  await attempt.writeFile(
    `${JSON.stringify({
      schema: "interai.track1.single-verify-attempt.v1",
      packageId,
      status: "ATTEMPT_RESERVED",
      reservedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requestSha256: sha256(requestBytes)
    })}
`
  );
  await attempt.close();
  await writeFile(requestPath, requestBytes, { mode: 384, flag: "wx" });
  await writeFile(
    path.join(outputDir, `${packageId}.request.sha256`),
    `${sha256(requestBytes)}  ${path.basename(requestPath)}
`,
    { mode: 384, flag: "wx" }
  );
  const headersPath = path.join(outputDir, `${packageId}.response.headers`);
  assert(
    quoteExpiresAt - Date.now() >= 15e3,
    "Quote aged out immediately before InterAI request"
  );
  const response = await runCurl(
    curlConfig(key, requestPath, packageId, headersPath, opts.get("--proxy"))
  );
  const headers = await readFile(headersPath).catch(() => Buffer.alloc(0));
  if (response.body.includes(key) || response.stderr.includes(key) || headers.includes(key)) {
    await unlink(headersPath).catch(() => void 0);
    throw new Error(
      "InterAI transport echoed the credential; response not persisted"
    );
  }
  const statusCodes = [
    ...headers.toString("utf8").matchAll(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/gm)
  ].map((match) => Number(match[1]));
  const httpStatus = statusCodes.at(-1) ?? null;
  const responsePath = path.join(outputDir, `${packageId}.response.json`);
  await writeFile(responsePath, response.body, { mode: 384, flag: "wx" });
  const result = {
    schema: "interai.track1.verify-result.v1",
    packageId,
    requestSha256: sha256(requestBytes),
    responseSha256: sha256(response.body),
    receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
    transportExitCode: response.exitCode,
    httpStatus,
    disposition: "NO_RUN"
  };
  if (response.exitCode === 0 && httpStatus === 200) {
    try {
      const parsed = object(
        JSON.parse(response.body.toString("utf8")),
        "InterAI response"
      );
      const receipt = object(parsed.trust_receipt, "InterAI trust receipt");
      const authorization = parsed.execution_authorization === null || parsed.execution_authorization === void 0 ? null : object(parsed.execution_authorization, "ExecutionAuthorization");
      result.decisionId = parsed.decision_id;
      result.recommendedAction = parsed.recommended_action;
      result.policyResult = parsed.policy_result;
      result.trustReceiptId = parsed.trust_receipt_id;
      await writeFile(
        path.join(outputDir, `${packageId}.trust-receipt.json`),
        `${JSON.stringify(receipt, null, 2)}
`,
        { mode: 384, flag: "wx" }
      );
      if (authorization)
        await writeFile(
          path.join(outputDir, `${packageId}.execution-authorization.json`),
          `${JSON.stringify(authorization, null, 2)}
`,
          { mode: 384, flag: "wx" }
        );
      if (parsed.recommended_action === "allow" && parsed.policy_result === "allow" && authorization) {
        const intent = object(
          parsed.execution_intent,
          "InterAI execution intent"
        );
        const exactRequest = object(
          JSON.parse(requestBytes.toString("utf8")),
          "exact request"
        );
        const intentDigest = sha256(canonicalJson(intent));
        const hostAttested = object(
          object(intent.authoritative_context, "intent.authoritative_context").host_attested,
          "host-attested context"
        );
        if (parsed.request_contract === "autonomous_execution" && intent.schema === "interai-canonical-execution-intent/v2" && intent.action_authority === "host_attested_canonical" && equalJson(intent.canonical_action, exactRequest.action) && equalJson(hostAttested, exactRequest.execution_context) && parsed.execution_intent_digest === intentDigest && receipt.receipt_id === parsed.trust_receipt_id && authorization.schema === "interai-execution-authorization/v1" && authorization.decision === "allow" && authorization.single_use === true && authorization.decision_id === parsed.decision_id && authorization.execution_intent_digest === intentDigest && Date.parse(string(authorization.expires_at, "authorization expiry")) > Date.now()) {
          result.disposition = "INTERAI_REPORTED_ALLOW_EXACT_INTENT_EVIDENCE_RETAINED_NON_BROADCAST";
        }
      }
    } catch (error) {
      result.parseError = error instanceof Error ? error.message : "Invalid response";
    }
  }
  await writeFile(
    path.join(outputDir, `${packageId}.result.json`),
    `${JSON.stringify(result, null, 2)}
`,
    { mode: 384, flag: "wx" }
  );
  process.stdout.write(
    `${String(result.disposition)}; request SHA-256 ${result.requestSha256}; response SHA-256 ${result.responseSha256}
`
  );
  if (result.disposition === "NO_RUN") process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `NO_RUN: ${error instanceof Error ? error.message : "unknown error"}
`
    );
    process.exitCode = 2;
  });
}
export {
  curlConfig,
  runCurl
};
