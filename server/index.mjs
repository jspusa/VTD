import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getHistory, getProducts, getRun, saveProducts, saveRun } from './store.mjs';
import { scrapeProducts } from './scraper.mjs';
import { buildWorkbook } from './excel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const APP_VERSION = '1.8.0';
const port = Number(process.env.PORT) || 8792;
const jobs = new Map();

app.use(express.json({ limit: '1mb' }));

function cleanProduct(input, index) {
  const asin = String(input.asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error(`ASIN 格式錯誤：${asin || '空白'}`);
  const baselinePrice = input.baselinePrice === '' || input.baselinePrice === null ? null : Number(input.baselinePrice);
  if (baselinePrice !== null && (!Number.isFinite(baselinePrice) || baselinePrice < 0)) throw new Error(`${asin} 的基準價不是有效數字。`);
  return {
    id: String(input.id || crypto.randomUUID()),
    pairId: String(input.pairId || '').trim(),
    role: input.role === 'own' ? 'own' : 'competitor',
    sku: String(input.sku || '').trim(),
    baselineStatus: String(input.baselineStatus || '').trim(),
    shape: String(input.shape || '').trim(),
    size: String(input.size || '').trim(),
    pack: String(input.pack || '').trim(),
    weight: String(input.weight || '').trim(),
    baselinePrice,
    asin,
    note: String(input.note || '').trim(),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : index + 1,
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'iPaw Amazon Price Monitor', version: APP_VERSION }));

app.get('/api/products', async (_req, res, next) => {
  try { res.json(await getProducts()); } catch (error) { next(error); }
});

app.put('/api/products', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: '資料必須是品項陣列。' });
    const products = req.body.map(cleanProduct);
    const duplicates = products.filter((item, index) => products.findIndex((candidate) => candidate.asin === item.asin) !== index);
    if (duplicates.length) return res.status(400).json({ error: `ASIN 重複：${[...new Set(duplicates.map((item) => item.asin))].join(', ')}` });
    await saveProducts(products);
    res.json(await getProducts());
  } catch (error) { next(error); }
});

app.get('/api/history', async (_req, res, next) => {
  try {
    const history = await getHistory();
    res.json(history.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      total: run.results?.length ?? 0,
      found: run.results?.filter((item) => Number.isFinite(item.currentPrice)).length ?? 0,
      available: run.results?.filter((item) => ['available', 'price_found'].includes(item.status)).length ?? 0,
      options: run.options,
      location: run.location,
    })));
  } catch (error) { next(error); }
});

app.get('/api/runs/:id', async (req, res, next) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: '找不到這次擷取紀錄。' });
    res.json(run);
  } catch (error) { next(error); }
});

app.post('/api/scrape', async (req, res, next) => {
  try {
    const running = [...jobs.values()].find((job) => ['queued', 'running'].includes(job.status));
    if (running) return res.status(409).json({ error: '已有一個擷取工作正在進行，請等待完成。', jobId: running.id });

    const products = await getProducts();
    const selectedAsins = Array.isArray(req.body?.asins) ? new Set(req.body.asins) : null;
    const targets = selectedAsins ? products.filter((product) => selectedAsins.has(product.asin)) : products;
    if (!targets.length) return res.status(400).json({ error: '沒有可擷取的品項。' });

    const options = {
      zipCode: /^\d{5}$/.test(String(req.body?.zipCode || '')) ? String(req.body.zipCode) : '10001',
      headless: req.body?.headless !== false,
      delayMs: Math.min(15_000, Math.max(1_500, Number(req.body?.delayMs) || 3_500)),
    };
    const id = crypto.randomUUID();
    const job = {
      id,
      status: 'queued',
      current: 0,
      total: targets.length,
      asin: '',
      results: [],
      messages: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      runId: null,
      error: '',
      options,
    };
    jobs.set(id, job);
    res.status(202).json({ jobId: id });

    queueMicrotask(async () => {
      job.status = 'running';
      try {
        const output = await scrapeProducts(targets, options, (event) => {
          if (event.type === 'start') {
            job.current = event.index;
            job.asin = event.asin;
          } else if (event.type === 'result') {
            job.current = event.index + 1;
            job.results = [...job.results, event.result];
          } else if (event.type === 'location' || event.type === 'warning') {
            if (event.message) job.messages = [...job.messages, event.message];
          }
        });
        job.status = 'completed';
        job.finishedAt = new Date().toISOString();
        const run = {
          id: crypto.randomUUID(),
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          options,
          location: output.location,
          results: output.results,
        };
        await saveRun(run);
        job.runId = run.id;
      } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        job.finishedAt = new Date().toISOString();
      }
    });
  } catch (error) { next(error); }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '找不到擷取工作。' });
  res.json(job);
});

app.get('/api/export/:runId.xlsx', async (req, res, next) => {
  try {
    const run = await getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: '找不到這次擷取紀錄。' });
    const workbook = await buildWorkbook(run);
    const stamp = new Date(run.finishedAt || run.startedAt).toISOString().slice(0, 10).replaceAll('-', '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="iPaw_SKU_Price_Comparison_${stamp}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { next(error); }
});

const dist = path.resolve(__dirname, '../dist');
app.use(express.static(dist));
app.get('*splat', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || '伺服器發生未知錯誤。' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`iPaw Amazon Price Monitor v${APP_VERSION} 已啟動：http://127.0.0.1:${port}`);
});
