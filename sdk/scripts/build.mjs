// Generated from build.mts by npm run core:build. Do not edit directly.
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(sdkRoot, "..");
execFileSync("tsc", ["-p", resolve(sdkRoot, "tsconfig.json")], { cwd: sdkRoot, stdio: "inherit" });
rmSync(resolve(sdkRoot, "dist/verifier-chunks"), { force: true, recursive: true });
await build({
  entryPoints: [resolve(sdkRoot, "src/verifier.ts")],
  outdir: resolve(sdkRoot, "dist"),
  splitting: true,
  chunkNames: "verifier-chunks/[name]-[hash]",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  sourcesContent: false,
  minify: true,
  legalComments: "eof",
  treeShaking: true
});
for (const extension of ["js", "js.map"]) {
  rmSync(resolve(sdkRoot, `dist/verifier-core.${extension}`), { force: true });
}
copyFileSync(resolve(sdkRoot, "src/defi-runtime.d.ts"), resolve(sdkRoot, "dist/defi-runtime.d.ts"));
await build({
  entryPoints: [resolve(repoRoot, "src/defi-sdk.mts")],
  outfile: resolve(sdkRoot, "dist/defi-runtime.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["priorseal-sdk", "viem", "asn1js", "pkijs"],
  sourcemap: true,
  sourcesContent: false,
  legalComments: "eof"
});
