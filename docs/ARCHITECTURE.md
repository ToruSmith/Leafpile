# 系統架構

Leafpile 沿用 Mdslide Pile 的分層：資料只往下流，**來源 → `core/` 解析 → 索引 → 介面**。新增來源只要實作來源介面；規則只有 `core/` 一份，瀏覽器與 Node 腳本共用。

```
┌ ① 資料來源 ─────────────────────────────────────────────────────────┐
│ HandleSource（Chrome/Edge，本機可寫）  FileListSource（其他瀏覽器，唯讀） │
│ HttpSource（GitHub Pages 的 content/）  EmbeddedSource（匯出的單一 HTML） │
└──────────────────────────────┬──────────────────────────────────────┘
┌ ② core/ 純邏輯（無 DOM、無 Node API）───────────────────────────────┐
│ names  yaml  markdown(+wikilink)  slide  note  library  links       │
│ privacy  check  chart  style  color  i18n                            │
└──────────────────────────────┬──────────────────────────────────────┘
┌ ③ 索引快取（IndexedDB）：標題、別名、標籤、連結、修改時間 ─────────────┐
└──────────────────────────────┬──────────────────────────────────────┘
┌ ④ 介面 ─────────────────────────────────────────────────────────────┐
│ 筆記：書架、閱讀、編輯、搜尋、反向連結                                   │
│ 橋接：快閃播放、摘錄嵌入、升級成簡報、講後筆記、畫布                       │
│ 簡報：Mdslide Pile 播放器（3D 牌堆、對照、閱讀、講者、畫筆、列印、匯出）   │
└─────────────────────────────────────────────────────────────────────┘
```

## 目錄（第一階段之後）

```
index.html            入口（CSP；只載入 CSS 與 app/main.js）
sw.js / offline.html  離線快取（只快取網站本身，不快取使用者內容）
app/
  main.js             路由、首頁、資料來源、介面語言
  core/               ── 沿用 Mdslide ──
    names.js yaml.js markdown.js slide.js style.js color.js chart.js highlight.js i18n.js check.js
                      ── Leafpile 新增 ──
    note.js           一個筆記檔 → 筆記資料（front matter、標題、段落、連結、摘錄）
    library.js        擴充：雙渠道掃描、主題配對、筆記本層
    links.js          [[連結]] 解析、目標比對、反向連結
    privacy.js        公開判斷（筆記 > 筆記本 > 主題 > 私人）、個資樣式
    locales/          zh-Hant.js、en.js
  sources/            沿用 Mdslide：sources.js、store.js；新增 index.js（IndexedDB 索引）
  ui/
    shelf.js          雙渠道書架（筆記｜簡報｜全部）、分類分組、急件區
    palette.js        Ctrl+K 指令面板
    notes/            reader.js、editor.js、backlinks.js、search.js
    check-view.js
  player/             沿用 Mdslide 播放器；新增 flash.js（快閃播放）、embed-note.js（摘錄）、qa.js（講者視窗問答）
  boards/             （第三階段）畫布，由 Vault 的 canvas*.js 改寫成 ES 模組
  styles/             themes.css、slides.css、app.css、notes.css
scripts/
  guard-content.mjs   GitHub 守門（已完成）
  check.mjs           規則檢查（筆記＋簡報＋互通）
  new-note.mjs        新增筆記或筆記本
  new-deck.mjs        沿用 Mdslide
  promote.mjs         升級成簡報
  build-catalog.mjs   產生 content/ 的目錄（部署時）
tests/                node:test；smoke/（Playwright 冒煙測試，不寫進 package.json）
```

## 資料來源介面

沿用 Mdslide Pile，新增來源只要實作：

| 方法 | 說明 |
|---|---|
| `label` | 顯示名稱 |
| `list(path)` | 列出資料夾內容（名稱、是否資料夾、修改時間） |
| `readText(path)` | 讀文字檔 |
| `mediaURL(path)` | 取得媒體的網址 |
| `releaseMedia()` | 釋放媒體網址 |

可寫入的來源另外提供 `canWrite`、`writeText(path, text, { expect })`、`stat(path)`、`archive(path)`。

## 讀取分層（按需讀取）

| 層 | 什麼時候 | 讀什麼 |
|---|---|---|
| 目錄 | 開啟書庫 | 只列資料夾與 `_site.yml`、`_topic.yml` |
| 封面 | 書架捲到 | `_book.yml`、`deck.yml`、筆記的 front matter（只讀前 4 KB） |
| 內容 | 點開 | 整篇筆記或整份簡報 |
| 媒體 | 快要看到 | 圖片、影片 |
| 索引 | 背景、閒置時 | 全部筆記的標題、別名、連結；以「路徑＋修改時間」增量更新 |

反向連結、全文搜尋、`[[連結]]` 自動完成依賴索引；索引還沒建好時，介面顯示「建立索引中」，不擋住閱讀。

## 安全

- 沿用 Mdslide：CSP、Markdown 中的 HTML 一律跳脫、外部連結白名單、樣式值白名單、嵌入頁面沙箱。
- 沿用 Vault：嵌入 HTML 絕不給 `allow-same-origin`／`allow-top-navigation`；上傳的 SVG 要消毒；未知 `x-` 欄位保留。
- 寫入：只寫 `.md`／`.yml`，寫前比對修改時間，刪除一律封存。
- 隱私：`core/privacy.js` 是唯一的公開判斷；守門腳本、匯出、未來的同步都呼叫它。

## 從兩個上游專案帶過來什麼

| 來源 | 帶過來 | 不帶 |
|---|---|---|
| Mdslide Pile | 全部 `core/`、資料來源、播放器、編輯器、匯出、PWA、檢查工具、測試架構與守門測試 | 內建書庫的中文資料夾名稱（改為 ASCII） |
| 讀書筆記 Vault | 筆記 front matter、分類與主題、公開規則、個資樣式、閱讀欄與字級、草稿保護、批次修改的概念、JSON Canvas 讀寫與 `x-` 規則 | Apps Script 後端、Sheets 索引、兩個部署、Drive 備份、esbuild 建置、IIFE 全域模組 |

## 測試策略

- `node:test` 單元測試：`core/` 每個模組、守門腳本、互通規則。
- 文件同步測試（沿用 Mdslide 的 docs-sync）：`docs/SPEC.md` 必須列出所有欄位與語法。
- 瀏覽器冒煙測試：Chrome、Firefox、Safari 核心各跑一次範例書庫。
- 守門：Mdslide 的洗牌動畫保護測試原樣保留。
