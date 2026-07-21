# iPaw Amazon Price Monitor

這是一套可重複使用的美國 Amazon 價格監測工具，已內建六組 iPaw 與我方 SKU，共 12 個 ASIN。

目前版本：**v1.9.0**

## GitHub 免費網頁版（推薦）

此版本可直接部署到公開 GitHub Pages，同事只需開啟網址，不需下載或登入 GitHub。

- 週一至週五台灣時間 09:27、11:27、13:27、15:27、17:27、19:27 自動擷取。
- 週六、週日台灣時間 09:27、19:27 自動擷取；國定假日若落在平日，仍依平日排程執行。
- GitHub 後台每 30 分鐘檢查一次；已有該目標時段的新資料便直接結束，漏更新時會持續補抓。
- 開啟中的網頁每 5 分鐘靜默同步最新資料，切回分頁時也會立即檢查。
- 管理者可從網頁的「管理者手動更新」前往 GitHub，或在 **Actions → Update Amazon prices → Run workflow** 臨時更新。
- 同事開啟網頁即可讀取部署完成的最新結果；前台不提供擷取按鈕。
- 每次更新同時產生最新 Excel。
- 每次擷取同步讀取 Amazon 公開的 `bought in past month` 標示；同一天只保留最後一筆。
- 每日價格與近月購買量歷史會寫回 GitHub，滾動保留最近 365 個日曆日。
- 「額外功能」可依 SKU 查看 30／90／365 天的價格與近月購買量下限圖表。
- 已加入 `noindex` 與 `robots.txt`，降低搜尋引擎收錄機率，但公開網站仍不是權限保護。

部署步驟：

1. 在 GitHub 建立一個 **Public** 空白 Repository。
2. 將本專案的內容放在 Repository 根目錄；`.github/workflows/update-prices.yml` 必須一併上傳。
3. 到 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
4. 到 **Actions → Update Amazon prices → Run workflow** 執行第一次更新。
5. 完成後，GitHub 會在該次執行頁與 Pages 設定中顯示網站網址。

## 主要功能

- Amazon 商品頁當下可見的即時售價
- 刪除線原價
- Coupon／折扣文字
- 庫存與 Featured Offer 狀態
- 賣家、商品標題、最終商品網址與擷取時間
- Amazon 公開顯示的近月購買量區間下限（若商品頁有提供）
- 以不同底色清楚區隔 iPaw 與我方 SKU
- 指定單品同時遵守「iPaw 售價減 US$2.00」與「最高 US$19.99」
- 五包裝取「iPaw 減 US$2.00」與「單包 × 5 − US$1.00 後向下取 .99」的較低值
- 十包裝取「iPaw 減 US$2.00」、「單包 × 10 − US$2.00」與「五包 × 2 − US$1.99」的最低值
- 計算結果為整數時只向下減 US$0.01 成為 `.99`，不向上湊價
- 目前售價低於允許上限時視為符合規則，不建議反向漲價
- 明確顯示降價、漲價或無須調整
- 若我方價格未讀取到，直接顯示依 iPaw 即時價格計算的建議售價
- 最新批次的 Excel 彙整檔

工具遇到「加入購物車才顯示價格」、CAPTCHA、人機驗證或沒有 Featured Offer 時，會明確標記，不會拿參考價冒充即時價格。
若 Amazon 把指定 ASIN 導向另一個規格，工具也會清空該列即時價格並標記「ASIN 規格不符」，避免採用錯誤變體的價格。

## macOS 使用方式

1. 安裝 [Node.js 20 以上版本](https://nodejs.org/)。
2. 解壓縮專案。
3. 連按兩下 `start.command`。
4. 第一次會安裝所需套件與 Chromium，完成後自動開啟 `http://127.0.0.1:8792`。

如果 macOS 阻擋 `start.command`，請對檔案按右鍵 →「打開」；或在終端機執行：

```bash
chmod +x start.command
./start.command
```

## 手動啟動

```bash
npm install
npx playwright install chromium
npm run build
npm start
```

開發模式：

```bash
npm run dev
```

前端位址為 `http://127.0.0.1:5173`，後端為 `http://127.0.0.1:8792`。

## 建議設定

- ZIP Code：填寫你想模擬的美國配送地點；預設 `10001`。
- 一般先使用背景執行。
- 若出現 Amazon 驗證頁，勾選「顯示擷取瀏覽器」後重試，必要時由使用者自行完成 Amazon 顯示的驗證。
- 不要高頻連續執行。程式預設每個 ASIN 間隔 3.5 秒，並一次只跑一個批次。

## 重要限制

Amazon 的價格可能因配送地點、登入狀態、Prime／Subscribe & Save 資格、Coupon 領取資格、賣家及購物車隱藏價而不同。Amazon 也可能變更網頁結構或限制自動化存取；因此本工具適合內部人工觸發與合理頻率的競品監測，不保證每次都能取得全部 ASIN。

`bought in past month` 是 Amazon 對外顯示的概略區間下限，例如 `700+` 只代表至少 700，並不是精確銷量；Amazon 沒有顯示時，工具會保留空值而不自行估算。

程式會先驗證 Amazon 頁首確實顯示指定的美國 ZIP Code，並強制使用 USD。若驗證失敗，整批會停止並顯示清楚原因，避免將台灣配送頁面的 `NT$` 誤認成美元。

若要長期排程、高成功率或大量 ASIN，建議日後把資料來源換成 Amazon Product Advertising API 或合規的商業價格資料 API；前端與 Excel 格式可以保留不變。

## 測試

```bash
npm test
npm run check
```
