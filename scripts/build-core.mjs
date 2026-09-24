// Generated from build-core.mts by npm run core:build. Do not edit directly.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
const check = process.argv[2] === "--check";
if (!check && process.argv.length !== 2) throw new Error("Usage: node scripts/build-core.mjs [--check]");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(projectRoot, "src");
const frozenExamples = /* @__PURE__ */ new Map([
  ["examples/boundaryattest-paired-v0.2/jcs.reference.mts", { source: "83136eddf8e3b9da6e13c6db0a4b474c1dc1fa5f9d40ca4103b804a93bab9daf", runtime: "4760729fce5f5d7ddabb6b5e1f2c6818abe4e9fa5b48cfcecc18fa57433262cd" }],
  ["examples/boundaryattest-paired-v0.2/verify.reference.mts", { source: "e4cbf5679ec07fb1c26099aaf9d1b0e10dcc51a7ab4b9d6123437eb52834cfac", runtime: "2325c0e4e50f2ab91431d095b817d4a68fd6022a9a0a1a19609a00f93d1b67f4" }],
  ["examples/insight-boundaryattest-three-object-v0.2/verify.reference.mts", { source: "1a80403168985ab304324cd5880af9a23f4dd8b06ff4a76f6a4bde3f1f0e6003", runtime: "910c319837899d8646cd339c3f529e424568b518fad75af3863b55f8b5cf16aa" }],
  ["examples/thoughtproof-sentinel-paired-v1/verify.reference.mts", { source: "1788dde81c7ba7a5f200184fa55f5399032590b02d80c61974af75db791b28c2", runtime: "074ff61b3127da51eb59c67fdb6bf0d02730ffcdc4eef4d4ad9864f192334c12" }],
  ["examples/thoughtproof-sentinel-paired-v2/verify.reference.mts", { source: "1a9f8ade24910c1d00df31347b187a99319c29fa1b1274cb905b110b99dbefa0", runtime: "749921c3436a498cf931071ff650d19e8f08470206ebf7a156fbc3a400693e20" }],
  ["examples/thoughtproof-sentinel-paired-v2-final/verify.reference.mts", { source: "1e356401e926331e5a35324f008d0fb75778f25900f25c294d38a07a15bccf30", runtime: "57265552ea729bea37d5c6ce2c979e2455316c2dcb5e947620a80e504c7574bb" }],
  ["examples/web3-agent-kit-base-swap-v1/verify.reference.mts", { source: "272d76a707b9208ae4ad5c98a1cc3c9ad6977d6a0ee7393bf0b75eca15cdbe60", runtime: "906113559b1f471dc499f205ad6c3c42351114b45e980effac48ba19a6f8e408" }],
  ["examples/web3-agent-kit-integration-spike-v1/verify.source.reference.mts", { source: "f2f808245a9ccf33307ae7423a2532753513a3d37be467db82aafc37bd1f8d1e", runtime: "ff4cb1f14603c46bef693c5137e38dbff5917c167c6ef4498f4f34471c886c18" }]
]);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function findSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findSources(path);
    return entry.isFile() && entry.name.endsWith(".mts") && !entry.name.endsWith(".d.mts") ? [path] : [];
  });
}
const sources = [
  ...findSources(sourceRoot),
  ...findSources(join(projectRoot, "scripts")),
  ...findSources(join(projectRoot, "sdk", "scripts")),
  ...findSources(join(projectRoot, "examples")),
  ...findSources(join(projectRoot, "test"))
].sort();
if (sources.length === 0) throw new Error("No TypeScript runtime sources found");
for (const source of frozenExamples.keys()) {
  if (!existsSync(join(projectRoot, source))) throw new Error(`Frozen TypeScript reference is missing: ${source}`);
}
function runtimePath(sourcePath) {
  if (sourcePath === join(sourceRoot, "domain", "rfc3161-source.mts")) return join(sourceRoot, "domain", "rfc3161.mjs");
  if (sourcePath.endsWith(".reference.mts")) return sourcePath.replace(/\.reference\.mts$/, ".mjs");
  return sourcePath.replace(/\.mts$/, ".mjs");
}
for (const sourcePath of sources) {
  const outputPath = runtimePath(sourcePath);
  const outputLabel = relative(projectRoot, outputPath).split(sep).join("/");
  const sourceLabel = relative(projectRoot, sourcePath).split(sep).join("/");
  const frozen = frozenExamples.get(sourceLabel);
  if (sourcePath.endsWith(".reference.mts") && !frozen) throw new Error(`Unregistered frozen TypeScript reference: ${sourceLabel}`);
  if (frozen) {
    if (!existsSync(outputPath) || sha256(sourcePath) !== frozen.source || sha256(outputPath) !== frozen.runtime) {
      console.error(`${outputLabel} or its TypeScript reference changed; publish a new fixture version`);
      process.exitCode = 1;
    }
    continue;
  }
  const name = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1, -4);
  const source = readFileSync(sourcePath, "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "esm", target: "es2022" }).code;
  const notice = `// Generated from ${name}.mts by npm run core:build. Do not edit directly.
`;
  const shebangEnd = compiled.startsWith("#!") ? compiled.indexOf("\n") + 1 : 0;
  const output = shebangEnd > 0 ? `${compiled.slice(0, shebangEnd)}${notice}${compiled.slice(shebangEnd)}` : `${notice}${compiled}`;
  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== output) {
      console.error(`${outputLabel} is missing or stale; run npm run core:build`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(outputPath, output);
  }
}
if (check) {
  let findRuntimeFiles = function(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findRuntimeFiles(path);
      return entry.isFile() && entry.name.endsWith(".mjs") ? [path] : [];
    });
  };
  const outputs = new Set(sources.map(runtimePath));
  for (const outputPath of findRuntimeFiles(sourceRoot)) {
    if (!outputs.has(outputPath)) {
      console.error(`src/${relative(sourceRoot, outputPath).split(sep).join("/")} has no TypeScript source`);
      process.exitCode = 1;
    }
  }
}
