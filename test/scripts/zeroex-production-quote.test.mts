import assert from 'node:assert/strict';
import test from 'node:test';
import { runZeroExProductionQuote } from '../../scripts/zeroex-production-quote.mjs';

test('the 0x production quote baseline is production-only and cannot run after activation', async () => {
  let calls = 0;
  const fetcher = (async () => { calls += 1; throw new Error('network must not be called'); }) as typeof fetch;
  await assert.rejects(runZeroExProductionQuote({ environment: { ZEROEX_API_KEY: 'secret' }, fetcher }), /PRIORSEAL_ENVIRONMENT=production/);
  await assert.rejects(runZeroExProductionQuote({ environment: { PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_ZEROEX_ENABLED: 'true', ZEROEX_API_KEY: 'secret' }, fetcher }), /refuses to run while PRIORSEAL_ZEROEX_ENABLED is true/);
  await assert.rejects(runZeroExProductionQuote({ environment: { PRIORSEAL_ENVIRONMENT: 'production', PRIORSEAL_ZEROEX_ENABLED: 'false' }, fetcher }), /ZEROEX_API_KEY is required/);
  assert.equal(calls, 0);
});
