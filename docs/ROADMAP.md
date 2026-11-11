# 路線圖

一人加 AI 的估算：約 18 週到 v1.0，第 8 週可以開始自用。**每個階段的閘門沒過，不開下一階段。**

## P0 奠基（第 1–2 週）

- [x] 定位、命名、授權（程式 MIT、內容 CC BY 4.0）
- [x] 存檔規格 `docs/SPEC.md` 與互通規則 `docs/INTEROP.md`
- [x] 預設分類與主題、範例筆記與簡報、範例畫布
- [x] 守門腳本與 CI
- [x] README、貢獻、AI 揭露、安全、行為準則
- [x] 建立 GitHub repo（<https://github.com/ToruSmith/Leafpile>）
- [x] 開啟 Pages（Source：GitHub Actions）
- [ ] 在 Mdslide Pile 補上 LICENSE（MIT）
- [ ] 確認名稱可用（網域；若發 CLI 再查 npm）

**閘門：規格凍結 v0**：自己照 SPEC 手動整理一個真實書庫（至少 20 篇筆記、2 份簡報），沒有遇到規格答不出來的情況。

## P1 MVP（v0.1.0 完成）

- [x] 把 Mdslide Pile v1.14.0 的 `app/`、`scripts/`、`tests/` 帶進來，原有測試全部通過
- [x] `core/note.js`、`core/links.js`、`core/privacy.js`、`core/vault.js`、`core/graph.js` 與單元測試
- [x] 雙渠道掃描與主題配對；自動判斷開啟的是 Leafpile 書庫、簡報書庫或單一簡報
- [x] 書架（全部｜筆記｜簡報）、分類分組、筆記本、急件區、全文搜尋
- [x] 筆記閱讀頁（置中單欄、字級、目錄、上下篇）與編輯（即時預覽、草稿保護、衝突偵測、`[[` 自動完成）
- [x] `[[連結]]` 與反向連結面板、「被這些簡報引用」
- [x] 快閃播放
- [x] Ctrl+K 指令面板
- [x] 中英文介面
- [x] 檢查工具涵蓋筆記與連結；單檔版 `leafpile-check.mjs`；範例書庫；CI、部署、發布流程

**閘門：自用一個月**：每天用它寫筆記，至少一次真的上台報告。

## P2 互通（v0.2.0 完成）

- [x] `![[摘錄]]` 嵌入（播放時讀取筆記的一段）
- [x] 升級成簡報（介面＋`scripts/promote.mjs`；單篇或整本筆記本）
- [x] 講後筆記（指令面板＋`scripts/after-talk.mjs`）
- [x] 檢查工具的互通規則（連結、摘錄、`source`、版型設定、急件）
- [x] 講者視窗的「問答」分頁，講後筆記自動帶入（`after-talk.mjs --qa`）
- [x] 提醒「來源筆記在升級後改過」（內容指紋 `source_hash`；`scripts/source-sync.mjs`）
- [x] 匯出單一 HTML 時，保留投影片裡的 `[[連結]]` 目標說明

**閘門：公開 Beta**：三位以上外部使用者完成「筆記 → 簡報 → 講後筆記」一輪並回饋。

## P3 擴充

- [ ] 畫布：由 Vault 移植，改寫成 ES 模組，筆記卡與簡報卡
- [ ] 個資掃描介面（發布前檢查、訪客視角預覽）
- [ ] 筆記的封存、改名、搬移（改名時更新連結）
- [ ] 圖譜存進 IndexedDB、增量更新；1,000 篇筆記的書庫首屏 1 秒內
- [ ] 手機上的筆記閱讀體驗再打磨

**閘門：v1.0**

## 之後（選配）

- GitHub API 寫回急件（細粒度權杖，只在使用者的瀏覽器）
- 雲端同步 adapter（例如 Google Drive，沿用 Vault 經驗）
- 手機編輯
