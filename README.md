# Leafpile 頁堆

[English](README.en.md) · 繁體中文

**一個資料夾，平常是筆記，上台是簡報。**

Leafpile 把兩件常被分開做的事接起來：用 Markdown 累積筆記，要分享時升級成 3D 牌堆簡報，講完再把問答存回筆記。檔案留在你的電腦或隨身碟，網站只負責讀取，不用安裝、不用上傳。

> **目前狀態：v0.0.1 規劃與骨架。** 這個倉庫現在有規格、預設分類、範例、守門工具與完整的專案文件；網站程式會在第一階段由 [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) 的引擎延伸而來。過渡期間，`slides/` 已經可以直接用 Mdslide Pile 播放，`notes/` 可以用任何 Markdown 軟體（例如 Obsidian）開啟。

## 為什麼

- 讀書時寫一份筆記，要分享時又從頭做一份簡報。
- 講完之後，現場的問答哪裡都沒留下。
- 筆記工具把簡報當附屬外掛；簡報工具不管筆記怎麼累積。

Leafpile 的答案是：**同一個書庫、兩個渠道、中間一座橋。**

## 核心概念

```
我的頁堆/                         ← 書庫（硬碟或隨身碟）
├─ _site.yml                     ← 書庫設定與分類（可省略）
├─ notes/                        ← 筆記渠道：一個 .md 一篇筆記
│  └─ 10-reading/                ← 主題
│     ├─ _topic.yml
│     └─ 2026-11-atomic-habits/  ← 一本書／筆記本（可省略這層）
├─ slides/                       ← 簡報渠道：Mdslide Pile 規格，一個 .md 一張投影片
│  └─ 10-reading/                ← 同名主題 = 同一個主題，自動配對
│     └─ 2026-11-atomic-habits-share/deck.yml
├─ boards/                       ← 畫布（JSON Canvas）
└─ _archive/                     ← 封存，Leafpile 從不刪除你的檔案
```

| | 筆記 `notes/` | 簡報 `slides/` |
|---|---|---|
| 一個 `.md` 是 | 一篇筆記，長短不限 | 一張投影片 |
| 設定 | front matter（與 Obsidian 相容） | `deck.yml`＋每張的版型設定 |
| 版型、背景、字級 | 不寫 | 有十幾種版型 |
| 看的方式 | 書架、閱讀、搜尋、反向連結 | 3D 牌堆、講者視窗、畫筆、匯出單一 HTML |

## 中間那座橋

**筆記是知識的唯一來源，簡報是一次演出。** 內容可以跨渠道引用或複製一次，但永遠不自動雙向同步。

| 走法 | 方向 | 會不會改檔案 |
|---|---|---|
| `[[連結]]` 與反向連結 | 雙向 | 不會 |
| ▶ 快閃播放 | 筆記暫時當簡報播 | 不會 |
| `![[筆記#標題]]` 摘錄嵌入 | 筆記的一段放進投影片 | 不會 |
| 升級成簡報 | 筆記 → 新簡報骨架 | 新增檔案，之後各自獨立 |
| 講後筆記 | 簡報備註與問答 → 新筆記 | 新增檔案 |

完整規則：[`docs/INTEROP.md`](docs/INTEROP.md)。

## 現在就能用

1. 下載或複製本倉庫，把 `content/` 的結構複製到你自己的資料夾（這就是你的書庫）。
2. **播放簡報**：打開 [Mdslide Pile](https://torusmith.github.io/Mdslide-Pile/)，按「開啟本機資料夾」，選你書庫裡的 `slides/`。
3. **寫筆記**：用 Obsidian、VS Code 或任何編輯器開 `notes/`，照 [`docs/SPEC.md`](docs/SPEC.md) 寫 front matter。
4. **放上 GitHub 前**：執行守門檢查。

```bash
node scripts/guard-content.mjs content   # 檔案大小、路徑、公開與否、急件到期、個資
node --test tests/*.test.mjs             # 單元測試（Node 18 以上，不用 npm install）
```

## GitHub 上只放什麼

> ⚠️ GitHub Pages 的網站一律公開。`content/` 裡的每個檔案都會被任何人看到。

- 只放**公開**、**小**、**必要時會過期**的東西：官方範例、公開的讀書分享、急件公告。
- 圖片單檔 ≤ 300 KB（優先 SVG、WebP），文字檔 ≤ 100 KB，總量 ≤ 20 MB；影片與 PDF 一律放連結。
- 路徑只用英文；中文名稱寫在 `_topic.yml` 的 `name` 或 front matter 的 `title`。
- 急件寫 `pinned: true` 與 `expires: 2026-12-31`，到期後守門檢查會提醒下架。
- 私人或公司內容一律留在你的電腦。

預設分類與主題已經放好：範例、收件匣、學習（讀書筆記、課程）、工作（報告、會議）、財經、參考、生活（只留本機）。說明見 [`docs/SPEC.md`](docs/SPEC.md#預設分類與主題)。

## 範例

| 範例 | 位置 | 示範什麼 |
|---|---|---|
| Leafpile 入門筆記 | `content/notes/00-examples/2026-11-leafpile-basics/` | 筆記本、front matter、連結、講後筆記 |
| Leafpile 導覽（13 張） | `content/slides/00-examples/2026-11-leafpile-tour/` | 由上面的筆記升級而來，10 種版型 |
| 讀書筆記＋讀書會簡報 | `content/notes/10-reading/…`、`content/slides/10-reading/…` | 同名主題配對、私人主題裡的公開筆記 |
| 急件 | `content/notes/00-examples/urgent-sample.md` | `pinned` 與 `expires` |
| 畫布 | `content/boards/00-examples-overview.canvas` | 筆記卡與簡報卡在同一張畫布 |

兩份範例簡報都通過 Mdslide Pile v1.14.0 的檢查工具（`node scripts/check.mjs content/slides`）。

## 文件

| 文件 | 給誰 |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | 存檔規格：資料夾、設定檔、front matter、連結語法（人與 AI 都照這份） |
| [`docs/INTEROP.md`](docs/INTEROP.md) | 筆記與簡報怎麼互通、界線在哪 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 系統架構與模組 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 路線圖與每階段的驗收閘門 |
| [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md) | 請 AI 幫你寫筆記、做簡報、寫講後筆記的提示詞 |
| [`AGENTS.md`](AGENTS.md) | 給維護本專案的 AI 與人 |

## 血緣

Leafpile 融合了同一位作者的兩個專案：

- [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile)：資料夾變成 3D 牌堆簡報。Leafpile 沿用它的簡報規格、本機優先架構、零依賴原則與寫入安全規則。
- [讀書筆記 Vault](https://github.com/ToruSmith/reading-notes-vault)：Apps Script 後端的讀書筆記庫。Leafpile 吸收它的筆記 front matter、分類與主題、公開／私人規則、個資掃描與 JSON Canvas 畫布。

## 參與

- 回報問題或建議功能：開 Issue（有範本）。
- 想改程式或文件：先讀 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 安全問題：依 [`SECURITY.md`](SECURITY.md) 私下回報。
- 行為準則：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

## 貢獻者與 AI 創作者

- 人類貢獻者：[`CONTRIBUTORS.md`](CONTRIBUTORS.md)
- AI 協作揭露：[`AI_CREDITS.md`](AI_CREDITS.md)。本專案歡迎 AI 協作，但每一行都由人類審閱並負責。

## 授權

程式碼 MIT（[`LICENSE`](LICENSE)）；文件與範例內容 CC BY 4.0（[`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)）。你自己的筆記與簡報著作權屬於你。
