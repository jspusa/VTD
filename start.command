#!/bin/bash
set -e

APP_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$APP_DIR"
export IPAW_DATA_DIR="$HOME/Library/Application Support/iPaw SKU Price Guard/data"

if ! command -v node >/dev/null 2>&1; then
  echo "尚未安裝 Node.js。請先至 https://nodejs.org 安裝 Node.js 20 以上版本。"
  read -r -p "按 Enter 關閉…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次執行：正在安裝程式套件…"
  npm install
fi

echo "正在檢查擷取用 Chromium…"
npx playwright install chromium

echo "正在建立並啟動 iPaw Amazon Price Monitor…"
npm run build

(sleep 2; open "http://127.0.0.1:8792") &
npm start
