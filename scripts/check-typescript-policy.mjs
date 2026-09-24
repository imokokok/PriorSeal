// Generated from check-typescript-policy.mts by npm run core:build. Do not edit directly.
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const errors = [];
const reviewedJavaScriptTools = /* @__PURE__ */ new Set();
const reviewedCompatibilityLaunchers = /* @__PURE__ */ new Set([
  "scripts/package-web3-agent-kit-integration-spike-v1.py"
]);
const reviewedPortableJavaScript = /* @__PURE__ */ new Set([
  "examples/402signal-eip3009-settlement-binding-v1/vendor/route-guard-v0.7.3.mjs",
  "examples/402signal-eip3009-settlement-binding-v1/verify.mjs",
  "examples/boundaryattest-paired-v0.2/jcs.mjs",
  "examples/boundaryattest-paired-v0.2/verify.mjs",
  "examples/insight-boundaryattest-three-object-v0.2/verify.mjs",
  "examples/thoughtproof-sentinel-paired-v1/verify.mjs",
  "examples/thoughtproof-sentinel-paired-v2/verify.mjs",
  "examples/thoughtproof-sentinel-paired-v2-final/verify.mjs",
  "examples/web3-agent-kit-base-swap-v1/verify.mjs",
  "examples/web3-agent-kit-integration-spike-v1/verify.mjs",
  "examples/web3-agent-kit-integration-spike-v1/verify.source.mjs",
  "examples/web3-agent-kit-integration-spike-v1.0.1/verify.mjs"
]);
const reviewedLegacyJavaScriptTests = /* @__PURE__ */ new Set();
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ["node_modules", "dist", ".git"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function label(path) {
  return relative(projectRoot, path).split(sep).join("/");
}
for (const directory of ["sdk/src", "web/src"]) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|mjs|cjs)$/.test(path)) errors.push(`${label(path)}: production source must be TypeScript`);
  }
}
for (const path of files(join(projectRoot, "src"))) {
  if (!path.endsWith(".mjs")) continue;
  const source = path === join(projectRoot, "src", "domain", "rfc3161.mjs") ? path.replace(/rfc3161\.mjs$/, "rfc3161-source.mts") : path.replace(/\.mjs$/, ".mts");
  if (!existsSync(source)) errors.push(`${label(path)}: runtime JavaScript has no TypeScript source`);
}
for (const directory of ["scripts", "sdk/scripts"]) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|cjs)$/.test(path)) errors.push(`${label(path)}: new maintenance code must use .mts`);
    if (path.endsWith(".py") && !reviewedCompatibilityLaunchers.has(label(path))) {
      errors.push(`${label(path)}: new maintenance code must use .mts`);
    }
    if (!path.endsWith(".mjs")) continue;
    const source = path.replace(/\.mjs$/, ".mts");
    if (!existsSync(source) && !reviewedJavaScriptTools.has(label(path))) {
      errors.push(`${label(path)}: new operational scripts must use a checked TypeScript source`);
    }
  }
}
for (const [directory, reviewed, description] of [
  ["examples", reviewedPortableJavaScript, "portable example"],
  ["test", reviewedLegacyJavaScriptTests, "legacy test"]
]) {
  for (const path of files(join(projectRoot, directory))) {
    if (/\.(?:js|jsx|cjs)$/.test(path)) errors.push(`${label(path)}: new ${description} code must use TypeScript`);
    if (!path.endsWith(".mjs") || existsSync(path.replace(/\.mjs$/, ".mts"))) continue;
    if (!reviewed.has(label(path))) errors.push(`${label(path)}: JavaScript ${description} is not a reviewed exception`);
  }
}
for (const [reviewed, description] of [
  [reviewedJavaScriptTools, "tool"],
  [reviewedCompatibilityLaunchers, "compatibility launcher"],
  [reviewedPortableJavaScript, "portable example"],
  [reviewedLegacyJavaScriptTests, "legacy test"]
]) {
  for (const exception of reviewed) {
    const path = join(projectRoot, exception);
    if (!existsSync(path)) errors.push(`${exception}: reviewed ${description} exception no longer exists`);
    else if (path.endsWith(".mjs") && existsSync(path.replace(/\.mjs$/, ".mts"))) {
      errors.push(`${exception}: remove stale JavaScript ${description} exception after TypeScript migration`);
    }
  }
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
}
