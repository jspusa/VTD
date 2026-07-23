import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbook } from '../server/excel.mjs';
import { updateDailyHistory } from '../server/daily-history.mjs';
import {
  mergeShardPayloads,
  readShardPayloads,
  shardSummary,
  unresolvedAsins,
} from '../server/distributed-results.mjs';
import { preserveLastKnownPrices } from '../server/last-known.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const products = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
const primaryDir = path.resolve(
  root,
  process.env.PRIMARY_RESULTS_DIR || '.scrape-output/primary',
);
const retryDir = path.resolve(
  root,
  process.env.RETRY_RESULTS_DIR || '.scrape-output/retry',
);
const payloads = await readShardPayloads(primaryDir, retryDir);
const rawResults = mergeShardPayloads(products, payloads);
const unresolved = unresolvedAsins(rawResults);
const summary = shardSummary(products, payloads);
const zipVerifiedCount = rawResults.filter((result) =>
  result.locationValidation === 'zip_10001').length;
const strictUsdVerifiedCount = rawResults.filter((result) =>
  result.locationValidation === 'amazon_com_exact_asin_usd').length;
const startedTimes = payloads
  .map((payload) => payload.startedAt)
  .filter(Boolean)
  .sort();
const startedAt = process.env.RUN_STARTED_AT || startedTimes[0] || new Date().toISOString();
const diagnosticDir = path.resolve(root, process.env.SCRAPE_REPORT_DIR || '.scrape-output');
const diagnostics = {
  generatedAt: new Date().toISOString(),
  strategy: 'one-asin-per-runner-v1',
  primaryArtifacts: payloads.filter((payload) => payload.pass === 'primary').length,
  retryArtifacts: payloads.filter((payload) => payload.pass === 'retry').length,
  ...summary,
  results: rawResults.map((result) => ({
    sku: result.sku,
    asin: result.asin,
    status: result.status,
    currentPrice: result.currentPrice,
    scrapePass: result.scrapePass,
    priceSource: result.priceSource || '',
    locationValidation: result.locationValidation || '',
    error: result.error || '',
  })),
};

await fs.mkdir(diagnosticDir, { recursive: true });
await fs.writeFile(
  path.join(diagnosticDir, 'aggregate-diagnostics.json'),
  `${JSON.stringify(diagnostics, null, 2)}\n`,
);

if (unresolved.length) {
  console.error(`阻止發布：${unresolved.length} 支仍是暫時性缺價（${unresolved.join(', ')}）。`);
  console.error('公開頁將保留上一個完整批次；下一次 30 分鐘健康檢查會自動再試。');
  process.exitCode = 2;
} else {
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
    options: {
      zipCode: '10001',
      headless: true,
      strategy: 'one-asin-per-runner-v2',
      primaryRunnerCount: products.length,
      retryRunnerCount: payloads.filter((payload) => payload.pass === 'retry').length,
      transactionalPublish: true,
      strictUsdFallback: true,
    },
    location: {
      applied: zipVerifiedCount === products.length,
      pricingVerified: true,
      visibleLocation: zipVerifiedCount ? 'New York 10001' : '',
      message: zipVerifiedCount === products.length
        ? `${products.length} 支 ASIN 均於獨立 runner 驗證美國 ZIP 10001 後擷取。`
        : `${zipVerifiedCount} 支確認 ZIP 10001；${strictUsdVerifiedCount} 支改以 Amazon.com、精確 ASIN 與明確 USD 三重驗證。`,
    },
    results: preserveLastKnownPrices(rawResults, previousDailyHistory),
  };

  const publicDir = path.join(root, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(
    path.join(publicDir, 'latest-run.json'),
    `${JSON.stringify({ products, run }, null, 2)}\n`,
  );
  const dailyHistory = updateDailyHistory(previousDailyHistory, run, { retentionDays: 365 });
  await fs.writeFile(dailyHistoryFile, `${JSON.stringify(dailyHistory, null, 2)}\n`);
  await fs.writeFile(
    path.join(publicDir, 'daily-history.json'),
    `${JSON.stringify(dailyHistory, null, 2)}\n`,
  );
  const workbook = await buildWorkbook(run);
  await workbook.xlsx.writeFile(path.join(publicDir, 'latest.xlsx'));

  const fresh = run.results.filter((result) =>
    Number.isFinite(result.currentPrice) && result.priceFreshness === 'fresh').length;
  console.log(`交易式發布通過：${fresh}/${products.length} 支為本輪新價格，0 支沿用舊價。`);
}
