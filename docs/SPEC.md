# Leafpile 存檔規格（leafpile: 1）

這份文件定義一個 Leafpile 書庫怎麼存。**人與 AI 都照這一份**；程式、守門腳本與範例都以它為準。

- 簡報渠道的細節（版型、投影片設定、媒體、圖表）完全沿用 [Mdslide Pile 製作專案指南](https://github.com/ToruSmith/Mdslide-Pile/blob/main/製作專案指南.md)，這裡只寫 Leafpile 新增或不同的地方。
- 筆記與簡報怎麼互通，見 [`INTEROP.md`](INTEROP.md)。

---

## 1. 一分鐘看懂

```
我的頁堆/                         ← 書庫
├─ _site.yml                     ← 書庫設定與分類（可省略）
├─ notes/                        ← 筆記渠道
│  ├─ 01-inbox/                  ← 主題
│  │  └─ 2026-11-09-idea.md      ← 一篇筆記
│  └─ 10-reading/
│     ├─ _topic.yml              ← 主題設定（可省略）
│     └─ 2026-11-atomic-habits/  ← 筆記本（可省略這層）
│        ├─ _book.yml
│        ├─ 01-ch1.md
│        └─ media/
├─ slides/                       ← 簡報渠道（Mdslide Pile 規格）
│  └─ 10-reading/                ← 和 notes/10-reading 是同一個主題
│     └─ 2026-11-atomic-habits-share/
│        ├─ deck.yml
│        └─ 01-why/01-hook.md
├─ boards/                       ← 畫布（*.canvas，JSON Canvas）
└─ _archive/                     ← 封存
```

- **層級**：書庫 → 渠道 → 主題 → （筆記本）→ 筆記；書庫 → 渠道 → 主題 → 簡報 → 章節 → 投影片。
- **所有設定檔都可以省略**，只靠資料夾名稱也能讀。
- **同名主題就是同一個主題**：`notes/10-reading` 與 `slides/10-reading` 在首頁合成一張主題卡。

## 2. 命名規則

沿用 Mdslide Pile：

| 規則 | 說明 | 範例 |
|---|---|---|
| 數字前綴決定順序 | 顯示時自動拿掉 | `10-reading` 顯示為主題設定的 `name` |
| 日期前綴 | 當成日期，依新到舊排 | `2026-11-atomic-habits` |
| `_` 或 `.` 開頭 | 略過（草稿、設定檔、封存） | `_draft.md`、`_archive/` |
| 保留資料夾 | 只放素材 | `media/` `assets/` `images/` `img/` `video/` `videos/` |
| 說明文件 | 不當成筆記或投影片 | `README.md`、`AGENTS.md` |

Leafpile 新增：

- **主題資料夾建議用兩位數字分段**：`0x` 系統（範例、收件匣）、`1x` 學習、`2x` 工作、`3x` 財經、`4x` 參考、`5x` 生活。留空位方便插入。
- **要放上 GitHub 的路徑只用英文字母、數字、`-`、`_`、`.`**；中文寫在 `name`、`title`。本機書庫可以用中文。
- 舊的 `_封存/` 仍然讀得懂；新的封存一律寫到 `_archive/`。

## 3. 設定檔

YAML，只支援常用語法：`名稱: 值`、縮排巢狀、`- 清單`、`[a, b]`、`|` 多行、`#` 註解。縮排用空白。

### `_site.yml`（書庫）

```yaml
leafpile: 1                    # 規則版本
title: Toru 的頁堆
description: 一句話說明
theme: paper                   # paper / ink / slate
lang: zh-Hant
categories:                    # 分類（首頁書架的分組與順序）
  - id: learning
    name: 學習
    color: "#4f73a6"
limits:                        # GitHub 守門上限（只有 content/ 用得到）
  image_kb: 300
  text_kb: 100
  total_mb: 20
```

### `_topic.yml`（主題，放在 `notes/<主題>/` 或 `slides/<主題>/`）

```yaml
name: 讀書筆記
description: 一本書一個資料夾
category: learning             # 對應 _site.yml 的分類 id
color: "#4f73a6"
public: false                  # 這個主題的筆記預設是否公開
local_only: true               # 只留本機；守門腳本會擋下放上 GitHub 的檔案（可省略）
order: [2026-12-x, 2026-11-y]  # 可省略
```

同一個主題在兩個渠道都有 `_topic.yml` 時，以 `notes/` 那份為準。

### `_book.yml`（筆記本，可省略）

```yaml
title: 原子習慣
author: James Clear
status: reading                # reading / done / paused
cover: media/cover.jpg
public: false
tags: [習慣]
```

### `deck.yml`（簡報）

完全沿用 Mdslide Pile（`mdslide: 1`）。Leafpile 新增一個欄位，Mdslide Pile 會略過它：

```yaml
source: notes/10-reading/2026-11-atomic-habits   # 升級自哪一份筆記或筆記本
```

## 4. 筆記怎麼寫

一般的 Markdown。開頭可以有 front matter，全部欄位都可以省略：

```markdown
---
title: 原子習慣 第 1 章
date: 2026-11-09
tags: [習慣, 讀書會]
aliases: [第一章]
public: false
lang: zh-Hant
source: https://example.com/book
pinned: false
expires: 2026-12-31
from_deck: slides/10-reading/2026-11-x
---
# 原子習慣 第 1 章

第一句寫結論。
```

| 欄位 | 說明 |
|---|---|
| `title` | 顯示名稱；省略時取第一個 `#` 標題，再省略取檔名（去掉前綴） |
| `date` | 日期；省略時取檔名的日期前綴 |
| `tags` | 標籤 |
| `aliases` | 別名，`[[連結]]` 也能用別名找到 |
| `public` | 是否公開，見第 6 節 |
| `lang` | `zh-Hant` 或 `en` |
| `source` | 原始出處網址 |
| `pinned` | 急件，置頂首頁「急件」區 |
| `expires` | 到期日；`pinned: true` 時必填 |
| `from_deck` | 講後筆記的來源簡報 |

**筆記裡不寫版型設定**（`layout`、`size`、`background`……）：版型只屬於簡報。

支援的 Markdown 與 Mdslide Pile 相同（標題、清單、核取方塊、引言、表格、程式碼、粗體、斜體、刪除線、`==螢光==`、連結、圖片、腳註），再加上第 5 節的連結語法。原始 HTML 不會生效。

## 5. 連結語法

| 寫法 | 意思 |
|---|---|
| `[[筆記]]` | 連到筆記；比對順序：`title` → `aliases` → 檔名（去前綴）→ 檔名 |
| `[[筆記#標題]]` | 連到筆記的某一段 |
| `[[筆記\|顯示文字]]` | 自訂顯示文字 |
| `[[slides:簡報]]` | 連到簡報（比對 `deck.yml` 的 `title` 或資料夾名稱） |
| `![[筆記#標題]]` | 在**投影片**裡摘錄筆記的一段（見 INTEROP） |

- 名稱重複時，同主題優先，再來是較新的日期；仍無法判斷時檢查工具會提醒，請改寫成路徑：`[[notes/10-reading/2026-11-x/01-ch1]]`。
- 找不到目標的連結照樣顯示，並在檢查工具中列出。
- 這套語法與 Obsidian 相容，`notes/` 可以直接用 Obsidian 開啟。

## 6. 公開與私人

沿用讀書筆記 Vault 的規則：

1. 筆記 front matter 的 `public` 優先。
2. 沒寫就看筆記本 `_book.yml` 的 `public`。
3. 再沒寫就看主題 `_topic.yml` 的 `public`。
4. 都沒寫就是**私人**。

`local_only: true` 的主題，裡面的筆記不管 `public` 寫什麼，都不能放上 GitHub。

放在倉庫 `content/` 的內容一律會公開，所以守門腳本要求每篇筆記都判斷為公開。

## 預設分類與主題

| 分類 id | 分類 | 主題資料夾 | 顯示名稱 | 筆記 | 簡報 | 預設公開 |
|---|---|---|---|---|---|---|
| `examples` | 範例 | `00-examples` | 官方範例 | ✓ | ✓ | 是 |
| `inbox` | 收件匣 | `01-inbox` | 收件匣 | ✓ | | 否 |
| `learning` | 學習 | `10-reading` | 讀書筆記 | ✓ | ✓ | 否 |
| `learning` | 學習 | `11-courses` | 課程與講座 | ✓ | ✓ | 否 |
| `work` | 工作 | `20-reports` | 工作報告 | ✓ | ✓ | 否 |
| `work` | 工作 | `21-meetings` | 會議紀錄 | ✓ | | 否 |
| `finance` | 財經 | `30-markets` | 財經市場 | ✓ | ✓ | 是 |
| `reference` | 參考 | `40-reference` | 速查與模板 | ✓ | ✓ | 是 |
| `life` | 生活 | `50-life` | 生活紀錄（`local_only`） | ✓ | | 否 |

這些設定已放在 `content/`。複製到本機書庫後可以自由增刪改名。

## 7. 畫布

`boards/*.canvas`，格式是 [JSON Canvas](https://jsoncanvas.org/)：

- `file` 節點可以指向筆記（`notes/…/x.md`）或簡報（`slides/…/deck.yml`）。
- Leafpile 自訂的欄位一律以 `x-` 開頭，例如節點的 `"x-kind": "deck"`、檔案層級的 `"x-board"`。
- 讀寫時保留所有未知欄位。

## 8. 封存

刪除一律是封存：搬到書庫根目錄的 `_archive/`，保留原本的相對路徑；同名時加編號。Leafpile 從不呼叫刪除。

## 9. 自動判斷開啟的層級

使用者可能開啟整個書庫、單一渠道、主題或單一簡報。依序判斷：

1. 有 `notes/` 或 `slides/` 子資料夾 → 書庫
2. 有 `deck.yml` → 單一簡報（交給 Mdslide 規則）
3. 有 `_book.yml` → 筆記本
4. 有 `_topic.yml` → 主題（看父資料夾名稱判斷渠道；判斷不出來時，有 `deck.yml` 子資料夾就是簡報主題）
5. 其他 → 交給 Mdslide Pile 原本的判斷（簡報書庫）

## 10. 版本

`_site.yml` 的 `leafpile: 1` 是規則版本，`deck.yml` 的 `mdslide: 1` 是簡報規則版本。只有破壞性變更才升版，並保留舊版的讀法。
