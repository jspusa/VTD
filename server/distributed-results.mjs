import fs from 'node:fs/promises';
import path from 'node:path';

const PUBLISHABLE_NO_PRICE_STATUSES = new Set([
  'unavailable',
  'delivery_unavailable',
  'cart_price',
  'missing',
  'asin_mismatch',
]);

const TRANSIENT_STATUSES = new Set([
  'blocked',
  'skipped',
  'unknown',
  'available_no_price',
  'location_unverified',
  'error',
  'last_known_price',
]);

function normalizedAsin(value) {
  return String(value ?? '').trim().toUpperCase();
}

function timestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function resultScore(payload) {
  const result = payload?.result;
  if (!result) return -1;
  const hasFreshPrice = Number.isFinite(result.currentPrice)
    && result.priceFreshness !== 'last_known'
    && result.status !== 'last_known_price';
  const isPublishableNoPrice = PUBLISHABLE_NO_PRICE_STATUSES.has(result.status);
  const passBonus = payload.pass === 'retry' ? 100 : 0;
  const recency = Math.min(timestamp(result.scrapedAt || payload.finishedAt), 99_999_999_999_999);

  if (hasFreshPrice) return 300_000_000_000_000 + passBonus + recency;
  if (isPublishableNoPrice) return 200_000_000_000_000 + passBonus + recency;
  return 100_000_000_000_000 + passBonus + recency;
}

function validPayloadForProduct(payload, product) {
  const expectedAsin = normalizedAsin(product?.asin);
  if (!payload?.result || !expectedAsin) return false;
  return normalizedAsin(payload.asin) === expectedAsin
    && normalizedAsin(payload.result.asin) === expectedAsin;
}

function missingResult(product) {
  const now = new Date().toISOString();
  return {
    ...product,
    status: 'error',
    availability: '獨立擷取結果遺失',
    currentPrice: null,
    listPrice: null,
    coupon: '',
    seller: '',
    productTitle: '',
    pageAsin: '',
    finalUrl: `https://www.amazon.com/dp/${product.asin}`,
    error: '本 ASIN 的獨立 runner 未產生可驗證結果，已阻止本批次發布。',
    scrapedAt: now,
    startedAt: now,
    scrapePass: '',
  };
}

export function isPublishableShardResult(result) {
  if (!result) return false;
  if (Number.isFinite(result.currentPrice)) {
    return result.priceFreshness !== 'last_known' && result.status !== 'last_known_price';
  }
  return PUBLISHABLE_NO_PRICE_STATUSES.has(result.status);
}

export function mergeShardPayloads(products, payloads) {
  return (products ?? []).map((product) => {
    const candidates = (payloads ?? [])
      .filter((payload) => validPayloadForProduct(payload, product))
      .sort((left, right) => resultScore(right) - resultScore(left));
    const selected = candidates[0];
    if (!selected) return missingResult(product);
    return {
      ...product,
      ...selected.result,
      scrapePass: selected.pass || selected.result.scrapePass || 'primary',
    };
  });
}

export function retryAsins(products, payloads) {
  const merged = mergeShardPayloads(products, payloads);
  return merged
    .filter((result) => !Number.isFinite(result.currentPrice)
      || result.priceFreshness === 'last_known'
      || result.status === 'last_known_price')
    .map((result) => result.asin);
}

export function unresolvedAsins(results) {
  return (results ?? [])
    .filter((result) => !isPublishableShardResult(result))
    .map((result) => result.asin);
}

export function shardSummary(products, payloads) {
  const results = mergeShardPayloads(products, payloads);
  return {
    expected: products?.length ?? 0,
    artifacts: payloads?.length ?? 0,
    freshPrices: results.filter((result) => Number.isFinite(result.currentPrice)
      && result.priceFreshness !== 'last_known'
      && result.status !== 'last_known_price').length,
    publishableNoPrice: results.filter((result) =>
      !Number.isFinite(result.currentPrice) && isPublishableShardResult(result)).length,
    unresolved: unresolvedAsins(results),
  };
}

async function jsonFiles(root) {
  if (!root) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return jsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  }));
  return nested.flat();
}

export async function readShardPayloads(...roots) {
  const files = (await Promise.all(roots.map(jsonFiles))).flat();
  const payloads = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(await fs.readFile(file, 'utf8'));
      if (payload?.schemaVersion === 1 && payload?.result) payloads.push(payload);
    } catch {
      // A malformed artifact is treated as missing and will be retried.
    }
  }
  return payloads;
}

export function isTransientShardStatus(status) {
  return TRANSIENT_STATUSES.has(status);
}
