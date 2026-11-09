# 請 AI 幫忙的提示詞

把下面的提示詞複製給任何 AI，改掉 `<尖括號>` 的部分。如果 AI 打不開網址，把 `docs/SPEC.md` 與 `docs/INTEROP.md` 當附件上傳。

> 網址假設倉庫建立在 `github.com/ToruSmith/leafpile`；倉庫名稱不同時請一併替換。

驗收時看四件事：數字有沒有來源、檔案路徑對不對、front matter 有沒有亂加版型、交付格式能不能直接放進書庫。

## 1. 整理讀書筆記

```text
請先完整閱讀這兩份規則：
https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/SPEC.md
https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/INTEROP.md

依規則，把我附上的劃線與心得整理成 Leafpile 讀書筆記：
- 書名：<書名>，作者：<作者>
- 放在：notes/10-reading/<日期>-<英文書名縮寫>/
- 一章一篇筆記，每篇第一句寫結論；概念之間用 [[連結]]
- 建立 _book.yml（status: reading）；所有筆記 public: false

要求：
1. 內容只能來自我附的劃線與心得，不要補書裡沒有的內容；不確定的地方標「待確認」。
2. 不要在筆記裡寫版型設定（layout、size、background）。
3. 交付一個 zip，解壓後就是筆記本資料夾。不能產生 zip 的話，就把每個檔案用「檔案路徑 + 程式碼區塊」逐一列出。
```

## 2. 把筆記升級成簡報

```text
請先完整閱讀：
https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/INTEROP.md（第 4 節「升級成簡報」）
https://raw.githubusercontent.com/ToruSmith/Mdslide-Pile/main/製作專案指南.md

依規則，把我附上的筆記升級成一份 Mdslide Pile 簡報：
- 聽眾：<讀書會成員>，長度：<10> 分鐘
- 放在：slides/<同名主題>/<日期>-<名稱>/
- deck.yml 加上 source: <筆記路徑>

要求：
1. 投影片標題寫結論；每張都要有講者備註（Note:）。
2. 至少用 4 種版型；不要逐字搬筆記，簡報要比筆記短。
3. 交付 zip 或「檔案路徑 + 程式碼區塊」。
```

## 3. 寫講後筆記

```text
請先完整閱讀：https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/INTEROP.md（第 5 節「講後筆記」）

依規則，用我附上的簡報資料夾與現場問答紀錄，寫一篇講後筆記：
- 放在：notes/<同名主題>/<日期>-<簡報名稱>-講後.md
- front matter：from_deck、public: false

要求：問答保留原意，不要美化；最後列出「下次要改」的待辦（- [ ]）。
```

## 4. 準備放上 GitHub 的急件

```text
請依 https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/SPEC.md 寫一篇急件筆記：
- 內容：<例如讀書會改期>
- 放在：content/notes/00-examples/<英文檔名>.md
- front matter：public: true、pinned: true、expires: <到期日>

要求：只放必要資訊與連結，不放私人會議連結、電話、Email；檔名只用英文。
完成後請提醒我執行 node scripts/guard-content.mjs content。
```
