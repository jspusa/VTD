const DAY_MS = 24 * 60 * 60 * 1_000;

export function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function cutoffDate(date, retentionDays) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - (retentionDays - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function makeDailySnapshot(run, capturedAt = run?.finishedAt || new Date().toISOString()) {
  return {
    date: taipeiDate(capturedAt),
    capturedAt,
    items: (run?.results ?? []).map((result) => ({
      id: result.id,
      pairId: result.pairId,
      role: result.role,
      sku: result.sku,
      asin: result.asin,
      status: result.status,
      price: Number.isFinite(result.currentPrice) ? result.currentPrice : null,
      monthlyBoughtText: result.monthlyBoughtText || '',
      monthlyBoughtLowerBound: Number.isFinite(result.monthlyBoughtLowerBound)
        ? result.monthlyBoughtLowerBound
        : null,
    })),
  };
}

export function updateDailyHistory(history, run, options = {}) {
  const retentionDays = Math.max(1, Number(options.retentionDays) || 365);
  const snapshot = makeDailySnapshot(run, options.capturedAt);
  const cutoff = cutoffDate(snapshot.date, retentionDays);
  const byDate = new Map(
    (Array.isArray(history) ? history : [])
      .filter((entry) => entry?.date && entry.date >= cutoff && entry.date <= snapshot.date)
      .map((entry) => [entry.date, entry]),
  );
  byDate.set(snapshot.date, snapshot);
  return [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, retentionDays);
}
