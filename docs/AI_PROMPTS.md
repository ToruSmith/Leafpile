# 請 AI 幫忙的提示詞

> **最簡單的方式**：書庫首頁的「AI 生成」。選筆記、簡報或畫布，貼上資料（或到 AI 那邊上傳檔案），按一下就會複製提示詞並開啟 Claude、ChatGPT 或 Gemini。提示詞請 AI 先讀 [`AI_PACK.md`](AI_PACK.md)（給 AI 的書庫包規格），再交 zip；選回 zip 或貼回文字就能匯入（先預覽、不覆蓋）。下面的提示詞適合更複雜的情況（整本書、多份檔案）。
>
> AI 的回覆可以用「文字書庫包」格式：每個檔案以 `=== FILE: 路徑 ===` 開頭、`=== END ===` 結尾。貼到「書庫包 → 匯入 → 貼上 AI 給的文字」即可，不必自己建檔。

把下面的提示詞複製給任何 AI，改掉 `<尖括號>` 的部分。如果 AI 打不開網址，把 `docs/SPEC.md` 與 `docs/INTEROP.md` 當附件上傳。

> 網址假設倉庫建立在 `github.com/ToruSmith/leafpile`；倉庫名稱不同時請一併替換。

驗收時看四件事：數字有沒有來源、檔案路徑對不對、front matter 有沒有亂加版型、交付格式能不能直接放進書庫。

## 0. 讓 AI 先看懂你的書庫（書庫索引）

書庫很大時，先產生一份索引交給 AI，它就不用一個檔案一個檔案翻：

```bash
node leafpile-check.mjs <書庫> --index > 索引.md          # Markdown，給 AI 讀
node leafpile-check.mjs <書庫> --index=json > 索引.json   # JSON，給程式讀
node leafpile-check.mjs <書庫> --index --public          # 只列公開的筆記（要交給外部 AI 服務時用）
```

索引列出每篇筆記的路徑、日期、標籤、自訂欄位、章節、連到誰、被誰連、出現在哪些畫布；簡報的來源與摘錄；每張畫布放了哪些卡片。它是用的時候才產生的，改了檔案就重跑一次，**不要把索引檔放進書庫或 GitHub**（私人筆記的標題也在裡面，除非加 `--public`）。

```text
這是我的 Leafpile 書庫索引（附件）。請先讀它掌握全貌，需要細節時再請我提供原檔，或直接打開索引裡列出的路徑。
規則：https://raw.githubusercontent.com/ToruSmith/leafpile/main/docs/SPEC.md
我想做的事：<例如找出三個月沒動、也沒被連到的筆記；或整理「習慣」相關的筆記成一個大綱>
```

能直接讀資料夾的 AI（例如在你電腦上執行的程式助理），請它在動手前先跑一次 `node leafpile-check.mjs <書庫> --index`。

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
3. 交付一個 zip，解壓後就是筆記本資料夾。不能產生 zip 的話，就用文字書庫包格式：每個檔案以「=== FILE: 完整路徑 ===」開頭、「=== END ===」結尾。
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
