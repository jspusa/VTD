import React, { useMemo, useState } from 'react';
import {
  groupProductPairs,
  pairedProduct,
  seriesFor,
  windowedHistory,
} from './history.js';

const SERIES = {
  primary: { label: 'A', color: '#2f6d57' },
  comparison: { label: 'B', color: '#c55b3d' },
};

const usd = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  : '—';

const integer = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  : '—';

const shortDate = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(new Date(`${value}T00:00:00+08:00`))
  : '';

const roleLabel = (product) => product?.role === 'competitor' ? 'iPaw' : '我方';

const publicVolume = (result) => Number.isFinite(result?.monthlyBoughtLowerBound)
  ? `${integer(result.monthlyBoughtLowerBound)}+`
  : '—';

function segmentsFor(points, x, y) {
  const segments = [];
  let current = [];
  points.forEach((point, index) => {
    if (Number.isFinite(point.value)) current.push(`${x(index)},${y(point.value)}`);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

function SparkChart({ datasets, format, emptyText, metricLabel }) {
  const values = datasets.flatMap((dataset) => dataset.points)
    .filter((point) => Number.isFinite(point.value));
  if (!values.length) return <div className="chart-empty">{emptyText}</div>;

  const width = 760;
  const height = 230;
  const pad = { left: 58, right: 18, top: 18, bottom: 36 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const rawMin = Math.min(...values.map((point) => point.value));
  const rawMax = Math.max(...values.map((point) => point.value));
  const spread = Math.max(rawMax - rawMin, rawMax * 0.08, 1);
  const min = Math.max(0, rawMin - spread * 0.15);
  const max = rawMax + spread * 0.15;
  const pointCount = Math.max(1, ...datasets.map((dataset) => dataset.points.length));
  const x = (index) => pad.left + (pointCount === 1 ? chartWidth / 2 : (index / (pointCount - 1)) * chartWidth);
  const y = (value) => pad.top + ((max - value) / Math.max(1, max - min)) * chartHeight;
  const dates = datasets.find((dataset) => dataset.points.length)?.points || [];
  const firstDate = dates[0]?.date;
  const lastDate = dates.at(-1)?.date;
  const seriesNames = datasets.map((dataset) => dataset.label).join('、');

  return (
    <svg
      className="history-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${seriesNames} ${shortDate(firstDate)}至${shortDate(lastDate)}的${metricLabel}比較圖`}
    >
      {[0, 0.5, 1].map((ratio) => {
        const gridY = pad.top + chartHeight * ratio;
        const label = max - (max - min) * ratio;
        return <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={gridY} y2={gridY} /><text x={pad.left - 9} y={gridY + 4} textAnchor="end">{format(label)}</text></g>;
      })}
      {datasets.map((dataset) => (
        <g className="history-series" style={{ '--series-color': dataset.color }} key={dataset.id}>
          {segmentsFor(dataset.points, x, y).map((points, index) => <polyline key={index} points={points.join(' ')} />)}
          {dataset.points.map((point, index) => Number.isFinite(point.value) && (
            <circle key={`${point.date}-${index}`} cx={x(index)} cy={y(point.value)} r={pointCount < 40 ? 3.8 : 2}>
              <title>{dataset.label} · {point.date}：{format(point.value)}</title>
            </circle>
          ))}
        </g>
      ))}
      <text className="chart-date" x={pad.left} y={height - 8}>{shortDate(firstDate)}</text>
      <text className="chart-date" x={width - pad.right} y={height - 8} textAnchor="end">{shortDate(lastDate)}</text>
    </svg>
  );
}

function ChartLegend({ datasets }) {
  return (
    <div className="chart-legend" aria-label="圖表線條說明">
      {datasets.map((dataset) => (
        <span key={dataset.id} style={{ '--series-color': dataset.color }}>
          <i />
          <strong>{dataset.label}</strong>
          <small>{dataset.points.filter((point) => Number.isFinite(point.value)).length} 點</small>
        </span>
      ))}
    </div>
  );
}

function ProductSummary({ product, result, tone }) {
  const series = SERIES[tone];
  if (!product) {
    return (
      <article className={`history-product-card ${tone} empty`}>
        <div className="history-product-label"><i style={{ '--series-color': series.color }}>{series.label}</i><span>未選擇比較 SKU</span></div>
        <strong>—</strong>
      </article>
    );
  }
  return (
    <article className={`history-product-card ${tone}`}>
      <div className="history-product-label"><i style={{ '--series-color': series.color }}>{series.label}</i><span>{tone === 'primary' ? '主要' : '比較'} · {roleLabel(product)}</span></div>
      <strong>{product.sku}</strong>
      <small>{product.asin}</small>
      <dl>
        <div><dt>最新價格</dt><dd>{usd(result?.currentPrice)}</dd></div>
        <div><dt>公開購買量</dt><dd>{Number.isFinite(result?.monthlyBoughtLowerBound) ? publicVolume(result) : '未顯示'}</dd></div>
      </dl>
    </article>
  );
}

export default function HistoryPanel({ products = [], run, history = [] }) {
  const preferred = products.find((product) => product.sku === 'iPS01-5')?.id || products[0]?.id || '';
  const [productId, setProductId] = useState('');
  const [comparisonChoice, setComparisonChoice] = useState('__auto__');
  const [days, setDays] = useState(30);
  const selectedId = products.some((product) => product.id === productId) ? productId : preferred;
  const automaticComparison = pairedProduct(products, selectedId)?.id || '';
  const requestedComparison = comparisonChoice === '__auto__' ? automaticComparison : comparisonChoice;
  const comparisonId = requestedComparison !== selectedId && products.some((product) => product.id === requestedComparison)
    ? requestedComparison
    : '';
  const selected = products.find((product) => product.id === selectedId);
  const comparison = products.find((product) => product.id === comparisonId);
  const productPairs = useMemo(() => groupProductPairs(products), [products]);
  const resultsById = useMemo(() => new Map((run?.results ?? []).map((result) => [result.id, result])), [run]);
  const latest = resultsById.get(selectedId);
  const comparisonLatest = resultsById.get(comparisonId);
  const visibleHistory = useMemo(() => windowedHistory(history, days), [history, days]);

  const priceDatasets = useMemo(() => [
    selected && { id: selected.id, label: selected.sku, color: SERIES.primary.color, points: seriesFor(visibleHistory, selected.id, 'price') },
    comparison && { id: comparison.id, label: comparison.sku, color: SERIES.comparison.color, points: seriesFor(visibleHistory, comparison.id, 'price') },
  ].filter(Boolean), [visibleHistory, selected?.id, comparison?.id]);

  const salesDatasets = useMemo(() => [
    selected && { id: selected.id, label: selected.sku, color: SERIES.primary.color, points: seriesFor(visibleHistory, selected.id, 'monthlyBoughtLowerBound') },
    comparison && { id: comparison.id, label: comparison.sku, color: SERIES.comparison.color, points: seriesFor(visibleHistory, comparison.id, 'monthlyBoughtLowerBound') },
  ].filter(Boolean), [visibleHistory, selected?.id, comparison?.id]);

  const firstDate = history.at(-1)?.date;
  const latestDate = history[0]?.date;

  const selectPrimary = (nextId) => {
    setProductId(nextId);
    setComparisonChoice(pairedProduct(products, nextId)?.id || '');
  };

  const selectPair = (pair) => {
    if (!pair.competitor || !pair.own) return;
    setProductId(pair.competitor.id);
    setComparisonChoice(pair.own.id);
  };

  return (
    <details className="extra-features">
      <summary>
        <span><small>EXTRA FEATURES</small><strong>額外功能</strong></span>
        <span className="extra-summary">雙 SKU 價格與近月購買量比較 · 保留 365 天</span>
      </summary>
      <div className="extra-body">
        <div className="history-heading">
          <div><p className="eyebrow">PRICE & SALES HISTORY</p><h2>價格／銷量變化</h2><p>兩個 SKU 會疊在同一張圖；銷量採 Amazon 公開的「bought in past month」區間下限，不代表精確訂單數。</p></div>
          <div className="history-controls">
            <label><span>主要 SKU · A</span><select aria-label="主要 SKU" value={selectedId} onChange={(event) => selectPrimary(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {roleLabel(product)}</option>)}</select></label>
            <label><span>比較 SKU · B</span><select aria-label="比較 SKU" value={comparisonId} onChange={(event) => setComparisonChoice(event.target.value)}><option value="">不比較</option>{products.filter((product) => product.id !== selectedId).map((product) => <option key={product.id} value={product.id}>{product.sku} · {roleLabel(product)}</option>)}</select></label>
            <label><span>期間</span><select aria-label="比較期間" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={365}>近 365 天</option></select></label>
          </div>
        </div>

        <div className="history-kpis compare-kpis">
          <ProductSummary product={selected} result={latest} tone="primary" />
          <ProductSummary product={comparison} result={comparisonLatest} tone="comparison" />
          <article className="history-coverage"><span>歷史資料</span><strong>{history.length}<small> / 365 天</small></strong><small>{firstDate && latestDate ? `${firstDate}～${latestDate}` : '從首次新版擷取開始累積'}</small></article>
        </div>

        <div className="chart-grid">
          <article className="chart-card" data-testid="price-chart">
            <div className="chart-card-heading"><div><span>PRICE</span><strong>價格變化（USD）</strong><small>同一座標比較兩個 SKU</small></div><ChartLegend datasets={priceDatasets} /></div>
            <SparkChart datasets={priceDatasets} format={(value) => `$${value.toFixed(2)}`} metricLabel="價格" emptyText="尚未累積可繪製的價格資料。" />
          </article>
          <article className="chart-card sales" data-testid="sales-chart">
            <div className="chart-card-heading"><div><span>MONTHLY BOUGHT</span><strong>近月購買量下限</strong><small>未顯示的日期不補值、不估算</small></div><ChartLegend datasets={salesDatasets} /></div>
            <SparkChart datasets={salesDatasets} format={(value) => `${integer(value)}+`} metricLabel="公開購買量" emptyText="這兩個 SKU 尚未累積 Amazon 公開購買量。" />
          </article>
        </div>

        <div className="sales-snapshot">
          <div className="snapshot-title"><div><strong>本輪公開購買量</strong><span>點擊任一組，即可將 iPaw 與我方 SKU 疊圖比較</span></div><span>有顯示才記錄；未顯示不估算</span></div>
          <div className="snapshot-pairs">{productPairs.map((pair, index) => {
            const competitorResult = resultsById.get(pair.competitor?.id);
            const ownResult = resultsById.get(pair.own?.id);
            const activeIds = new Set([selectedId, comparisonId]);
            const active = pair.competitor && pair.own
              && activeIds.has(pair.competitor.id)
              && activeIds.has(pair.own.id);
            return (
              <button
                type="button"
                className={`snapshot-pair-card ${active ? 'active' : ''}`}
                key={pair.pairId}
                onClick={() => selectPair(pair)}
                aria-label={`比較 ${pair.competitor?.sku || 'iPaw'} 與 ${pair.own?.sku || '我方'}`}
                data-testid={`purchase-pair-${pair.pairId}`}
              >
                <span className="snapshot-pair-index">配對 {String(index + 1).padStart(2, '0')}</span>
                <span className="snapshot-member competitor"><small>iPaw</small><strong>{pair.competitor?.sku || '—'}</strong><b>{publicVolume(competitorResult)}</b></span>
                <span className="snapshot-connector" aria-hidden="true"><i /><em>VS</em><i /></span>
                <span className="snapshot-member own"><small>我方</small><strong>{pair.own?.sku || '—'}</strong><b>{publicVolume(ownResult)}</b></span>
              </button>
            );
          })}</div>
        </div>
      </div>
    </details>
  );
}
