import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const check = process.argv[2] === '--check'
if (!check && process.argv.length !== 2) throw new Error('Usage: node scripts/build.mjs [--check]')
const verifierPath = resolve(root, 'verify.mjs')
const manifestPath = resolve(root, 'MANIFEST.json')

const built = await build({
  entryPoints: [resolve(root, 'src', 'verify-source.mjs')],
  outfile: verifierPath,
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'eof',
  banner: {
    js: '// Standalone offline verifier. Includes 402Signal route-guard v0.7.3 from commit ca6e2f1ee806bec6621487338ba6ed3f1ac09352 and bundled viem dependencies.',
  },
})
const output = built.outputFiles?.find((file) => file.path === verifierPath)
if (!output) throw new Error('Standalone verifier was not produced')
const verifier = Buffer.from(output.contents)

const includedRoots = ['README.md', 'TEST-RECORD.md', 'THIRD_PARTY_NOTICES.md', 'verify.mjs', 'fixture', 'vendor']
type ManifestFile = { path: string; bytes: number; sha256: string }
const files: ManifestFile[] = []
const visit = (path: string) => {
  if (path.endsWith('MANIFEST.json')) return
  const stats = path === verifierPath ? null : statSync(path)
  if (stats?.isDirectory()) {
    for (const child of readdirSync(path).sort()) visit(resolve(path, child))
    return
  }
  const bytes = path === verifierPath ? verifier : readFileSync(path)
  files.push({
    path: relative(root, path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
for (const entry of includedRoots) visit(resolve(root, entry))

const manifest = `${JSON.stringify({
  schema: 'priorseal.offline-fixture-manifest.v1',
  profile: 'priorseal.execution-profile.eip3009-settlement-binding.v1',
  nonproduction: true,
  exactRunCommand: 'node verify.mjs',
  files,
}, null, 2)}\n`

if (check) {
  if (!existsSync(verifierPath) || !readFileSync(verifierPath).equals(verifier)) throw new Error('Standalone verifier is stale; rebuild the 402Signal fixture')
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifest) throw new Error('402Signal fixture manifest is stale; rebuild the fixture')
  console.log(`Checked standalone verifier and manifest with ${files.length} hashed files.`)
} else {
  writeFileSync(verifierPath, verifier)
  writeFileSync(manifestPath, manifest)
  console.log(`Built standalone verifier and manifest with ${files.length} hashed files.`)
}
