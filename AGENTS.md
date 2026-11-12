# AGENTS.md：給維護這個倉庫的 AI（與人）

> 任務是**做內容**（筆記、簡報、講後筆記）：讀 [`docs/SPEC.md`](docs/SPEC.md)、[`docs/INTEROP.md`](docs/INTEROP.md)，現成提示詞在 [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)。
> 任務是**改工具本身**：讀完這份，再讀 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 這個專案是什麼

Leafpile 把一個本機資料夾同時當成筆記庫與簡報庫：`notes/` 是筆記渠道，`slides/` 是簡報渠道（Mdslide Pile 規格），同名主題自動配對，兩邊用連結與一次性轉換互通。網站是讀取器，檔案留在使用者的電腦。

## 目前階段

v0.6.0：P1、P2 完成；P3 完成畫布（含嵌入與簡報模式）、發布前檢查、筆記改名／搬移／封存、沉浸閱讀與字級。路線圖的 P3 都已完成或量測後暫緩（圖譜快取，見 [`docs/ROADMAP.md`](docs/ROADMAP.md)）。**開始寫程式前先確認目前在哪個階段，不要跳做後面階段的功能。**

簡報引擎（`app/player/`、`app/core/` 的 slide、markdown、library 等）來自 [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) v1.14.0。它的洗牌動畫有守門測試（`tests/protected.test.mjs`），**未經維護者同意不得修改**。

## 不能違反的原則

1. **零依賴、零建置。** 原生 ES 模組，靜態伺服器即可執行。不加 npm 套件、打包工具或框架。
2. **解析器只有一份。** `app/core/` 給瀏覽器與 Node 腳本共用，不碰 DOM 與 Node 專屬 API。
3. **按需讀取。** 書架只讀目錄；筆記內容點開才讀；反向連結靠背景索引，不在首屏掃全庫。
4. **使用者內容不執行。** Markdown 裡的 HTML 一律跳脫；外部連結只允許 http(s)、mailto、相對路徑；嵌入頁面的沙箱絕不給 `allow-same-origin`。
5. **寫入安全。** 只寫書庫內的 `.md`／`.yml`，路徑不可含 `..`；寫前比對修改時間，不符就交給使用者決定；新增檔案時已存在就停下來，絕不覆蓋；**永遠不刪除**，一律搬到 `_archive/`。
6. **未知欄位原樣保留。** 別的軟體寫的 front matter 與畫布的 `x-` 欄位，讀寫時不可洗掉。
7. **公開與否只由 `core/privacy` 判斷**，網站、守門腳本、匯出用同一套規則：筆記 > 筆記本 > 主題 > 私人。
8. **互通不做雙向同步。** 新功能若會讓筆記自動改簡報、或簡報自動改筆記，先停下來問維護者（見 `docs/INTEROP.md`「刻意不做的事」）。
9. **規格與程式同步。** 改了欄位、語法、命名規則，就同時改 `docs/SPEC.md`、範例內容、測試與 `CHANGELOG.md`。
10. **介面文字一律走 i18n**，繁中與英文同時加。
11. **repo 內路徑一律 ASCII**；中文顯示名稱寫在 yml。

## 目錄

```
index.html  sw.js  offline.html  embed.html  manifest.webmanifest   網站入口與離線快取
app/
  main.js             路由、首頁、指令面板、橋接動作（升級、講後筆記）
  core/               純邏輯，瀏覽器與 Node 共用（不碰 DOM 與 Node API）
    vault.js          雙渠道書庫、子資料來源、主題配對      ← Leafpile
    note.js           筆記解析、[[連結]]、標題、段落          ← Leafpile
    links.js          連結比對、反向連結                     ← Leafpile
    graph.js          背景索引（標題、連結、搜尋）            ← Leafpile
    privacy.js        公開判斷、個資樣式                     ← Leafpile
    bridge.js         摘錄嵌入、升級成簡報、講後筆記          ← Leafpile
    scale.js          筆記字級（十級，0.8–2.2 倍）           ← Leafpile
    check.js          檢查規則（checkVault 包住 checkLibrary）
    library.js slide.js markdown.js yaml.js names.js …      簡報引擎（Mdslide Pile）
    locales/          zh-Hant.js、en.js（兩份的鍵必須一致）
  sources/            資料來源（Http、Handle、FileList）與最近開啟的書庫
  ui/                 shelf.js（書架）、notes/reader.js（含沉浸閱讀）、notes/editor.js、palette.js、dialog.js、check-view.js、fullscreen.js（全螢幕與浮動列自動收起）
  player/             播放器（Mdslide Pile）＋ flash.js（快閃播放）
  styles/             themes.css、slides.css、app.css、notes.css
content/              公開書庫（部署到 GitHub Pages）：notes/、slides/、boards/、_site.yml
starter/              範例書庫的說明、設定與歡迎筆記（scripts/build-starter.mjs 組裝）
dist/                 單檔檢查工具 leafpile-check.mjs（自動產生，請勿手改）
docs/                 SPEC、INTEROP、ARCHITECTURE、ROADMAP、AI_PROMPTS、slides/（簡報指南與手冊）
scripts/              check、guard-content、promote、after-talk、source-sync、bench-graph、new-deck、build-catalog、bundle-check、build-starter
tests/                node:test 單元測試；smoke/（Playwright）；visual/（畫面比對）
```

## 驗證

```bash
node --test tests/*.test.mjs             # 全部單元測試
node scripts/check.mjs content           # 內建書庫：筆記、簡報、連結
node scripts/guard-content.mjs content   # 內建書庫：大小、路徑、公開與否
node scripts/bundle-check.mjs            # 改了 app/core/ 之後：重新產生 dist/leafpile-check.mjs
```

改了介面，再跑瀏覽器冒煙測試（需要 Playwright；`SMOKE_BROWSER_PATH` 可指定系統的瀏覽器）：

```bash
node scripts/build-catalog.mjs && python3 -m http.server 8000 &
python tests/smoke/smoke.py http://localhost:8000/ chromium
```

版本號有三處要一致（`tests/version.test.mjs` 會檢查）：`package.json`、`app/main.js` 的 `VERSION`、`CHANGELOG.md` 最新標題。

## 提交前檢查

- [ ] 測試與守門檢查都通過
- [ ] 規格變動已同步到 `docs/SPEC.md`、範例與測試
- [ ] `CHANGELOG.md` 已記錄
- [ ] 若由 AI 參與，在 PR 勾選揭露；重要產出在 `AI_CREDITS.md` 加一列

## 交付給使用者

AI 沒有使用者的 GitHub 權限時，不要自行發布：交付修改後的檔案（或 zip），用繁體中文簡短說明改了什麼、使用者要做哪些步驟。
