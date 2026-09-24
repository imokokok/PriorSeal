// Generated from build-web3-agent-kit-integration-spike-v1.0.1.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = join(root, "examples/web3-agent-kit-integration-spike-v1.0.1");
const verifierPath = join(bundle, "verify.mjs");
const frozenVerifierSha256 = "b36c3fb6e76f92e9b2260767fed672c455b68d5821b1f70d90928621c01fd612";
const frozenManifestSha256 = "20260cb71e288a0910749d4442db8fd9140bb6b22bce702d9425e64ba86f0ca9";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
execFileSync(process.execPath, [join(root, "scripts/build-core.mjs"), "--check"], { stdio: "inherit" });
const built = await build({
  entryPoints: [join(bundle, "verify.source.mjs")],
  outfile: verifierPath,
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node:*"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "inline"
});
const output = built.outputFiles?.find((file) => file.path === verifierPath);
if (!output) throw new Error("Standalone verifier was not produced");
const verifier = output.text.replace(/[ \t]+$/gm, "");
if (sha256(verifier) !== frozenVerifierSha256) throw new Error("Frozen v1.0.1 verifier changed; publish a new version instead");
const files = {};
for (const relative of [
  "README.md",
  "fixture/baseline.json",
  "fixture/cases.json",
  "fixture/trust-roots.json",
  "verify.mjs"
]) {
  const bytes = relative === "verify.mjs" ? Buffer.from(verifier) : await readFile(join(bundle, relative));
  files[relative] = sha256(bytes);
}
const manifest = `${JSON.stringify({
  schema: "wak-insight-priorseal.fixture-manifest.v1",
  version: "v1.0.1",
  reportContractVersion: "v1",
  files
}, null, 2)}
`;
if (sha256(manifest) !== frozenManifestSha256) throw new Error("Frozen v1.0.1 manifest changed; publish a new version instead");
await writeFile(verifierPath, verifier);
await writeFile(join(bundle, "fixture/manifest.json"), manifest);
process.stdout.write(`${JSON.stringify({ status: "BUILT", version: "v1.0.1", files: Object.keys(files).length })}
`);
