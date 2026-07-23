import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveLastKnownPrices } from '../server/last-known.mjs';

const history = [{
  date: '2026-07-21', capturedAt: '2026-07-21T12:00:00.000Z',
  items: [{ id: 'own-1', price: 12.49 }, { id: 'own-2', price: 19.99 }],
}];

test('a transient missing Amazon price widget preserves the last valid price', () => {
  const [result] = preserveLastKnownPrices([{
    id: 'own-1', status: 'available_no_price', currentPrice: null,
    availability: '商品頁已確認，價格暫未顯示', error: '未偵測到價格節點。',
  }], history);
  assert.equal(result.currentPrice, 12.49);
  assert.equal(result.status, 'last_known_price');
  assert.equal(result.priceFreshness, 'last_known');
  assert.equal(result.priceObservedAt, '2026-07-21T12:00:00.000Z');
  assert.match(result.error, /沿用最近一次/);
});

test('a fresh price records its own observation time', () => {
  const [result] = preserveLastKnownPrices([{
    id: 'own-1', status: 'available', currentPrice: 12.99,
    scrapedAt: '2026-07-22T12:00:00.000Z',
  }], history);
  assert.equal(result.currentPrice, 12.99);
  assert.equal(result.priceFreshness, 'fresh');
  assert.equal(result.priceObservedAt, '2026-07-22T12:00:00.000Z');
});

test('definitive unavailable and missing states never reuse an old price', () => {
  for (const status of ['unavailable', 'missing', 'cart_price', 'blocked', 'delivery_unavailable', 'asin_mismatch']) {
    const [result] = preserveLastKnownPrices([{ id: 'own-2', status, currentPrice: null }], history);
    assert.equal(result.currentPrice, null, status);
    assert.equal(result.status, status);
  }
});
