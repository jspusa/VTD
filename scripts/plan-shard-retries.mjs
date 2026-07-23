import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readShardPayloads,
  retryAsins,
  shardSummary,
} from '../server/distributed-results.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const products = JSON.parse(await fs.readFile(path.join(root, 'data/products.json'), 'utf8'));
const primaryDir = path.resolve(
  root,
  process.env.PRIMARY_RESULTS_DIR || '.scrape-output/primary',
);
const payloads = await readShardPayloads(primaryDir);
const missing = retryAsins(products, payloads);
const summary = shardSummary(products, payloads);
const report = {
  generatedAt: new Date().toISOString(),
  missing,
  summary,
};

const reportDir = path.resolve(root, process.env.SCRAPE_REPORT_DIR || '.scrape-output');
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(
  path.join(reportDir, 'retry-plan.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `missing=${JSON.stringify(missing)}\nmissing_count=${missing.length}\n`,
  );
}

console.log(`第一輪獨立 runner：${summary.freshPrices}/${summary.expected} 支取得價格；${missing.length} 支排入全新 runner 補抓。`);
