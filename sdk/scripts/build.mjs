import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

execFileSync('tsc', ['-p', resolve(sdkRoot, 'tsconfig.json')], { cwd: sdkRoot, stdio: 'inherit' })

await build({
  entryPoints: [resolve(sdkRoot, 'src/verifier.ts')],
  outfile: resolve(sdkRoot, 'dist/verifier.js'),
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

for (const extension of ['js', 'js.map', 'd.ts', 'd.ts.map']) {
  rmSync(resolve(sdkRoot, `dist/verifier-core.${extension}`), { force: true })
}
