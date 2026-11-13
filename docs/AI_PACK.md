# Leafpile 書庫包規格（給 AI）

> 這份給 AI 讀：使用者會給你資料（貼上或附件），請照這份規格做出可以直接匯入 Leafpile 的**書庫包**。
> 完整規格在 [`SPEC.md`](SPEC.md)；簡報版型的細節在 [`slides/GUIDE.zh-Hant.md`](slides/GUIDE.zh-Hant.md)。這份是精簡版，照這份做就夠了。

## 1. 你要交什麼

- **一個 zip 檔**（建議檔名 `leafpile-pack.zip`），根目錄就是 `notes/`、`slides/`、`boards/`（用到哪個放哪個）。
- 不能建立檔案時，改用第 7 節的**文字書庫包**，只輸出檔案內容，不要其他說明。
- 使用者指定的主題資料夾（例如 `10-reading`）照用；沒指定就用 `01-inbox`。
- 檔名與資料夾只用小寫英文、數字、`-`（中文寫在 `title`）；日期前綴用今天。
- 一律 UTF-8、LF 換行、YAML 用空白縮排。

```
leafpile-pack.zip
├─ notes/10-reading/2026-11-13-atomic-habits.md
├─ slides/10-reading/2026-11-atomic-habits-share/
│  ├─ deck.yml
│  ├─ 01-why/01-hook.md
│  └─ 02-how/01-four-laws.md
└─ boards/atomic-habits-map.canvas
```

## 2. 內容原則（最重要）

1. **只用資料裡的內容**。資料沒有的事實不要補；需要補背景時寫「（補充，待確認）」。數字、引言要能在資料裡找到。
2. **寫得有用，不要只寫大綱**：每個重點要有「是什麼 → 為什麼 → 例子或原文」。
3. **結論先行**：第一段一兩句講完整件事。
4. 資料是新聞、報告時，清楚分開「事實」「各方說法」「未確定」。
5. 使用者的補充要求優先於這裡的預設（長度、對象、語氣、張數）。

## 3. 筆記（`notes/<主題>/YYYY-MM-DD-<slug>.md`）

```markdown
---
title: 原子習慣：每天進步 1%
date: 2026-11-13
tags: [習慣, 讀書]
public: false
source: <資料的網址或書名，沒有就省略>
---
# 原子習慣：每天進步 1%

一句話結論：習慣是系統的結果，改系統比靠意志力有效。

## 重點
### 1. 身分認同比目標重要
說明為什麼……
> 原文引用（第 2 章）

## 例子
……

## 待確認
- ……

## 相關
- [[另一篇筆記的 title]]
```

- 資料長（一本書、一份長報告）時拆成幾篇，**另外寫一篇總覽**，用 `[[筆記 title]]` 連到各篇。
- 一本書的多章可以放一個筆記本資料夾：`notes/<主題>/2026-11-<slug>/`，裡面放 `_book.yml`（`title`、`author`、`status: reading`）和 `01-xxx.md`、`02-xxx.md`。
- 筆記裡不要寫版型（`layout`、`size`）；可用：標題、清單、核取方塊、引言、表格、`==螢光==`、腳註、`[[連結]]`。不要原始 HTML。
- 篇幅依資料：一般 400–1500 字。

## 4. 簡報（`slides/<主題>/YYYY-MM-<slug>/`）

**資料夾就是結構**：簡報 → 章節資料夾 `01-xxx/` → 投影片檔 `01-xxx.md`（一個檔案一張）。

`deck.yml`：

```yaml
mdslide: 1
title: 原子習慣：讓好習慣自動發生
subtitle: 讀書會分享
date: 2026-11-13
theme: paper          # paper / ink / slate / sepia / nord
lang: zh-Hant
end: 謝謝聆聽
sections:
  - folder: 01-why
    title: 為什麼目標沒用
    color: "#c0674a"
  - folder: 02-how
    title: 四個法則
    color: "#4f73a6"
```

投影片（例：`01-why/01-hook.md`）：

```markdown
# 標題直接寫結論：改系統，不要只定目標

- 重點一，**粗體**會用章節顏色
- 重點二
- 重點三

Note:
講者備註：這裡講書中的例子。
```

版型（在檔案開頭寫 `<!-- layout: 名稱 -->`；不寫就自動判斷）：

| 版型 | 寫法 |
|---|---|
| `number` | `## 37 倍` 下一行說明（大數字） |
| `stats` | `- **3 倍** 說明`，2–4 項 |
| `quote` | `> 引言` 下一行 `— 出處` |
| `timeline` | `- **2024** 事件`，可加子項目 |
| `columns` | 用單獨一行 `+++` 分欄比較 |
| `grid` | 用 `+++` 分 3–6 個區塊 |
| `flow` | 一行清單是一列流程，項目間自動畫箭頭 |
| `chart` | front matter 寫 `layout: chart`、`chart: bar`，內文一個表格 |
| `center` | 置中強調一句話 |

原則：

- 一張只講一件事；標題寫結論；清單最多 5 條、每條一行內。
- 預設 10–15 張、2–4 章，每章 3–6 張；開場第一張可用 `<!-- layout: agenda -->`（自動大綱，內文只要 `# 大綱`）。
- 每 3–4 張穿插一張 `number`、`quote`、`stats`、`timeline` 或 `columns`，不要整份都是條列。
- 細節放 `Note:` 備註；最後一章放「結論／下一步」。
- 標題頁、章節封面由工具自動產生，**不要自己做**。
- 沒有真實圖片就不要放圖片連結。

## 5. 畫布（`boards/<slug>.canvas`，JSON Canvas）

```json
{
  "nodes": [
    { "id": "g1", "type": "group", "label": "核心觀念", "x": 0, "y": 0, "width": 340, "height": 420, "color": "5" },
    { "id": "c1", "type": "text", "text": "**身分認同**\n先決定成為什麼樣的人", "x": 20, "y": 50, "width": 300, "height": 110 },
    { "id": "n1", "type": "file", "file": "notes/10-reading/2026-11-13-atomic-habits.md", "x": 400, "y": 50, "width": 300, "height": 110 }
  ],
  "edges": [
    { "id": "e1", "fromNode": "c1", "fromSide": "right", "toNode": "n1", "toSide": "left", "label": "詳見" }
  ]
}
```

- 3–6 個群組（`group`），每組 3–8 張卡片；群組由左到右排，間隔 60；卡片寬 300、由上往下排，間隔 20；群組要包住它的卡片。
- 卡片文字用 Markdown，第一行粗體當小標，下面一兩句說明（不要只放一個詞）。
- 連線一定加 `label`（「導致」「舉例」「相反」……）；10 條以內，只連真正有關係的。
- `color` 用 `"1"`–`"6"`（紅、橘、黃、綠、青、紫）。
- 要指向筆記時用 `file` 節點，路徑必須是同一個包裡的筆記（或使用者告訴你的既有路徑）；指向簡報用 `"file": "slides/…/deck.yml"` 並加 `"x-kind": "deck"`。
- 所有 `id` 不能重複；`fromNode`、`toNode` 必須是存在的 `id`。

## 6. 交付前自我檢查

- [ ] 路徑以 `notes/`、`slides/`、`boards/` 開頭，資料夾名稱只有小寫英文、數字、`-`。
- [ ] 每篇筆記有 front matter（`title`、`date`）和一行結論；`[[連結]]` 的目標在包裡找得到。
- [ ] 每份簡報有 `deck.yml`，章節資料夾和 `sections` 的 `folder` 一致；沒有超過 5 條的清單。
- [ ] 畫布是合法 JSON，連線兩端都存在。
- [ ] 沒有資料以外的事實；不確定的已標「待確認」。

## 7. 文字書庫包（不能建立 zip 時）

每個檔案以單獨一行 `=== FILE: 路徑 ===` 開頭、單獨一行 `=== END ===` 結尾，整個回覆只放這些區塊：

```text
=== FILE: notes/10-reading/2026-11-13-atomic-habits.md ===
---
title: 原子習慣：每天進步 1%
date: 2026-11-13
---
# 原子習慣：每天進步 1%
……
=== END ===
=== FILE: slides/10-reading/2026-11-atomic-habits-share/deck.yml ===
mdslide: 1
title: 原子習慣
=== END ===
```

使用者把 zip 或這段文字交給 Leafpile 匯入；匯入前會預覽，不會覆蓋使用者原有的檔案。
