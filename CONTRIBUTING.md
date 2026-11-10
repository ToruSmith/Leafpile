# 參與貢獻

謝謝你想讓 Leafpile 變好。這份文件說明怎麼回報、怎麼改、改完要檢查什麼。

## 先讀這些

1. [`README.md`](README.md)：專案在做什麼
2. [`docs/SPEC.md`](docs/SPEC.md)：存檔規格（改規則前必讀）
3. [`docs/INTEROP.md`](docs/INTEROP.md)：筆記與簡報的界線（新功能常常卡在這裡）
4. [`AGENTS.md`](AGENTS.md)：架構原則與不能違反的規則

## 開發環境

只需要 Node 18 以上與任何靜態伺服器，**不需要 `npm install`**。

```bash
node --test tests/*.test.mjs             # 單元測試
node scripts/check.mjs content           # 內建書庫的規則檢查
node scripts/guard-content.mjs content   # content/ 守門檢查
node scripts/build-catalog.mjs           # 產生 catalog.json（「內建範例」需要）
python3 -m http.server 8000              # 開 http://localhost:8000
```

## 不能違反的原則

- **零依賴、零建置**：不加 npm 套件、打包工具或框架。需要的功能自己寫精簡版。
- **本機優先**：使用者的檔案不上傳；網站只讀取，寫入只在使用者授權後寫 `.md`／`.yml`。
- **從不刪除使用者的檔案**：刪除一律是搬到 `_archive/`。
- **使用者內容不執行**：Markdown 裡的 HTML 一律跳脫；嵌入頁面放在沒有 `allow-same-origin` 的沙箱。
- **規格與程式同步**：改了欄位、語法或命名規則，就要同時改 `docs/SPEC.md`、範例與測試。
- **介面文字走 i18n**：繁中與英文兩份語系檔同時更新。
- **repo 內路徑用 ASCII**：GitHub 網頁上傳會略過中文檔名。

## 貢獻內容到 `content/`

`content/` 會部署到公開網站，所以只收：

- 公開的範例、讀書分享、速查表
- 路徑是英文、圖片小於 300 KB、沒有影片與 PDF
- 數字要有來源與資料時間

送出前執行 `node scripts/guard-content.mjs content`，沒有錯誤才算完成。

## 提交與 PR

- 一個 PR 做一件事；標題用一句話說明結果，例如「筆記閱讀頁加上反向連結面板」。
- 更新 [`CHANGELOG.md`](CHANGELOG.md) 的「未發布」段落。
- 填寫 PR 範本的檢查清單與 **AI 協作揭露**（見 [`AI_CREDITS.md`](AI_CREDITS.md)）。
- 合併後把自己加進 [`CONTRIBUTORS.md`](CONTRIBUTORS.md)。

## 回報問題

- 錯誤與建議：開 Issue，選對應範本。請不要貼私人筆記內容。
- 安全問題：請依 [`SECURITY.md`](SECURITY.md) 私下回報，不要開公開 Issue。

參與本專案即表示同意遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
