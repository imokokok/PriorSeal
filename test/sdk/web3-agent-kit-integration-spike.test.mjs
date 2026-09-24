// Generated from web3-agent-kit-integration-spike.test.mts by npm run core:build. Do not edit directly.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runVerification } from "../../examples/web3-agent-kit-integration-spike-v1/verify.source.reference.mjs";
const bundle = fileURLToPath(new URL("../../examples/web3-agent-kit-integration-spike-v1/", import.meta.url));
const maintenanceBundle = fileURLToPath(new URL("../../examples/web3-agent-kit-integration-spike-v1.0.1/", import.meta.url));
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
test("the TypeScript-backed v1 verifier checks the frozen fixture", async () => {
  const result = await runVerification();
  assert.equal(result.status, "PASS");
  if (result.status !== "PASS") return;
  assert.deepEqual(result.caseIds, ["N1", "N2", "N3", "N4", "N5a", "N5b", "P1"]);
});
test("the extracted spike bundle verifies without a repository checkout and rejects changed bytes", () => {
  const temporary = mkdtempSync(join(tmpdir(), "wak-spike-v1-"));
  try {
    mkdirSync(join(temporary, "fixture"));
    for (const relative of ["README.md", "verify.mjs", "fixture/baseline.json", "fixture/cases.json", "fixture/trust-roots.json", "fixture/manifest.json"]) {
      cpSync(join(bundle, relative), join(temporary, relative));
    }
    const verifier = join(temporary, "verify.mjs");
    const verified = JSON.parse(execFileSync(process.execPath, [verifier], { encoding: "utf8", cwd: temporary, env: childEnv }));
    assert.equal(verified.status, "PASS");
    assert.equal(verified.wakAcceptance, "NOT_RUN");
    assert.equal(verified.adapterNewFieldTypes, 0);
    assert.deepEqual(verified.caseIds, ["N1", "N2", "N3", "N4", "N5a", "N5b", "P1"]);
    const baseline = join(temporary, "fixture/baseline.json");
    const input = JSON.parse(readFileSync(baseline, "utf8"));
    const report = join(temporary, "wak-report.json");
    writeFileSync(report, JSON.stringify({
      schema: "wak-insight-priorseal.acceptance-report.v1",
      fixtureVersion: "v1",
      envelopeDigest: input.wak.callEnvelope.digest,
      policyCommitmentDigest: input.wak.policyDecisionCommitment.digest,
      instrumentation: { explicitSignerProtocol: false, explicitBroadcastFn: true }
    }));
    const uninstrumented = spawnSync(process.execPath, [verifier, "--report", report], { encoding: "utf8", cwd: temporary, env: childEnv });
    assert.equal(uninstrumented.status, 1);
    assert.equal(JSON.parse(uninstrumented.stdout).code, "REPORT_INSTRUMENTATION_MISSING");
    writeFileSync(baseline, `${readFileSync(baseline, "utf8")} `);
    const altered = spawnSync(process.execPath, [verifier], { encoding: "utf8", cwd: temporary, env: childEnv });
    assert.equal(altered.status, 1);
    assert.equal(JSON.parse(altered.stdout).code, "FILE_HASH_MISMATCH");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
test("the v1.0.1 maintenance bundle closes the stale Base Sepolia compatibility note", () => {
  const verified = JSON.parse(execFileSync(process.execPath, [join(maintenanceBundle, "verify.mjs")], {
    encoding: "utf8",
    cwd: maintenanceBundle,
    env: childEnv
  }));
  assert.equal(verified.status, "PASS");
  assert.equal(verified.fixtureBundleVersion, "v1.0.1");
  assert.equal(verified.reportContractVersion, "v1");
  assert.equal(verified.wakAcceptance, "NOT_RUN");
  assert.match(verified.compatibilityNote, /Chain\.BASE_SEPOLIA with chain ID 84532/);
  assert.doesNotMatch(verified.compatibilityNote, /lacks Base Sepolia/i);
});
