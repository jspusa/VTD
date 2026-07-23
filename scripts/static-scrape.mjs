import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbook } from '../server/excel.mjs';
import { updateDailyHistory } from '../server/daily-history.mjs';
import { preserveLastKnownPrices } from '../server/last-known.mjs';
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

const dailyHistoryFile = path.join(root, 'data', 'daily-history.json');
let previousDailyHistory = [];
try {
  previousDailyHistory = JSON.parse(await fs.readFile(dailyHistoryFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const run = {
  id: crypto.randomUUID(),
  startedAt,
  finishedAt: new Date().toISOString(),
  options,
  location: output.location,
  results: preserveLastKnownPrices(output.results, previousDailyHistory),
};

const publicDir = path.join(root, 'public');
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'latest-run.json'), `${JSON.stringify({ products, run }, null, 2)}\n`);
const dailyHistory = updateDailyHistory(previousDailyHistory, run, { retentionDays: 365 });
await fs.writeFile(dailyHistoryFile, `${JSON.stringify(dailyHistory, null, 2)}\n`);
await fs.writeFile(path.join(publicDir, 'daily-history.json'), `${JSON.stringify(dailyHistory, null, 2)}\n`);
const workbook = await buildWorkbook(run);
await workbook.xlsx.writeFile(path.join(publicDir, 'latest.xlsx'));

const found = run.results.filter((item) => Number.isFinite(item.currentPrice)).length;
console.log(`完成：${found}/${run.results.length} 個 ASIN 讀取到價格。`);
console.log(`每日歷史：${dailyHistory.length}/365 天；${dailyHistory[0]?.date || '尚無資料'} 已更新。`);
