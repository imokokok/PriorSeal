import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const examples = fileURLToPath(new URL('../../examples/', import.meta.url))
const fixture = join(examples, 'web3-agent-kit-base-sepolia-live-v1')

test('the Base Sepolia verifier checks the fixture and rejects malformed evidence', () => {
  const temporary = mkdtempSync(join(examples, '.base-sepolia-verifier-'))
  try {
    for (const name of ['verify.mjs', 'evidence-bundle.json', 'trust-roots.json']) {
      copyFileSync(join(fixture, name), join(temporary, name))
    }
    const verifier = join(temporary, 'verify.mjs')
    const baseline = spawnSync(process.execPath, [verifier], { encoding: 'utf8', cwd: temporary })
    assert.equal(baseline.status, 0, baseline.stderr)
    assert.equal(JSON.parse(baseline.stdout).status, 'PASS')

    const bundlePath = join(temporary, 'evidence-bundle.json')
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
    bundle.network = null
    writeFileSync(bundlePath, JSON.stringify(bundle))
    const malformed = spawnSync(process.execPath, [verifier], { encoding: 'utf8', cwd: temporary })
    assert.equal(malformed.status, 1)
    assert.match(malformed.stderr, /bundle\.network must be an object/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
