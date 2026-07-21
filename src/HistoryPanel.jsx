import React, { useMemo, useState } from 'react';

const usd = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  : '—';

const integer = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  : '—';

const shortDate = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(new Date(`${value}T00:00:00+08:00`))
  : '';

function windowedHistory(history, days) {
  const dated = (Array.isArray(history) ? history : []).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry?.date));
  if (!dated.length) return [];
  const newest = dated.reduce((latest, entry) => entry.date > latest ? entry.date : latest, dated[0].date);
  const cutoff = new Date(`${newest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  const cutoffText = cutoff.toISOString().slice(0, 10);
  return dated.filter((entry) => entry.date >= cutoffText && entry.date <= newest).sort((a, b) => a.date.localeCompare(b.date));
}

function seriesFor(history, productId, key) {
  return history.map((entry) => {
    const item = entry.items?.find((candidate) => candidate.id === productId);
    return { date: entry.date, value: Number.isFinite(item?.[key]) ? item[key] : null };
  });
}

function SparkChart({ series, format, emptyText }) {
  const values = series.filter((point) => Number.isFinite(point.value));
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
  const x = (index) => pad.left + (series.length === 1 ? chartWidth / 2 : (index / (series.length - 1)) * chartWidth);
  const y = (value) => pad.top + ((max - value) / Math.max(1, max - min)) * chartHeight;
  const segments = [];
  let current = [];
  series.forEach((point, index) => {
    if (Number.isFinite(point.value)) current.push(`${x(index)},${y(point.value)}`);
    else if (current.length) { segments.push(current); current = []; }
  });
  if (current.length) segments.push(current);
  const firstDate = series[0]?.date;
  const lastDate = series.at(-1)?.date;

  return (
    <svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${shortDate(firstDate)}至${shortDate(lastDate)}的變化圖`}>
      {[0, 0.5, 1].map((ratio) => {
        const gridY = pad.top + chartHeight * ratio;
        const label = max - (max - min) * ratio;
        return <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={gridY} y2={gridY} /><text x={pad.left - 9} y={gridY + 4} textAnchor="end">{format(label)}</text></g>;
      })}
      {segments.map((points, index) => <polyline key={index} points={points.join(' ')} />)}
      {series.map((point, index) => Number.isFinite(point.value) && (
        <circle key={`${point.date}-${index}`} cx={x(index)} cy={y(point.value)} r={series.length < 40 ? 3.6 : 2}>
          <title>{point.date}：{format(point.value)}</title>
        </circle>
      ))}
      <text className="chart-date" x={pad.left} y={height - 8}>{shortDate(firstDate)}</text>
      <text className="chart-date" x={width - pad.right} y={height - 8} textAnchor="end">{shortDate(lastDate)}</text>
    </svg>
  );
}

export default function HistoryPanel({ products = [], run, history = [] }) {
  const preferred = products.find((product) => product.sku === 'iPS01-5')?.id || products[0]?.id || '';
  const [productId, setProductId] = useState(preferred);
  const [days, setDays] = useState(30);
  const selectedId = products.some((product) => product.id === productId) ? productId : preferred;
  const selected = products.find((product) => product.id === selectedId);
  const resultsById = useMemo(() => new Map((run?.results ?? []).map((result) => [result.id, result])), [run]);
  const latest = resultsById.get(selectedId);
  const visibleHistory = useMemo(() => windowedHistory(history, days), [history, days]);
  const priceSeries = useMemo(() => seriesFor(visibleHistory, selectedId, 'price'), [visibleHistory, selectedId]);
  const salesSeries = useMemo(() => seriesFor(visibleHistory, selectedId, 'monthlyBoughtLowerBound'), [visibleHistory, selectedId]);
  const firstDate = history.at(-1)?.date;
  const latestDate = history[0]?.date;

  return (
    <details className="extra-features">
      <summary>
        <span><small>EXTRA FEATURES</small><strong>額外功能</strong></span>
        <span className="extra-summary">價格與近月購買量趨勢 · 保留 365 天</span>
      </summary>
      <div className="extra-body">
        <div className="history-heading">
          <div><p className="eyebrow">PRICE & SALES HISTORY</p><h2>價格／銷量變化</h2><p>銷量採 Amazon 商品頁公開的「bought in past month」區間下限，不代表精確訂單數。</p></div>
          <div className="history-controls">
            <label><span>查看 SKU</span><select value={selectedId} onChange={(event) => setProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.role === 'competitor' ? 'iPaw' : '我方'}</option>)}</select></label>
            <label><span>期間</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={365}>近 365 天</option></select></label>
          </div>
        </div>

        <div className="history-kpis">
          <div><span>目前選擇</span><strong>{selected?.sku || '—'}</strong><small>{selected?.asin || ''}</small></div>
          <div><span>最新價格</span><strong>{usd(latest?.currentPrice)}</strong><small>{latest?.status === 'available' ? '在售' : latest?.availability || '尚無資料'}</small></div>
          <div><span>近月購買量</span><strong>{Number.isFinite(latest?.monthlyBoughtLowerBound) ? `${integer(latest.monthlyBoughtLowerBound)}+` : '未顯示'}</strong><small>{latest?.monthlyBoughtText || 'Amazon 本輪未提供公開標示'}</small></div>
          <div><span>已累積</span><strong>{history.length}<small> / 365 天</small></strong><small>{firstDate && latestDate ? `${firstDate}～${latestDate}` : '從首次新版擷取開始累積'}</small></div>
        </div>

        <div className="chart-grid">
          <article className="chart-card"><div><span>PRICE</span><strong>價格變化（USD）</strong><small>{priceSeries.filter((point) => Number.isFinite(point.value)).length} 個有效日期點</small></div><SparkChart series={priceSeries} format={(value) => `$${value.toFixed(2)}`} emptyText="尚未累積可繪製的價格資料。" /></article>
          <article className="chart-card sales"><div><span>MONTHLY BOUGHT</span><strong>近月購買量下限</strong><small>{salesSeries.filter((point) => Number.isFinite(point.value)).length} 個有效日期點</small></div><SparkChart series={salesSeries} format={(value) => `${integer(value)}+`} emptyText="Amazon 尚未公開此 SKU 的 bought in past month 標示。" /></article>
        </div>

        <div className="sales-snapshot">
          <div className="snapshot-title"><strong>本輪公開購買量</strong><span>有顯示才記錄；未顯示不估算</span></div>
          <div className="snapshot-grid">{products.map((product) => {
            const result = resultsById.get(product.id);
            return <button type="button" className={product.id === selectedId ? 'active' : ''} key={product.id} onClick={() => setProductId(product.id)}><span>{product.sku}<small>{product.role === 'competitor' ? 'iPaw' : '我方'}</small></span><strong>{Number.isFinite(result?.monthlyBoughtLowerBound) ? `${integer(result.monthlyBoughtLowerBound)}+` : '—'}</strong></button>;
          })}</div>
        </div>
      </div>
    </details>
  );
}
