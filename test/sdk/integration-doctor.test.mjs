import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationDoctor } from '../../scripts/integration-doctor.mjs';

test('default doctor never sends credentials or requests a paid assessment', async () => {
  const calls = [];
  const result = await integrationDoctor({ apiKey: 'private-fixture', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('capabilities')) return Response.json({ audience: 'fixture' });
    const status = url.includes('ready') ? 'ready' : 'ok';
    return Response.json(url.includes('oracleinsight') ? { data: { status } } : { status });
  } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => Object.keys(call.options.headers).length === 0));
  assert.ok(!JSON.stringify(result).includes('private-fixture'));
});

test('independent public health checks run concurrently while results retain their documented order', async () => {
  let active = 0;
  let maxActive = 0;
  const result = await integrationDoctor({ fetcher: async url => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, url.includes('capabilities') ? 5 : 20));
    active--;
    if (url.includes('capabilities')) return Response.json({ audience: 'fixture' });
    const status = url.includes('ready') ? 'ready' : 'ok';
    return Response.json(url.includes('oracleinsight') ? { data: { status } } : { status });
  } });
  assert.equal(maxActive, 5);
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map(check => check.path), [
    '/api/v1/health', '/api/v1/health/ready', '/health/live', '/health/ready', '/v1/capabilities',
  ]);
});

test('explicit insufficient-freshness probe reports a failed readiness check, not a market-risk verdict', async () => {
  const result = await integrationDoctor({ offer: 'insight', probe: true, apiKey: 'private-fixture', fetcher: async url => {
    if (url.includes('coverage')) return Response.json({ data: { diagnostic: { freshnessStatus: 'INSUFFICIENT_FRESH_EVIDENCE', providers: [] } } });
    return Response.json({ data: { status: url.includes('ready') ? 'ready' : 'ok' } });
  } });
  assert.equal(result.ok, false);
  assert.equal(result.checks[2].diagnostic.freshnessStatus, 'INSUFFICIENT_FRESH_EVIDENCE');
  await assert.rejects(integrationDoctor({ samples: 99 }), /samples/);
  await assert.rejects(integrationDoctor({ offer: 'insight', insightUrl: 'http://remote.invalid' }), /HTTPS/);
});
