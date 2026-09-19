import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

execFileSync('tsc', ['-p', resolve(sdkRoot, 'tsconfig.json')], { cwd: sdkRoot, stdio: 'inherit' })
rmSync(resolve(sdkRoot, 'dist/verifier-chunks'), { force: true, recursive: true })

await build({
  entryPoints: [resolve(sdkRoot, 'src/verifier.ts')],
  outdir: resolve(sdkRoot, 'dist'),
  splitting: true,
  chunkNames: 'verifier-chunks/[name]-[hash]',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  sourcesContent: false,
  minify: true,
  legalComments: 'eof',
  treeShaking: true,
})

// Keep declarations used by the public signing-data export; runtime code is bundled.
for (const extension of ['js', 'js.map']) {
  rmSync(resolve(sdkRoot, `dist/verifier-core.${extension}`), { force: true })
}
