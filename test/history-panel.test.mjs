import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupProductPairs,
  pairedProduct,
  seriesFor,
  windowedHistory,
} from '../src/history.js';

const products = [
  { id: 'pair-02-own', pairId: 'pair-02', role: 'own', sku: 'OWN-2', order: 4 },
  { id: 'pair-01-own', pairId: 'pair-01', role: 'own', sku: 'OWN-1', order: 2 },
  { id: 'pair-02-competitor', pairId: 'pair-02', role: 'competitor', sku: 'IPAW-2', order: 3 },
  { id: 'pair-01-competitor', pairId: 'pair-01', role: 'competitor', sku: 'IPAW-1', order: 1 },
];

test('purchase-volume cards group and order each iPaw/own pair together', () => {
  const pairs = groupProductPairs(products);
  assert.deepEqual(pairs.map((pair) => pair.pairId), ['pair-01', 'pair-02']);
  assert.equal(pairs[0].competitor.sku, 'IPAW-1');
  assert.equal(pairs[0].own.sku, 'OWN-1');
});

test('selecting one SKU resolves its paired comparison SKU', () => {
  assert.equal(pairedProduct(products, 'pair-01-competitor')?.id, 'pair-01-own');
  assert.equal(pairedProduct(products, 'pair-02-own')?.id, 'pair-02-competitor');
  assert.equal(pairedProduct(products, 'missing'), null);
});

test('two SKU series retain aligned dates and missing public-volume points', () => {
  const history = [
    { date: '2026-07-20', items: [{ id: 'a', price: 10 }, { id: 'b', price: 8 }] },
    { date: '2026-07-21', items: [{ id: 'a', price: 11 }, { id: 'b', price: null }] },
  ];
  assert.deepEqual(seriesFor(history, 'a', 'price').map((point) => point.value), [10, 11]);
  assert.deepEqual(seriesFor(history, 'b', 'price').map((point) => point.value), [8, null]);
});

test('history window uses the newest stored date instead of the current clock', () => {
  const history = [
    { date: '2026-05-01' },
    { date: '2026-05-30' },
    { date: '2026-05-31' },
  ];
  assert.deepEqual(windowedHistory(history, 30).map((entry) => entry.date), ['2026-05-30', '2026-05-31']);
});
