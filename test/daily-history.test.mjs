import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDailySnapshot, taipeiDate, updateDailyHistory } from '../server/daily-history.mjs';

const result = (overrides = {}) => ({
  id: 'pair-01-competitor', pairId: 'pair-01', role: 'competitor',
  sku: 'iPS01-5', asin: 'B0DWMFGPH3', status: 'available',
  currentPrice: 60, monthlyBoughtText: '700+ bought in past month',
  monthlyBoughtLowerBound: 700, ...overrides,
});

test('taipeiDate uses the Taipei calendar day', () => {
  assert.equal(taipeiDate('2026-07-20T16:30:00.000Z'), '2026-07-21');
});

test('daily snapshot stores price and public monthly sales lower bound', () => {
  const snapshot = makeDailySnapshot({ results: [result()] }, '2026-07-21T04:00:00.000Z');
  assert.equal(snapshot.date, '2026-07-21');
  assert.deepEqual(snapshot.items[0], {
    id: 'pair-01-competitor', pairId: 'pair-01', role: 'competitor',
    sku: 'iPS01-5', asin: 'B0DWMFGPH3', status: 'available', price: 60,
    priceFreshness: 'fresh', priceObservedAt: '',
    monthlyBoughtText: '700+ bought in past month', monthlyBoughtLowerBound: 700,
  });
});

test('same day is replaced and dates older than the 365-day window are removed', () => {
  const history = [
    { date: '2025-07-21', capturedAt: 'old', items: [] },
    { date: '2026-07-21', capturedAt: 'morning', items: [] },
  ];
  const updated = updateDailyHistory(history, { results: [result({ currentPrice: 57.99 })] }, {
    capturedAt: '2026-07-21T11:30:00.000Z',
  });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].capturedAt, '2026-07-21T11:30:00.000Z');
  assert.equal(updated[0].items[0].price, 57.99);
});
