const CAPPED_SKUS = new Set([
  '7VTRD015AB',
  '7VTBD015AB',
  '7VTBD410AB',
  '7VTSD013AB',
]);

const SINGLE_SKU = '7VTSD013AB';
const FIVE_PACK_SKU = '7VTSD513AB';
const TEN_PACK_SKU = '7VTSD913AB';

export const roundPrice = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// When a calculated price is an exact dollar amount, move down one cent to .99.
// Never round upward to reach a .99 ending.
export function integerToLower99(value) {
  const rounded = roundPrice(Math.max(0, value));
  return Number.isInteger(rounded) && rounded > 0 ? roundPrice(rounded - 0.01) : rounded;
}

// Return the greatest .99 price that does not exceed value.
export function ending99AtOrBelow(value) {
  if (!Number.isFinite(value) || value < 0.99) return 0;
  const cents = Math.floor((value + Number.EPSILON) * 100);
  const dollars = Math.floor(cents / 100);
  const candidate = dollars * 100 + 99;
  return roundPrice((candidate <= cents ? candidate : candidate - 100) / 100);
}

function competitorCeiling(price) {
  return Number.isFinite(price) ? integerToLower99(price - 2) : null;
}

function effectiveFinalPrice(pair, ceiling) {
  const current = pair?.ownResult?.currentPrice;
  if (!Number.isFinite(ceiling)) return null;
  return Number.isFinite(current) ? Math.min(current, ceiling) : ceiling;
}

function makeAnalysis(pair, targetPrice, rule, checks = []) {
  const competitorPrice = pair?.competitorResult?.currentPrice;
  const ownPrice = pair?.ownResult?.currentPrice;
  if (!Number.isFinite(competitorPrice)) {
    return { state: 'insufficient', label: '資料不足', tone: 'neutral', targetPrice: null, gap: null, adjustment: null, recommendation: '待取得 iPaw 價格後判斷', rule: '', checks };
  }
  if (!Number.isFinite(targetPrice)) {
    return { state: 'insufficient', label: '資料不足', tone: 'neutral', targetPrice: null, gap: null, adjustment: null, recommendation: '待取得連動品項價格後判斷', rule: '', checks };
  }
  if (!Number.isFinite(ownPrice)) {
    return { state: 'suggested', label: '建議售價', tone: 'warning', targetPrice, gap: null, adjustment: null, recommendation: `我方建議售價 $${targetPrice.toFixed(2)}`, rule, checks };
  }

  const gap = roundPrice(competitorPrice - ownPrice);
  const adjustment = roundPrice(targetPrice - ownPrice);
  if (ownPrice <= targetPrice + 0.004) {
    return { state: 'matched', label: '符合規則', tone: 'positive', targetPrice, gap, adjustment: 0, recommendation: '無須調整', rule, checks };
  }
  return { state: 'lower', label: '需要降價', tone: 'negative', targetPrice, gap, adjustment, recommendation: `降價 $${Math.abs(adjustment).toFixed(2)} → $${targetPrice.toFixed(2)}`, rule, checks };
}

export function analyzePairs(pairs = []) {
  const bySku = new Map(pairs.map((pair) => [pair.own?.sku || pair.own?.id, pair]));
  const ceilings = new Map();
  const rules = new Map();
  const checksBySku = new Map();

  for (const pair of pairs) {
    const sku = pair.own?.sku;
    const base = competitorCeiling(pair.competitorResult?.currentPrice);
    if (!Number.isFinite(base)) continue;
    if (CAPPED_SKUS.has(sku)) {
      ceilings.set(sku, Math.min(19.99, base));
      rules.set(sku, base > 19.99 ? '售價上限 $19.99' : 'iPaw 價格 − $2');
      checksBySku.set(sku, [
        { label: 'iPaw 價格 − $2', value: base },
        { label: '單品售價上限', value: 19.99 },
      ]);
    }
  }

  const singlePair = bySku.get(SINGLE_SKU);
  const singleFinal = effectiveFinalPrice(singlePair, ceilings.get(SINGLE_SKU));

  const fivePair = bySku.get(FIVE_PACK_SKU);
  const fiveCompetitor = competitorCeiling(fivePair?.competitorResult?.currentPrice);
  if (Number.isFinite(fiveCompetitor) && Number.isFinite(singleFinal)) {
    const singleBundleCeiling = ending99AtOrBelow(singleFinal * 5 - 1);
    const ceiling = Math.min(fiveCompetitor, singleBundleCeiling);
    ceilings.set(FIVE_PACK_SKU, ceiling);
    rules.set(FIVE_PACK_SKU, ceiling === fiveCompetitor ? 'iPaw 價格 − $2' : '單包 × 5 − $1 後向下取 .99');
    checksBySku.set(FIVE_PACK_SKU, [
      { label: 'iPaw 價格 − $2', value: fiveCompetitor },
      { label: `${SINGLE_SKU} × 5 − $1`, note: '向下取最近的 .99', value: singleBundleCeiling },
    ]);
  }

  const fiveFinal = effectiveFinalPrice(fivePair, ceilings.get(FIVE_PACK_SKU));
  const tenPair = bySku.get(TEN_PACK_SKU);
  const tenCompetitor = competitorCeiling(tenPair?.competitorResult?.currentPrice);
  if (Number.isFinite(tenCompetitor) && Number.isFinite(singleFinal) && Number.isFinite(fiveFinal)) {
    const singleCeiling = integerToLower99(singleFinal * 10 - 2);
    const fiveCeiling = integerToLower99(fiveFinal * 2 - 1.99);
    const ceiling = Math.min(tenCompetitor, singleCeiling, fiveCeiling);
    ceilings.set(TEN_PACK_SKU, ceiling);
    const rule = ceiling === tenCompetitor
      ? 'iPaw 價格 − $2'
      : ceiling === singleCeiling ? '單包 × 10 − $2' : '五包 × 2 − $1.99';
    rules.set(TEN_PACK_SKU, rule);
    checksBySku.set(TEN_PACK_SKU, [
      { label: 'iPaw 價格 − $2', value: tenCompetitor },
      { label: `${SINGLE_SKU} × 10 − $2`, value: singleCeiling },
      { label: `${FIVE_PACK_SKU} × 2 − $1.99`, value: fiveCeiling },
    ]);
  }

  return pairs.map((pair) => ({
    ...pair,
    analysis: makeAnalysis(
      pair,
      ceilings.get(pair.own?.sku),
      rules.get(pair.own?.sku) || '',
      (checksBySku.get(pair.own?.sku) || []).map((check) => ({
        ...check,
        selected: Math.abs(check.value - ceilings.get(pair.own?.sku)) < 0.005,
      })),
    ),
  }));
}
