import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data');
const DATA_DIR = process.env.IPAW_DATA_DIR ? path.resolve(process.env.IPAW_DATA_DIR) : DEFAULT_DATA_DIR;
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

export async function getProducts() {
  const bundledProducts = await readJson(path.join(DEFAULT_DATA_DIR, 'products.json'), []);
  const products = await readJson(PRODUCTS_FILE, bundledProducts);
  return products.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

export async function saveProducts(products) {
  await writeJson(PRODUCTS_FILE, products);
}

export async function getHistory() {
  return readJson(HISTORY_FILE, []);
}

export async function getRun(runId) {
  const history = await getHistory();
  return history.find((run) => run.id === runId) ?? null;
}

export async function saveRun(run) {
  const history = await getHistory();
  history.unshift(run);
  await writeJson(HISTORY_FILE, history.slice(0, 100));
  return run;
}

export { DATA_DIR };
