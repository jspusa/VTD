const PRICE_SELECTORS = [
  '#corePrice_feature_div .apex-pricetopay-accessibility-label',
  '#corePriceDisplay_desktop_feature_div .apex-pricetopay-accessibility-label',
  '#apex_desktop .apex-pricetopay-accessibility-label',
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
  'meta[itemprop="price"]',
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

export function parseMonthlyBought(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/(\d+(?:[,.]\d+)?)\s*([KMB]?)\s*\+\s*bought in past month/i);
  if (!match) return { text: '', lowerBound: null };
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2].toUpperCase()] ?? 1;
  const lowerBound = amount * multiplier;
  return {
    text: match[0],
    lowerBound: Number.isFinite(lowerBound) ? Math.round(lowerBound) : null,
  };
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
  const jsonPrice = normalized.match(/"(?:priceAmount|price|lowPrice)"\s*:\s*"?(\d+(?:\.\d{1,2})?)/i);
  if (jsonPrice) return Number.parseFloat(jsonPrice[1]);
  return null;
}

function decodeAmazonHtmlText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&dollar;|&#36;|&#x24;/gi, '$')
    .replace(/&period;|&#46;|&#x2e;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function matchedTexts(html, pattern) {
  const values = [];
  for (const match of String(html ?? '').matchAll(pattern)) {
    const value = decodeAmazonHtmlText(match[1]);
    if (value) values.push(value);
  }
  return values;
}

export function extractProductSignalsFromHtml(html) {
  const source = String(html ?? '');
  if (!source) return {
    priceTexts: [], productTitle: '', pageAsin: '', availabilityText: '', hasAddToCart: false,
  };

  // Amazon sometimes returns the complete price in the navigation response,
  // then omits the price widget from the hydrated DOM. Keep this fallback
  // strictly scoped to the one-time-purchase offer. Subscribe & Save, unit,
  // recommendation and struck "Typical price" values are not valid here.
  const oneTimeStart = source.search(/id=["']newAccordionRow_0["']/i);
  const laterBuyingOption = oneTimeStart >= 0
    ? source.slice(oneTimeStart + 1).search(/id=["'](?:snsAccordionRow|usedAccordionRow|newAccordionRow_1)/i)
    : -1;
  const oneTimeEnd = laterBuyingOption >= 0 ? oneTimeStart + 1 + laterBuyingOption : source.length;
  const oneTimeSection = oneTimeStart >= 0 ? source.slice(oneTimeStart, oneTimeEnd) : '';

  const directOneTimePrices = matchedTexts(
    oneTimeSection,
    /class=["'][^"']*apex-pricetopay-accessibility-label[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
  );
  const labeledOneTimePrices = matchedTexts(
    source,
    /data-basisprice-label=["'][^"']*["'][^>]*>\s*(One-Time Price:\s*(?:US\$|USD\s*|\$)\s*\d+(?:[.,]\d{1,2})?)[\s\S]*?<\/span>/gi,
  ).map((value) => value.replace(/^One-Time Price:\s*/i, ''));
  const legacyPrices = matchedTexts(
    source,
    /id=["'](?:price_inside_buybox|newBuyBoxPrice|priceblock_ourprice|priceblock_dealprice)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
  );
  const priceTexts = [...new Set([...directOneTimePrices, ...labeledOneTimePrices, ...legacyPrices])]
    .filter((value) => parseUsd(value) !== null);

  const title = matchedTexts(
    source,
    /id=["'](?:productTitle|title)["'][^>]*>([\s\S]*?)<\/(?:span|h1)>/gi,
  )[0] ?? '';
  const hiddenAsin = source.match(/id=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})["']/i)?.[1]
    || source.match(/value=["']([A-Z0-9]{10})["'][^>]*id=["']ASIN["']/i)?.[1]
    || '';
  const availabilityText = matchedTexts(
    source,
    /id=["']availability["'][^>]*>([\s\S]*?)<\/div>/gi,
  )[0] ?? '';

  return {
    priceTexts,
    productTitle: title,
    pageAsin: hiddenAsin,
    availabilityText,
    hasAddToCart: /id=["']add-to-cart-button["']|name=["']submit\.add-to-cart["']/i.test(source),
  };
}

export function mergeSnapshotWithHtml(snapshot, html) {
  const signals = extractProductSignalsFromHtml(html);
  return {
    ...snapshot,
    productTitle: snapshot.productTitle || signals.productTitle,
    pageAsin: snapshot.pageAsin || signals.pageAsin,
    availabilityText: snapshot.availabilityText || signals.availabilityText,
    hasAddToCart: snapshot.hasAddToCart || signals.hasAddToCart,
    structuredPriceValues: [
      ...(snapshot.structuredPriceValues ?? []),
      ...signals.priceTexts,
    ],
  };
}

export function buildExactSearchResultSnapshot(result, product) {
  const asin = String(result?.asin ?? '').trim().toUpperCase();
  if (!asin || asin !== String(product?.asin ?? '').trim().toUpperCase()) return null;
  const priceTexts = [...new Set(result?.priceTexts ?? [])]
    .filter((value) => parseUsd(value) !== null);
  if (!priceTexts.length) return null;
  return {
    url: `https://www.amazon.com/dp/${product.asin}`,
    title: result.productTitle || 'Amazon.com',
    httpStatus: 200,
    bodyText: result.bodyText || result.productTitle || '',
    productTitle: result.productTitle || '',
    pageAsin: asin,
    priceTexts,
    priceDetails: [],
    structuredPriceValues: [],
    listPriceTexts: [],
    couponText: '',
    availabilityText: 'In Stock',
    sellerText: '',
    salesVolumeText: result.salesVolumeText || '',
    hasAddToCart: true,
    baselinePrice: product.baselinePrice,
    priceSource: 'exact_asin_search_result',
  };
}

export function buildExactOfferSnapshot(result, product) {
  const asin = String(result?.asin ?? '').trim().toUpperCase();
  if (!asin || asin !== String(product?.asin ?? '').trim().toUpperCase()) return null;
  const priceTexts = [...new Set(result?.priceTexts ?? [])]
    .filter((value) => parseUsd(value) !== null);
  if (!priceTexts.length) return null;
  return {
    url: `https://www.amazon.com/dp/${product.asin}`,
    title: result.productTitle || 'Amazon.com',
    httpStatus: 200,
    bodyText: result.bodyText || result.productTitle || '',
    productTitle: result.productTitle || '',
    pageAsin: asin,
    priceTexts,
    priceDetails: [],
    structuredPriceValues: [],
    listPriceTexts: [],
    couponText: '',
    availabilityText: 'In Stock',
    sellerText: result.sellerText || '',
    salesVolumeText: '',
    hasAddToCart: true,
    baselinePrice: product.baselinePrice,
    priceSource: 'amazon_all_offers',
  };
}

function closestPlausiblePrice(prices, baselinePrice) {
  if (!prices.length) return null;
  if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) return prices.length === 1 ? prices[0] : null;
  const plausible = prices.filter((price) => price >= baselinePrice * 0.25 && price <= baselinePrice * 4);
  if (!plausible.length) return null;
  return plausible.sort((a, b) => Math.abs(a - baselinePrice) - Math.abs(b - baselinePrice))[0];
}

export function isIncompleteProductSnapshot(snapshot) {
  return Boolean(snapshot.pageAsin)
    && !snapshot.productTitle
    && !snapshot.hasAddToCart
    && !(snapshot.availabilityText ?? '').trim()
    && (snapshot.priceTexts?.length ?? 0) === 0
    && (snapshot.priceDetails?.length ?? 0) === 0
    && (snapshot.structuredPriceValues?.length ?? 0) === 0;
}

export function shouldRetryMissingPriceSnapshot(snapshot) {
  const interpreted = interpretSnapshot(snapshot);
  return interpreted.currentPrice === null
    && ['unknown', 'available_no_price'].includes(interpreted.status);
}

export function interpretSnapshot(snapshot) {
  const body = snapshot.bodyText ?? '';
  const monthlyBought = parseMonthlyBought(snapshot.salesVolumeText || body);
  const salesFields = {
    monthlyBoughtText: monthlyBought.text,
    monthlyBoughtLowerBound: monthlyBought.lowerBound,
  };
  const captcha = /enter the characters you see below|type the characters you see in this image|sorry, we just need to make sure you're not a robot|validatecaptcha/i.test(`${snapshot.title ?? ''} ${body} ${snapshot.url ?? ''}`);
  // Amazon can render generic "Looking for something?" copy and "Dogs of
  // Amazon" links on a valid product page. Only trust those phrases when the
  // page also lacks concrete product evidence.
  const missingCopy = /looking for something|page not found/i.test(body);
  const hasRenderedProductEvidence = Boolean(snapshot.productTitle)
    || Boolean(snapshot.hasAddToCart)
    || (snapshot.priceTexts?.length ?? 0) > 0
    || (snapshot.priceDetails?.length ?? 0) > 0;
  const pageMissing = snapshot.httpStatus === 404 || (missingCopy && !hasRenderedProductEvidence);
  const hasProductEvidence = hasRenderedProductEvidence || Boolean(snapshot.pageAsin);
  const hiddenPrice = /add this item to your cart to see the price|to see product details, add this item to your cart|see price in cart/i.test(body);
  const deliveryUnavailable = /cannot be shipped to your selected delivery location|not deliverable to this address|does not ship to your location/i.test(body);

  if (captcha) {
    return { status: 'blocked', availability: 'Amazon 驗證頁', error: 'Amazon 要求 CAPTCHA／人機驗證，未嘗試繞過。', ...salesFields };
  }
  if (pageMissing) {
    return { status: 'missing', availability: '頁面不存在', error: '找不到商品頁或 ASIN 已失效。', ...salesFields };
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
  } else if (hasProductEvidence) {
    status = 'available_no_price';
    availability = '商品頁已確認，價格暫未顯示';
  }

  return {
    status,
    availability,
    currentPrice,
    listPrice,
    priceSource: snapshot.priceSource || 'amazon_product_page',
    coupon: snapshot.couponText || '',
    seller: snapshot.sellerText || '',
    productTitle: snapshot.productTitle || '',
    pageAsin: snapshot.pageAsin || '',
    finalUrl: snapshot.url || '',
    ...salesFields,
    error: currentPrice === null && ['unknown', 'available_no_price'].includes(status)
      ? `頁面已開啟，但找不到整包主售價。${diagnosticPrices ? `偵測到：${diagnosticPrices}` : '未偵測到價格節點。'}`
      : '',
  };
}

function amazonComUrlAsin(value) {
  try {
    const url = new URL(String(value ?? ''));
    const hostname = url.hostname.toLowerCase();
    const isAmazonCom = hostname === 'amazon.com' || hostname.endsWith('.amazon.com');
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || '';
    return { isAmazonCom, asin: asin.toUpperCase() };
  } catch {
    return { isAmazonCom: false, asin: '' };
  }
}

function approximatelyEqual(left, right) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) < 0.001;
}

function explicitUsdValue(value, expectedPrice) {
  const text = String(value ?? '');
  if (!/(?:US\$|USD\s*|(?<![A-Za-z])\$)\s*\d/i.test(text)) return false;
  return approximatelyEqual(parseUsd(text), expectedPrice);
}

export function verifyAmazonUsdPrice(snapshot, expectedAsin, expectedPrice) {
  const urlEvidence = amazonComUrlAsin(snapshot?.url);
  const pageAsin = String(snapshot?.pageAsin || urlEvidence.asin || '').trim().toUpperCase();
  const normalizedExpectedAsin = String(expectedAsin ?? '').trim().toUpperCase();
  const directPriceValues = [
    ...(snapshot?.priceTexts ?? []),
    ...(snapshot?.priceDetails ?? [])
      .filter((detail) => !detail.isUnit && (!detail.isTextPrice || !detail.isStruck))
      .map((detail) => detail.text),
  ];
  const structuredValues = snapshot?.structuredPriceValues ?? [];
  const explicitUsd = directPriceValues.some((value) => explicitUsdValue(value, expectedPrice))
    || structuredValues.some((value) => explicitUsdValue(value, expectedPrice))
    || structuredValues.some((value) => {
      const text = String(value ?? '');
      return /"(?:priceCurrency|currency)"\s*:\s*"USD"/i.test(text)
        && approximatelyEqual(parseStructuredPrice(text), expectedPrice);
    });

  const hostVerified = urlEvidence.isAmazonCom;
  const asinVerified = Boolean(normalizedExpectedAsin) && pageAsin === normalizedExpectedAsin;
  return {
    verified: hostVerified && asinVerified && explicitUsd,
    hostVerified,
    asinVerified,
    currencyVerified: explicitUsd,
    pageAsin,
  };
}

export function finalizeProductSnapshot(snapshot, product, location) {
  let interpreted = interpretSnapshot(snapshot);
  const expectedAsin = String(product?.asin ?? '').trim().toUpperCase();
  const urlAsin = amazonComUrlAsin(snapshot?.url).asin;
  const actualAsin = String(interpreted.pageAsin || urlAsin || '').trim().toUpperCase();

  if (actualAsin && actualAsin !== expectedAsin) {
    return {
      ...interpreted,
      status: 'asin_mismatch',
      availability: 'Amazon 導向其他規格',
      currentPrice: null,
      listPrice: null,
      locationValidation: location?.applied ? 'zip_10001' : 'unverified',
      error: `要求 ${expectedAsin}，但 Amazon 頁面目前選取 ${actualAsin}；為避免抓錯規格，未採用頁面價格。`,
    };
  }

  if (Number.isFinite(interpreted.currentPrice)) {
    const usdValidation = verifyAmazonUsdPrice(
      snapshot,
      expectedAsin,
      interpreted.currentPrice,
    );
    if (!location?.applied && !usdValidation.verified) {
      return {
        ...interpreted,
        status: 'location_unverified',
        availability: '美元與美國站驗證未通過',
        currentPrice: null,
        listPrice: null,
        locationValidation: 'unverified',
        error: 'Amazon 未顯示 ZIP Code，且本頁未同時通過 Amazon.com、精確 ASIN 與明確 USD 價格驗證；已拒絕採用。',
      };
    }
    interpreted = {
      ...interpreted,
      currency: 'USD',
      locationValidation: location?.applied ? 'zip_10001' : 'amazon_com_exact_asin_usd',
    };
  } else if (!location?.applied
    && ['unavailable', 'delivery_unavailable'].includes(interpreted.status)) {
    interpreted = {
      ...interpreted,
      status: 'location_unverified',
      availability: '配送地點尚未確認',
      locationValidation: 'unverified',
      error: 'Amazon 未顯示 ZIP Code，無法確認缺貨或不可配送是否只受目前配送地點影響；已阻止本批次發布。',
    };
  } else {
    interpreted = {
      ...interpreted,
      locationValidation: location?.applied ? 'zip_10001' : 'unverified',
    };
  }

  return interpreted;
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
      return {
        applied: true,
        verificationMode: 'zip',
        visibleLocation: verification.visibleLocation,
        message: `配送地點已確認：${verification.visibleLocation}`,
      };
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
      return {
        applied: true,
        verificationMode: 'zip',
        visibleLocation: verification.visibleLocation,
        message: `配送地點已確認：${verification.visibleLocation}`,
      };
    }
  } catch {
    // Report one concise, actionable error below.
  }

  const detected = lastVisibleLocation ? `目前 Amazon 顯示「${lastVisibleLocation}」` : 'Amazon 未回傳可驗證的配送地點';
  return {
    applied: false,
    verificationMode: 'strict_usd_page',
    visibleLocation: lastVisibleLocation,
    message: `無法從頁首文字確認美國 ZIP Code ${zipCode}（${detected}）。將繼續擷取，但只接受同時通過 Amazon.com、精確 ASIN 與明確 USD 驗證的價格。`,
  };
}

async function snapshotPage(page, httpStatus) {
  return page.evaluate(({ priceSelectors, listPriceSelectors, httpStatusValue }) => {
    const texts = (selectors) => selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]
        .map((node) => (node.getAttribute('content') || node.textContent || '').trim())
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
      'meta[itemprop="price"]',
    ].flatMap((selector) => [...document.querySelectorAll(selector)].map((node) =>
      node.getAttribute('value')
      || node.getAttribute('content')
      || node.getAttribute('data-a-raw-price')
      || node.getAttribute('data-price')
      || node.textContent
      || '').filter(Boolean));
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      const text = node.textContent || '';
      if (/"(?:price|lowPrice|highPrice)"\s*:/i.test(text)) structuredPriceValues.push(text);
    }
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
      salesVolumeText: firstText([
        '#social-proofing-faceout-title-tk_bought',
        '[data-csa-c-content-id="social-proofing-faceout-title-tk_bought"]',
        '.social-proofing-faceout-title-text',
        '[data-feature-name="socialProof"]',
      ]),
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

async function loadProductSnapshot(page, product, options) {
  const timeout = options.timeoutMs ?? 45_000;
  const allUrls = [
    `https://www.amazon.com/dp/${product.asin}?th=1&psc=1&language=en_US&currency=USD`,
    `https://www.amazon.com/dp/${product.asin}?language=en_US&currency=USD`,
    `https://www.amazon.com/gp/product/${product.asin}?psc=1&language=en_US&currency=USD`,
  ];
  const urlLimit = Math.max(1, Math.min(allUrls.length, Number(options.productUrlLimit) || allUrls.length));
  const urls = allUrls.slice(0, urlLimit);
  let bestSnapshot = null;

  for (let attempt = 0; attempt < urls.length; attempt += 1) {
    const response = await gotoProductWithRetry(page, urls[attempt], timeout);
    const responseHtmlPromise = response?.text().catch(() => '') ?? Promise.resolve('');
    await page.locator('#productTitle, #title, #corePrice_feature_div, #corePriceDisplay_desktop_feature_div, #apex_desktop, #add-to-cart-button, #buy-now-button')
      .first()
      .waitFor({ state: 'attached', timeout: attempt === 0 ? 6_000 : 10_000 })
      .catch(() => {});
    await page.waitForTimeout(attempt === 0
      ? (options.pageWaitMs ?? 2_800)
      : (options.retryPageWaitMs ?? 3_200));
    let snapshot = null;
    const responseHtml = await responseHtmlPromise;
    const observationCount = Math.max(1, Number(options.priceObservationCount) || 3);
    for (let observation = 0; observation < observationCount; observation += 1) {
      const renderedSnapshot = await snapshotPage(page, response?.status() ?? null);
      const renderedHtml = await page.content().catch(() => '');
      snapshot = mergeSnapshotWithHtml(
        mergeSnapshotWithHtml(renderedSnapshot, responseHtml),
        renderedHtml,
      );
      snapshot.baselinePrice = product.baselinePrice;
      if (!shouldRetryMissingPriceSnapshot(snapshot)) break;
      if (observation < observationCount - 1) {
        await page.waitForTimeout(options.priceObservationWaitMs ?? 1_800);
      }
    }

    const score = (candidate) => (candidate?.productTitle ? 2 : 0)
      + (candidate?.hasAddToCart ? 2 : 0)
      + (candidate?.priceTexts?.length ?? 0) * 4
      + (candidate?.priceDetails?.length ?? 0) * 3
      + (candidate?.structuredPriceValues?.length ?? 0) * 2;
    if (!bestSnapshot || score(snapshot) > score(bestSnapshot)) bestSnapshot = snapshot;

    if (!isIncompleteProductSnapshot(snapshot) && !shouldRetryMissingPriceSnapshot(snapshot)) {
      return snapshot;
    }
    if (attempt < urls.length - 1) await page.waitForTimeout(1_200);
  }

  return bestSnapshot;
}

async function loadExactSearchResultSnapshot(page, product, options) {
  const timeout = options.timeoutMs ?? 45_000;
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(product.asin)}&language=en_US&currency=USD`;
  await gotoProductWithRetry(page, searchUrl, timeout);
  const card = page.locator(`[data-asin="${product.asin}"]`).first();
  await card.waitFor({ state: 'attached', timeout: options.searchWaitMs ?? 10_000 }).catch(() => {});
  if (!(await card.count())) return null;
  const result = await card.evaluate((node) => {
    const priceTexts = [...node.querySelectorAll('.a-price:not(.a-text-price) .a-offscreen')]
      .map((priceNode) => (priceNode.textContent || '').trim())
      .filter(Boolean);
    const productTitle = (
      node.querySelector('h2 a span, h2 span, [data-cy="title-recipe"] span')
        ?.textContent || ''
    ).replace(/\s+/g, ' ').trim();
    const bodyText = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    const salesVolumeText = bodyText.match(/\d+(?:[,.]\d+)?\s*[KMB]?\s*\+\s*bought in past month/i)?.[0] || '';
    return {
      asin: node.getAttribute('data-asin') || '',
      priceTexts,
      productTitle,
      bodyText,
      salesVolumeText,
    };
  });
  return buildExactSearchResultSnapshot(result, product);
}

async function loadExactOfferSnapshot(page, product, options) {
  const timeout = options.timeoutMs ?? 45_000;
  const offersUrl = 'https://www.amazon.com/gp/product/ajax/ref=dp_aod_ALL_mbc'
    + `?asin=${encodeURIComponent(product.asin)}&pc=dp&experienceId=aodAjaxMain`;
  await gotoProductWithRetry(page, offersUrl, timeout);
  const offer = page.locator('#aod-price-0, #aod-offer').first();
  await offer.waitFor({ state: 'attached', timeout: options.offerWaitMs ?? 8_000 }).catch(() => {});
  if (!(await offer.count())) return null;
  const result = await page.evaluate((asin) => {
    const featuredPrices = [
      ...document.querySelectorAll('#aod-price-0 .a-price:not(.a-text-price) .a-offscreen'),
    ].map((node) => (node.textContent || '').trim()).filter(Boolean);
    const firstOfferPrices = featuredPrices.length
      ? featuredPrices
      : [...document.querySelectorAll('#aod-offer .a-price:not(.a-text-price) .a-offscreen')]
        .slice(0, 1)
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean);
    const firstOffer = document.querySelector('#aod-price-0')?.closest('#aod-offer')
      || document.querySelector('#aod-offer');
    const bodyText = (firstOffer?.innerText || firstOffer?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const sellerText = (
      firstOffer?.querySelector('#aod-offer-soldBy .a-size-small, #aod-offer-soldBy a')
        ?.textContent || ''
    ).replace(/\s+/g, ' ').trim();
    return {
      asin,
      priceTexts: firstOfferPrices,
      productTitle: '',
      bodyText,
      sellerText,
    };
  }, product.asin);
  return buildExactOfferSnapshot(result, product);
}

async function loadProductWithSearchFallback(page, product, options) {
  const productSnapshot = await loadProductSnapshot(page, product, options);
  if (!shouldRetryMissingPriceSnapshot(productSnapshot)) return productSnapshot;
  const offerSnapshot = await loadExactOfferSnapshot(page, product, options).catch(() => null);
  if (offerSnapshot) return offerSnapshot;
  const searchSnapshot = await loadExactSearchResultSnapshot(page, product, options).catch(() => null);
  return searchSnapshot || productSnapshot;
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
  const configurePage = async (page) => page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) await route.abort();
    else await route.continue();
  });
  const locationPage = await context.newPage();
  await configurePage(locationPage);

  const location = await setDeliveryZip(locationPage, context, options.zipCode ?? '10001');
  onProgress({ type: 'location', ...location });
  if (!location.applied) {
    onProgress({ type: 'warning', message: location.message });
  }
  await locationPage.close();

  const results = [];
  try {
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      onProgress({ type: 'start', index, total: products.length, asin: product.asin });
      const startedAt = new Date().toISOString();
      const page = await context.newPage();
      await configurePage(page);
      try {
        const snapshot = await loadProductWithSearchFallback(page, product, options);
        snapshot.baselinePrice = product.baselinePrice;
        const interpreted = finalizeProductSnapshot(snapshot, product, location);
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
      } finally {
        await page.close().catch(() => {});
      }

      if (index < products.length - 1) {
        const delay = Math.max(1_500, Number(options.delayMs) || 3_500);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const retryIndexes = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => !Number.isFinite(result.currentPrice)
        && ['unknown', 'available_no_price', 'error'].includes(result.status))
      .map(({ index }) => index);

    if (retryIndexes.length && options.sameRunnerRetry === false) {
      onProgress({
        type: 'warning',
        message: `本 runner 仍有 ${retryIndexes.length} 支缺價；略過相同出口環境的重抓，交由新的獨立 runner 補抓。`,
      });
    }

    if (retryIndexes.length && options.sameRunnerRetry !== false) {
      onProgress({
        type: 'warning',
        message: `第一階段仍有 ${retryIndexes.length} 支缺價，改用全新 Amazon 瀏覽情境集中補抓。`,
      });
      const retryContext = await browser.newContext({
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        viewport: { width: 1440, height: 1100 },
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
      });
      await retryContext.addCookies([
        { name: 'lc-main', value: 'en_US', domain: '.amazon.com', path: '/' },
        { name: 'i18n-prefs', value: 'USD', domain: '.amazon.com', path: '/' },
      ]);
      const retryLocationPage = await retryContext.newPage();
      await configurePage(retryLocationPage);
      const retryLocation = await setDeliveryZip(
        retryLocationPage,
        retryContext,
        options.zipCode ?? '10001',
      );
      await retryLocationPage.close();

      if (!retryLocation.applied) {
        onProgress({ type: 'warning', message: retryLocation.message });
      }
      for (const index of retryIndexes) {
        const product = products[index];
        const page = await retryContext.newPage();
        await configurePage(page);
        const startedAt = new Date().toISOString();
        try {
          const snapshot = await loadProductWithSearchFallback(page, product, {
            ...options,
            productUrlLimit: options.retryProductUrlLimit ?? 1,
            priceObservationCount: options.retryPriceObservationCount ?? 2,
          });
          snapshot.baselinePrice = product.baselinePrice;
          const interpreted = finalizeProductSnapshot(snapshot, product, retryLocation);
          if (Number.isFinite(interpreted.currentPrice)) {
            results[index] = {
              ...product,
              ...interpreted,
              scrapedAt: new Date().toISOString(),
              startedAt,
            };
          }
          onProgress({
            type: 'retry_result',
            index,
            total: retryIndexes.length,
            result: results[index],
          });
        } catch (error) {
          onProgress({
            type: 'warning',
            message: `${product.asin} 第二階段補抓失敗：${conciseError(error)}`,
          });
        } finally {
          await page.close().catch(() => {});
        }
        await new Promise((resolve) => setTimeout(
          resolve,
          Math.max(1_500, Number(options.retryDelayMs) || 2_500),
        ));
      }
      await retryContext.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return { results, location };
}
