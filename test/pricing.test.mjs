import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePairs, ending99AtOrBelow, integerToLower99 } from '../src/pricing.js';

function pair(sku, competitorPrice, ownPrice) {
  return {
    pairId: sku,
    competitor: { sku: `iP-${sku}` },
    own: { sku },
    competitorResult: { currentPrice: competitorPrice },
    ownResult: Number.isFinite(ownPrice) ? { currentPrice: ownPrice } : { currentPrice: null },
  };
}

test('integer prices move down to .99 and never round upward', () => {
  assert.equal(integerToLower99(58), 57.99);
  assert.equal(integerToLower99(18.5), 18.5);
  assert.equal(ending99AtOrBelow(61.45), 60.99);
  assert.equal(ending99AtOrBelow(61.99), 61.99);
});

test('capped SKUs use the lower of competitor minus two and $19.99', () => {
  const results = analyzePairs([
    pair('7VTSD013AB', 28, 18.99),
    pair('7VTBD410AB', 20.99, 19.99),
    pair('7VTBD015AB', 28, 18.99),
    pair('7VTRD015AB', 28, 19.99),
  ]);
  const bySku = new Map(results.map((item) => [item.own.sku, item.analysis]));
  assert.equal(bySku.get('7VTSD013AB').targetPrice, 19.99);
  assert.equal(bySku.get('7VTSD013AB').state, 'matched');
  assert.equal(bySku.get('7VTBD410AB').targetPrice, 18.99);
  assert.equal(bySku.get('7VTBD410AB').state, 'lower');
  assert.equal(bySku.get('7VTBD015AB').state, 'matched');
  assert.equal(bySku.get('7VTRD015AB').state, 'matched');
});

test('five-pack uses the lower of iPaw minus two and the single-pack ceiling', () => {
  const results = analyzePairs([
    pair('7VTSD013AB', 14.49, 12.49),
    pair('7VTSD513AB', 60, null),
  ]);
  const five = results.find((item) => item.own.sku === '7VTSD513AB').analysis;
  assert.equal(five.targetPrice, 57.99);
  assert.match(five.recommendation, /iPaw 價格 − \$2/);
});

test('five-pack follows a lower actual single price instead of an inflated competitor price', () => {
  const results = analyzePairs([
    pair('7VTSD013AB', 14.49, 9.99),
    pair('7VTSD513AB', 80, null),
  ]);
  const five = results.find((item) => item.own.sku === '7VTSD513AB').analysis;
  assert.equal(five.targetPrice, 47.99);
});

test('ten-pack takes the lowest of competitor, ten singles, and two five-packs', () => {
  const results = analyzePairs([
    pair('7VTSD013AB', 14.49, 12.49),
    pair('7VTSD513AB', 60, 57.99),
    pair('7VTSD913AB', 120, null),
  ]);
  const ten = results.find((item) => item.own.sku === '7VTSD913AB').analysis;
  assert.equal(ten.targetPrice, 113.98);
  assert.match(ten.recommendation, /五包 × 2 − \$2/);
});
