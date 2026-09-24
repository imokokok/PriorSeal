import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationDoctor } from '../../scripts/integration-doctor.mjs';

type FetchInput = Parameters<typeof fetch>[0];
const requestUrl = (input: FetchInput) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

test('default doctor never sends credentials or requests a paid assessment', async () => {
  const calls: Array<{ url: string; options: Parameters<typeof fetch>[1] }> = [];
  const result = await integrationDoctor({ apiKey: 'private-fixture', fetcher: async (input, options) => {
    const url = requestUrl(input);
    calls.push({ url, options });
    if (url.includes('capabilities')) return Response.json({ audience: 'fixture' });
    const status = url.includes('ready') ? 'ready' : 'ok';
    return Response.json(url.includes('oracleinsight') ? { data: { status } } : { status });
  } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => Object.keys(call.options?.headers ?? {}).length === 0));
  assert.ok(!JSON.stringify(result).includes('private-fixture'));
});

test('independent public health checks run concurrently while results retain their documented order', async () => {
  let active = 0;
  let maxActive = 0;
  const result = await integrationDoctor({ fetcher: async input => {
    const url = requestUrl(input);
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
  const result = await integrationDoctor({ offer: 'insight', probe: true, apiKey: 'private-fixture', fetcher: async input => {
    const url = requestUrl(input);
    if (url.includes('coverage')) return Response.json({ data: { diagnostic: { freshnessStatus: 'INSUFFICIENT_FRESH_EVIDENCE', providers: [] } } });
    return Response.json({ data: { status: url.includes('ready') ? 'ready' : 'ok' } });
  } });
  assert.equal(result.ok, false);
  assert.equal(result.checks[2]?.diagnostic?.freshnessStatus, 'INSUFFICIENT_FRESH_EVIDENCE');
  await assert.rejects(integrationDoctor({ samples: 99 }), /samples/);
  await assert.rejects(integrationDoctor({ offer: 'insight', insightUrl: 'http://remote.invalid' }), /HTTPS/);
});

test('malformed remote JSON cannot pass health or paid coverage checks', async () => {
  const health = await integrationDoctor({ offer: 'insight', fetcher: async () => Response.json([]) });
  assert.equal(health.ok, false);
  assert.deepEqual(health.checks.map(check => check.ok), [false, false]);

  const coverage = await integrationDoctor({ offer: 'insight', probe: true, apiKey: 'private-fixture', fetcher: async input => {
    const url = requestUrl(input);
    if (url.includes('coverage')) return Response.json({ data: { diagnostic: { freshnessStatus: 'SUFFICIENT', providers: [null] } } });
    return Response.json({ data: { status: url.includes('ready') ? 'ready' : 'ok' } });
  } });
  assert.equal(coverage.ok, false);
  assert.equal(coverage.checks[2]?.ok, false);
});
