import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const verifier = new URL(
  '../../examples/402signal-eip3009-settlement-binding-v1/verify.mjs',
  import.meta.url,
)

test('402Signal EIP-3009 portable fixture passes every vector', async () => {
  const { stdout, stderr } = await run(process.execPath, [verifier.pathname])
  assert.equal(stderr, '')
  assert.match(stdout, /PASS signed-recipient-mismatch .*PAYMENT_RECIPIENT_MISMATCH/)
  assert.match(stdout, /PASS signed-amount-mismatch .*PAYMENT_AMOUNT_MISMATCH/)
  assert.match(stdout, /PASS expired-route-valid-payment .*ROUTE_EVIDENCE_EXPIRED/)
  assert.match(stdout, /PASS timeout-reconciliation .*replacement=BLOCKED/)
  assert.match(stdout, /PASS reorg-reconciliation .*replacement=BLOCKED/)
  assert.match(stdout, /SUMMARY 9\/9 PASS\n$/)
})
