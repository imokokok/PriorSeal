import assert from 'node:assert/strict'
import test from 'node:test'
import { createInsightFetcher } from '../src/insight-fetch.ts'

test('Insight API and key registry requests use the private Worker service binding', async () => {
  const calls: string[] = []
  const fetcher = createInsightFetcher({
    async fetch(input) {
      calls.push(input instanceof Request ? input.url : String(input))
      return new Response('from insight worker')
    },
  }, async () => {
    throw new Error('public fetch should not be used for Insight')
  })

  const response = await fetcher('https://www.oracleinsight.xyz/api/telegram/account')

  assert.equal(await response.text(), 'from insight worker')
  assert.deepEqual(calls, ['https://www.oracleinsight.xyz/api/telegram/account'])
})

test('non-Insight requests keep using the ordinary fetch implementation', async () => {
  let fallbackCalls = 0
  const fetcher = createInsightFetcher({
    async fetch() {
      throw new Error('service binding should only receive Insight requests')
    },
  }, async () => {
    fallbackCalls += 1
    return new Response('external service')
  })

  const response = await fetcher('https://api.telegram.org/bot/example/sendMessage')

  assert.equal(await response.text(), 'external service')
  assert.equal(fallbackCalls, 1)
})
