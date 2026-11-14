# AGENTS.md：給維護這個倉庫的 AI（與人）

> 任務是**做內容**（筆記、簡報、講後筆記）：讀 [`docs/SPEC.md`](docs/SPEC.md)、[`docs/INTEROP.md`](docs/INTEROP.md)，現成提示詞在 [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)；要交一個可以匯入的書庫包，照 [`docs/AI_PACK.md`](docs/AI_PACK.md)。動手前先跑 `node scripts/check.mjs <書庫> --index`（或書庫裡的 `node leafpile-check.mjs --index`）看全貌，不必逐檔翻找。
> 任務是**改工具本身**：讀完這份，再讀 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 這個專案是什麼

Leafpile 把一個本機資料夾同時當成筆記庫與簡報庫：`notes/` 是筆記渠道，`slides/` 是簡報渠道（Mdslide Pile 規格），同名主題自動配對，兩邊用連結與一次性轉換互通。網站是讀取器，檔案留在使用者的電腦。

## 目前階段

v0.20.0：P1、P2 完成；P3 完成畫布（含嵌入與簡報模式、側邊卡片面板、筆記卡全文與摺疊）、發布前檢查、筆記改名／搬移、刪除（筆記、簡報、主題、畫布，一律搬到 _archive/ 並可復原）、沉浸閱讀與字級、畫布小地圖與右鍵選單、書庫表格／卡片／看板／月曆、斜線選單、智慧貼上（網頁、Word、Google 文件的內容轉成 Markdown）、從剪貼簿新增筆記、記到收件匣、日記、對卡片問 AI、側邊欄、主題管理（設定類）、書庫索引、外觀主題、書庫包、用 AI 生成。結構類主題管理視需要再做（見路線圖）。v1.0 閘門：真實書庫試用擱置、公開 Beta 不做（2026-11-14 維護者決定）；接下來照路線圖「之後」的「參考 Heptabase 的第二輪」逐項做。**開始寫程式前先確認目前在哪個階段，不要跳做後面階段的功能。**

簡報引擎（`app/player/`、`app/core/` 的 slide、markdown、library 等）來自 [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) v1.14.0。它的洗牌動畫有守門測試（`tests/protected.test.mjs`），**未經維護者同意不得修改**。

## 不能違反的原則

1. **核心零依賴、零建置。** `app/` 是原生 ES 模組，靜態伺服器即可執行。不加 npm 套件、打包工具或框架。這條守的是：十年後還能跑、沒有供應鏈風險（這個程式會讀寫使用者的整個筆記資料夾）、讀完全部程式就能審查、改一行重新整理就看得到。只有兩種例外，**其他一律先問維護者**（2026-11-14 維護者決定）：
   - **外殼可以有依賴。** 把網站包成桌面或手機 App 的外殼（例如 Tauri、Capacitor）放在 repo 的獨立資料夾（如 `shell/`），依賴只在外殼裡；`app/` 不得因此引入依賴，也不得依賴外殼才能運作（網站版必須照常可用）。
   - **選用功能可以內嵌第三方檔案。** 例如把 KaTeX 的檔案複製進 repo、用到時才載入：沒有 npm、沒有建置步驟；程式碼不是我們寫的，所以要放在 `app/vendor/<名稱>/`，附上授權檔，並在 `docs/VENDOR.md` 記錄版本、來源網址、為什麼需要、怎麼更新。選用的意思是：不載入它，其他功能完全不受影響，且只在使用者用到時才載入，不拖慢首屏。
2. **解析器只有一份。** `app/core/` 給瀏覽器與 Node 腳本共用，不碰 DOM 與 Node 專屬 API。
3. **按需讀取。** 書架只讀目錄；筆記內容點開才讀；反向連結靠背景索引，不在首屏掃全庫。
4. **使用者內容不執行。** Markdown 裡的 HTML 一律跳脫；外部連結只允許 http(s)、mailto、相對路徑；嵌入頁面的沙箱絕不給 `allow-same-origin`。
5. **寫入安全。** 只寫書庫內的 `.md`／`.yml`，路徑不可含 `..`；寫前比對修改時間，不符就交給使用者決定；新增檔案時已存在就停下來，絕不覆蓋；**永遠不刪除**，一律搬到 `_archive/`。
6. **未知欄位原樣保留。** 別的軟體寫的 front matter 與畫布的 `x-` 欄位，讀寫時不可洗掉。
7. **公開與否只由 `core/privacy` 判斷**，網站、守門腳本、匯出用同一套規則：筆記 > 筆記本 > 主題 > 私人。
8. **互通不做雙向同步。** 新功能若會讓筆記自動改簡報、或簡報自動改筆記，先停下來問維護者（見 `docs/INTEROP.md`「刻意不做的事」）。
9. **規格與程式同步。** 改了欄位、語法、命名規則，就同時改 `docs/SPEC.md`、範例內容、測試與 `CHANGELOG.md`；影響 AI 產出的格式（筆記欄位、簡報版型、畫布欄位）也要改給 AI 的精簡規格 `docs/AI_PACK.md`、`docs/AI_PACK.en.md`（測試會用其中的範例建一個書庫跑檢查）。
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
    table.js          書庫表格檢視（唯讀，front matter 欄位、分組）← Leafpile
    index.js          書庫索引（check --index，給 AI 先看全貌）  ← Leafpile
    zip.js pack.js    書庫包：zip 讀寫、匯出規則、匯入合併（不覆蓋）← Leafpile
    generate.js       用 AI 生成：提示詞、組檔案                ← Leafpile
    nav.js            側邊欄的樹狀目錄、釘選與最近開過         ← Leafpile
    yaml-edit.js      設定檔的局部改寫（保留註解）             ← Leafpile
    topics.js         主題管理（設定類）的規則與預覽           ← Leafpile
    slash.js          斜線選單的觸發規則與要插入的 Markdown     ← Leafpile
    html-md.js        貼上的 HTML → Markdown(自己的小解析器,零依賴)  ← Leafpile
    ask.js            對卡片問 AI 的提示詞                      ← Leafpile
    trash.js          刪除 = 搬到 _archive/ 的路徑規則、編號、還原清單  ← Leafpile
    check.js          檢查規則（checkVault 包住 checkLibrary）
    library.js slide.js markdown.js yaml.js names.js …      簡報引擎（Mdslide Pile）
    locales/          zh-Hant.js、en.js（兩份的鍵必須一致）
  sources/            資料來源（Http、Handle、FileList）與最近開啟的書庫
  ui/                 shelf.js（書架）、notes/reader.js（含沉浸閱讀）、notes/editor.js、palette.js、dialog.js、check-view.js、fullscreen.js（全螢幕與浮動列自動收起）、sidebar.js（側邊欄）、prefs.js（本機偏好設定的唯一入口）、topic-manage.js（主題管理的對話框）、canvas-view.js（畫布）、board-peek.js（畫布的側邊卡片面板）、slash-menu.js（編輯器的斜線選單）、ask.js（對卡片問 AI 的對話框）
  player/             播放器（Mdslide Pile）＋ flash.js（快閃播放）
  styles/             themes.css（主題變數；新增主題見檔頭，tests/themes.test.mjs 檢查對比）、slides.css、app.css、notes.css
                      顏色一律用主題變數（--ok、--danger、--warn、--info、--mark、--on-accent…），不要寫死色碼
content/              公開書庫（部署到 GitHub Pages）：notes/、slides/、boards/、_site.yml
starter/              範例書庫的說明、設定與歡迎筆記（scripts/build-starter.mjs 組裝）
dist/                 單檔檢查工具 leafpile-check.mjs（自動產生，請勿手改）
docs/                 SPEC、INTEROP、FEATURES（功能手冊）、ARCHITECTURE、ROADMAP、AI_PROMPTS、AI_PACK（給 AI 的書庫包規格，「AI 生成」的提示詞指向它）、slides/（簡報指南與手冊）
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
- [ ] 新增或改動使用者看得到的功能、快捷鍵、按鈕，已同步到 `docs/FEATURES.md` 與 `docs/FEATURES.en.md`
- [ ] `CHANGELOG.md` 已記錄
- [ ] 若由 AI 參與，在 PR 勾選揭露；重要產出在 `AI_CREDITS.md` 加一列

## 交付給使用者

AI 沒有使用者的 GitHub 權限時，不要自行發布：交付修改後的檔案（或 zip），用繁體中文簡短說明改了什麼、使用者要做哪些步驟。
