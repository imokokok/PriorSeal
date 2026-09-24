import { readFile } from 'node:fs/promises'
import {
  HEADLESS_MARKET_STATE_NAMESPACE,
  verifyHeadlessMarketStateReceiptPair,
} from '../../sdk/dist/index.js'

const fixture = JSON.parse(await readFile(new URL('./vectors.json', import.meta.url), 'utf8'))
const result = await verifyHeadlessMarketStateReceiptPair({
  intent: {
    contextCommitments: [{
      namespace: HEADLESS_MARKET_STATE_NAMESPACE,
      algorithm: 'sha256',
      digest: fixture.authorization_context_commitment,
    }],
  },
  authorityReceipt: fixture.authority_receipt,
  executionReceipt: fixture.execution_receipt,
  key: fixture.issuer_key,
  authorityTime: fixture.authority_time,
  executionTime: fixture.execution_time,
  policy: fixture.policy,
})

console.log(JSON.stringify(result, null, 2))
if (!result.valid) process.exitCode = 1
