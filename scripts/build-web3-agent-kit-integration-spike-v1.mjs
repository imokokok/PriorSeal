#!/usr/bin/env node
// Generated from build-web3-agent-kit-integration-spike-v1.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = join(root, "examples/web3-agent-kit-integration-spike-v1");
await build({
  entryPoints: [join(bundle, "verify.source.mjs")],
  outfile: join(bundle, "verify.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node:*"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "inline"
});
const verifierPath = join(bundle, "verify.mjs");
await writeFile(verifierPath, (await readFile(verifierPath, "utf8")).replace(/[ \t]+$/gm, ""));
const files = {};
for (const relative of [
  "README.md",
  "fixture/baseline.json",
  "fixture/cases.json",
  "fixture/trust-roots.json",
  "verify.mjs"
]) {
  const bytes = await readFile(join(bundle, relative));
  files[relative] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(join(bundle, "fixture/manifest.json"), `${JSON.stringify({
  schema: "wak-insight-priorseal.fixture-manifest.v1",
  version: "v1",
  files
}, null, 2)}
`);
process.stdout.write(`${JSON.stringify({ status: "BUILT", files: Object.keys(files).length })}
`);
