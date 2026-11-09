# AGENTS.md：給維護這個倉庫的 AI（與人）

> 任務是**做內容**（筆記、簡報、講後筆記）：讀 [`docs/SPEC.md`](docs/SPEC.md)、[`docs/INTEROP.md`](docs/INTEROP.md)，現成提示詞在 [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)。
> 任務是**改工具本身**：讀完這份，再讀 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 這個專案是什麼

Leafpile 把一個本機資料夾同時當成筆記庫與簡報庫：`notes/` 是筆記渠道，`slides/` 是簡報渠道（Mdslide Pile 規格），同名主題自動配對，兩邊用連結與一次性轉換互通。網站是讀取器，檔案留在使用者的電腦。

## 目前階段

v0.0.1：規格、預設分類、範例、守門腳本與文件。網站程式在第一階段由 Mdslide Pile 的引擎延伸（見 [`docs/ROADMAP.md`](docs/ROADMAP.md)）。**開始寫程式前先確認目前在哪個階段，不要跳做後面階段的功能。**

## 不能違反的原則

1. **零依賴、零建置。** 原生 ES 模組，靜態伺服器即可執行。不加 npm 套件、打包工具或框架。
2. **解析器只有一份。** `app/core/` 給瀏覽器與 Node 腳本共用，不碰 DOM 與 Node 專屬 API。
3. **按需讀取。** 書架只讀目錄；筆記內容點開才讀；反向連結靠背景索引，不在首屏掃全庫。
4. **使用者內容不執行。** Markdown 裡的 HTML 一律跳脫；外部連結只允許 http(s)、mailto、相對路徑；嵌入頁面的沙箱絕不給 `allow-same-origin`。
5. **寫入安全。** 只寫書庫內的 `.md`／`.yml`，路徑不可含 `..`；寫前比對修改時間，不符就交給使用者決定；**永遠不刪除**，一律搬到 `_archive/`。
6. **未知欄位原樣保留。** 別的軟體寫的 front matter 與畫布的 `x-` 欄位，讀寫時不可洗掉。
7. **公開與否只由 `core/privacy` 判斷**，網站、守門腳本、匯出用同一套規則：筆記 > 筆記本 > 主題 > 私人。
8. **互通不做雙向同步。** 新功能若會讓筆記自動改簡報、或簡報自動改筆記，先停下來問維護者（見 `docs/INTEROP.md`「刻意不做的事」）。
9. **規格與程式同步。** 改了欄位、語法、命名規則，就同時改 `docs/SPEC.md`、範例內容、測試與 `CHANGELOG.md`。
10. **介面文字一律走 i18n**，繁中與英文同時加。
11. **repo 內路徑一律 ASCII**；中文顯示名稱寫在 yml。

## 目錄

```
content/          公開書庫（部署到 GitHub Pages）：notes/、slides/、boards/、_site.yml
docs/             SPEC（規格）、INTEROP（互通）、ARCHITECTURE、ROADMAP、AI_PROMPTS
scripts/          guard-content.mjs（GitHub 守門）；之後：check、promote、new-note、build-catalog
tests/            node:test 單元測試
.github/          CI、Issue 與 PR 範本
app/              （第一階段建立）網站本體
```

## 驗證

```bash
node --test tests/*.test.mjs
node scripts/guard-content.mjs content
```

改了 `content/slides/` 時，另外用 Mdslide Pile 的檢查工具確認簡報規格沒有壞：

```bash
node <Mdslide-Pile>/scripts/check.mjs content/slides --slides
```

## 提交前檢查

- [ ] 測試與守門檢查都通過
- [ ] 規格變動已同步到 `docs/SPEC.md`、範例與測試
- [ ] `CHANGELOG.md` 已記錄
- [ ] 若由 AI 參與，在 PR 勾選揭露；重要產出在 `AI_CREDITS.md` 加一列

## 交付給使用者

AI 沒有使用者的 GitHub 權限時，不要自行發布：交付修改後的檔案（或 zip），用繁體中文簡短說明改了什麼、使用者要做哪些步驟。
