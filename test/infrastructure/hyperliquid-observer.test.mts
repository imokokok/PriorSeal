import test from 'node:test';
import assert from 'node:assert/strict';
import { observeHyperliquidSpotIoc } from '../../src/infrastructure/blockchain/hyperliquid/observer.mjs';

const account = `0x${'a'.repeat(40)}`;
const cloid = `0x${'b'.repeat(32)}`;
const order = { assetId: 10001, isBuy: true, limitPrice: '100', size: '2', timeInForce: 'Ioc' as const, clientOrderId: cloid, expiresAfter: 1_700_000_060_000 };
const nonce = '1700000000000';
const status = { status: 'filled', order: { status: 'filled', statusTimestamp: 1_700_000_001_000, order: { oid: 42, timestamp: 1_700_000_000_050, coin: '@1', side: 'B', limitPx: '100', origSz: '2', reduceOnly: false, tif: 'Ioc', cloid } } };
const fill = { oid: 42, px: '99.5', sz: '2', fee: '0.1', time: 1_700_000_001_000, coin: '@1', side: 'B', tid: 7 };

test('Hyperliquid observer verifies terminal IOC status against fills and exact order fields', async () => {
  const requests: unknown[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const body = requests.length === 1 ? status : [fill];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'CONFIRMED');
  assert.equal(observed.chainRef, 'hyperliquid:mainnet');
  assert.equal(observed.txHash, cloid);
  assert.equal(observed.hyperliquidOrder?.averagePrice, '99.5');
  assert.equal(observed.hyperliquidInfoObservation?.fillsComplete, true);
  assert.deepEqual(requests[0], { type: 'orderStatus', user: account, oid: cloid });
  assert.deepEqual(requests[1], { type: 'userFillsByTime', user: account, startTime: 1_699_999_940_000, endTime: 1_700_000_001_000, aggregateByTime: false });
});

test('Hyperliquid observer paginates fills and aggregates only complete, provenance-matched pages', async () => {
  let count = 0;
  const firstPage = [{ ...fill, sz: '1', time: 1_700_000_000_500, tid: 8 }, ...Array.from({ length: 499 }, (_, index) => ({ oid: 99, px: '1', sz: '1', fee: '0', time: 1_700_000_000_501 + index, coin: '@2', side: 'A', tid: 100 + index }))];
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(++count === 1 ? status : count === 2 ? firstPage : [{ ...fill, sz: '1', time: 1_700_000_001_000, tid: 9 }]), { status: 200 });
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'CONFIRMED');
  assert.equal(observed.hyperliquidOrder?.filledSize, '2');
  assert.equal(observed.hyperliquidInfoObservation?.fillPageCount, 2);
  assert.equal(observed.hyperliquidInfoObservation?.relevantFillCount, 2);
});

test('Hyperliquid observer leaves a full page with a non-advancing cursor non-assessable', async () => {
  let count = 0;
  const fullPage = Array.from({ length: 500 }, (_, index) => ({ oid: 99, px: '1', sz: '1', fee: '0', time: 1_699_999_940_000, coin: '@2', side: 'A', tid: 1_000 + index }));
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(++count === 1 ? status : fullPage), { status: 200 });
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'PENDING');
  assert.equal(observed.hyperliquidInfoObservation?.fillsComplete, false);
});

test('Hyperliquid observer stays pending if a filled order has no verifiable fills', async () => {
  let count = 0;
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(++count === 1 ? status : []), { status: 200 });
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'PENDING');
  assert.equal(observed.executionDataAvailable, false);
});

test('Hyperliquid observer leaves an unknown cloid pending without a fills query', async () => {
  let count = 0;
  const fetcher: typeof fetch = async () => { count += 1; return new Response(JSON.stringify({ status: 'unknownOid' }), { status: 200 }); };
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'PENDING');
  assert.equal(count, 1);
});

test('Hyperliquid observer maps a documented IOC rejection to terminal reverted evidence', async () => {
  const rejection = { status: 'order', order: { status: 'iocCancelRejected', statusTimestamp: 1_700_000_001_000, order: status.order.order } };
  let count = 0;
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(++count === 1 ? rejection : []), { status: 200 });
  const observed = await observeHyperliquidSpotIoc({ txHash: cloid, order, nonce, user: account, fetcher, now: () => 1_700_000_002_000 });
  assert.equal(observed.status, 'REVERTED');
  assert.equal(observed.hyperliquidOrder?.orderStatus, 'iocCancelRejected');
});
