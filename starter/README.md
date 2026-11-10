# 我的頁堆(Leafpile 書庫)

一個資料夾,平常是筆記,上台是簡報。這個資料夾放在你的電腦或隨身碟,內容不會上傳。

```
我的頁堆/
├─ _site.yml      書庫設定與分類
├─ notes/         筆記:一個 .md 一篇
├─ slides/        簡報:一個資料夾一份,一個 .md 一張投影片
├─ boards/        畫布(之後的版本)
├─ _archive/      封存(Leafpile 從不刪除你的檔案)
└─ _docs/         規則與說明
```

## 怎麼開

1. 用 Chrome 或 Edge 打開 https://torusmith.github.io/Leafpile/
2. 按「開啟本機資料夾」,選這個資料夾
3. 之後在首頁的「最近開啟的書庫」點一下就能重新連線

網站可以「安裝」成 App(網址列右側的安裝圖示),裝過一次之後沒有網路也能用。
筆記資料夾 `notes/` 也可以直接用 Obsidian 或任何 Markdown 編輯器開啟。

## 怎麼用

- **寫筆記**:書架右上「+ 筆記」,或直接在 `notes/<主題>/` 放 `.md` 檔。用 `[[筆記標題]]` 互相連結。
- **快閃播放**:筆記右上的 ▶,把筆記暫時當簡報播(不會產生檔案)。
- **做成簡報**:筆記右上「做成簡報」,會在 `slides/<同名主題>/` 建立一份新簡報的骨架。之後兩邊各自獨立。
- **講後筆記**:播放簡報時按 Ctrl+K →「把這份簡報存成講後筆記」。
- **找東西**:任何畫面按 Ctrl+K(Mac 是 ⌘K)。

## 規則

- `_docs/SPEC.md`:資料夾、設定檔、筆記的 front matter、連結語法
- `_docs/INTEROP.md`:筆記與簡報怎麼互通
- `_docs/slides/GUIDE.zh-Hant.md`:簡報的完整規則(版型、媒體、圖表);`MANUAL.zh-Hant.md` 是操作手冊
- `_docs/AI_PROMPTS.md`:請 AI 幫你整理筆記、做簡報的提示詞
- 英文版:`_docs/slides/GUIDE.en.md`、`MANUAL.en.md`

## 怎麼檢查

- **不用安裝**:在網站開啟這個書庫,按「✓ 檢查」
- **雙擊執行**(需要先安裝 [Node.js](https://nodejs.org/)):Windows 雙擊 `check-library.cmd`,Mac 雙擊 `check-library.command`
- **命令列**:`node leafpile-check.mjs`

## 公開與私人

筆記預設是私人的。只有 front matter 寫 `public: true`(或筆記本、主題設為公開)的筆記才算公開。
`50-life` 設定了 `local_only: true`:永遠只留在這台電腦。
要把少數內容放上 GitHub 時,請先讀 `_docs/SPEC.md` 第 6 節。
