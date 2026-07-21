import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbook } from '../server/excel.mjs';

test('Excel export contains paired SKU comparison and adjustment rule', async () => {
  const now = '2026-07-18T03:00:00.000Z';
  const workbook = await buildWorkbook({
    id: 'test-run',
    startedAt: now,
    finishedAt: now,
    options: { zipCode: '10001', headless: true },
    results: [
      { id: 'pair-1-competitor', pairId: 'pair-1', role: 'competitor', sku: 'iPS05-1', currentPrice: 14.99, status: 'available', availability: 'In Stock', asin: 'B0CZRN7HXT', scrapedAt: now, error: '' },
      { id: 'pair-1-own', pairId: 'pair-1', role: 'own', sku: '7VTSD013AB', currentPrice: 12.99, status: 'available', availability: 'In Stock', asin: 'B0DNF4564B', scrapedAt: now, error: '' },
    ],
  });
  const prices = workbook.getWorksheet('六組價格對照');
  const metadata = workbook.getWorksheet('擷取資訊');
  assert.ok(prices);
  assert.ok(metadata);
  assert.equal(prices.rowCount, 3);
  assert.equal(prices.getCell('A3').value, 'iPS05-1');
  assert.equal(prices.getCell('B3').value.text, 'B0CZRN7HXT');
  assert.equal(prices.getCell('E3').value, '7VTSD013AB');
  assert.equal(prices.getCell('D3').value, 14.99);
  assert.equal(prices.getCell('H3').value, 12.99);
  assert.equal(prices.getCell('I3').value, '$12.99\n無須調整（上限 $12.99）');
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 5_000);
});

test('Excel shows a suggested own price when the own price is missing', async () => {
  const now = '2026-07-18T03:00:00.000Z';
  const workbook = await buildWorkbook({
    id: 'missing-own-price', startedAt: now, finishedAt: now, options: {},
    results: [
      { id: 'c', pairId: 'pair-1', role: 'competitor', sku: 'iPS05-1', currentPrice: 14.49, status: 'available', asin: 'B0CZRN7HXT', scrapedAt: now },
      { id: 'o', pairId: 'pair-1', role: 'own', sku: '7VTSD013AB', currentPrice: null, status: 'available_no_price', asin: 'B0DNF4564B', scrapedAt: now },
    ],
  });
  assert.equal(workbook.getWorksheet('六組價格對照').getCell('I3').value, '$12.49\n我方建議售價 $12.49（iPaw 價格 − $2）');
});
