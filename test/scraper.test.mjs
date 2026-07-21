import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretSnapshot,
  isIncompleteProductSnapshot,
  parseMonthlyBought,
  parseUsd,
} from '../server/scraper.mjs';

test('parseUsd parses common Amazon formats', () => {
  assert.equal(parseUsd('$14.99'), 14.99);
  assert.equal(parseUsd('US$ 1,120.00'), 1120);
  assert.equal(parseUsd('Price: USD 28.00'), 28);
  assert.equal(parseUsd('NT$594.36'), null);
  assert.equal(parseUsd('TWD 792.59'), null);
  assert.equal(parseUsd('CA$20.00'), null);
  assert.equal(parseUsd('no price'), null);
});

test('parseMonthlyBought reads Amazon public sales ranges', () => {
  assert.deepEqual(parseMonthlyBought('700+ bought in past month'), {
    text: '700+ bought in past month', lowerBound: 700,
  });
  assert.equal(parseMonthlyBought('1K+ bought in past month').lowerBound, 1000);
  assert.equal(parseMonthlyBought('1.5K+ bought in past month').lowerBound, 1500);
  assert.equal(parseMonthlyBought('2,000+ bought in past month').lowerBound, 2000);
  assert.equal(parseMonthlyBought('In Stock').lowerBound, null);
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

test('interpretSnapshot reads the new Amazon accessibility deal-price label', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0F1385154', bodyText: 'In Stock',
    priceTexts: ['$17.99 with 10 percent savings'], listPriceTexts: ['$19.99'],
    availabilityText: 'In Stock', hasAddToCart: true, pageAsin: 'B0F1385154',
  });
  assert.equal(output.currentPrice, 17.99);
  assert.equal(output.listPrice, 19.99);
  assert.equal(output.status, 'available');
});

test('an ASIN-only Amazon variation shell is retried instead of accepted as complete', () => {
  assert.equal(isIncompleteProductSnapshot({
    pageAsin: 'B0F1385154', productTitle: '', hasAddToCart: false,
    availabilityText: '', priceTexts: [], priceDetails: [], structuredPriceValues: [],
  }), true);
  assert.equal(isIncompleteProductSnapshot({
    pageAsin: 'B0F1385154', productTitle: 'iPaw Turkey Tendons', hasAddToCart: false,
    availabilityText: '', priceTexts: [], priceDetails: [], structuredPriceValues: [],
  }), false);
});

test('a confirmed product shell never falls back to an ambiguous unknown status', () => {
  const output = interpretSnapshot({
    title: 'Amazon.com', url: 'https://www.amazon.com/dp/B0F1385154', bodyText: '',
    pageAsin: 'B0F1385154', productTitle: '', hasAddToCart: false,
    availabilityText: '', priceTexts: [], priceDetails: [], structuredPriceValues: [],
  });
  assert.equal(output.status, 'available_no_price');
  assert.equal(output.availability, '商品頁已確認，價格暫未顯示');
});

test('interpretSnapshot includes the monthly bought indicator when Amazon exposes it', () => {
  const output = interpretSnapshot({
    title: 'iPaw product', url: 'https://www.amazon.com/dp/B0TEST0001', bodyText: 'In Stock',
    priceTexts: ['$19.99'], listPriceTexts: [], availabilityText: 'In Stock',
    hasAddToCart: true, salesVolumeText: '700+ bought in past month',
  });
  assert.equal(output.monthlyBoughtText, '700+ bought in past month');
  assert.equal(output.monthlyBoughtLowerBound, 700);
});

test('interpretSnapshot does not mistake generic Amazon copy on a valid product page for a missing page', () => {
  const output = interpretSnapshot({
    title: 'Vitaday product', url: 'https://www.amazon.com/dp/B0DNF4564B',
    bodyText: 'In Stock\nLooking for something?\nDogs of Amazon',
    productTitle: 'VITADAY Turkey Tendons for Dogs',
    priceTexts: ['$7.99'], listPriceTexts: [], availabilityText: 'In Stock',
    hasAddToCart: true, pageAsin: 'B0DNF4564B',
  });
  assert.equal(output.status, 'available');
  assert.equal(output.currentPrice, 7.99);
});

test('interpretSnapshot still reports a genuine 404 page as missing', () => {
  const output = interpretSnapshot({
    title: 'Amazon.com', url: 'https://www.amazon.com/dp/B0MISSING0',
    httpStatus: 404, bodyText: 'Looking for something?', priceTexts: [],
    listPriceTexts: [], hasAddToCart: false, productTitle: '',
  });
  assert.equal(output.status, 'missing');
});

test('interpretSnapshot still reports an Amazon soft 404 even when the URL contains the requested ASIN', () => {
  const output = interpretSnapshot({
    title: 'Amazon.com', url: 'https://www.amazon.com/dp/B0MISSING0',
    bodyText: 'Looking for something?', pageAsin: 'B0MISSING0', priceTexts: [],
    priceDetails: [], listPriceTexts: [], hasAddToCart: false, productTitle: '',
  });
  assert.equal(output.status, 'missing');
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
