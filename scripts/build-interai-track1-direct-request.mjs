// Generated from build-interai-track1-direct-request.mts by npm run core:build. Do not edit directly.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { keccak256 } from "viem";
const RELEASE_ID = "0x6e3bd18c541cc80e326754a7743f05050df348257102b93f9a13bc82c7e69f6b";
const SIGNER = "0x6506f789edd43338a416f59822a63f309f97e8ce";
const WETH_ID = "eip155:84532/erc20:0x4200000000000000000000000000000000000006";
const USDC_ID = "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e";
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
async function json(file) {
  return object(JSON.parse(await readFile(file, "utf8")), file);
}
function parseArgs() {
  const args = process.argv.slice(2);
  assert(args.length === 4, "Usage: --candidate-dir DIR --output FILE");
  const opts = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i += 2) {
    assert(
      args[i]?.startsWith("--") && !opts.has(args[i]),
      "Invalid or duplicate option"
    );
    opts.set(args[i], args[i + 1]);
  }
  assert(
    opts.has("--candidate-dir") && opts.has("--output") && opts.size === 2,
    "Missing or unsupported option"
  );
  return opts;
}
async function main() {
  process.umask(63);
  const opts = parseArgs();
  const directory = path.resolve(opts.get("--candidate-dir") ?? "");
  const candidate = await json(
    path.join(directory, "candidate-run-package.json")
  );
  assert(
    candidate.schema === "interai.track1.jit-direct-verify-candidate-package.v1" && candidate.hostPrerequisiteDisposition === "SATISFIED_AT_GENERATION",
    "Candidate is not a satisfied Track 1 JIT package"
  );
  const packageId = candidate.packageId;
  assert(
    typeof packageId === "string" && /^interai-track1-base-sepolia-\d+-[0-9a-f-]{36}$/.test(packageId),
    "Invalid package ID"
  );
  const action = object(candidate.canonicalAction, "candidate action");
  const actionArgs = object(action.arguments, "action.arguments");
  const projection = object(
    candidate.interaiSixFieldProjection,
    "six-field projection"
  );
  assert(
    action.schema === "interai-canonical-action/v1" && action.tool_id === "wallet.send_transaction" && action.type === "evm_call" && action.operation === "eth_sendTransaction" && action.external_side_effect === true && action.irreversible === true && Object.keys(actionArgs).sort().join(",") === "amount_usd,calldataHash,chainId,currency,nonce,sender,target,value" && actionArgs.chainId === 84532 && actionArgs.target?.toString().toLowerCase() === "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4" && actionArgs.value === "0" && actionArgs.amount_usd === 4 && actionArgs.currency === "USD" && typeof actionArgs.sender === "string" && /^0x[0-9a-fA-F]{40}$/.test(actionArgs.sender) && typeof actionArgs.calldataHash === "string" && /^0x[0-9a-f]{64}$/.test(actionArgs.calldataHash) && typeof actionArgs.nonce === "string" && /^(0|[1-9][0-9]*)$/.test(actionArgs.nonce) && projection.chainId === actionArgs.chainId && projection.sender === actionArgs.sender && projection.target === actionArgs.target && projection.value === actionArgs.value && projection.calldataHash === actionArgs.calldataHash && projection.nonce === actionArgs.nonce,
    "Canonical action or exact-call projection mismatch"
  );
  const source = await json(
    path.join(directory, "source-oracle-safety-check-v3.json")
  );
  const destination = await json(
    path.join(directory, "destination-oracle-safety-check-v3.json")
  );
  const sourceBinding = await json(
    path.join(directory, "source-evidence-binding.json")
  );
  const destinationBinding = await json(
    path.join(directory, "destination-evidence-binding.json")
  );
  const registryCurrent = await json(
    path.join(directory, "oracle-registry-current.json")
  );
  assert(
    typeof registryCurrent.releaseId === "string" && /^0x[0-9a-f]{64}$/.test(registryCurrent.releaseId),
    "Invalid pinned registry release ID"
  );
  const registryRelease = await json(
    path.join(
      directory,
      `oracle-registry-release-${registryCurrent.releaseId}.json`
    )
  );
  const registryKeys = await json(path.join(directory, "oracle-keys.json"));
  assert(
    registryCurrent.releaseId === RELEASE_ID && registryRelease.releaseId === RELEASE_ID && object(registryKeys.registryRelease, "key registry release").releaseId === RELEASE_ID && registryKeys.attestation_enabled === true && Array.isArray(registryKeys.public_keys) && registryKeys.public_keys.some(
      (entry) => object(entry, "registry key").public_key?.toString().toLowerCase() === SIGNER && object(entry, "registry key").revoked === false
    ) && object(candidate.trustRoots, "trust roots").registryReleaseId === RELEASE_ID && object(candidate.oracleSafetyCheckV3, "oracle refs").signer?.toString().toLowerCase() === SIGNER,
    "Pinned registry release or signer mismatch"
  );
  const calldata = sourceBinding.exactCalldata;
  assert(
    typeof calldata === "string" && /^0x[0-9a-f]+$/i.test(calldata) && keccak256(calldata) === actionArgs.calldataHash && calldata === destinationBinding.exactCalldata && JSON.stringify(sourceBinding.exactCall) === JSON.stringify(projection) && JSON.stringify(destinationBinding.exactCall) === JSON.stringify(projection),
    "Source/destination calldata binding mismatch"
  );
  const externalEvidence = [
    ["source", source, sourceBinding, WETH_ID, USDC_ID],
    ["destination", destination, destinationBinding, USDC_ID, WETH_ID]
  ].map(([label, assertion, binding, from, to]) => {
    const data = object(assertion.data, `${label}.data`);
    assert(
      assertion.schemaVersion === 3 && assertion.validForSeconds === 600 && assertion.attester?.toString().toLowerCase() === SIGNER && typeof assertion.uid === "string" && typeof assertion.signature === "string" && data.schemaVersion === 3 && data.verdict === "PASS" && data.sourceAssetId?.toString().toLowerCase() === from && data.destinationAssetId?.toString().toLowerCase() === to && data.tradeAmountUsd === 4e6 && binding.role === label && binding.assertionUid === assertion.uid,
      `${label} assertion or binding mismatch`
    );
    return {
      profile: "insight.oracle-safety-check.v3.pilot/v1",
      attestation_json: JSON.stringify(assertion),
      registry_json: JSON.stringify(registryKeys),
      binding: { calldata }
    };
  });
  const request = {
    use_case: "agent-before-tool-execution",
    action,
    execution_context: {
      schema: "interai-host-execution-context/v1",
      workspace_id: "interai-priorseal-track1",
      environment: "base-sepolia-testnet",
      actor_id: "agent:yutao:interai-track1",
      run_id: packageId
    },
    context: { environment: "test", user_confirmation: true },
    policy: {
      require_trust_receipt: true,
      require_user_confirmation_for_irreversible: true
    },
    authorization_ttl_seconds: 120,
    domain: "interai-priorseal-track1",
    external_evidence: externalEvidence
  };
  const output = path.resolve(opts.get("--output") ?? "");
  await writeFile(output, `${JSON.stringify(request)}
`, {
    mode: 384,
    flag: "wx"
  });
  process.stdout.write(
    `Built InterAI request for ${packageId}; no InterAI call made
`
  );
}
main().catch((error) => {
  process.stderr.write(
    `NO_RUN: ${error instanceof Error ? error.message : "unknown error"}
`
  );
  process.exitCode = 2;
});
