import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbook } from '../server/excel.mjs';
import { scrapeProducts } from '../server/scraper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const products = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
const startedAt = new Date().toISOString();
const options = {
  zipCode: /^\d{5}$/.test(process.env.AMAZON_ZIP || '') ? process.env.AMAZON_ZIP : '10001',
  headless: true,
  delayMs: 3_500,
  timeoutMs: 45_000,
};

console.log(`開始擷取 ${products.length} 個 ASIN，配送 ZIP ${options.zipCode}`);
const output = await scrapeProducts(products, options, (event) => {
  if (event.type === 'start') console.log(`[${event.index + 1}/${event.total}] ${event.asin}`);
  if (event.type === 'warning' && event.message) console.warn(event.message);
});

const run = {
  id: crypto.randomUUID(),
  startedAt,
  finishedAt: new Date().toISOString(),
  options,
  location: output.location,
  results: output.results,
};

const publicDir = path.join(root, 'public');
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'latest-run.json'), `${JSON.stringify({ products, run }, null, 2)}\n`);
const workbook = await buildWorkbook(run);
await workbook.xlsx.writeFile(path.join(publicDir, 'latest.xlsx'));

const found = run.results.filter((item) => Number.isFinite(item.currentPrice)).length;
console.log(`完成：${found}/${run.results.length} 個 ASIN 讀取到價格。`);
