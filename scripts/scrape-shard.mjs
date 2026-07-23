import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeProducts } from '../server/scraper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const products = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
const asin = String(process.env.AMAZON_ASIN ?? '').trim().toUpperCase();
const pass = process.env.SCRAPE_PASS === 'retry' ? 'retry' : 'primary';
const outputDir = path.resolve(
  root,
  process.env.SCRAPE_OUTPUT_DIR || `.scrape-output/${pass}`,
);
const product = products.find((item) => item.asin === asin);

if (!product) {
  throw new Error(`找不到 AMAZON_ASIN ${asin || '（空白）'} 對應的產品設定。`);
}

const startedAt = new Date().toISOString();
let location = {
  applied: false,
  verificationMode: '',
  visibleLocation: '',
  message: '尚未完成配送地點驗證。',
};
let result;
let fatalError = '';

try {
  const output = await scrapeProducts([product], {
    zipCode: /^\d{5}$/.test(process.env.AMAZON_ZIP || '') ? process.env.AMAZON_ZIP : '10001',
    headless: true,
    delayMs: 0,
    timeoutMs: 45_000,
    productUrlLimit: 1,
    priceObservationCount: 2,
    searchWaitMs: 8_000,
    offerWaitMs: 7_000,
    sameRunnerRetry: false,
    retryProductUrlLimit: 1,
    retryPriceObservationCount: 2,
  }, (event) => {
    if (event.type === 'location') {
      location = {
        applied: Boolean(event.applied),
        verificationMode: event.verificationMode || '',
        visibleLocation: event.visibleLocation || '',
        message: event.message || '',
      };
    }
    if (event.type === 'warning' && event.message) console.warn(event.message);
    if (event.type === 'retry_result') {
      const recovered = Number.isFinite(event.result?.currentPrice);
      console.log(`[${pass}] ${asin} 同 runner 補抓：${recovered ? '成功' : '仍缺價'}`);
    }
  });
  result = output.results[0];
  location = output.location || location;
} catch (error) {
  fatalError = String(error?.message || error || '未知錯誤').replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();
  result = {
    ...product,
    status: 'error',
    availability: '獨立 runner 擷取失敗',
    currentPrice: null,
    listPrice: null,
    coupon: '',
    seller: '',
    productTitle: '',
    pageAsin: '',
    finalUrl: `https://www.amazon.com/dp/${product.asin}`,
    error: fatalError,
    scrapedAt: now,
    startedAt,
  };
}

const payload = {
  schemaVersion: 1,
  pass,
  asin,
  startedAt,
  finishedAt: new Date().toISOString(),
  location,
  fatalError,
  result: {
    ...result,
    scrapePass: pass,
  },
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, `${asin}.json`),
  `${JSON.stringify(payload, null, 2)}\n`,
);

const outcome = Number.isFinite(result.currentPrice)
  ? `$${result.currentPrice.toFixed(2)}`
  : `${result.status}／無新價格`;
console.log(`[${pass}] ${asin} 完成：${outcome}`);
