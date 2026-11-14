# 系統架構

Leafpile 沿用 Mdslide Pile 的分層：資料只往下流，**來源 → `core/` 解析 → 索引 → 介面**。新增來源只要實作來源介面；規則只有 `core/` 一份，瀏覽器與 Node 腳本共用。

```
┌ ① 資料來源 ─────────────────────────────────────────────────────────┐
│ HandleSource（Chrome/Edge，本機可寫）  FileListSource（其他瀏覽器，唯讀） │
│ HttpSource（GitHub Pages 的 content/）  EmbeddedSource（匯出的單一 HTML） │
└──────────────────────────────┬──────────────────────────────────────┘
┌ ② core/ 純邏輯（無 DOM、無 Node API）───────────────────────────────┐
│ names  yaml  markdown(+wikilink)  slide  library  chart  style  i18n │
│ vault  note  links  graph  privacy  bridge  check                    │
└──────────────────────────────┬──────────────────────────────────────┘
┌ ③ 圖譜（記憶體，背景建立）：標題、別名、標籤、連結、反向連結、搜尋 ────┐
└──────────────────────────────┬──────────────────────────────────────┘
┌ ④ 介面 ─────────────────────────────────────────────────────────────┐
│ 筆記：書架、閱讀、編輯、搜尋、反向連結                                   │
│ 橋接：快閃播放、摘錄嵌入、升級成簡報、講後筆記、畫布                       │
│ 簡報：Mdslide Pile 播放器（3D 牌堆、對照、閱讀、講者、畫筆、列印、匯出）   │
└─────────────────────────────────────────────────────────────────────┘
```

## 目錄

完整的目錄與每個模組的用途在 [`AGENTS.md`](../AGENTS.md#目錄)。Leafpile 在 Mdslide Pile 引擎上新增的模組：

| 模組 | 做什麼 |
|---|---|
| `core/vault.js` | `openVault()`：判斷是 Leafpile 書庫還是簡報書庫；`subSource()` 把 `notes/`、`slides/` 包成各自的資料來源；同名主題配對；分類 |
| `core/note.js` | `parseNote()`：front matter、標題、`[[連結]]`、`sectionOf()` 取出一段 |
| `core/links.js` | `createResolver()`：標題 → 別名 → 檔名 → 路徑；`computeBacklinks()` |
| `core/graph.js` | `buildGraph()`：背景讀完所有筆記與投影片裡的連結；`searchGraph()` 全文搜尋 |
| `core/privacy.js` | `resolvePublic()`、`isLocalOnly()`、`scanPII()`：網站與守門腳本共用 |
| `core/bridge.js` | `expandEmbeds()`、`promoteNote()`、`promoteBook()`、`distillDeck()` |
| `core/check.js` | `checkVault()`：簡報規則（沿用）＋筆記與互通規則；錯誤與警告分開 |
| `core/index.js` | `buildIndex()`、`indexMarkdown()`、`libraryIndex()`：書庫索引（`--index`），所有筆記、簡報、畫布與連結的一覽，給 AI 先看全貌；用時才產生、不存檔。`--public` 用 `graph` 裡的公開判斷過濾 |
| `core/zip.js` | 零依賴 zip 讀寫（`CompressionStream('deflate-raw')`）；擋 `../`、隱藏檔、解壓縮炸彈 |
| `core/pack.js`、`ui/pack.js` | 書庫包：匯出哪些檔案（公開包的規則）、文字書庫包格式、匯入規劃（絕不覆蓋）；寫檔與復原在 `main.js` 的 `exportPack`／`importFiles` |
| `core/generate.js`、`ui/generate.js` | 用 AI 生成：精簡提示詞（在語言檔）、AI 網址、把回覆組成筆記／簡報（`promoteNote`）／畫布（大綱自動排版） |
| `player/flash.js` | `noteToDeck()`：筆記 → 播放器要的 deck 物件 |
| `ui/shelf.js` | 書架：分類、主題、筆記本、散篇、簡報卡片、急件、全文搜尋 |
| `ui/notes/reader.js`、`editor.js` | 閱讀（目錄、反向連結）與編輯（即時預覽、草稿保護、`[[` 自動完成） |
| `ui/palette.js`、`ui/dialog.js` | Ctrl+K 指令面板、對話框與提示 |
| `core/nav.js`、`ui/sidebar.js` | 側邊欄（書庫導覽，唯讀）：樹狀目錄、目前位置、釘選與最近開過 |
| `core/table.js` | 書庫的表格檢視（唯讀）：front matter 欄位、排序、篩選 |
| `core/slash.js`、`ui/slash-menu.js` | 斜線選單：觸發規則、選項與插入的 Markdown（純邏輯）；畫面、鍵盤與游標位置（筆記編輯器與畫布側邊面板共用） |
| `ui/board-peek.js` | 畫布的側邊卡片面板：閱讀與編輯一篇筆記（寫入規則、草稿與筆記頁的編輯器相同）；畫布只給它容器與幾個回呼 |
| `ui/prefs.js` | 本機偏好設定（localStorage）的唯一入口；所有用到的鍵列在檔案開頭 |
| `core/yaml-edit.js` | 設定檔的局部改寫：只改最上層某個鍵的那幾行，保留其他行與註解 |
| `core/topics.js`、`ui/topic-manage.js` | 主題管理（設定類）：規則、預覽清單、對話框；寫檔與復原在 `main.js` 的 `editTopic`、`newTopic`、`editCategories` |

### 本機偏好設定

字級、書庫顯示、表格排序、小地圖、側邊欄收合、釘選與最近開過等，都只存在瀏覽器的 localStorage，不寫進書庫檔案。新功能要記住設定時，一律透過 `ui/prefs.js`，並把鍵名補進它開頭的清單；讀不到或壞資料時回預設值，不能讓畫面出錯。

### 網址

```
#/<書庫>                                書架
#/<書庫>/n/<筆記路徑>[/<段落>]            閱讀筆記
#/<書庫>/e/<筆記路徑>                     編輯筆記
#/<書庫>/f/<筆記路徑>[/<第幾張>]          快閃播放
#/<書庫>/d/<主題>/<簡報>[/<第幾張>[/read]]  播放簡報
#/<書庫>/go/<連結>/<來自哪篇>             解析 [[連結]] 後轉過去
```

`<書庫>` 是 `repo`（內建）、`local/<id>`（記住的本機資料夾）或 `session`。Mdslide Pile 的舊網址 `#/<書庫>/<主題>/<簡報>/<n>` 會自動轉到新網址。

## 資料來源介面

沿用 Mdslide Pile，新增來源只要實作：

| 方法 | 說明 |
|---|---|
| `label` | 顯示名稱 |
| `list(path)` | 列出資料夾內容（名稱、是否資料夾、修改時間） |
| `readText(path)` | 讀文字檔 |
| `mediaURL(path)` | 取得媒體的網址 |
| `releaseMedia()` | 釋放媒體網址 |

可寫入的來源另外提供 `canWrite`、`writeText(path, text, { expect, mkdir })`、`stat(path)`、`archive(path, dir)`。

`subSource(parent, 'notes')` 把書庫的一個子資料夾包成同樣介面的來源：路徑自動加前綴，寫入與監看轉給原來的來源，封存一律搬到書庫根目錄的 `_archive/`。播放器與編輯器因此不需要知道自己在 Leafpile 書庫裡。

## 讀取分層（按需讀取）

| 層 | 什麼時候 | 讀什麼 |
|---|---|---|
| 目錄 | 開啟書庫 | 只列資料夾與 `_site.yml`、`_topic.yml` |
| 封面 | 書架捲到 | `_book.yml`、`deck.yml`、筆記的 front matter（只讀前 4 KB） |
| 內容 | 點開 | 整篇筆記或整份簡報 |
| 媒體 | 快要看到 | 圖片、影片 |
| 圖譜 | 開啟書架後在背景 | 全部筆記的標題、別名、連結，與投影片裡的 `[[連結]]`（同時最多 6 個讀取） |

反向連結、全文搜尋、`[[連結]]` 自動完成依賴圖譜；圖譜還沒建好時，介面顯示「建立索引中」，不擋住閱讀。

圖譜目前放在記憶體裡，每次開啟書庫重建一次。1,000 篇以上的書庫需要把它存進 IndexedDB、依修改時間增量更新，排在第三階段。

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
