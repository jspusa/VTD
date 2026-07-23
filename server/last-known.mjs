const PRESERVABLE_STATUSES = new Set(['unknown', 'available_no_price', 'error']);

export function lastKnownPrices(history) {
  const known = new Map();
  for (const snapshot of Array.isArray(history) ? history : []) {
    for (const item of snapshot?.items ?? []) {
      if (!item?.id || known.has(item.id) || !Number.isFinite(item.price)) continue;
      known.set(item.id, {
        price: item.price,
        observedAt: item.priceObservedAt || snapshot.capturedAt || snapshot.date || '',
      });
    }
  }
  return known;
}

export function preserveLastKnownPrices(results, history) {
  const known = lastKnownPrices(history);
  return (results ?? []).map((result) => {
    if (Number.isFinite(result.currentPrice)) {
      return {
        ...result,
        priceFreshness: 'fresh',
        priceObservedAt: result.scrapedAt || '',
      };
    }
    if (!PRESERVABLE_STATUSES.has(result.status)) return result;
    const previous = known.get(result.id);
    if (!previous) return result;
    return {
      ...result,
      scrapeStatus: result.status,
      scrapeAvailability: result.availability,
      status: 'last_known_price',
      availability: '本輪價格區塊未載入；沿用最近有效價格',
      currentPrice: previous.price,
      priceFreshness: 'last_known',
      priceObservedAt: previous.observedAt,
      error: `${result.error ? `${result.error} ` : ''}為避免 Amazon 半成品頁覆蓋有效資料，本輪沿用最近一次成功讀取的價格。`,
    };
  });
}
