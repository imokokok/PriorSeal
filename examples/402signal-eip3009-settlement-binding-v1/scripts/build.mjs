import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

await build({
  entryPoints: [resolve(root, 'src', 'verify-source.mjs')],
  outfile: resolve(root, 'verify.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'eof',
  banner: {
    js: '// Standalone offline verifier. Includes 402Signal route-guard v0.7.3 from commit ca6e2f1ee806bec6621487338ba6ed3f1ac09352 and bundled viem dependencies.',
  },
})

const includedRoots = ['README.md', 'TEST-RECORD.md', 'THIRD_PARTY_NOTICES.md', 'verify.mjs', 'fixture', 'vendor']
const files = []
const visit = (path) => {
  const stats = statSync(path)
  if (stats.isDirectory()) {
    for (const child of readdirSync(path).sort()) visit(resolve(path, child))
    return
  }
  if (path.endsWith('MANIFEST.json')) return
  const bytes = readFileSync(path)
  files.push({
    path: relative(root, path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
for (const entry of includedRoots) visit(resolve(root, entry))

writeFileSync(resolve(root, 'MANIFEST.json'), `${JSON.stringify({
  schema: 'priorseal.offline-fixture-manifest.v1',
  profile: 'priorseal.execution-profile.eip3009-settlement-binding.v1',
  nonproduction: true,
  exactRunCommand: 'node verify.mjs',
  files,
}, null, 2)}\n`)

console.log(`Built standalone verifier and manifest with ${files.length} hashed files.`)
