# 變更紀錄

格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號依 [語意化版本](https://semver.org/lang/zh-TW/)。

## 未發布

## 0.2.0 — 2026-11-11

P2（互通）完成。

- 新增：講者視窗的「備註｜問答」分頁。按 Q 記下現場問題（自動帶上頁碼），答案可以之後補；紀錄存在瀏覽器裡，產生講後筆記時自動帶入並清空。可以下載成 JSON。
- 新增：`scripts/after-talk.mjs --qa <檔案>`，帶入講者視窗下載的問答，或「Q: / A:」純文字。
- 新增：來源筆記改過的提醒。升級成簡報時 `deck.yml` 記下 `source_hash`（內文指紋，不看修改時間）；開啟簡報、筆記右側欄、檢查工具都會提醒。Ctrl+K 可以開啟來源筆記、標記簡報已跟上。
- 新增：`scripts/source-sync.mjs`，列出升級來的簡報與來源狀態，`--mark` 標記已跟上。
- 新增：投影片裡的 `[[連結]]` 在播放與匯出的單一 HTML 裡帶上目標說明（滑鼠提示：連到哪篇筆記或哪份簡報、路徑，或找不到目標）。
- 變更：範例簡報補上 `source_hash`。
- 移除：重複的 `.github/workflows/guard.yml`（內容已包含在 `ci.yml`，每週排程也在那裡）。
- 移除：未使用的 `sourceIsNewer`（以修改時間比對，git clone 後不可靠），改用內容指紋。

## 0.1.0 — 2026-11-10

第一個可以日常使用的版本：P1（MVP）完成，P2（互通）的核心完成。

**簡報引擎**

- 引入 [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) v1.14.0 的播放器、編輯器、匯出、離線快取與測試；原有測試全部通過，洗牌動畫未改動。
- 與 Mdslide Pile 的差異：封存資料夾改為 `_archive/`；瀏覽器儲存的鍵、離線快取、講者視窗頻道改用 `leafpile-` 前綴（兩個網站在同一個網域下不會互相影響）；簡報網址多一段 `/d/`，舊網址會自動轉址。

**書庫與筆記**

- 新增：雙渠道書庫。有 `notes/` 或 `slides/` 的資料夾是 Leafpile 書庫，同名主題自動配對；其他資料夾照舊當成簡報書庫或單一簡報。
- 新增：書架（全部｜筆記｜簡報）、分類分組、筆記本卡片、散篇筆記、急件置頂、標題與全文搜尋。
- 新增：筆記閱讀頁（目錄、上下篇、字級、公開／私人標示、圖片放大）與反向連結、「被這些簡報引用」。
- 新增：筆記編輯（即時預覽、Ctrl+S、別的程式改過時先詢問、草稿保護、輸入 `[[` 自動完成）與「+ 筆記」。
- 新增：`[[筆記]]`、`[[筆記#標題]]`、`[[筆記|文字]]`、`[[slides:簡報]]`；比對順序為標題、別名、檔名、路徑，同名時同主題優先。
- 新增：Ctrl+K 指令面板。

**互通**

- 新增：快閃播放（筆記暫時當簡報播，不產生檔案）。
- 新增：摘錄嵌入 `![[筆記#標題]]`（播放時讀取筆記的一段）。
- 新增：升級成簡報（介面與 `scripts/promote.mjs`；單篇或整本筆記本；已存在的資料夾不覆蓋）。
- 新增：講後筆記（指令面板與 `scripts/after-talk.mjs`；預設私人，記錄 `from_deck`）。

**工具與流程**

- 檢查工具涵蓋筆記與連結，錯誤與提醒分開（只有錯誤讓 CI 失敗）；單檔版改名 `leafpile-check.mjs`。
- 守門腳本改用與網站相同的解析器與公開規則；允許簡報裡的互動網頁 `.html`。
- 範例書庫（`scripts/build-starter.mjs`）改為 Leafpile 書庫：預設主題、歡迎筆記、`_docs/` 說明。
- CI：單元測試、內容檢查、守門、三種瀏覽器冒煙測試、通過後部署 GitHub Pages；發布流程會打包範例書庫。
- 修正：上傳時 `.github` 被存成 `,github`，CI 與 Issue／PR 範本因此沒有生效。
- 文件：簡報指南與手冊移到 `docs/slides/`（檔名改為英文）；README 加上截圖與使用方式；SPEC、INTEROP、ARCHITECTURE、ROADMAP 依實作更新。

**還沒做**（見 `docs/ROADMAP.md`）：講者視窗的問答分頁、「來源筆記已更新」提醒、畫布、個資掃描介面、筆記的封存與改名。

## 0.0.1 — 2026-11-09

第零階段：規劃與骨架。

- 新增：專案定位與命名（Leafpile 頁堆），融合 Mdslide Pile 與讀書筆記 Vault。
- 新增：存檔規格 `docs/SPEC.md`（雙渠道 `notes/`、`slides/`，筆記本 `_book.yml`，front matter，連結語法，`leafpile: 1`）。
- 新增：互通規則 `docs/INTEROP.md`（連結、快閃播放、摘錄嵌入、升級成簡報、講後筆記、畫布）。
- 新增：系統架構 `docs/ARCHITECTURE.md` 與路線圖 `docs/ROADMAP.md`。
- 新增：預設分類 7 個、主題 9 個（筆記 9、簡報 6），含 `local_only` 的生活紀錄。
- 新增：範例筆記 6 篇、範例簡報 2 份（通過 Mdslide Pile v1.14.0 檢查）、範例畫布 1 張。
- 新增：守門腳本 `scripts/guard-content.mjs`（檔案大小、ASCII 路徑、禁止的檔案類型、公開與否、急件到期、個資警告）與 10 組單元測試、GitHub Actions 流程。
- 新增：README（中、英）、CONTRIBUTING、CONTRIBUTORS、AI_CREDITS、CODE_OF_CONDUCT、SECURITY、AGENTS、Issue 與 PR 範本。
- 授權：程式 MIT；文件與範例內容 CC BY 4.0。
