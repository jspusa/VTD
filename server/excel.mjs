import ExcelJS from 'exceljs';

const STATUS_LABELS = {
  available: '在售',
  price_found: '已讀取價格',
  available_no_price: '在售／未讀取價格',
  unavailable: '缺貨／無報價',
  delivery_unavailable: '配送地點不可送',
  cart_price: '購物車內顯示',
  blocked: 'Amazon 驗證頁',
  missing: '頁面不存在',
  asin_mismatch: 'ASIN 規格不符',
  skipped: '本批次略過',
  error: '擷取失敗',
  unknown: '未能判定',
};

const roundPrice = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function analyzePair(competitor, own) {
  if (!Number.isFinite(competitor?.currentPrice)) {
    return { recommendation: '資料不足：待取得 iPaw 價格後判斷', state: 'insufficient' };
  }
  const target = roundPrice(Math.max(0, competitor.currentPrice - 2));
  if (!Number.isFinite(own?.currentPrice)) {
    return { target, recommendation: `我方建議售價 $${target.toFixed(2)}`, state: 'suggested' };
  }
  const gap = roundPrice(competitor.currentPrice - own.currentPrice);
  const adjustment = roundPrice(target - own.currentPrice);
  if (Math.abs(adjustment) < 0.005) return { gap, target, recommendation: '無須調整', state: 'matched' };
  if (adjustment < 0) return { gap, target, recommendation: `降價 $${Math.abs(adjustment).toFixed(2)} → $${target.toFixed(2)}`, state: 'lower' };
  return { gap, target, recommendation: `漲價 $${adjustment.toFixed(2)} → $${target.toFixed(2)}`, state: 'raise' };
}

function buildPairs(results = []) {
  const grouped = new Map();
  for (const result of results) {
    const pairId = result.pairId || result.id;
    if (!grouped.has(pairId)) grouped.set(pairId, { pairId });
    grouped.get(pairId)[result.role === 'own' ? 'own' : 'competitor'] = result;
  }
  return [...grouped.values()];
}

export async function buildWorkbook(run) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'iPaw Amazon Price Monitor';
  workbook.created = new Date(run.startedAt);
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('六組價格對照', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet.mergeCells('A1:K1');
  const title = sheet.getCell('A1');
  title.value = `iPaw vs. 我方 — 美國 Amazon 六組 SKU 價格對照｜擷取時間：${new Date(run.finishedAt || run.startedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`;
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2925' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 32;

  const columns = [
    ['iPaw 品號', 15], ['iPaw ASIN', 15], ['iPaw 狀況', 20], ['iPaw 價格', 14],
    ['我方 SKU', 16], ['我方 ASIN', 15], ['我方庫存', 20], ['我方價格', 14],
    ['目標價格', 30], ['擷取時間', 21], ['錯誤／備註', 42],
  ];
  sheet.columns = columns.map(([header, width]) => ({ header, width }));
  const header = sheet.getRow(2);
  columns.forEach(([label], index) => { header.getCell(index + 1).value = label; });
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF335B50' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 34;
  [5, 6, 7, 8].forEach((column) => {
    header.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF426D86' } };
  });

  buildPairs(run.results).forEach(({ competitor, own }) => {
    const analysis = analyzePair(competitor, own);
    const row = sheet.addRow([
      competitor?.sku,
      competitor ? { text: competitor.asin, hyperlink: competitor.finalUrl || `https://www.amazon.com/dp/${competitor.asin}` } : '',
      competitor ? `${STATUS_LABELS[competitor.status] ?? competitor.status}${competitor.availability ? `｜${competitor.availability}` : ''}` : '無資料',
      competitor?.currentPrice,
      own?.sku,
      own ? { text: own.asin, hyperlink: own.finalUrl || `https://www.amazon.com/dp/${own.asin}` } : '',
      own ? `${STATUS_LABELS[own.status] ?? own.status}${own.availability ? `｜${own.availability}` : ''}` : '無資料',
      own?.currentPrice,
      `${Number.isFinite(analysis.target) ? `$${analysis.target.toFixed(2)}` : '—'}\n${analysis.recommendation}`,
      new Date(competitor?.scrapedAt || own?.scrapedAt || run.finishedAt || run.startedAt),
      [competitor?.error, own?.error].filter(Boolean).join('｜'),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    [5, 6, 7, 8].forEach((column) => {
      row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3F8' } };
    });
    [4, 8].forEach((column) => { row.getCell(column).numFmt = '$0.00;[Red]-$0.00'; });
    row.getCell(10).numFmt = 'yyyy-mm-dd hh:mm:ss';
    [2, 6].forEach((column) => { row.getCell(column).font = { color: { argb: 'FF1677C8' }, underline: true }; });
    const recommendationCell = row.getCell(9);
    if (analysis.state === 'matched') recommendationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2E9' } };
    else if (analysis.state === 'lower') recommendationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE2DE' } };
    else recommendationCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0CC' } };
    if (analysis.state !== 'insufficient') recommendationCell.font = { bold: true };
  });

  sheet.autoFilter = { from: 'A2', to: 'K2' };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        if (!cell.fill?.fgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8F6' } };
      });
    }
  });

  const meta = workbook.addWorksheet('擷取資訊');
  meta.columns = [{ width: 24 }, { width: 80 }];
  meta.addRows([
    ['欄位', '內容'],
    ['擷取批次 ID', run.id],
    ['開始時間', new Date(run.startedAt)],
    ['完成時間', new Date(run.finishedAt)],
    ['美國配送郵遞區號', run.options?.zipCode || '10001'],
    ['擷取模式', run.options?.headless === false ? '顯示瀏覽器' : '背景執行'],
    ['SKU 對照組數', buildPairs(run.results).length],
    ['調價規則', '我方目標售價＝iPaw 即時售價－US$2.00。低不到 US$2 建議降價；低超過 US$2 建議提高售價。'],
    ['說明', 'Amazon 顯示價格會受配送地點、登入狀態、優惠資格、Subscribe & Save 與購物車隱藏價影響。工具不會猜測未讀取到的價格。'],
  ]);
  meta.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  meta.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF335B50' } };
  meta.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  meta.getCell('B3').numFmt = 'yyyy-mm-dd hh:mm:ss';
  meta.getCell('B4').numFmt = 'yyyy-mm-dd hh:mm:ss';

  return workbook;
}
