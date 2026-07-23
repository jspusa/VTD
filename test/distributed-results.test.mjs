import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublishableShardResult,
  mergeShardPayloads,
  retryAsins,
  shardSummary,
  unresolvedAsins,
} from '../server/distributed-results.mjs';

const products = [
  { id: 'one', sku: 'SKU-1', asin: 'B000000001', order: 1 },
  { id: 'two', sku: 'SKU-2', asin: 'B000000002', order: 2 },
];

function payload(asin, result, pass = 'primary', finishedAt = '2026-07-23T10:00:00.000Z') {
  return {
    schemaVersion: 1,
    pass,
    asin,
    finishedAt,
    result: { asin, ...result },
  };
}

test('distributed results keep product order and prefer a fresh retry price', () => {
  const merged = mergeShardPayloads(products, [
    payload('B000000001', { status: 'available_no_price', currentPrice: null }),
    payload('B000000002', { status: 'available', currentPrice: 12.99 }),
    payload('B000000001', { status: 'available', currentPrice: 14.99 }, 'retry'),
  ]);

  assert.deepEqual(merged.map((result) => result.asin), ['B000000001', 'B000000002']);
  assert.equal(merged[0].currentPrice, 14.99);
  assert.equal(merged[0].scrapePass, 'retry');
  assert.equal(merged[1].currentPrice, 12.99);
});

test('retry plan includes every no-price ASIN and every missing artifact', () => {
  const missing = retryAsins(products, [
    payload('B000000001', { status: 'unavailable', currentPrice: null }),
  ]);
  assert.deepEqual(missing, ['B000000001', 'B000000002']);
});

test('a mismatched artifact is rejected instead of being assigned to another product', () => {
  const merged = mergeShardPayloads(products, [
    {
      schemaVersion: 1,
      pass: 'primary',
      asin: 'B000000001',
      result: { asin: 'B000000002', status: 'available', currentPrice: 1.99 },
    },
  ]);
  assert.equal(merged[0].status, 'error');
  assert.equal(merged[0].currentPrice, null);
  assert.match(merged[0].error, /阻止本批次發布/);
});

test('transient missing-price results block publishing but confirmed unavailable does not', () => {
  assert.equal(isPublishableShardResult({
    status: 'available_no_price',
    currentPrice: null,
  }), false);
  assert.equal(isPublishableShardResult({
    status: 'unavailable',
    currentPrice: null,
  }), true);
  assert.deepEqual(unresolvedAsins([
    { asin: 'B000000001', status: 'available_no_price', currentPrice: null },
    { asin: 'B000000002', status: 'unavailable', currentPrice: null },
  ]), ['B000000001']);
});

test('last-known prices can never satisfy a distributed fresh-run health check', () => {
  const result = {
    asin: 'B000000001',
    status: 'last_known_price',
    currentPrice: 14.99,
    priceFreshness: 'last_known',
  };
  assert.equal(isPublishableShardResult(result), false);
  assert.deepEqual(retryAsins([products[0]], [
    payload('B000000001', result),
  ]), ['B000000001']);
});

test('summary reports fresh, terminal and unresolved outcomes separately', () => {
  const summary = shardSummary(products, [
    payload('B000000001', { status: 'available', currentPrice: 14.99 }),
    payload('B000000002', { status: 'available_no_price', currentPrice: null }),
  ]);
  assert.equal(summary.expected, 2);
  assert.equal(summary.freshPrices, 1);
  assert.equal(summary.publishableNoPrice, 0);
  assert.deepEqual(summary.unresolved, ['B000000002']);
});
