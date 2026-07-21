import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isRunStale } from './schedule.js';
import PriceGuardGame from './PriceGuardGame.jsx';
import AdminGate from './AdminGate.jsx';
import GuardianChaos from './GuardianChaos.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import { analyzePairs } from './pricing.js';
import './styles.css';

const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === 'true';
const staticAsset = (name) => `${import.meta.env.BASE_URL}${name}`;
const ACTIONS_URL = import.meta.env.VITE_ACTIONS_URL || '';

const STATUS = {
  available: { label: '在售', tone: 'positive' },
  price_found: { label: '已讀取價格', tone: 'positive' },
  available_no_price: { label: '在售／無價格', tone: 'warning' },
  unavailable: { label: '停售／無報價', tone: 'neutral' },
  delivery_unavailable: { label: '配送地點不可送', tone: 'warning' },
  cart_price: { label: '購物車內顯示', tone: 'warning' },
  blocked: { label: 'Amazon 驗證頁', tone: 'negative' },
  missing: { label: '頁面不存在', tone: 'negative' },
  asin_mismatch: { label: 'ASIN 規格不符', tone: 'negative' },
  skipped: { label: '本批次略過', tone: 'neutral' },
  error: { label: '擷取失敗', tone: 'negative' },
  unknown: { label: '未能判定', tone: 'neutral' },
};

const money = (value) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  : '—';

const dateTime = (value) => value
  ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '尚未擷取';

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.4 9A7 7 0 0 0 6.7 6.4L4 9M20 15l-2.7 2.6A7 7 0 0 1 5.6 15"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    external: <><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `請求失敗（${response.status}）`);
  return data;
}

function ResultStatus({ result, fallback }) {
  if (!result) return <span className="status neutral">尚未擷取</span>;
  const status = STATUS[result.status] || STATUS.unknown;
  return <><span className={`status ${status.tone}`}>{status.label}</span><span className="cell-sub availability" title={result.availability}>{result.availability || ''}</span></>;
}

function TargetPrice({ analysis }) {
  const hasChecks = analysis.checks?.length > 0;
  return (
    <details className="price-reason">
      <summary aria-label={hasChecks ? `查看 ${analysis.checks.length} 個價格檢查點` : '查看價格狀態'}>
        <span className={`status target-price ${analysis.tone}`}>{money(analysis.targetPrice)}</span>
        <strong className={`recommendation ${analysis.state}`}>{analysis.recommendation}</strong>
      </summary>
      {hasChecks && (
        <div className="price-reason-panel">
          <div className="reason-heading"><strong>定價依據</strong><span>{analysis.checks.length} 個檢查點</span></div>
          <div className="reason-checks">
            {analysis.checks.map((check) => (
              <div className={check.selected ? 'selected' : ''} key={check.label}>
                <span>{check.label}{check.note && <small>{check.note}</small>}</span>
                <strong>{money(check.value)}</strong>
              </div>
            ))}
          </div>
          <p>採用最低允許價格 <strong>{money(analysis.targetPrice)}</strong></p>
        </div>
      )}
    </details>
  );
}

function App() {
  const [products, setProducts] = useState([]);
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [dailyHistory, setDailyHistory] = useState([]);
  const [job, setJob] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('全部狀態');
  const [zipCode, setZipCode] = useState('10001');
  const [showBrowser, setShowBrowser] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [gameOpen, setGameOpen] = useState(false);
  const [adminGateOpen, setAdminGateOpen] = useState(false);
  const [chaosMode, setChaosMode] = useState(null);

  const load = async () => {
    if (STATIC_MODE) {
      const cacheBuster = Date.now();
      const [payload, storedDailyHistory] = await Promise.all([
        api(`${staticAsset('latest-run.json')}?v=${cacheBuster}`, { cache: 'no-store' }),
        api(`${staticAsset('daily-history.json')}?v=${cacheBuster}`, { cache: 'no-store' }).catch(() => []),
      ]);
      setProducts(payload.products ?? []);
      setRun(payload.run ?? null);
      setDailyHistory(Array.isArray(storedDailyHistory) ? storedDailyHistory : []);
      setHistory(payload.run ? [{
        id: payload.run.id,
        finishedAt: payload.run.finishedAt,
        total: payload.run.results?.length ?? 0,
        found: payload.run.results?.filter((item) => Number.isFinite(item.currentPrice)).length ?? 0,
      }] : []);
      return;
    }
    const [productData, historyData] = await Promise.all([api('/api/products'), api('/api/history')]);
    setProducts(productData);
    setHistory(historyData);
    if (historyData[0]) setRun(await api(`/api/runs/${historyData[0].id}`));
  };

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  useEffect(() => {
    if (!STATIC_MODE) return undefined;
    const sync = () => load().catch((e) => setError(e.message));
    const timer = window.setInterval(sync, 5 * 60 * 1_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await api(`/api/jobs/${job.id}`);
        setJob(next);
        if (next.status === 'completed') {
          window.clearInterval(timer);
          const completedRun = await api(`/api/runs/${next.runId}`);
          setRun(completedRun);
          setHistory(await api('/api/history'));
          const priceCount = completedRun.results.filter((item) => Number.isFinite(item.currentPrice)).length;
          setMessage(`完成：6 組 SKU、12 個 ASIN 已處理，其中 ${priceCount} 個讀取到價格。`);
        } else if (next.status === 'failed') {
          window.clearInterval(timer);
          setError(next.error || '擷取失敗。');
        }
      } catch (e) {
        window.clearInterval(timer);
        setError(e.message);
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const resultsById = useMemo(() => new Map((run?.results ?? []).map((item) => [item.id, item])), [run]);
  const pairs = useMemo(() => {
    const grouped = new Map();
    for (const product of products) {
      if (!grouped.has(product.pairId)) grouped.set(product.pairId, { pairId: product.pairId });
      grouped.get(product.pairId)[product.role] = product;
    }
    const rawPairs = [...grouped.values()].map((pair) => {
      const competitorResult = resultsById.get(pair.competitor?.id);
      const ownResult = resultsById.get(pair.own?.id);
      return { ...pair, competitorResult, ownResult };
    });
    return analyzePairs(rawPairs);
  }, [products, resultsById]);

  const filteredPairs = useMemo(() => pairs.filter((pair) => {
    const query = search.trim().toLowerCase();
    const values = [pair.competitor?.sku, pair.competitor?.asin, pair.own?.sku, pair.own?.asin];
    const matchesSearch = !query || values.some((value) => String(value || '').toLowerCase().includes(query));
    const matchesFilter = filter === '全部狀態'
      || (filter === '需要調價' && ['lower', 'raise'].includes(pair.analysis.state))
      || (filter === '符合規則' && pair.analysis.state === 'matched')
      || (filter === '資料不足' && ['insufficient', 'suggested'].includes(pair.analysis.state));
    return matchesSearch && matchesFilter;
  }), [pairs, search, filter]);

  const summary = useMemo(() => ({
    complete: pairs.filter((pair) => ['matched', 'lower', 'raise'].includes(pair.analysis.state)).length,
    matched: pairs.filter((pair) => pair.analysis.state === 'matched').length,
    adjust: pairs.filter((pair) => ['lower', 'raise'].includes(pair.analysis.state)).length,
  }), [pairs]);
  const stale = STATIC_MODE && run && isRunStale(run.finishedAt);

  const busy = job && ['queued', 'running'].includes(job.status);
  const startScrape = async () => {
    setError(''); setMessage('');
    try {
      const response = await api('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipCode, headless: !showBrowser, delayMs: 3500 }),
      });
      setJob({ id: response.jobId, status: 'queued', current: 0, total: products.length, messages: [] });
    } catch (e) { setError(e.message); }
  };

  const openHistory = async (id) => {
    try { setRun(await api(`/api/runs/${id}`)); } catch (e) { setError(e.message); }
  };

  const triggerChaos = () => {
    setGameOpen(false);
    setAdminGateOpen(false);
    setChaosMode((current) => current || 'rage');
  };

  const openGame = () => {
    if (chaosMode) {
      setChaosMode('takeover');
      return;
    }
    setGameOpen(true);
  };

  const passAdminGate = () => {
    setAdminGateOpen(false);
    window.open(ACTIONS_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">iP</span><div><strong>SKU Price Guard</strong><span>{STATIC_MODE ? 'GitHub Pages' : 'Amazon US'} · v1.9</span></div></div>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">iPaw vs. Jasper Amazon US</p>
            <h1>六組 SKU 價格對照</h1>
            <p className="subtitle">目標規則：依 iPaw 價差、$19.99 上限與單包／組合包價格邏輯，採用最低允許售價上限。</p>
          </div>
          {STATIC_MODE
            ? <div className="static-schedule"><span>目標更新時間</span><strong>平日 09:27 · 11:27 · 13:27 · 15:27 · 17:27 · 19:27</strong><small>後台每 30 分鐘檢查缺漏；此頁每 5 分鐘自動同步最新結果</small></div>
            : <div className="run-settings" aria-label="擷取設定"><label><span>美國配送 ZIP Code</span><input inputMode="numeric" maxLength={5} value={zipCode} onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))} /></label><label className="switch-row"><input type="checkbox" checked={showBrowser} onChange={(e) => setShowBrowser(e.target.checked)} /><span className="switch" /><span>顯示擷取瀏覽器</span></label></div>}
        </section>

        <section className="summary-strip pair-summary">
          <div><span>SKU 對照組數</span><strong>{pairs.length}</strong></div>
          <div><span>雙邊價格完整</span><strong>{summary.complete}<small> / {pairs.length}</small></strong></div>
          <div><span>符合價格規則</span><strong>{summary.matched}</strong></div>
          <div><span>需要調價</span><strong>{summary.adjust}</strong></div>
          <div className="last-run"><span>目前顯示批次</span><strong>{dateTime(run?.finishedAt)}</strong></div>
        </section>

        {busy && <section className="progress-panel" aria-live="polite"><div className="progress-copy"><div><span className="pulse" />正在讀取 {job.asin || 'Amazon 商品頁'}</div><strong>{job.current ?? 0} / {job.total ?? products.length}</strong></div><div className="progress-track"><span style={{ width: `${Math.max(2, ((job.current ?? 0) / Math.max(1, job.total ?? products.length)) * 100)}%` }} /></div>{(job.messages ?? []).length > 0 && <p>{job.messages.at(-1)}</p>}</section>}

        {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}><Icon name={error ? 'close' : 'check'} />{error || message}<button onClick={() => { setError(''); setMessage(''); }} aria-label="關閉通知"><Icon name="close" size={15} /></button></div>}
        {stale && <div className="notice warning" role="alert"><Icon name="clock" />自動更新可能延遲：目前顯示的資料早於最近一個應完成的排程，請由管理者檢查 GitHub Actions。</div>}

        <section className="table-section">
          <div className="table-toolbar">
            <div className="filters"><label className="search-box"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋 SKU 或 ASIN" /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option>全部狀態</option><option>需要調價</option><option>符合規則</option><option>資料不足</option></select>{STATIC_MODE ? ACTIONS_URL && <button className="button secondary" type="button" onClick={() => setAdminGateOpen(true)}><Icon name="external" />管理者手動更新</button> : <button className="button primary" onClick={startScrape} disabled={busy || !products.length}><Icon name="refresh" />{busy ? '擷取中' : '立即擷取'}</button>}</div>
            <div className="history-actions">{!STATIC_MODE && history.length > 0 && <select value={run?.id ?? ''} onChange={(e) => openHistory(e.target.value)} aria-label="選擇歷史批次">{history.map((item) => <option key={item.id} value={item.id}>{dateTime(item.finishedAt)} · {item.found}/{item.total} 價格</option>)}</select>}<a className={`button secondary ${!run ? 'disabled' : ''}`} href={run ? (STATIC_MODE ? staticAsset('latest.xlsx') : `/api/export/${run.id}.xlsx`) : undefined}><Icon name="download" />匯出 Excel</a></div>
          </div>

          <div className="table-wrap">
            <table className="comparison-table">
              <thead><tr><th>iPaw 品號／ASIN</th><th>iPaw 狀況</th><th className="number">iPaw 價格</th><th className="own-column">我方 SKU／ASIN</th><th className="own-column">我方庫存</th><th className="number own-column">我方價格</th><th>目標價格</th><th>擷取資訊</th></tr></thead>
              <tbody key={run?.id || 'empty'}>
                {filteredPairs.map((pair) => (
                  <tr key={pair.pairId}>
                    <td><strong>{pair.competitor?.sku}</strong><a className="asin-link cell-link" href={`https://www.amazon.com/dp/${pair.competitor?.asin}`} target="_blank" rel="noreferrer">{pair.competitor?.asin}<Icon name="external" size={13} /></a></td>
                    <td><ResultStatus result={pair.competitorResult} fallback={pair.competitor?.baselineStatus} /></td>
                    <td className="number current-price">{money(pair.competitorResult?.currentPrice)}</td>
                    <td className="own-column"><strong>{pair.own?.sku}</strong><a className="asin-link cell-link" href={`https://www.amazon.com/dp/${pair.own?.asin}`} target="_blank" rel="noreferrer">{pair.own?.asin}<Icon name="external" size={13} /></a></td>
                    <td className="own-column"><ResultStatus result={pair.ownResult} fallback={pair.own?.baselineStatus} /></td>
                    <td className="number current-price own-column">{money(pair.ownResult?.currentPrice)}</td>
                    <td><TargetPrice analysis={pair.analysis} /></td>
                    <td><span>{pair.competitorResult || pair.ownResult ? dateTime(pair.competitorResult?.scrapedAt || pair.ownResult?.scrapedAt) : '—'}</span>{(pair.competitorResult?.error || pair.ownResult?.error) && <span className="cell-sub error-text pair-error" title={[pair.competitorResult?.error, pair.ownResult?.error].filter(Boolean).join('｜')}>{[pair.competitorResult?.error, pair.ownResult?.error].filter(Boolean).join('｜')}</span>}</td>
                  </tr>
                ))}
                {!filteredPairs.length && <tr className="empty-row"><td colSpan="8">沒有符合條件的 SKU 對照。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <HistoryPanel products={products} run={run} history={dailyHistory} />

        <footer><div><Icon name="clock" size={16} />調價公式：各項限制取最低；整數結果只向下調為 .99。</div><div className="footer-side"><span>單品最高 $19.99；五包與十包另受單包、五包售價連動限制。</span><button className="game-launch" onClick={openGame} data-chaos-safe="true">價格守門員小遊戲</button></div></footer>
      </main>
      <PriceGuardGame open={gameOpen} onClose={() => setGameOpen(false)} onFastClose={triggerChaos} />
      <AdminGate open={adminGateOpen} onSuccess={passAdminGate} onFail={triggerChaos} />
      <GuardianChaos mode={chaosMode} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
