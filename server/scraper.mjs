const PRICE_SELECTORS = [
  '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
  '#corePrice_feature_div .priceToPay .a-offscreen',
  '#corePrice_desktop .priceToPay .a-offscreen',
  '#apex_desktop .priceToPay .a-offscreen',
  '#desktop_buybox .priceToPay .a-offscreen',
  '#buybox .priceToPay .a-offscreen',
  '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
  '#desktop_buybox .a-price:not(.a-text-price) .a-offscreen',
  '#buybox .a-price:not(.a-text-price) .a-offscreen',
  '#price_inside_buybox',
  '#newBuyBoxPrice',
  '.reinventPricePriceToPayMargin .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
];

const LIST_PRICE_SELECTORS = [
  '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
  '#apex_desktop .basisPrice .a-offscreen',
  '#apex_desktop .a-text-price .a-offscreen',
  '[data-a-strike="true"] .a-offscreen',
  '.a-text-price .a-offscreen',
  '#listPrice',
];

export function parseUsd(text) {
  if (text === null || text === undefined) return null;
  const normalized = String(text).replace(/\u00a0/g, ' ').replace(/,/g, '');
  if (/(?:NT\$|TWD|CA\$|C\$|AU\$|AUD|HK\$|£|€|¥)/i.test(normalized)) return null;
  const match = normalized.match(/(?:US\$|USD\s*|(?<![A-Za-z])\$)\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function uniquePrices(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!Number.isFinite(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function parseStructuredPrice(text) {
  const usd = parseUsd(text);
  if (usd !== null) return usd;
  const normalized = String(text ?? '').replace(/,/g, '').trim();
  if (/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
  }
  const priceAmount = normalized.match(/"priceAmount"\s*:\s*(\d+(?:\.\d{1,2})?)/i);
  if (priceAmount) return Number.parseFloat(priceAmount[1]);
  return null;
}

function closestPlausiblePrice(prices, baselinePrice) {
  if (!prices.length) return null;
  if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) return prices.length === 1 ? prices[0] : null;
  const plausible = prices.filter((price) => price >= baselinePrice * 0.25 && price <= baselinePrice * 4);
  if (!plausible.length) return null;
  return plausible.sort((a, b) => Math.abs(a - baselinePrice) - Math.abs(b - baselinePrice))[0];
}

export function interpretSnapshot(snapshot) {
  const body = snapshot.bodyText ?? '';
  const captcha = /enter the characters you see below|type the characters you see in this image|sorry, we just need to make sure you're not a robot|validatecaptcha/i.test(`${snapshot.title ?? ''} ${body} ${snapshot.url ?? ''}`);
  // "Dogs of Amazon" also appears in the normal Amazon footer, so it cannot
  // be used as evidence that a product page is missing.
  const pageMissing = /looking for something|page not found/i.test(body) || snapshot.httpStatus === 404;
  const hiddenPrice = /add this item to your cart to see the price|to see product details, add this item to your cart|see price in cart/i.test(body);
  const deliveryUnavailable = /cannot be shipped to your selected delivery location|not deliverable to this address|does not ship to your location/i.test(body);

  if (captcha) {
    return { status: 'blocked', availability: 'Amazon 驗證頁', error: 'Amazon 要求 CAPTCHA／人機驗證，未嘗試繞過。' };
  }
  if (pageMissing) {
    return { status: 'missing', availability: '頁面不存在', error: '找不到商品頁或 ASIN 已失效。' };
  }

  const priceDetails = snapshot.priceDetails ?? [];
  const composedPriceCandidates = uniquePrices(
    priceDetails
      .filter((detail) => !detail.isTextPrice && !detail.isUnit)
      .map((detail) => parseUsd(detail.text)),
  );
  const selectorPriceCandidates = uniquePrices((snapshot.priceTexts ?? []).map(parseUsd));
  const structuredPriceCandidates = uniquePrices((snapshot.structuredPriceValues ?? []).map(parseStructuredPrice));
  const priceCandidates = uniquePrices([
    ...composedPriceCandidates,
    ...selectorPriceCandidates,
    ...structuredPriceCandidates,
  ]);
  const listPriceCandidates = uniquePrices((snapshot.listPriceTexts ?? []).map(parseUsd));
  const struckListPriceCandidates = uniquePrices(
    priceDetails
      .filter((detail) => detail.isStruck && !detail.isUnit)
      .map((detail) => parseUsd(detail.text)),
  );
  const nonUnitTextPriceCandidates = uniquePrices(
    priceDetails
      .filter((detail) => detail.isTextPrice && !detail.isUnit && !detail.isStruck)
      .map((detail) => parseUsd(detail.text)),
  );
  const currentPrice = priceCandidates[0]
    ?? closestPlausiblePrice(nonUnitTextPriceCandidates, snapshot.baselinePrice)
    ?? null;
  const listPrice = currentPrice === null
    ? null
    : uniquePrices([...struckListPriceCandidates, ...listPriceCandidates])
      .find((price) => price > currentPrice && price <= currentPrice * 3) ?? null;
  const availabilityText = (snapshot.availabilityText ?? '').trim();
  const outOfStock = /currently unavailable|temporarily out of stock|unavailable|no featured offers available/i.test(`${availabilityText} ${body.slice(0, 6000)}`);
  const inStock = snapshot.hasAddToCart || /in stock|available to ship/i.test(availabilityText);
  const diagnosticPrices = priceDetails
    .slice(0, 8)
    .map((detail) => `${detail.text}${detail.isUnit ? '（單位價）' : detail.isTextPrice ? '（文字價）' : '（主價格）'}`)
    .join('、');

  let status = 'unknown';
  let availability = availabilityText || '未能判定';
  if (deliveryUnavailable) {
    status = 'delivery_unavailable';
    availability = '目前配送地點不可送達';
  } else if (currentPrice !== null && inStock) {
    status = 'available';
    availability = availabilityText || '在售';
  } else if (currentPrice !== null) {
    status = 'price_found';
    availability = availabilityText || '已讀取價格，庫存待確認';
  } else if (hiddenPrice) {
    status = 'cart_price';
    availability = '需加入購物車查看價格';
  } else if (outOfStock) {
    status = 'unavailable';
    availability = availabilityText || '缺貨／無 Featured Offer';
  } else if (inStock) {
    status = 'available_no_price';
    availability = availabilityText || '可購買，但價格未出現在頁面';
  }

  return {
    status,
    availability,
    currentPrice,
    listPrice,
    coupon: snapshot.couponText || '',
    seller: snapshot.sellerText || '',
    productTitle: snapshot.productTitle || '',
    pageAsin: snapshot.pageAsin || '',
    finalUrl: snapshot.url || '',
    error: currentPrice === null && ['unknown', 'available_no_price'].includes(status)
      ? `頁面已開啟，但找不到整包主售價。${diagnosticPrices ? `偵測到：${diagnosticPrices}` : '未偵測到價格節點。'}`
      : '',
  };
}

async function readDeliveryLocation(page) {
  try {
    const locator = page.locator('#glow-ingress-line2');
    if (!(await locator.count())) return '';
    return (await locator.first().innerText()).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function verifyDeliveryZip(page, zipCode) {
  try {
    await page.goto('https://www.amazon.com/?language=en_US&currency=USD', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(900);
    const visibleLocation = await readDeliveryLocation(page);
    return { verified: visibleLocation.includes(zipCode), visibleLocation };
  } catch {
    return { verified: false, visibleLocation: '' };
  }
}

async function setDeliveryZip(page, context, zipCode) {
  if (!zipCode) return { applied: false, message: '' };
  let lastVisibleLocation = '';

  try {
    await page.goto('https://www.amazon.com/?language=en_US&currency=USD', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const locationButton = page.locator('#nav-global-location-popover-link');
    if (await locationButton.count()) {
      await locationButton.first().click({ timeout: 8_000 });
      const input = page.locator('#GLUXZipUpdateInput, input[data-action="GLUXPostalInputAction"]');
      const update = page.locator('#GLUXZipUpdate, input[aria-labelledby="GLUXZipUpdate-announce"]');
      if (await input.count() && await update.count()) {
        await input.first().fill(zipCode, { timeout: 8_000 });
        await update.first().click({ timeout: 8_000 });
        await page.waitForTimeout(2_200);
        const done = page.locator('#GLUXConfirmClose, button[name="glowDoneButton"]');
        if (await done.count()) await done.first().click().catch(() => {});
      }
    }
    const verification = await verifyDeliveryZip(page, zipCode);
    lastVisibleLocation = verification.visibleLocation;
    if (verification.verified) {
      return { applied: true, visibleLocation: verification.visibleLocation, message: `配送地點已確認：${verification.visibleLocation}` };
    }
  } catch {
    // The request-based fallback below uses the same Amazon session.
  }

  try {
    const csrfToken = await page.evaluate(() => document.querySelector('input[name="anti-csrftoken-a2z"]')?.value || '');
    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: 'https://www.amazon.com/',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (csrfToken) headers['anti-csrftoken-a2z'] = csrfToken;
    await context.request.post('https://www.amazon.com/gp/delivery/ajax/address-change.html', {
      form: {
        locationType: 'LOCATION_INPUT',
        zipCode,
        storeContext: 'generic',
        deviceType: 'web',
        pageType: 'Gateway',
        actionSource: 'glow',
      },
      headers,
      timeout: 20_000,
    });
    const verification = await verifyDeliveryZip(page, zipCode);
    lastVisibleLocation = verification.visibleLocation || lastVisibleLocation;
    if (verification.verified) {
      return { applied: true, visibleLocation: verification.visibleLocation, message: `配送地點已確認：${verification.visibleLocation}` };
    }
  } catch {
    // Report one concise, actionable error below.
  }

  const detected = lastVisibleLocation ? `目前 Amazon 顯示「${lastVisibleLocation}」` : 'Amazon 未回傳可驗證的配送地點';
  return {
    applied: false,
    visibleLocation: lastVisibleLocation,
    message: `無法確認美國 ZIP Code ${zipCode}（${detected}）。本次已停止，避免把台幣或錯誤地區價格當成美元。`,
  };
}

async function snapshotPage(page, httpStatus) {
  return page.evaluate(({ priceSelectors, listPriceSelectors, httpStatusValue }) => {
    const texts = (selectors) => selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean));
    const firstText = (selectors) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const raw = node?.innerText || node?.textContent || '';
        const value = raw.replace(/\s+/g, ' ').trim();
        if (value) return value.slice(0, 500);
      }
      return '';
    };
    const composePrice = (node) => {
      const offscreen = (node.querySelector('.a-offscreen')?.textContent || '').trim();
      if (offscreen) return offscreen;
      const symbol = (node.querySelector('.a-price-symbol')?.textContent || '$').trim();
      const whole = (node.querySelector('.a-price-whole')?.textContent || '').replace(/[^0-9]/g, '');
      const fraction = (node.querySelector('.a-price-fraction')?.textContent || '').replace(/[^0-9]/g, '');
      if (!whole) return '';
      return `${symbol}${whole}${fraction ? `.${fraction}` : ''}`;
    };
    const priceContainers = [
      '#corePriceDisplay_desktop_feature_div',
      '#corePrice_feature_div',
      '#corePrice_desktop',
      '#apex_desktop',
      '#desktop_buybox',
      '#buybox',
      '#price',
    ];
    const priceNodes = [];
    const seenNodes = new Set();
    for (const containerSelector of priceContainers) {
      const container = document.querySelector(containerSelector);
      if (!container) continue;
      for (const node of container.querySelectorAll('.a-price')) {
        if (seenNodes.has(node)) continue;
        seenNodes.add(node);
        const text = composePrice(node);
        if (!text) continue;
        const context = (node.parentElement?.innerText || node.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const isTextPrice = node.classList.contains('a-text-price');
        const isUnit = isTextPrice && /(?:\/|\bper\b)\s*(?:ounce|oz|count|100\s*g|lb|pound|piece|item)/i.test(context);
        const isStruck = Boolean(node.closest('.basisPrice, [data-a-strike="true"]'))
          || node.getAttribute('data-a-strike') === 'true';
        priceNodes.push({ text, context, isTextPrice, isUnit, isStruck });
      }
    }
    const structuredPriceValues = [
      '#twister-plus-price-data-price',
      '#attach-base-product-price',
      '#priceValue',
      '#newBuyBoxPrice',
      '#corePriceDisplay_desktop_feature_div [data-a-raw-price]',
      '#corePrice_feature_div [data-a-raw-price]',
      '#apex_desktop [data-a-raw-price]',
      '#desktop_buybox [data-a-raw-price]',
    ].flatMap((selector) => [...document.querySelectorAll(selector)].map((node) =>
      node.getAttribute('value')
      || node.getAttribute('data-a-raw-price')
      || node.getAttribute('data-price')
      || node.textContent
      || '').filter(Boolean));
    const urlAsin = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || '';
    return {
      url: location.href,
      title: document.title,
      httpStatus: httpStatusValue,
      bodyText: (document.body?.innerText || '').slice(0, 80_000),
      productTitle: firstText(['#productTitle', '#title']),
      pageAsin: document.querySelector('#ASIN')?.value || urlAsin,
      priceTexts: texts(priceSelectors),
      priceDetails: priceNodes,
      structuredPriceValues,
      listPriceTexts: texts(listPriceSelectors),
      couponText: firstText(['#couponTextpctch', '#couponText', '.couponBadge', '#promoPriceBlockMessage_feature_div']),
      availabilityText: firstText(['#availability > span', '#availability .a-color-success', '#availability .a-color-state', '#outOfStock', '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE', '#availability']).replace(/\s*\{[\s\S]*$/, ''),
      sellerText: firstText(['#sellerProfileTriggerId', '#merchant-info', '#tabular-buybox-truncate-1 .a-truncate-full']),
      hasAddToCart: Boolean(document.querySelector('#add-to-cart-button, input[name="submit.add-to-cart"]')),
    };
  }, { priceSelectors: PRICE_SELECTORS, listPriceSelectors: LIST_PRICE_SELECTORS, httpStatusValue: httpStatus });
}

async function gotoProductWithRetry(page, url, timeout) {
  try {
    return await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (error) {
    if (!/ERR_ABORTED/i.test(error.message)) throw error;
    await page.waitForTimeout(900);
    const productTitle = page.locator('#productTitle');
    if (await productTitle.count()) return null;
    return page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  }
}

function conciseError(error) {
  return String(error?.message || error || '未知錯誤')
    .replace(/\nCall log:[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

export async function scrapeProducts(products, options = {}, onProgress = () => {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright 尚未安裝。請先執行 npm install 與 npx playwright install chromium。');
  }

  const browser = await chromium.launch({
    headless: options.headless !== false,
    slowMo: options.headless === false ? 80 : 0,
  });
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    viewport: { width: 1440, height: 1100 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  await context.addCookies([
    { name: 'lc-main', value: 'en_US', domain: '.amazon.com', path: '/' },
    { name: 'i18n-prefs', value: 'USD', domain: '.amazon.com', path: '/' },
  ]);
  const page = await context.newPage();

  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['media', 'font'].includes(type)) await route.abort();
    else await route.continue();
  });

  const location = await setDeliveryZip(page, context, options.zipCode ?? '10001');
  onProgress({ type: 'location', ...location });
  if (!location.applied) {
    await context.close();
    await browser.close();
    throw new Error(location.message);
  }

  const results = [];
  try {
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      onProgress({ type: 'start', index, total: products.length, asin: product.asin });
      const startedAt = new Date().toISOString();
      try {
        const productUrl = `https://www.amazon.com/dp/${product.asin}?th=1&psc=1&language=en_US&currency=USD`;
        const response = await gotoProductWithRetry(page, productUrl, options.timeoutMs ?? 45_000);
        await page.waitForTimeout(options.pageWaitMs ?? 2_400);
        const snapshot = await snapshotPage(page, response?.status() ?? null);
        snapshot.baselinePrice = product.baselinePrice;
        let interpreted = interpretSnapshot(snapshot);
        if (interpreted.pageAsin && interpreted.pageAsin !== product.asin) {
          interpreted = {
            ...interpreted,
            status: 'asin_mismatch',
            availability: 'Amazon 導向其他規格',
            currentPrice: null,
            listPrice: null,
            error: `要求 ${product.asin}，但 Amazon 頁面目前選取 ${interpreted.pageAsin}；為避免抓錯規格，未採用頁面價格。`,
          };
        }
        const result = { ...product, ...interpreted, scrapedAt: new Date().toISOString(), startedAt };
        results.push(result);
        onProgress({ type: 'result', index, total: products.length, result });

        if (interpreted.status === 'blocked') {
          onProgress({ type: 'warning', message: 'Amazon 已顯示人機驗證，本次停止以避免重複觸發。可改用「顯示瀏覽器」模式手動完成驗證後再試。' });
          for (const skippedProduct of products.slice(index + 1)) {
            const skipped = {
              ...skippedProduct,
              status: 'skipped',
              availability: '因 Amazon 驗證頁而略過',
              currentPrice: null,
              listPrice: null,
              coupon: '',
              seller: '',
              productTitle: '',
              pageAsin: '',
              finalUrl: `https://www.amazon.com/dp/${skippedProduct.asin}`,
              error: '同批次較早品項觸發 Amazon 人機驗證，為避免重複請求，本品項未擷取。',
              scrapedAt: new Date().toISOString(),
              startedAt: new Date().toISOString(),
            };
            results.push(skipped);
            onProgress({ type: 'result', index: results.length - 1, total: products.length, result: skipped });
          }
          break;
        }
      } catch (error) {
        const result = {
          ...product,
          status: 'error',
          availability: '擷取失敗',
          currentPrice: null,
          listPrice: null,
          coupon: '',
          seller: '',
          productTitle: '',
          pageAsin: '',
          finalUrl: `https://www.amazon.com/dp/${product.asin}`,
          error: conciseError(error),
          scrapedAt: new Date().toISOString(),
          startedAt,
        };
        results.push(result);
        onProgress({ type: 'result', index, total: products.length, result });
      }

      if (index < products.length - 1) {
        const delay = Math.max(1_500, Number(options.delayMs) || 3_500);
        await page.waitForTimeout(delay);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return { results, location };
}
