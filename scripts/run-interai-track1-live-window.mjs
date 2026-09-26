// Generated from run-interai-track1-live-window.mts by npm run core:build. Do not edit directly.
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTrack1ReadyWindow } from "./interai-track1-window.mjs";
function assert(value, message) {
  if (!value) throw new Error(message);
}
function args() {
  const values = process.argv.slice(2);
  assert(
    values.length % 2 === 0,
    "Usage: --ready-file FILE --output-root DIR [--insight-root DIR --insight-env-file FILE] [--proxy http://127.0.0.1:7890]"
  );
  const parsed = /* @__PURE__ */ new Map();
  for (let i = 0; i < values.length; i += 2) {
    assert(
      values[i]?.startsWith("--") && values[i + 1] && !parsed.has(values[i]),
      "Invalid or duplicate option"
    );
    parsed.set(values[i], values[i + 1]);
  }
  for (const key of parsed.keys())
    assert(
      [
        "--ready-file",
        "--output-root",
        "--insight-root",
        "--insight-env-file",
        "--proxy"
      ].includes(key),
      `Unsupported option: ${key}`
    );
  for (const key of ["--ready-file", "--output-root"])
    assert(parsed.has(key), `Missing ${key}`);
  for (const key of ["--insight-root", "--insight-env-file"])
    if (parsed.has(key))
      assert(
        path.isAbsolute(parsed.get(key) ?? ""),
        `${key} must be an absolute path`
      );
  if (parsed.has("--proxy"))
    assert(
      parsed.get("--proxy") === "http://127.0.0.1:7890",
      "Only the configured local proxy is permitted"
    );
  return parsed;
}
async function command(label, cwd, commandName, commandArgs, env, logPrefix) {
  process.stdout.write(`Starting ${label}
`);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const stdout = await open(`${logPrefix}.stdout.log`, "wx", 384);
  const stderr = await open(`${logPrefix}.stderr.log`, "wx", 384);
  let exitCode = null;
  let failure = null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(commandName, commandArgs, {
        cwd,
        env,
        stdio: ["ignore", stdout.fd, stderr.fd]
      });
      child.on("error", reject);
      child.on("close", (code) => {
        exitCode = code;
        code === 0 ? resolve() : reject(
          new Error(`${label} failed; NO_RUN; inspect private stage logs`)
        );
      });
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unknown stage failure";
    throw error;
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
    await writeFile(
      `${logPrefix}.result.json`,
      `${JSON.stringify({ label, startedAt, finishedAt: (/* @__PURE__ */ new Date()).toISOString(), exitCode, failure }, null, 2)}
`,
      { mode: 384, flag: "wx" }
    );
  }
}
async function main() {
  process.umask(63);
  const opts = args();
  const readyFile = path.resolve(opts.get("--ready-file") ?? "");
  const outputRoot = path.resolve(opts.get("--output-root") ?? "");
  validateTrack1ReadyWindow(
    JSON.parse(await readFile(readyFile, "utf8"))
  );
  const priorSealRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const documentsRoot = path.resolve(priorSealRoot, "..");
  const insightRoot = opts.get("--insight-root") ?? path.join(documentsRoot, "insight");
  const insightEnvFile = opts.get("--insight-env-file") ?? path.join(insightRoot, ".env.local");
  await access(
    path.join(
      insightRoot,
      "scripts/interai-track1/capture-preflight-gates.mts"
    )
  );
  await access(insightEnvFile);
  for (const script of [
    "generate-interai-track1-executable-candidate.mjs",
    "build-interai-track1-direct-request.mjs",
    "run-interai-track1-direct-preflight.mjs"
  ]) {
    await access(path.join(priorSealRoot, "scripts", script));
  }
  const trustRootDir = path.join(
    documentsRoot,
    "partnerships/interai-collaboration/file/2026-09-24-interai-track1-final-binding-review-candidate-source-record"
  );
  const allowanceRecord = path.join(
    documentsRoot,
    "partnerships/interai-collaboration/file/2026-09-24-interai-track1-allowance-prerequisite-record/allowance-receipt.json"
  );
  const gateDir = path.join(outputRoot, "fresh-insight-gates");
  const candidateDir = path.join(outputRoot, "jit-candidate");
  const archiveDir = path.join(outputRoot, "jit-candidate-source-record");
  const requestFile = path.join(outputRoot, "interai-verify-request.json");
  const verifyDir = path.join(outputRoot, "verify-evidence");
  await mkdir(outputRoot, { recursive: false, mode: 448 });
  await writeFile(
    path.join(outputRoot, "ready-source.json"),
    await readFile(readyFile),
    { mode: 384, flag: "wx" }
  );
  await mkdir(path.join(outputRoot, "stage-logs"), { mode: 448 });
  const stage = (name) => path.join(outputRoot, "stage-logs", name);
  const recheckWindow = async () => validateTrack1ReadyWindow(
    JSON.parse(await readFile(readyFile, "utf8"))
  );
  const env = { ...process.env };
  if (opts.has("--proxy")) env.HTTPS_PROXY = opts.get("--proxy");
  await command(
    "fresh Insight v3 capture",
    insightRoot,
    "node",
    [
      `--env-file=${insightEnvFile}`,
      "--import",
      "tsx",
      "scripts/interai-track1/capture-preflight-gates.mts",
      "--output",
      gateDir,
      "--trust-root-dir",
      trustRootDir,
      "--profile",
      "interai"
    ],
    env,
    stage("01-insight-capture")
  );
  await recheckWindow();
  await command(
    "JIT Base Sepolia candidate",
    priorSealRoot,
    "node",
    [
      "scripts/generate-interai-track1-executable-candidate.mjs",
      "--gate-dir",
      gateDir,
      "--allowance-record",
      allowanceRecord,
      "--output",
      candidateDir,
      "--archive",
      archiveDir,
      "--mode",
      "live"
    ],
    env,
    stage("02-jit-candidate")
  );
  await recheckWindow();
  await command(
    "InterAI request binding",
    priorSealRoot,
    "node",
    [
      "scripts/build-interai-track1-direct-request.mjs",
      "--candidate-dir",
      candidateDir,
      "--output",
      requestFile
    ],
    env,
    stage("03-request-binding")
  );
  await recheckWindow();
  const verifyArgs = [
    "scripts/run-interai-track1-direct-preflight.mjs",
    "--candidate-dir",
    candidateDir,
    "--request-file",
    requestFile,
    "--ready-file",
    readyFile,
    "--output-dir",
    verifyDir
  ];
  if (opts.has("--proxy"))
    verifyArgs.push("--proxy", opts.get("--proxy") ?? "");
  await command(
    "single direct authenticated InterAI /verify",
    priorSealRoot,
    "node",
    verifyArgs,
    env,
    stage("04-interai-verify")
  );
  process.stdout.write(
    `Non-broadcast preflight evidence retained under ${outputRoot}
`
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(
      `NO_RUN: ${error instanceof Error ? error.message : "unknown error"}
`
    );
    process.exitCode = 2;
  });
export {
  command
};
