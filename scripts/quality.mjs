// Generated from quality.mts by npm run core:build. Do not edit directly.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
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
for (const directory of ["src", "test", "examples", "scripts", "sdk/src", "sdk/scripts", "web/src"]) walk(directory);
sourceFiles.push("playwright.config.ts", "web/vite.config.ts");
const mode = process.argv[2];
if (mode === "lint") {
  for (const file of runtimeFiles) run(process.execPath, ["--check", file]);
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
