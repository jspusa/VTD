import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretSnapshot, parseUsd } from '../server/scraper.mjs';

test('parseUsd parses common Amazon formats', () => {
  assert.equal(parseUsd('$14.99'), 14.99);
  assert.equal(parseUsd('US$ 1,120.00'), 1120);
  assert.equal(parseUsd('Price: USD 28.00'), 28);
  assert.equal(parseUsd('NT$594.36'), null);
  assert.equal(parseUsd('TWD 792.59'), null);
  assert.equal(parseUsd('CA$20.00'), null);
  assert.equal(parseUsd('no price'), null);
});

test('interpretSnapshot finds current price, list price and availability', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0001', bodyText: 'In Stock',
    priceTexts: ['$19.99'], listPriceTexts: ['$28.00'], availabilityText: 'In Stock',
    hasAddToCart: true, couponText: 'Save 10%', sellerText: 'PetDelux US', pageAsin: 'B0TEST0001',
  });
  assert.equal(output.currentPrice, 19.99);
  assert.equal(output.listPrice, 28);
  assert.equal(output.status, 'available');
  assert.equal(output.coupon, 'Save 10%');
});

test('interpretSnapshot never invents cart-hidden prices', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0002',
    bodyText: 'To see product details, add this item to your cart.', priceTexts: [], listPriceTexts: [],
    availabilityText: '', hasAddToCart: true,
  });
  assert.equal(output.currentPrice, null);
  assert.equal(output.status, 'cart_price');
});

test('interpretSnapshot detects CAPTCHA without bypassing it', () => {
  const output = interpretSnapshot({
    title: 'Amazon CAPTCHA', url: 'https://www.amazon.com/errors/validateCaptcha',
    bodyText: "Sorry, we just need to make sure you're not a robot", priceTexts: [], listPriceTexts: [],
  });
  assert.equal(output.status, 'blocked');
  assert.match(output.error, /CAPTCHA/);
});

test('interpretSnapshot reports an unavailable featured offer', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0003',
    bodyText: 'No featured offers available', priceTexts: [], listPriceTexts: [],
    availabilityText: 'No featured offers available', hasAddToCart: false,
  });
  assert.equal(output.currentPrice, null);
  assert.equal(output.status, 'unavailable');
});

test('interpretSnapshot separates a delivery-location failure from stock', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0004',
    bodyText: 'This item cannot be shipped to your selected delivery location.',
    priceTexts: ['NT$594.36'], listPriceTexts: ['NT$792.59'],
    availabilityText: 'This item cannot be shipped to your selected delivery location.', hasAddToCart: false,
  });
  assert.equal(output.currentPrice, null);
  assert.equal(output.listPrice, null);
  assert.equal(output.status, 'delivery_unavailable');
});

test('interpretSnapshot rebuilds Amazon split price nodes', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0005', bodyText: 'In Stock',
    priceTexts: [], listPriceTexts: ['$4.72'], availabilityText: 'In Stock', hasAddToCart: true,
    baselinePrice: 120,
    priceDetails: [
      { text: '$120.00', context: '$120.00', isTextPrice: false, isUnit: false, isStruck: false },
      { text: '$4.72', context: '$4.72 / Ounce', isTextPrice: true, isUnit: true, isStruck: false },
    ],
  });
  assert.equal(output.currentPrice, 120);
  assert.equal(output.listPrice, null);
  assert.equal(output.status, 'available');
});

test('interpretSnapshot can use a non-unit text price fallback but rejects unit prices', () => {
  const normal = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0006', bodyText: 'In Stock',
    priceTexts: [], listPriceTexts: ['$14.99'], availabilityText: 'In Stock', hasAddToCart: true,
    baselinePrice: 14.99,
    priceDetails: [{ text: '$14.99', context: '$14.99', isTextPrice: true, isUnit: false, isStruck: false }],
  });
  const unitOnly = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0007', bodyText: 'In Stock',
    priceTexts: [], listPriceTexts: ['$4.72'], availabilityText: 'In Stock', hasAddToCart: true,
    baselinePrice: 120,
    priceDetails: [{ text: '$4.72', context: '$4.72 / Ounce', isTextPrice: true, isUnit: true, isStruck: false }],
  });
  assert.equal(normal.currentPrice, 14.99);
  assert.equal(unitOnly.currentPrice, null);
});

test('interpretSnapshot does not treat a distant unit value as list price', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0008', bodyText: 'In Stock',
    priceTexts: ['$14.99'], listPriceTexts: ['$94.43'], availabilityText: 'In Stock', hasAddToCart: true,
    baselinePrice: 14.99,
    priceDetails: [{ text: '$94.43', context: '$94.43 / Pound', isTextPrice: true, isUnit: true, isStruck: false }],
  });
  assert.equal(output.currentPrice, 14.99);
  assert.equal(output.listPrice, null);
});
