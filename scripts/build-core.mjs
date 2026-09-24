// Generated from build-core.mts by npm run core:build. Do not edit directly.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
const check = process.argv[2] === "--check";
if (!check && process.argv.length !== 2) throw new Error("Usage: node scripts/build-core.mjs [--check]");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(projectRoot, "src");
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
function runtimePath(sourcePath) {
  if (sourcePath === join(sourceRoot, "domain", "rfc3161-source.mts")) return join(sourceRoot, "domain", "rfc3161.mjs");
  return sourcePath.replace(/\.mts$/, ".mjs");
}
for (const sourcePath of sources) {
  const outputPath = runtimePath(sourcePath);
  const outputLabel = relative(projectRoot, outputPath).split(sep).join("/");
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
