export function windowedHistory(history, days) {
  const dated = (Array.isArray(history) ? history : [])
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry?.date));
  if (!dated.length) return [];

  const newest = dated.reduce(
    (latest, entry) => entry.date > latest ? entry.date : latest,
    dated[0].date,
  );
  const cutoff = new Date(`${newest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  const cutoffText = cutoff.toISOString().slice(0, 10);
  return dated
    .filter((entry) => entry.date >= cutoffText && entry.date <= newest)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function seriesFor(history, productId, key) {
  return history.map((entry) => {
    const item = entry.items?.find((candidate) => candidate.id === productId);
    return {
      date: entry.date,
      value: Number.isFinite(item?.[key]) ? item[key] : null,
    };
  });
}

export function groupProductPairs(products = []) {
  const grouped = new Map();
  for (const product of products) {
    if (!product?.pairId) continue;
    if (!grouped.has(product.pairId)) {
      grouped.set(product.pairId, {
        pairId: product.pairId,
        order: Number.isFinite(product.order) ? product.order : Number.MAX_SAFE_INTEGER,
      });
    }
    const pair = grouped.get(product.pairId);
    pair.order = Math.min(
      pair.order,
      Number.isFinite(product.order) ? product.order : Number.MAX_SAFE_INTEGER,
    );
    pair[product.role] = product;
  }
  return [...grouped.values()].sort((a, b) => a.order - b.order);
}

export function pairedProduct(products = [], productId) {
  const selected = products.find((product) => product.id === productId);
  if (!selected?.pairId) return null;
  return products.find(
    (product) => product.pairId === selected.pairId && product.id !== selected.id,
  ) || null;
}
