// Generated from build-interai-track1-direct-request.mts by npm run core:build. Do not edit directly.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  assert(
    args.length === 6,
    "Usage: --candidate-dir DIR --pilot-template FILE --output FILE"
  );
  const opts = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i += 2) {
    assert(
      args[i]?.startsWith("--") && !opts.has(args[i]),
      "Invalid or duplicate option"
    );
    opts.set(args[i], args[i + 1]);
  }
  assert(
    opts.has("--candidate-dir") && opts.has("--pilot-template") && opts.has("--output") && opts.size === 3,
    "Missing or unsupported option"
  );
  return opts;
}
function substitute(value, replacements) {
  if (Array.isArray(value))
    return value.map((item) => substitute(item, replacements));
  if (value && typeof value === "object") {
    const item = value;
    if (Object.keys(item).length === 1 && typeof item.$track1 === "string") {
      assert(
        replacements.has(item.$track1),
        `Unknown pilot template placeholder: ${item.$track1}`
      );
      return replacements.get(item.$track1);
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [
        key,
        substitute(child, replacements)
      ])
    );
  }
  return value;
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
    typeof packageId === "string" && /^interai-track1-base-sepolia-\d+$/.test(packageId),
    "Invalid package ID"
  );
  const action = object(candidate.canonicalAction, "candidate action");
  assert(
    action.schema === "interai-canonical-action/v1",
    "Invalid canonical action"
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
  const auditProof = await json(
    path.join(directory, "audit-persistence-proof.json")
  );
  const replacements = /* @__PURE__ */ new Map([
    ["sourceAssertion", source],
    ["destinationAssertion", destination],
    ["sourceBinding", sourceBinding],
    ["destinationBinding", destinationBinding],
    ["canonicalAction", action],
    ["sixFieldProjection", candidate.interaiSixFieldProjection],
    ["registryCurrent", registryCurrent],
    ["registryRelease", registryRelease],
    ["auditPersistenceProof", auditProof]
  ]);
  const template = await json(path.resolve(opts.get("--pilot-template") ?? ""));
  assert(
    template.schema === "interai.track1.pilot-evidence-template.v1",
    "Unapproved pilot template schema"
  );
  assert(
    typeof template.use_case === "string" && template.use_case.length > 0,
    "Pilot template use_case missing"
  );
  assert(
    typeof template.workspace_id === "string" && template.workspace_id.length > 0,
    "Pilot workspace_id missing"
  );
  assert(
    typeof template.actor_id === "string" && template.actor_id.length > 0,
    "Pilot actor_id missing"
  );
  const externalEvidence = substitute(template.external_evidence, replacements);
  assert(
    Array.isArray(externalEvidence) && externalEvidence.length === 2,
    "Pilot template must produce exactly two external evidence items"
  );
  for (const [label, assertion, index] of [
    ["source", source, 0],
    ["destination", destination, 1]
  ]) {
    const item = JSON.stringify(externalEvidence[index]);
    assert(
      typeof assertion.uid === "string" && typeof assertion.signature === "string" && item.includes(assertion.uid) && item.includes(assertion.signature),
      `${label} UID or signature missing from evidence template output`
    );
  }
  const request = {
    use_case: template.use_case,
    action,
    execution_context: {
      schema: "interai-host-execution-context/v1",
      workspace_id: template.workspace_id,
      environment: "testnet",
      actor_id: template.actor_id,
      run_id: packageId
    },
    authorization_ttl_seconds: 120,
    context: { environment: "testnet" },
    policy: { require_trust_receipt: true },
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
