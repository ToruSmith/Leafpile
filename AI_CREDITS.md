# AI 創作者與協作揭露

Leafpile 歡迎 AI 協作。這份文件公開記錄哪些部分由 AI 參與產出、由誰審閱，讓使用者與貢獻者知道內容從哪裡來。

## 原則

1. **人類負責。** 每一份 AI 參與的產出，都由一位具名的人類審閱、修改並為它負責。
2. **著作權歸人類貢獻者與專案。** AI 列在這裡是揭露，不是作者或權利人；授權依 [`LICENSE`](LICENSE) 與 [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)。
3. **公開揭露。** Pull Request 範本裡有「AI 協作揭露」欄位，請照實勾選；重要的產出請在下表加一列。
4. **規則寫給 AI 看。** [`docs/SPEC.md`](docs/SPEC.md)、[`docs/INTEROP.md`](docs/INTEROP.md) 與 [`AGENTS.md`](AGENTS.md) 同時寫給人與 AI；AI 產出的內容必須通過 `scripts/guard-content.mjs` 與單元測試。
5. **事實由人核對。** AI 寫的數字、引用與來源，合併前必須由人類查證。

## 紀錄

| 日期 | AI（模型） | 提供者 | 參與內容 | 人類審閱者 |
|---|---|---|---|---|
| 2026-11-09 | Claude Opus 5.5 | Anthropic | 可行性評估與規劃書、系統架構、命名建議；本倉庫 v0.0.1 骨架：README、規格與互通文件、預設分類與主題、範例筆記與簡報、守門腳本與測試、社群文件 | ToruSmith |
| 2026-11-10 | Claude Fable 5.2（部分提交為 Claude Opus 5.5） | Anthropic | v0.1.0：引入 Mdslide Pile 引擎；`app/core/` 的 vault、note、links、graph、privacy、bridge；書架、筆記閱讀與編輯、指令面板、快閃播放、摘錄嵌入、升級成簡報、講後筆記；檢查工具、範例書庫、CI 與部署流程；文件更新 | ToruSmith |
| 2026-11-11 | Claude Opus 5.5、Claude Sonnet 5.5 | Anthropic | v0.2.0：講者問答分頁、來源筆記指紋與提醒、投影片連結說明；公開 Beta 試用包；唯讀提示；冒煙測試修正 | ToruSmith |
| 2026-11-12 | Claude Opus 5.5 | Anthropic | v0.3.0、v0.4.0：筆記改名／搬移／封存與連結更新、發布前檢查與訪客視角、畫布（含嵌入、圖片、簡報模式）；來源提醒按鈕；文件更新 | ToruSmith |

上游專案 Mdslide Pile 與讀書筆記 Vault 也以 AI 協作開發（見各自的 `AGENTS.md`／`CLAUDE.md`）。它們使用的模型與版本請由維護者補進上表。

## 怎麼新增一列

在 PR 裡新增一列，寫明：日期、AI 工具與模型版本、提供者、參與了哪些檔案或功能、審閱者。只用 AI 改錯字、排版等小事不必列入，但 PR 仍請勾選揭露欄。

Git 提交可以用 trailer 標示 AI 協作，例如：

```
Co-Authored-By: <AI 名稱與版本> <提供者指定的信箱>
```
