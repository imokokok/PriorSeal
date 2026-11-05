// Generated from quality.mts by npm run core:build. Do not edit directly.
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
const runtimeFiles = [];
const sourceFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (["node_modules", "dist", ".git"].includes(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".mjs")) runtimeFiles.push(path);
    else if (/\.(?:mts|ts|tsx)$/.test(path) && !path.endsWith(".d.mts") && !path.endsWith(".reference.mts")) sourceFiles.push(path);
  }
}
function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
async function checkRuntime(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => resolve(code === 0 ? null : `${file}
${output}`));
  });
}
async function checkRuntimeFiles(files) {
  const limit = Math.max(2, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  const failures = [];
  const queue = [...files];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (; ; ) {
      const file = queue.shift();
      if (file === void 0) return;
      const failure = await checkRuntime(file);
      if (failure) failures.push(failure);
    }
  }));
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(failure);
    process.exit(1);
  }
}
for (const directory of ["src", "test", "examples", "scripts", "sdk/src", "sdk/scripts", "web/src"]) walk(directory);
sourceFiles.push("playwright.config.ts", "web/vite.config.ts");
const mode = process.argv[2];
if (mode === "lint") {
  await checkRuntimeFiles(runtimeFiles);
  run("./node_modules/.bin/biome", [
    "lint",
    "--only=lint/correctness/noUnusedImports",
    "--only=lint/correctness/noSelfAssign",
    "--only=lint/suspicious/noDebugger",
    "--error-on-warnings",
    ...sourceFiles
  ]);
  process.exit(0);
}
if (mode === "format") {
  run("git", ["diff", "--check"]);
  process.exit(0);
}
if (mode === "typecheck") {
  run("./node_modules/.bin/tsc", ["-p", "tsconfig.core.json", "--pretty", "false"]);
  run("./node_modules/.bin/tsc", ["-p", "tsconfig.maintenance.json", "--pretty", "false"]);
  run("./node_modules/.bin/tsc", ["-b", "web/tsconfig.json", "--pretty", "false"]);
  process.exit(0);
}
throw new Error("Usage: node scripts/quality.mjs <lint|format|typecheck>");
