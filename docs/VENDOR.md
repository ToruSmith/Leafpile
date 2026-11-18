# 第三方程式碼紀錄

依 [`AGENTS.md`](../AGENTS.md) 的依賴原則,每一個不是我們寫的、會在瀏覽器裡執行的程式都記在這裡。

| 名稱 | 載入方式 | 來源 | 為什麼需要 | 何時載入 | 決定 |
| --- | --- | --- | --- | --- | --- |
| Google Identity Services(登入) | 從 Google 載入(不能複製進 repo) | `https://accounts.google.com/gsi/client` | Google Drive 書庫的登入與通行證 | 只有網站設定了 Google(`app/config.js`),而且使用者打開首頁或按「Google Drive」時 | 2026-11-18 維護者同意 |

## Google Identity Services

- Google 規定必須從它的網址載入,沒有可以內嵌的版本,所以不放在 `app/vendor/`。
- 內容安全政策(`index.html`)只多允許這一個確切網址的程式,以及連線到 `https://www.googleapis.com`;`tests/shell.test.mjs` 會檢查。
- 不設定 Google 的網站完全不會載入它,其他功能不受影響。
- 我們只用它的 `google.accounts.oauth2.initTokenClient` 取得通行證,Drive 的讀寫是我們自己用 `fetch` 呼叫 REST API(`app/sources/drive.js`)。
