#!/usr/bin/env node
// Leafpile 書庫檢查工具(單檔版 v0.17.0)
// 由 scripts/bundle-check.mjs 自動產生,請不要手動修改。原始碼:https://github.com/ToruSmith/Leafpile
//
// 用法(需要 Node.js 18 以上):
//   node leafpile-check.mjs                 檢查這個檔案所在的資料夾(放在書庫根目錄時 = 整個書庫)
//   node leafpile-check.mjs <資料夾>         檢查指定的書庫(Leafpile 或 Mdslide Pile)、主題或單一簡報
//   node leafpile-check.mjs <資料夾> --slides 連每張投影片都列出來
//   node leafpile-check.mjs <資料夾> --lang en  英文輸出(預設依作業系統語言)
//   node leafpile-check.mjs <資料夾> --index    書庫索引:所有筆記、簡報、畫布與連結(給 AI 先看全貌)
//                                             --index=json 輸出 JSON;加 --public 只列公開的筆記
// Windows 也可以直接雙擊 check-library.cmd,Mac 雙擊 check-library.command。

import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';
import { fileURLToPath as __toPath } from 'node:url';

const __m = {};
// ───────── app/core/color.js ─────────
__m["app/core/color.js"] = (() => {
// 顏色值白名單。設定檔與投影片裡的顏色會直接放進 style 屬性,
// 只接受下列格式,避免 `red;background:url(...)` 這類內容注入樣式。
//   #rgb  #rrggbb  #rrggbbaa   rgb()/rgba()/hsl()/hsla()(只含數字)   英文顏色名稱(red、teal…)

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.\s,/%+-]+(?:deg)?[\d.\s,/%+-]*\)$/i;
const NAMED = /^[a-z]{3,24}$/i;

/** 合法就回傳整理過的顏色字串,否則回傳 null。 */
function safeColor(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || v.length > 64) return null;
  return HEX.test(v) || FUNC.test(v) || NAMED.test(v) ? v : null;
}
return { safeColor };
})();

// ───────── app/core/style.js ─────────
__m["app/core/style.js"] = (() => {
// 每張投影片的外觀設定(size、background、overlay、text、font、align、ratio)。
// 這些值會放進 class 或 style 屬性,所以一律在這裡驗證成固定格式,不合法就忽略並回報。
// 瀏覽器與 Node(檢查工具)共用,不能用到 DOM。

const { safeColor } = __m["app/core/color.js"];
const SIZES = { small: 0.8, compact: 0.8, normal: 1, large: 1.15, xl: 1.3 };
const OVERLAYS = ['auto', 'dark', 'light', 'none'];
const ALIGNS = ['left', 'center', 'right'];

/** 字型名稱白名單:只允許文字、數字、空白、連字號、底線、點(不能放引號、括號、url())。 */
const FONT_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;

/** 「Noto Sans TC, Arial」→ `"Noto Sans TC", "Arial"`;不合法回傳 null。 */
function safeFonts(value) {
  const names = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length || names.some(n => !FONT_NAME.test(n))) return null;
  return names.map(n => `"${n}"`).join(', ');
}

/** 「2:1」「1:1:2」→ `2fr 1fr`;每個數字 0.5–6,最多 4 欄。不合法回傳 null。 */
function parseRatio(value) {
  const parts = String(value ?? '').split(/\s*[:/]\s*/);
  if (parts.length < 2 || parts.length > 4) return null;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0.5 || n > 6)) return null;
  return nums.map(n => `${n}fr`).join(' ');
}

/** 顏色的相對亮度(0 暗 – 1 亮)。只認得 #色碼 與 rgb();其他格式回傳 null(不自動換字色)。 */
function luminance(color) {
  const v = String(color || '').trim();
  let rgb = null;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb) {
    const NAMED = { black: 0, white: 1, navy: 0.016, darkblue: 0.018, maroon: 0.046, darkgreen: 0.09, purple: 0.061, indigo: 0.031, darkslategray: 0.06, midnightblue: 0.02 };
    return NAMED[v.toLowerCase()] ?? null;
  }
  const [r, g, b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 整理一張投影片的外觀設定。meta 會被就地整理(不合法的值刪掉),問題推進 issues。
 * 回傳給 render.js 用的結果:{ size, bgColor, bgImage, overlay, text, font, align, ratio }。
 */
function readSlideStyle(meta, { path, issues = [], t = k => k } = {}) {
  const out = {};
  const bad = (key, value) => { issues.push({ path, message: t('issue.slideStyle', { key, value }) }); delete meta[key]; };

  if (meta.size != null) {
    const s = String(meta.size).toLowerCase();
    if (s in SIZES) out.size = s === 'compact' ? 'small' : s; else bad('size', meta.size);
  }
  if (meta.background != null && meta.background !== '') {
    const c = safeColor(meta.background);
    const v = String(meta.background).trim();
    if (c && (/^(#|rgb|hsl)/i.test(v) || !/[./]/.test(v))) out.bgColor = c; else out.bgImage = v; // 有 . 或 / 的是檔案路徑
  }
  if (meta.overlay != null) {
    const o = String(meta.overlay).toLowerCase();
    if (OVERLAYS.includes(o)) out.overlay = o; else bad('overlay', meta.overlay);
  }
  if (meta.text != null) {
    const c = safeColor(meta.text);
    if (c) out.text = c; else bad('text', meta.text);
  }
  if (meta.font != null) {
    const f = safeFonts(meta.font);
    if (f) out.font = f; else bad('font', meta.font);
  }
  if (meta.align != null) {
    const a = String(meta.align).toLowerCase();
    if (ALIGNS.includes(a)) out.align = a; else bad('align', meta.align);
  }
  if (meta.ratio != null) {
    const r = parseRatio(meta.ratio);
    if (r) out.ratio = r; else bad('ratio', meta.ratio);
  }
  // 背景是深色或淺色:決定字要不要反白(背景色看亮度;背景圖看遮罩)
  if (out.bgColor) { const l = luminance(out.bgColor); if (l != null) out.tone = l < 0.35 ? 'dark' : 'light'; }
  if (out.bgImage && (out.overlay === 'dark' || out.overlay === 'light')) out.tone = out.overlay;
  return out;
}
return { SIZES, OVERLAYS, ALIGNS, safeFonts, parseRatio, luminance, readSlideStyle };
})();

// ───────── app/core/locales/zh-Hant.js ─────────
__m["app/core/locales/zh-Hant.js"] = (() => {
// 繁體中文字串表。新增任何使用者看得到的文字時,必須同時加進 en.js(tests/i18n.test.mjs 會檢查)。
// {name} 是參數佔位,兩份語言的佔位必須一致。

const LOCALE_ZH_HANT = {
  // ---------- 設定檔(YAML)----------
  'yaml.line': '第 {line} 行:{message}',
  'yaml.tab': '請用空白縮排,不要用 Tab',
  'yaml.inconsistent': '縮排不一致',
  'yaml.tooDeep': '縮排過多',
  'yaml.notList': '這裡應該是「名稱: 值」,不是清單',
  'yaml.unknown': '看不懂「{text}」,格式應為「名稱: 值」',
  'yaml.array': '行內陣列缺少 ]',

  // ---------- 解析時的提醒 ----------
  'lib.defaultLabel': '書庫',
  'issue.color': '顏色「{value}」格式不正確,已改用預設顏色',
  'issue.slideStyle': '設定 {key} 的值「{value}」看不懂,已忽略。可用的寫法見 docs/slides/GUIDE.zh-Hant.md 第 4 節',
  'issue.mark': '標註「{value}」看不懂,已忽略。寫法:<!-- mark: 左 上 寬 高 標籤 -->,數字是圖片上的百分比(0–100)',
  'issue.slideColor': '顏色「{value}」格式不正確,已改用章節顏色',
  'issue.readFailed': '讀取失敗',
  'issue.noSlides': '這個資料夾裡沒有找到任何投影片(.md 檔)',
  'issue.newerSchema': '此簡報需要較新版本的工具(mdslide: {version})',
  'issue.frontMatter': '開頭設定(front matter){detail}',
  'issue.frontMatterParse': '無法解析',
  'issue.layout': '未知的版型「{layout}」,改用自動判斷。可用:{list}',
  'issue.brandFont': 'brand 字型「{value}」含有不允許的字元,已忽略',

  // ---------- 檢查 ----------
  'check.noTable': 'chart 版型找不到表格',
  'check.badCell': '圖表第 {row} 列第 {col} 欄「{text}」不是數字,會顯示為空白',
  'check.missingMedia': '找不到素材 {src}(實際路徑 {path})',
  'check.missingBg': '找不到背景圖 {src}',
  'check.missingCover': '找不到 cover_image {src}',
  'check.dupPrefix': '同一層有兩個以上的 {prefix} 前綴:{names}。播放順序會依名稱決定,可能不是你要的',
  'check.mixedPrefix': '前綴位數不一致:{names}。檔案總管裡的順序可能和播放順序不同,建議統一用兩位數(01-、02-)',
  'check.emptySlide': '第 {n} 張是空白投影片(只有設定、沒有內容)',
  'check.sep': '、',
  'check.overflow': '第 {n} 張的內容超出投影片約 {px} 像素,下面會被切掉。可以拆成兩張,或加上 size: small',
  'check.overflowCompact': '第 {n} 張已經是小字級,內容仍超出約 {px} 像素,請拆成兩張',
  'check.missingLogo': '找不到 brand.logo {src}',
  'check.missingFootnote': '腳註 [^{id}] 沒有定義',
  'check.deckFolder': '(簡報資料夾)',
  'check.tooMany': '共 {n} 張,25–30 分鐘的報告建議 20–30 張',
  'check.opening': '(開場)',
  'check.unreadable': '無法讀取:{error}',
  'check.kind.library': '書庫',
  'check.kind.topic': '主題',
  'check.kind.deck': '單一簡報',
  'check.report.title': '📚 {title}(偵測為:{kind})',
  'check.report.topic': '▸ 主題:{title}',
  'check.report.empty': '  (還沒有簡報)',
  'check.report.deck': '  ▪ {title}{date}— {sections} 章、{total} 張、{layouts} 種版型、備註 {noted}/{total}{noConfig}',
  'check.report.date': '({date})',
  'check.report.noConfig': '、沒有 deck.yml',
  'check.report.section': '      {title}:{count} 張',
  'check.report.untitled': '(無標題)',
  'check.report.auto': '  (自動)',
  'check.report.problems': '⚠ {n} 個問題:',
  'check.report.ok': '✓ 沒有發現問題',
  'check.usage': '用法:node scripts/check.mjs <資料夾> [--slides] [--index[=json]] [--public] [--lang en|zh-Hant]',
  'index.title': '書庫索引：{title}',
  'index.summary': '{topics} 個主題 · {notes} 篇筆記 · {decks} 份簡報 · {boards} 張畫布 · 產生於 {date}（UTC）',
  'index.publicOnly': '> 只列公開的筆記（--public）。',
  'index.howto': '> 給 AI：這份索引列出每篇筆記的路徑、日期、標籤、章節與連結。先從這裡找到要的檔案，再打開原檔；改了檔案之後重新產生（node leafpile-check.mjs <書庫> --index）。規則見 docs/SPEC.md。',
  'index.sep': '、',
  'index.more': '…還有 {n} 個',
  'index.topicPublic': '預設公開',
  'index.localOnly': '只留本機',
  'index.public': '公開',
  'index.private': '私人',
  'index.pinned': '急件（到 {date}）',
  'index.book': '筆記本：{title}',
  'index.aliases': '別名：{list}',
  'index.fields': '欄位：{list}',
  'index.headings': '章節：{list}',
  'index.links': '連到：{list}',
  'index.missing': '找不到：{list}',
  'index.backlinks': '被連：{list}',
  'index.onBoards': '畫布：{list}',
  'index.fromDeck': '講後筆記，來自 {path}',
  'index.deck': '[簡報]',
  'index.source': '升級自 {path}',
  'index.boards': '畫布',
  'index.boardStats': '{cards} 張筆記或簡報卡、{texts} 張文字卡',
  'index.groups': '群組：{list}',
  'index.cards': '卡片：{list}',
  'catalog.done': 'catalog.json:{topics} 個主題、{notes} 篇筆記、{decks} 份簡報、{slides} 張投影片',

  // ---------- 資料來源 ----------
  'source.repoLabel': '內建範例',
  'source.localLabel': '本機資料夾',
  'source.noCatalog': '找不到 catalog.json。倉庫模式需要它:請在專案資料夾執行 node scripts/build-catalog.mjs 產生。若只是要播放自己的簡報,回首頁選「開啟本機資料夾」就好',

  // ---------- 投影片自動文字(依簡報語言)----------
  'slide.thanks': '謝謝',
  'slide.agenda': '大綱',
  'slide.noMedia': '沒有媒體',
  'slide.missingMedia': '找不到素材',

  // ---------- 主題與排列 ----------
  'theme.paper': '紙張',
  'theme.ink': '深色',
  'theme.slate': '石板',
  'theme.sepia': '棕褐',
  'theme.nord': '北極',
  'theme.auto': '自動',
  'theme.menu': '外觀',
  'theme.hint': '只改這個瀏覽器的書庫、筆記與畫布;簡報照自己的設定。「自動」用書庫設定,電腦是深色模式時用深色。',
  'theme.now': '外觀:{name}',
  'stage.pile': '牌堆',
  'stage.coverflow': '封面流',
  'stage.carousel': '圓柱',
  'stage.helix': '螺旋',
  'stage.sphere': '球體',
  'stage.overview': '總覽',
  'stage.side': '對照',

  // ---------- 首頁與導覽 ----------
  'doc.title': 'Leafpile · 一個資料夾,平常是筆記,上台是簡報',
  'nav.repo': '內建範例',
  'nav.home': '我的書庫',
  'nav.backHome': '回首頁',
  'lang.label': '語言 / Language',
  'lang.zhShort': '中',
  'loading': '讀取中…',
  'loading.library': '讀取書庫目錄…',
  'loading.deck': '讀取簡報…',
  'err.title': '出了點問題',
  'err.offlineTitle': '目前沒有網路',
  'err.offline': '內建範例與倉庫裡的簡報需要連線才能讀取。你電腦或隨身碟上的簡報資料夾不需要網路,回首頁選擇資料夾即可。',
  'err.noRecord': '找不到這個書庫的紀錄,請重新開啟資料夾。',
  'err.sessionGone': '這次開啟的資料夾已經失效(重新整理頁面後需要再選一次)。',
  'err.cannotRead': '無法讀取這個資料夾,可能已被移動或隨身碟未插上。',
  'err.noDeck': '找不到這份簡報,可能已經改名或移除。',
  'err.emptyDeck': '這份簡報裡沒有投影片。',
  'err.dropFolder': '請拖入「資料夾」,不是單一檔案。',
  'drop.hint': '放開來開啟這個資料夾',
  'home.eyebrow': '筆記與簡報,同一個資料夾',
  'home.title': '平常是筆記,<br>上台是簡報。',
  'home.lead': '用 Markdown 累積筆記,要分享時變成 3D 牌堆簡報。檔案留在你的電腦或隨身碟裡,這裡只負責讀取。不用安裝、不用上傳。',
  'home.open': '開啟本機資料夾',
  'home.repo': '看內建範例',
  'home.tipPicker': '也可以直接把資料夾拖進這個視窗。Chrome / Edge 會記住你開過的書庫。',
  'home.tipNoPicker': '也可以直接把資料夾拖進這個視窗。這個瀏覽器無法記住資料夾,重新整理後需要再選一次;用 Chrome 或 Edge 體驗最好。',
  'home.recent': '最近開啟的書庫',
  'home.forget': '從清單移除(不會刪除檔案)',
  'home.step1.title': '準備資料夾',
  'home.step1.text': '書庫裡放 notes/(筆記)與 slides/(簡報)。一個 .md 檔是一篇筆記,或一張投影片。',
  'home.step2.title': '開啟',
  'home.step2.text': '開啟整個書庫就能看到所有筆記與簡報;只開一份簡報資料夾(或 Mdslide Pile 書庫)也可以,會自動判斷。',
  'home.step3.title': '讀、寫、上台',
  'home.step3.text': '筆記用 [[連結]] 串起來;按 ▶ 把筆記當簡報播,或開正式簡報:Enter 放大、S 講者視窗、P 存成 PDF。',
  'home.rules': '規則說明:',
  'home.guideName': 'docs/SPEC.md',
  'home.guidePath': 'docs/SPEC.md',
  'perm.title': '重新連線「{name}」',
  'perm.text': '為了保護你的檔案,瀏覽器每次重新開啟都需要再確認一次讀取權限。<br>如果是隨身碟,請先確認已經插上。',
  'perm.writeTitle': '需要寫入權限',
  'perm.writeText': '要把變更存進你的資料夾，瀏覽器需要你同意一次。按「允許」後，瀏覽器會再問一次，請選「儲存變更」或「允許」。',
  'perm.writeAllow': '允許',
  'perm.grant': '允許讀取',

  // ---------- 目錄頁 ----------
  'lib.repo': '內建書庫',
  'lib.local': '本機書庫',
  'lib.eyebrow': '{kind} · {topics} 個主題 · {decks} 份簡報',
  'lib.search': '搜尋簡報標題、標籤…',
  'lib.found': '找到 {n} 份,共 {total} 份',
  'lib.noResults': '找不到符合「{q}」的簡報',
  'lib.check': '✓ 檢查',
  'lib.checkTitle': '檢查所有簡報是否符合規則',
  'lib.refresh': '↻ 重新整理',
  'lib.refreshTitle': '重新讀取資料夾',
  'lib.all': '全部',
  'lib.issues': '⚠ {n} 個設定檔問題',
  'lib.empty': '這個主題還沒有簡報',
  'lib.chapters': '{n} 章',

  // ---------- 檢查面板 ----------
  'checkp.aria': '檢查結果',
  'checkp.title': '檢查',
  'checkp.close': '關閉(Esc)',
  'checkp.progress': '檢查中({i}/{n}):{title}',
  'checkp.finishing': '整理結果…',
  'checkp.failed': '檢查失敗:{error}',
  'checkp.problems': '⚠ {n} 個問題',
  'checkp.summary': '{decks} 份簡報 · {slides} 張投影片',
  'checkp.problemsHeading': '問題',
  'checkp.decksHeading': '簡報',
  'checkp.sections': '{n} 章',
  'checkp.slides': '{n} 張',
  'checkp.layouts': '{n} 種版型',
  'checkp.notes': '備註 {a}/{b}',
  'checkp.auto': '自動',
  'checkp.noDecks': '還沒有簡報',
  'checkp.foot': '規則:docs/SPEC.md(筆記與書庫)、docs/slides/GUIDE.zh-Hant.md(簡報)· 版型建議至少 4 種、每張都有講者備註。修改檔案後再按一次「檢查」即可。',
  // ---------- 播放器 ----------
  'player.back': '‹ 目錄',
  'player.backTitle': '回到目錄(Esc)',
  'player.stageTitle': '排列方式(L)',
  'player.theme': '主題',
  'player.themeTitle': '切換主題(T)',
  'player.check': '檢查',
  'player.rotate': '把手機轉成橫向,投影片會大很多。',
  'player.rotateLock': '全螢幕橫放',
  'player.rotateOk': '知道了',
  'player.export': '匯出',
  'player.exportTitle': '匯出成單一 HTML 檔(離線也能播放)',
  'export.title': '匯出成單一 HTML 檔',
  'export.text': '程式、樣式、簡報內容與圖片會放進同一個檔案,雙擊就能離線播放,不需要網路或這個網站。線上影片(YouTube 等)仍需要網路。',
  'export.measuring': '正在計算檔案大小…',
  'export.size': '預估大小:{size}',
  'export.videos': '包含影片與音訊({n} 個,約 {size})',
  'export.go': '下載',
  'export.cancel': '取消',
  'export.working': '正在產生檔案…',
  'export.done': '已匯出({size})',
  'export.failed': '匯出失敗,請再試一次。',
  'player.checkTitle': '檢查這份簡報',
  'player.presentTitle': '放大播放(Enter)',
  'player.helpTitle': '快捷鍵(?)',
  'player.hint': '← → 翻頁 · ↑ ↓ 換章 · Enter 放大 · L 排列 · ? 說明',
  'player.issues': '⚠ {n} 個提醒',
  'player.slideLabel': '第 {n} 張:{title}',
  'player.reloaded': '已重新載入',
  'player.reloadUnsupported': '這個資料來源無法重新載入,請重新開啟資料夾',
  'help.title': '快捷鍵',
  'help.foot': '點卡片選取,再點一次放大。滑鼠滾輪也可以翻頁。',
  'help.motion': '動畫',
  'help.motionFull': '完整',
  'help.motionReduced': '簡化',
  'key.prevNext': '上一張 / 下一張(翻頁筆也可以)',
  'key.section': '上一章 / 下一章(牌堆會洗牌)',
  'key.enter': '放大 / 縮回',
  'key.esc': '縮回、離開總覽、回目錄',
  'key.jump': '跳到第幾章',
  'key.homeEnd': '第一張 / 最後一張',
  'key.overview': '總覽',
  'key.side': '對照模式(大圖 + 縮圖列)',
  'key.stage': '切換排列',
  'key.theme': '切換主題',
  'key.black': '黑屏',
  'key.full': '全螢幕',
  'key.presenter': '開啟講者視窗',
  'key.print': '列印 / 存成 PDF',
  'key.video': '放大時播放 / 暫停本機影片',
  'key.reload': '重新載入簡報',
  'key.help': '這個說明',
  'toast.theme': '主題:{name}',
  'toast.noPresenter': '這個瀏覽器不支援講者視窗',
  'toast.popupBlocked': '瀏覽器擋住了彈出視窗,請允許後再按 S',
  'toast.printing': '準備列印中…',

  // ---------- 講者視窗 ----------
  'pv.docTitle': '講者視窗 · Leafpile',
  'pv.current': '目前',
  'pv.elapsed': '經過',
  'pv.now': '現在',
  'pv.reset': '重設',
  'pv.next': '下一張',
  'pv.notes': '備註',
  'pv.waiting': '等待主視窗…(在主視窗按 S 開啟)',
  'pv.keys': '← → 翻頁 · ↑ ↓ 換章 · Enter 放大 · B 黑屏(再按一次回來)· Q 記下問題 · 這個視窗的按鍵會同步到主視窗(全螢幕除外)',
  'pv.last': '(最後一張)',
  'pv.steps': ' · 逐步 {a}/{b}',
  'pv.notViewing': ' · <em>主畫面未放大</em>',
  'pv.noNotes': '這張沒有備註',
  'scaffold.usage': '用法:node scripts/new-deck.mjs <資料夾> [--title "標題"] [--deck-lang zh-Hant|en]\n例:node scripts/new-deck.mjs content/02-工作報告/2026-11-Q4週報',
  'scaffold.notEmpty': '{dir} 已經有檔案了,為了不覆蓋你的內容,請換一個新資料夾。',
  'scaffold.done': '已建立簡報骨架:{dir}',
  'scaffold.next': '下一步:打開各章節的 MD 檔改寫內容,規則見 docs/slides/GUIDE.zh-Hant.md;改完再跑一次 node scripts/check.mjs 檢查。',
  'scaffold.subtitle': '副標題:一句話說明這份簡報',
  'scaffold.end': '謝謝聆聽',
  'scaffold.sec1Folder': '01-開場',
  'scaffold.sec1Title': '開場',
  'scaffold.sec2Folder': '02-重點',
  'scaffold.sec2Title': '重點',
  'scaffold.sec3Folder': '03-結論',
  'scaffold.sec3Title': '結論',
  'scaffold.slide1File': '01-大綱.md',
  'scaffold.slide1': '<!-- layout: agenda -->\n# 今天的內容',
  'scaffold.slide2File': '01-第一個重點.md',
  'scaffold.slide2': '# 第一個重點\n\n- 一張投影片只講一件事\n- 每點不超過一行\n\nNote:\n這裡寫講者備註,只會出現在講者視窗(按 S)。',
  'scaffold.slide3File': '02-關鍵數字.md',
  'scaffold.slide3': '## 3 倍\n\n用一個數字讓觀眾記住重點\n\n資料來源:請填寫出處與日期',
  'scaffold.slide4File': '01-總結.md',
  'scaffold.slide4': '# 帶走三件事\n\n1. 第一件\n2. 第二件\n3. 第三件',
  'player.read': '閱讀',
  'player.readTitle': '閱讀模式:整份往下捲,附講者備註(M)',
  'player.inkTitle': '畫筆與雷射筆(D)',
  'ink.bar': '畫筆工具',
  'ink.laser': '雷射筆',
  'ink.pen': '畫筆',
  'ink.highlight': '螢光筆',
  'ink.eraser': '橡皮擦',
  'ink.color': '換畫筆顏色',
  'ink.undo': '復原',
  'ink.undoTitle': '復原(Ctrl+Z)',
  'ink.clear': '清除',
  'ink.clearTitle': '清除這張的畫(X)',
  'ink.offTitle': '關閉畫筆(Esc)',
  'lightbox.label': '放大的圖片',
  'lightbox.hint': '點一下或按 Esc 關閉',
  'reader.label': '閱讀模式',
  'reader.close': '‹ 回到投影片',
  'reader.closeTitle': '回到投影片(M 或 Esc)',
  'reader.print': '列印講義',
  'reader.printTitle': '印成附講者備註的講義(P)',
  'key.ink': '畫筆與雷射筆',
  'key.read': '閱讀模式(附備註)',
  'pv.inkNone': '不畫',
  'pv.inkHint': '在上面的投影片畫,觀眾畫面同步出現',
  'update.ready': '網站已更新到新版。',
  'update.reload': '重新整理',
  'update.later': '稍後',
  'pv.fullscreenHint': '全螢幕要在觀眾畫面按 F(或點一下觀眾畫面再按),瀏覽器不允許從講者視窗代為切換。',
  'toast.kNone': '這張沒有影片或音訊(K 用來播放 / 暫停放大投影片上的本機影片)',
  'toast.kZoom': '先按 Enter 放大投影片,K 才能播放 / 暫停上面的影片',
  'toast.kEmbed': '線上影片請直接點影片上的播放鈕,K 只控制本機影片',
  'toast.kPlay': '▶ 播放',
  'toast.kPause': '❚❚ 暫停',
  'slide.interactive': '互動頁面',
  'slide.openPage': '↗ 在新分頁開啟',
  'player.edit': '編輯',
  'player.editTitle': '編輯這張投影片的 Markdown(E)',
  'key.edit': '編輯這張的原始碼',
  'key.clear': '清除這張的畫(畫筆開著時)',
  'key.goto': "輸入頁碼,跳到第幾張",
  'jump.label': "跳到第",
  'jump.total': "張(共 {total} 張)",
  'editor.prevTitle': "上一張(Alt+PageUp)。換到別的檔案前會自動存檔",
  'editor.nextTitle': "下一張(Alt+PageDown)。換到別的檔案前會自動存檔",
  'editor.position': "第 {n} / {total} 張",
  'editor.tools': "插入工具",
  'editor.layout': "版型",
  'editor.layoutAuto': "目前自動判斷為「{name}」",
  'editor.tHeading': "標題",
  'editor.tHeadingTitle': "把這一行變成標題;再按一次變小一級",
  'editor.tBold': "粗體",
  'editor.tBoldTitle': "把選取的文字變粗體",
  'editor.tList': "清單",
  'editor.tListTitle': "把選取的行變成清單(再按一次取消)",
  'editor.tMedia': "圖片 / 影片",
  'editor.tMediaTitle': "從 media 資料夾挑一個檔案,或插入線上影片網址",
  'editor.tColumns': "分欄",
  'editor.tColumnsTitle': "插入分欄線 +++(columns 版型用)",
  'editor.tSplit': "新的一張",
  'editor.tSplitTitle': "在游標處插入 ---,把後面的內容分成新的一張",
  'editor.tNotes': "備註",
  'editor.tNotesTitle': "跳到這張的講者備註;沒有就新增一段",
  'editor.guide': "語法說明 ↗",
  'editor.guideURL': 'https://github.com/ToruSmith/Leafpile/blob/main/docs/slides/GUIDE.zh-Hant.md',
  'editor.ok': "確定",
  'editor.cancel': "取消",
  'editor.discard': "不儲存",
  'editor.overwrite': "用我的版本覆蓋",
  'editor.keepTheirs': "保留對方的修改",
  'editor.sampleBold': "重點",
  'editor.sampleTitle': "新的標題",
  'editor.sampleCaption': "說明",
  'editor.mediaLoading': "讀取中…",
  'editor.mediaNone': "簡報資料夾的 media/ 裡還沒有圖片或影片。把檔案放進去後再按一次,就會出現在這裡。",
  'editor.mediaVideo': "＋ 線上影片網址(YouTube 等)",
  'editor.mediaTemplate': "＋ 圖片範本(自己改檔名)",
  'layoutName.auto': "自動",
  'layoutName.text': "一般內文",
  'layoutName.center': "置中強調",
  'layoutName.split': "左文右圖",
  'layoutName.split-left': "左圖右文",
  'layoutName.full': "滿版媒體",
  'layoutName.quote': "引言",
  'layoutName.number': "大數字",
  'layoutName.stats': "數字卡",
  'layoutName.timeline': "時間軸",
  'layoutName.columns': "分欄比較",
  'layoutName.agenda': "自動大綱",
  'layoutName.chart': "圖表",
  'layoutName.flow': '流程圖',
  'layoutName.gallery': '多圖並排',
  'layoutName.grid': '多區塊',
  'layoutName.end': "結尾頁",
  'layoutName.title': "標題頁",
  'layoutName.section': "章節頁",
  'editor.autoSaved': '已自動儲存 {name}',
  'editor.overflow': '內容超出投影片約 {px} 像素,下面會被切掉。可以用「新的一張」拆開,或在這張開頭加上 <!-- size: small -->(字縮小約兩成)',
  'editor.overflowCompact': '已經是小字級,內容仍超出約 {px} 像素。請拆成兩張',
  'editor.markHint': '在右邊的圖上拖曳,可以加紅框標註',
  'editor.markAdded': '已加上標註。游標停在標籤的位置,直接打字(例如「這裡改內容」);#色碼 可以換顏色',
  'editor.look': "外觀",
  'editor.lookTitle': "字級、背景、顏色、字型、對齊等設定(只影響這一張)",
  'editor.lookDefault': "預設",
  'editor.lookClear': "清除",
  'editor.lookNone': "無",
  'editor.lookPick': "選圖片…",
  'editor.lookSize': "字級",
  'editor.sizeSmall': "小(資料多時)",
  'editor.sizeNormal': "正常",
  'editor.sizeLarge': "大",
  'editor.sizeXl': "特大",
  'editor.lookBgColor': "背景色",
  'editor.lookBgImage': "背景圖",
  'editor.lookOverlay': "圖片遮罩",
  'editor.overlayDark': "深色(字反白)",
  'editor.overlayLight': "淺色",
  'editor.overlayNone': "不加",
  'editor.lookAccent': "強調色",
  'editor.lookText': "文字色",
  'editor.lookFont': "字型",
  'editor.lookAlign': "對齊",
  'editor.alignLeft': "靠左",
  'editor.alignCenter': "置中",
  'editor.alignRight': "靠右",
  'editor.lookRatio': "欄寬比例",
  'editor.lookStep': "逐步顯示",
  'editor.lookHidden': "播放時跳過這張",
  'editor.lookFooter': "顯示頁尾",
  'editor.lookNote': "每個選擇都會在這一張開頭寫一行設定註解;改回「預設」就刪掉那一行。背景色深時字自動變淺。",
  'editor.label': '編輯 Markdown',
  'editor.close': '‹ 關閉',
  'editor.save': '儲存',
  'editor.revert': '還原',
  'editor.add': '+ 新增一張',
  'editor.addTitle': '在同一個章節新增一張投影片',
  'editor.archive': '封存',
  'editor.archiveTitle': '把這個檔案搬到 _封存/(不會真的刪掉)',
  'editor.ready': '可以編輯。Ctrl+S 儲存;‹ › 換張(換到別的檔案前會自動存檔)',
  'editor.readOnly': '這個模式不能存檔,可以「儲存」下載修改後的檔案',
  'editor.unsaved': '有尚未儲存的修改',
  'editor.noChange': '沒有修改',
  'editor.saving': '儲存中…',
  'editor.saved': '已儲存 {time}',
  'editor.failed': '儲存失敗:{message}',
  'editor.denied': '沒有寫入權限。請在瀏覽器的詢問視窗按「允許」',
  'editor.staleAsk': '這個檔案在你編輯期間被其他程式改過。要用你的版本覆蓋,還是保留對方的修改?(保留的話,你的內容還在編輯框裡,可以先複製起來)',
  'editor.staleKept': '已保留對方的修改。你的內容還在編輯框裡,請自行複製後再處理',
  'editor.downloaded': '已下載修改後的檔案',
  'editor.revertAsk': '要放棄尚未儲存的修改,回到打開時的內容嗎?',
  'editor.reverted': '已還原成打開時的內容',
  'editor.unsavedAsk': '有尚未儲存的修改。',
  'editor.addAsk': '新投影片的標題(可留空):',
  'editor.added': '已新增 {name}',
  'editor.archiveAsk': '要把 {name} 搬到 _封存/ 嗎?檔案不會被刪掉,之後可以從資料夾裡拿回來。',
  'editor.archived': '已搬到 {path}',
  'editor.segment': '這個檔案有 {total} 張,目前顯示第 {n} 張(游標在哪就顯示哪一張)',
  'pv.editNotes': '改備註',
  'pv.saveNotes': '儲存備註',
  'pv.savingNotes': '儲存中…',
  'pv.notesSaved': '已儲存',
  'pv.notesFailed': '存檔失敗',
  'editor.autoSlide': '這是自動產生的封面 / 章節頁,沒有自己的檔案。這裡編輯的是 deck.yml(標題寫在裡面)',
  'editor.yamlNote': '這是簡報的設定檔,右邊不顯示預覽。存檔後畫面會重新載入',
  'editor.openFailed': '打不開 {path}',
  'editor.onGitHub': '↗ 在 GitHub 上編輯',

  // ---------- Leafpile:書架、筆記、互通 ----------
  'brand.zh': '頁堆',
  'home.engine': '簡報引擎:',
  'nav.backShelf': '回到書庫',
  'loading.note': '讀取筆記…',
  'loading.link': '尋找連結的目標…',
  'err.noNotes': '這個書庫沒有 notes/ 資料夾。',
  'err.noNote': '找不到這篇筆記({path}),可能已經改名或移除。',
  'notes.unfiled': '未歸檔',
  'issue.newerLeafpile': '這個書庫使用較新的規則版本(leafpile: {version}),部分設定可能不會生效;請更新 Leafpile。',
  'note.layoutKeys': '筆記的 front matter 寫了版型設定({keys})。版型只屬於簡報,請移到投影片。',
  'check.kind.leafpile': 'Leafpile 書庫',
  'check.linkMissing': '連結 {link} 找不到目標',
  'check.embedMissing': '摘錄 {link} 找不到目標',
  'check.linkAmbiguous': '連結 {link} 符合多個目標({paths}),請改寫成路徑',
  'check.headingMissing': '{link}:在「{title}」裡找不到這個標題',
  'check.embedLong': '摘錄 {link} 超過 {n} 字;簡報應該比筆記短',
  'check.pinnedNoExpiry': '急件(pinned)請加上 expires 到期日',
  'check.expired': '已在 {date} 到期,請刪除或移到 _archive/',
  'note.sourceChanged': '筆記已更新',
  'note.sourceChangedTip': '這份簡報建立之後,這篇筆記又改過了。簡報可能需要跟上。',
  'deck.sourceChanged': '這份簡報的來源筆記在升級之後改過了，簡報可能需要跟上。',
  'dialog.close': '關閉',
  'deck.openSourceShort': '開啟來源筆記',
  'deck.markSyncedShort': '已跟上，不再提醒',
  'deck.openSource': '開啟這份簡報的來源筆記',
  'deck.markSynced': '標記簡報已跟上來源筆記(不再提醒)',
  'deck.trackSource': '開始追蹤來源筆記的變動',
  'deck.markedSynced': '已更新 deck.yml 的 source_hash。',
  'check.sourceChanged': '來源筆記「{source}」在升級之後改過了,簡報可能需要跟上(跟上之後更新 source_hash,或執行 node scripts/source-sync.mjs)',
  'sync.usage': '用法:node scripts/source-sync.mjs <書庫> [<簡報的路徑> --mark]\n列出由筆記升級的簡報,來源筆記在升級後有沒有改過;--mark 表示簡報已經跟上,更新 source_hash。',
  'sync.notDeck': '找不到由筆記升級的簡報 {path}(路徑像 slides/10-reading/2026-11-share)。',
  'sync.marked': '已更新 {path}/deck.yml 的 source_hash 為 {hash}。',
  'sync.none': '沒有由筆記升級的簡報(deck.yml 裡沒有 source)。',
  'sync.changed': '{n} 份簡報的來源筆記改過了。簡報跟上之後,用 --mark 更新。',
  'sync.allSame': '所有可以比對的簡報都跟來源筆記一致。',
  'sync.status.same': '[一致]  ',
  'sync.status.changed': '[已改過]',
  'sync.status.missing': '[找不到]',
  'sync.status.untracked': '[未追蹤]',
  'link.tipNote': '連到筆記「{title}」({path})',
  'link.tipDeck': '連到簡報「{title}」({path})',
  'link.tipMissing': '連結「{target}」找不到目標',
  'link.tipRaw': '連到 {target}',
  'check.boardBroken': '畫布讀不懂:{error}',
  'check.boardIssue': '畫布有一個項目略過了({issue})',
  'check.boardMissing': '畫布上的卡片指到不存在的檔案 {file}',
  'check.sourceMissing': 'deck.yml 的 source「{source}」找不到對應的筆記',
  'check.report.notes': '📝 筆記:{topics} 個主題、{books} 本筆記本、{notes} 篇筆記、{links} 個連結',
  'check.report.warnings': '提醒 {n} 項(不影響檢查結果):',
  'checkp.warnings': '提醒 {n} 項',
  'checkp.warningsHeading': '提醒(不影響檢查結果)',
  'checkp.notesSummary': '{notes} 篇筆記 · {links} 個連結',
  'shelf.eyebrow': '{kind} · {topics} 個主題 · {notes} 篇筆記 · {decks} 份簡報',
  'shelf.search': '搜尋筆記與簡報…',
  'shelf.viewLabel': '顯示哪個渠道',
  'shelf.view.all': '全部',
  'shelf.view.notes': '筆記',
  'shelf.view.slides': '簡報',
  'shelf.view.table': '表格',
  'side.label': '書庫導覽',
  'side.toggle': '書庫導覽(側邊欄)',
  'side.collapse': '收起側邊欄',
  'side.shelf': '書庫總覽',
  'side.table': '表格',
  'side.search': '搜尋',
  'side.pins': '釘選',
  'side.pinThis': '釘選這頁',
  'side.unpinThis': '取消釘選',
  'side.pin': '釘選',
  'side.unpin': '取消釘選',
  'side.pinsEmpty': '打開筆記、簡報或畫布後,按「釘選這頁」放在這裡。只存在這個瀏覽器。',
  'side.recent': '最近開過',
  'side.boards': '畫布',
  'side.topics': '分類與主題',
  'side.topicsEmpty': '還沒有主題',
  'side.loading': '整理中⋯',
  'tm.publicUnset': '不設定(各篇自己決定)',
  'tm.publicYes': '公開',
  'tm.publicNo': '不公開',
  'tm.noCategory': '(未分類)',
  'tm.newTitle': '新增主題',
  'tm.editTitle': '編輯主題:{name}',
  'tm.newHint': '會在 notes/ 底下建立一個主題資料夾和它的 _topic.yml。資料夾名稱建好後就不再改(之後改要搬移整個資料夾)。',
  'tm.editHint': '只會改 {path},不影響任何筆記、簡報或連結。',
  'tm.folder': '資料夾',
  'tm.name': '名稱',
  'tm.description': '說明',
  'tm.category': '分類',
  'tm.color': '顏色',
  'tm.public': '預設公開',
  'tm.next': '下一步:預覽',
  'tm.idErr.empty': '請填資料夾名稱',
  'tm.idErr.spaces': '資料夾名稱的前後不能有空白',
  'tm.idErr.chars': '資料夾名稱不能有 / \\ : * ? " < > | #,也不能以空白或句點結尾',
  'tm.idErr.reserved': '資料夾名稱不能以 . 或 _ 開頭(留給系統用)',
  'tm.idErr.long': '資料夾名稱太長(最多 80 個字)',
  'tm.idErr.exists': '已經有同名的主題',
  'tm.nameRequired': '請填主題名稱',
  'tm.colorErr': '顏色請用 #rrggbb 或 #rgb,例如 #4f73a6;不要可以留空',
  'tm.previewFile': '會寫入 {path}:',
  'tm.back': '返回修改',
  'tm.save': '確定寫入',
  'tm.unset': '(不設定)',
  'tm.change': '{field}:{from} → {to}',
  'tm.catsTitle': '管理分類',
  'tm.catsHint': '分類存在書庫的 _site.yml。順序就是書庫首頁與側邊欄的順序。還有主題在用的分類不能刪。',
  'tm.catName': '分類名稱',
  'tm.catId': '分類 id(主題用它指到這個分類)',
  'tm.catIdPh': 'id,例如 health',
  'tm.catUsed': '{n} 個主題',
  'tm.up': '往上移',
  'tm.down': '往下移',
  'tm.delete': '刪除',
  'tm.catInUse': '還有主題在用,不能刪',
  'tm.catAdd': '+ 新增分類',
  'tm.catNameRequired': '每個分類都要有名稱',
  'tm.catIdErr.empty': '新分類要填 id',
  'tm.catIdErr.chars': '分類 id「{id}」只能用英文字母、數字、- 與 _',
  'tm.catIdErr.exists': '分類 id「{id}」重複了',
  'tm.stale': '{path} 在別處被改過,沒有寫入。請按「重新整理」後再試一次。',
  'tm.writeFailed': '沒辦法寫入 {path}',
  'tm.undo': '復原',
  'tm.undone': '已復原',
  'tm.undoFailed': '沒辦法復原:{path} 之後又被改過',
  'tm.noChange': '沒有改動',
  'tm.previewTitle': '確認修改主題設定',
  'tm.willCreate': '這個主題還沒有 _topic.yml,會新增一個。不影響任何筆記、簡報或連結。',
  'tm.noLinks': '只改設定檔,不影響任何筆記、簡報或連結。寫入後可以按「復原」。',
  'tm.saved': '已更新 {path}',
  'tm.newFolder': '新資料夾 {path}',
  'tm.previewNew': '確認新增主題',
  'tm.newNote': '只建立資料夾和設定檔,不動其他檔案。之後在這個主題按「+ 筆記」就能新增筆記。',
  'tm.create': '建立',
  'tm.created': '已新增主題「{name}」',
  'tm.catBlocked': '還有主題在用這些分類,不能刪:{names}。請先把那些主題換到別的分類。',
  'tm.catOrder': '順序:{list}',
  'tm.catAdded': '新增分類「{name}」(id:{id})',
  'tm.catRemoved': '刪除分類「{name}」',
  'tm.catRenamed': '分類改名:{from} → {to}',
  'tm.catRecolor': '「{name}」的顏色 → {to}',
  'tm.catNote': '只改 _site.yml 的 categories 這一段,其他設定與註解不動。寫入後可以按「復原」。',
  'tm.lostComments': '注意:categories 這一段裡有 {n} 行註解,改寫後會不見(其他段落的註解保留)。',
  'tm.previewCats': '確認修改分類',
  'tm.newBtn': '+ 新增主題',
  'tm.catsBtn': '管理分類',
  'tm.editBtn': '編輯',
  'table.modeLabel': '表格內容',
  'table.mode.notes': '筆記',
  'table.mode.topics': '主題',
  'table.topicCount': '{n} 個主題',
  'table.topicsHint': '改的是設定檔(_topic.yml、_site.yml),每次都會先預覽',
  'table.topicsReadonly': '唯讀:用 Chrome 或 Edge 開啟本機資料夾才能修改',
  'table.notes': '筆記',
  'table.decks': '簡報',
  'side.manage': '管理',
  'side.manageTitle': '管理主題與分類',
  'table.loading': '正在整理筆記的欄位⋯',
  'table.title': '標題',
  'table.topic': '主題',
  'table.book': '筆記本',
  'table.date': '日期',
  'table.tags': '標籤',
  'table.count': '{n} / {total} 篇',
  'table.clearTag': '取消標籤篩選',
  'table.readonly': '唯讀：欄位來自每篇筆記開頭的 front matter，要改請開筆記編輯',
  'table.groupBy': '分組',
  'table.layoutLabel': "怎麼看",
  'table.layout.table': "表格",
  'table.layout.kanban': "看板",
  'table.layout.calendar': "月曆",
  'table.layout.cards': "卡片",
  'table.boardBy': "畫布",
  'table.boardAll': "全部",
  'table.boardNone': "還沒放上畫布",
  'table.cardsHint': "每篇筆記一張卡；下面是它出現在哪些畫布，點了在那張畫布的側邊打開",
  'table.sortBy': "排序",
  'table.sortAsc': "由小到大",
  'table.sortDesc': "由大到小",
  'table.openOnBoard': "在這張畫布打開",
  'table.addToBoard': "+ 放到畫布",
  'table.addToBoardTitle': "放到畫布",
  'table.alreadyOnBoard': "已經在「{name}」上了",
  'table.addedToBoard': "已放到「{name}」",
  'table.openBoard': "打開畫布",
  'table.kanbanBy': "欄位",
  'table.calPrev': "上個月",
  'table.calNext': "下個月",
  'table.calToday': "這個月",
  'table.calMonthList': "這個月的筆記（{n} 篇）",
  'table.calNone': "這個月沒有筆記。用 ‹ › 換月份。",
  'table.calUndated': "另有 {n} 篇沒有日期，不會出現在月曆上。",
  'table.group.none': '不分組',
  'table.group.category': '分類',
  'table.group.topic': '主題',
  'table.group.book': '筆記本',
  'table.group.year': '年',
  'table.group.month': '月',
  'table.group.tags': '標籤',
  'table.groupEmpty': '(未設定)',
  'table.foldAll': '全部收起',
  'table.unfoldAll': '全部展開',
  'table.empty': '沒有符合的筆記',
  'table.private': '不公開',
  'shelf.otherCategory': '其他',
  'shelf.newNote': '+ 筆記',
  'shelf.readonly': '唯讀',
  'shelf.readonlyTip': '這個書庫目前是唯讀的，不能新增或儲存筆記。請用 Chrome 或 Edge，在首頁按「開啟本機資料夾」並允許寫入。',
  'shelf.readonlyBrowserTip': '這個瀏覽器不能存檔，所以只能閱讀與播放。要新增筆記請改用 Chrome 或 Edge（Brave 預設關閉這項功能）。',
  'move.more': '更多 ▾',
  'move.moreTitle': '改名、搬移、封存',
  'move.rename': '改名…',
  'move.move': '搬到其他資料夾…',
  'move.archive': '封存…',
  'move.renameTitle': '改名',
  'move.renameHint': '會同時改標題與檔名(保留日期或編號前綴),並更新連到這篇的 [[連結]]。下一步會先列出要改的檔案。',
  'move.newTitle': '新標題',
  'move.next': '下一步',
  'move.moveTitle': '搬到其他資料夾',
  'move.moveHint': '用標題寫的連結搬完仍然有效;用路徑寫的會自動更新。筆記裡相對路徑的圖片也會換算。',
  'move.dest': '搬到',
  'move.nothing': '沒有要改的地方。',
  'move.summaryRename': '「{from}」改名為「{title}」\n新檔名:{to}',
  'move.summaryMove': '「{from}」搬到\n{to}',
  'move.summaryLinks': '會更新 {files} 個檔案裡的 {links} 個連結:',
  'move.summaryNoLinks': '沒有其他檔案需要更新。',
  'move.andMore': '…還有 {n} 個',
  'move.doRename': '改名',
  'move.doMove': '搬移',
  'move.exists': '目的地已經有同名的檔案,沒有改任何東西。',
  'move.done': '完成:{path}(更新了 {links} 個連結)',
  'move.partial': '筆記已經搬好,但有 {n} 個檔案的連結沒改成功:{files}。請用「檢查」找出剩下的連結。',
  'move.archiveAsk': '把「{path}」搬到 _archive/notes/?\n檔案不會刪除,之後可以自己搬回來。',
  'move.archiveRefs': '有 {n} 篇筆記或簡報連到這篇,封存後這些連結會失效(「檢查」會列出):',
  'move.doArchive': '封存',
  'move.archived': '已封存到 {path}',
  'privacy.button': '🔒 發布前檢查',
  'privacy.buttonTitle': '哪些筆記會公開、哪裡可能有個資',
  'privacy.title': '發布前檢查',
  'privacy.scanning': '正在讀取每篇筆記與投影片…',
  'privacy.ok': '會公開的內容裡沒有找到個資',
  'privacy.bad': '{n} 個會公開的檔案可能有個資',
  'privacy.counts': '公開 {public} 篇 · 私人 {private} 篇 · 只留本機 {localOnly} 篇',
  'privacy.rule': '規則:筆記的 public → 筆記本 → 主題 → 都沒寫就是私人;只留本機(local_only)的主題一律不公開。簡報沒有 public 設定,放上 GitHub 就會公開。',
  'privacy.visitorOn': '以訪客視角瀏覽',
  'privacy.visitorOff': '結束訪客視角',
  'privacy.visitorHint': '只顯示會公開的筆記與簡報,看看放上 GitHub Pages 後別人看得到什麼。',
  'privacy.visitorBar': '訪客視角:只顯示會公開的內容',
  'privacy.piiHeading': '可能是個資',
  'privacy.piiNote': '只是提醒,不會擋下。自動比對 Email、台灣手機號碼、身分證字號;範例網域與程式碼區塊不算。畫面上已遮罩。',
  'privacy.exposed': '會公開',
  'privacy.hidden': '不會公開',
  'privacy.line': '第 {n} 行',
  'privacy.kind.email': 'Email',
  'privacy.kind.phone': '手機',
  'privacy.kind.tw-id': '身分證字號',
  'privacy.noPII': '沒有找到疑似個資。',
  'privacy.publicList': '會公開的筆記({n} 篇)',
  'privacy.noPublic': '沒有會公開的筆記。',
  'privacy.hiddenTitle': '訪客看不到這篇筆記',
  'privacy.hiddenText': '這篇是私人的,或在只留本機的主題裡。結束訪客視角就能看到。',
  'board.heading': '畫布',
  'board.new': '+ 新畫布',
  'board.newTitle': '新增畫布',
  'board.newName': '名稱',
  'board.newPlaceholder': '例如:讀書計畫',
  'board.create': '建立',
  'board.open': '開啟畫布:{name}',
  'board.notFound': '找不到畫布「{name}」(應該在 boards/ 資料夾裡)。',
  'board.aria': '畫布 {name}',
  'board.readonly': '唯讀:可以看、不能改',
  'board.addText': '+ 文字',
  'board.addTextTitle': '新增一張文字卡(也可以雙擊空白處)',
  'board.addCard': '+ 筆記或簡報',
  'board.addCardTitle': '把一篇筆記或一份簡報放到畫布上',
  'board.pick': '選擇',
  'board.add': '放上去',
  'board.noChoices': '書庫裡還沒有筆記或簡報。',
  'board.undo': '復原(Ctrl+Z)',
  'board.zoomIn': '放大',
  'board.zoomOut': '縮小',
  'board.zoomReset': '回到 100%(按 0)',
  'board.fit': '適合畫面',
  'board.fitTitle': '把所有卡片放進畫面(按 F)',
  'board.empty': '這張畫布是空的。',
  'board.emptyEdit': '這張畫布是空的。雙擊任何地方新增文字,或按上方「+ 筆記或簡報」。',
  'board.hint': '拖曳平移 · Ctrl+滾輪或兩指縮放 · F 適合畫面 · Ctrl+F 搜尋',
  'board.hintEdit': '拖曳移動(自動對齊,Alt 暫停) · Shift+點或拖曳多選 · 圓點拖曳連線 · 雙擊新增或編輯 · Ctrl+C/V/D 複製 · Ctrl+F 搜尋 · Ctrl+Z 復原',
  'board.kindNote': '筆記',
  'board.kindDeck': '簡報',
  'board.kindLink': '網址',
  'board.kindMissing': '找不到檔案',
  'board.editText': '編輯文字(Ctrl+Enter 或 Esc 完成)',
  'board.edgeTitle': '連線文字',
  'board.edgeLabel': '文字(留白就不顯示)',
  'board.unsaved': '尚未儲存',
  'board.saving': '儲存中…',
  'board.saved': '已儲存',
  'board.denied': '沒有寫入權限，已暫停自動儲存',
  'board.deniedLong': '沒有寫入權限，所以沒有存檔，也暫停了自動儲存（不會再一直詢問）。要存的時候按「重試儲存」或 Ctrl+S，再按「允許」。',
  'board.retrySave': '重試儲存',
  'board.saveFailed': '沒有存成功',
  'board.stale': '檔案被別的程式改過,已停止自動儲存',
  'board.staleLong': '這張畫布在別的地方被改過了。為了不覆蓋那些修改,已停止自動儲存;請重新整理頁面再編輯。',
  'note.onBoards': '出現在這些畫布',
  'board.addLink': '+ 網址',
  'board.addLinkTitle': '放一個網址:連結卡,或直接嵌入網頁、影片、Google 簡報',
  'board.addFile': '+ 圖片或檔案',
  'board.addFileTitle': '圖片、HTML、PDF(也可以直接拖進畫布,或 Ctrl+V 貼上截圖)',
  'board.linkHint': '可以直接貼 Google 簡報「發布到網路」的整段嵌入碼。YouTube、Google 簡報會自動嵌入。',
  'board.urlLabel': '網址',
  'board.linkMode': '顯示方式',
  'board.linkCard': '連結卡',
  'board.embedWeb': '嵌入網頁',
  'board.urlBad': '請輸入 http:// 或 https:// 開頭的網址。',
  'board.httpsOnly': '只有 https 的網頁可以嵌入;先以連結卡顯示。',
  'board.editUrl': '網址',
  'board.present': '▶ 簡報',
  'board.presentTitle': '依群組一頁一頁放大(沒有群組就逐張卡片);←/→ 換頁,Esc 離開',
  'board.presentExit': '離開',
  'board.full': '全螢幕',
  'board.fullExit': '離開全螢幕',
  'board.fullTitle': '畫布鋪滿整個畫面;工具列從右上角的 ☰ 叫出,Esc 離開',
  'board.menu': '顯示／隱藏工具列',
  'board.more': '更多 ▾',
  'board.moreTitle': '網址、圖片、手繪、簡報、匯出與縮放',
  'board.minimap': '小地圖',
  'board.minimapTitle': '小地圖:點或拖曳就移過去(M)',
  'board.ctxTitle': '更多動作',
  'board.ctxOpen': '開啟',
  'board.ctxPeek': '在側邊開啟',
  'board.ctxPage': '在筆記頁開啟',
  'board.fold': '摺疊',
  'board.unfold': '展開',
  'board.foldTitle': '只留標題（再按一次展開，高度會還原）',
  'board.unfoldTitle': '展開成原本的高度',
  'board.fitContent': '適合內容',
  'board.fitContentTitle': '把卡片高度改成剛好放下內容',
  'board.onBoardsTitle': '這篇筆記出現在 {n} 張畫布',
  'board.onBoardsHead': '出現在 {n} 張畫布',
  'board.onBoardsHere': '這張',
  'peek.aria': '側邊卡片面板',
  'peek.edit': '編輯',
  'peek.editTitle': '在面板裡編輯這篇筆記（Ctrl+S 存檔、Esc 取消）',
  'peek.add': '+ 放到畫布',
  'peek.addTitle': '把這篇筆記放到這張畫布上',
  'peek.pageTitle': '在筆記頁開啟',
  'peek.closeTitle': '關閉面板（Esc）',
  'peek.readFailed': '讀不到這篇筆記。可能已經改名、搬移或封存。',
  'peek.discardAsk': '放棄還沒存的修改嗎？（草稿會留在這台電腦）',
  'peek.discard': '放棄修改',
  'board.ctxFocus': '放大到這裡',
  'board.ctxCopy': '複製',
  'board.ctxCut': '剪下',
  'board.ctxDup': '再製一份',
  'board.ctxFront': '移到最上層',
  'board.ctxBack': '移到最下層',
  'board.paste': '貼上',
  'board.ctxGroup': '用群組框起來',
  'board.ctxUrl': '編輯網址',
  'board.ctxGroupLabel': '改群組名稱',
  'board.ctxEdgeText': '編輯連線文字',
  'board.pin': '固定工具列(不自動收起)',
  'board.prev': '上一頁',
  'board.next': '下一頁',
  'board.loadEmbed': '載入',
  'board.interact': '互動',
  'board.interactTitle': '讓滑鼠操作卡片裡的內容(再按一次恢復拖曳畫布)',
  'board.fullscreen': '這張卡片全螢幕',
  'board.openTab': '在新分頁開啟',
  'board.embedFailed': '載入失敗。可以按 ↗ 在新分頁開啟。',
  'board.scripts': '允許執行腳本',
  'board.scriptsTitle': 'HTML 裡的程式會在隔離的環境執行,碰不到你的書庫;只在信任這份檔案時打開',
  'board.scriptsOn': '執行腳本',
  'board.edgeText': '連線文字',
  'board.editShort': '編輯',
  'board.groupLabel': '群組名稱',
  'board.color': '顏色',
  'board.remove': '移除',
  'board.removeTitle': '從畫布移除(不刪除檔案)',
  'board.toNote': '轉成筆記',
  'board.toNoteHint': '會建立一篇新筆記,卡片原地換成筆記卡,連線不變。',
  'board.toNoteDone': '已建立筆記 {path}',
  'board.fileType': '「{name}」不能放進畫布:只收圖片、HTML、PDF。',
  'board.fileTooLarge': '「{name}」太大了:HTML 上限 500 KB,其他 5 MB。',
  'board.draw': '✎ 手繪',
  'board.drawTitle': '用筆畫圖,完成後變成一張圖片卡',
  'board.drawing': '手繪中',
  'board.drawDone': '完成',
  'board.search': '搜尋',
  'board.searchTitle': '在畫布上搜尋(Ctrl+F)',
  'board.searchPlaceholder': '搜尋卡片的文字、標題、網址…',
  'board.searchCount': '{i} / {n}',
  'board.export': '匯出',
  'board.exportTitle': '匯出成圖片',
  'board.exportFormat': '格式',
  'board.exportScope': '範圍',
  'board.exportSel': '選取的 {n} 張',
  'board.exportAll': '整張畫布',
  'board.selected': '已選 {n} 張',
  'board.groupUnnamed': "群組",
  'board.groupUnnamedEdit': "未命名群組（雙擊改名）",
  'board.ungroup': "解散",
  'board.ungroupTitle': "解散群組（只拿掉框，卡片留著）",
  'board.makeGroupKey': "把選取的卡片框成一個群組（{key}）",
  'board.makeGroup': '框成群組',
  'board.makeGroupTitle': '用一個群組框住這張卡片',
  'board.align.left': '靠左對齊',
  'board.align.hcenter': '水平置中',
  'board.align.right': '靠右對齊',
  'board.align.top': '靠上對齊',
  'board.align.vcenter': '垂直置中',
  'board.align.bottom': '靠下對齊',
  'board.distH': '水平等距',
  'board.distV': '垂直等距',
  'board.outline': '轉成大綱筆記',
  'board.outlineView': "大綱檢視",
  'board.outlineViewTitle': "把群組、卡片和連線排成清單；點一項就跳到那張卡片",
  'board.outlineLoose': "未分組",
  'board.outlineEmpty': "畫布還沒有卡片。",
  'board.outlineSave': "存成筆記",
  'board.outlineSaveTitle': "把整張畫布的大綱存成一篇新筆記",
  'board.outlineCopy': "複製",
  'board.outlineCopyTitle': "把大綱複製成 Markdown",
  'board.outlineCopied': "大綱已複製成 Markdown。",
  'board.outlineCopyFailed': "沒辦法複製：瀏覽器沒有給剪貼簿權限。",
  'board.outlineSaved': "大綱已存成筆記。",
  'board.pdfPage': "頁碼",
  'board.pdfPageN': "第 {n} 頁",
  'board.pdfPageTitle': "從第幾頁開始顯示",
  'board.pdfPageLabel': "頁碼（留空就從第一頁）",
  'board.pdfPageBad': "頁碼要是 1 以上的整數。",
  'board.outlineTitle': '把群組裡的卡片依位置排成 Markdown 清單,建立一篇新筆記',
  'board.outlineEdge': '大綱',
  'board.copied': '已複製 {n} 張',
  'board.cut': '已剪下 {n} 張',
  'board.kindImage': '圖片',
  'shelf.newNoteTitle': '新增一篇筆記',
  'shelf.emptyTopics': '還沒有內容的主題:{list}',
  'shelf.emptyLibrary': '這個書庫還是空的。在 notes/ 或 slides/ 的主題資料夾裡放進 .md 檔,再按「重新整理」。',
  'shelf.fullText': '內文符合的筆記({n})',
  'shelf.urgent': '急件',
  'shelf.until': '到 {date}',
  'shelf.countNotes': '{n} 篇筆記',
  'shelf.countDecks': '{n} 份簡報',
  'shelf.dot': ' · ',
  'shelf.localOnly': '只留本機',
  'shelf.localOnlyTitle': '這個主題設定 local_only,不能放上 GitHub',
  'shelf.publicTopic': '預設公開',
  'shelf.emptyTopic': '還沒有內容',
  'book.count': '{n} 篇',
  'book.status.reading': '閱讀中',
  'book.status.done': '已讀完',
  'book.status.paused': '暫停',
  'book.status.other': '{status}',
  'note.crumbs': '所在位置',
  'note.chapters': '這本筆記本的篇章',
  'note.inTopic': '這個主題的筆記',
  'note.public': '公開',
  'note.private': '私人',
  'note.localOnly': '只留本機',
  'note.publicTitle': '這篇筆記判斷為公開(筆記 > 筆記本 > 主題)',
  'note.privateTitle': '這篇筆記是私人的,不要放上 GitHub',
  'note.localOnlyTitle': '這個主題只留在本機',
  'note.pinned': '急件',
  'note.pinnedUntil': '急件 · 到 {date}',
  'note.sourceLabel': '出處:',
  'note.prev': '上一篇',
  'note.next': '下一篇',
  'note.flash': '快閃播放',
  'note.flashTitle': '把這篇筆記暫時當成簡報播放(P)。不會產生任何檔案',
  'note.edit': '編輯',
  'note.editTitle': '編輯這篇筆記(E)',
  'note.smaller': '字小一點',
  'note.larger': '字大一點',
  'note.scaleReset': '目前字級,點一下回到 100%',
  'note.immersive': '沉浸閱讀',
  'note.immersiveTitle': '隱藏選單,只留內文並進入全螢幕(F)',
  'rd.chapters': '章節',
  'rd.toolbar': '沉浸閱讀工具',
  'rd.menu': '顯示／隱藏工具列',
  'rd.fullscreen': '全螢幕',
  'rd.exit': '離開沉浸',
  'note.toc': '目錄',
  'note.backlinks': '反向連結',
  'note.indexing': '建立索引中…',
  'note.indexFailed': '索引建立失敗,請重新整理。',
  'note.noBacklinks': '還沒有其他筆記連到這裡。',
  'note.usedByDecks': '被這些簡報引用',
  'note.viaSource': '由這篇筆記升級',
  'note.viaLink': '投影片裡有連結',
  'note.linkMissing': '找不到這個連結的目標',
  'note.linkAmbiguous': '有 {n} 個同名的目標,已選最接近的一個',
  'note.linkMissingToast': '找不到「{link}」。可能還沒寫,或已經改名。',
  'note.linkAmbiguousToast': '有 {n} 個同名的目標,已開啟最接近的一個。',
  'ne.docTitle': '編輯:{title}',
  'ne.back': '← 回到筆記',
  'ne.toolbar': '插入',
  'ne.bold': '粗體(Ctrl+B)',
  'ne.boldSample': '粗體',
  'ne.heading': '小標題',
  'ne.list': '清單',
  'ne.task': '待辦',
  'ne.quote': '引言',
  'ne.link': '連到筆記或簡報',
  'ne.save': '儲存',
  'ne.saveTitle': '儲存(Ctrl+S)',
  'ask.prompt': "以下是我筆記軟體畫布上的 {n} 張卡片（Markdown）。{groups}\n\n我的問題：{question}\n\n請只根據這些內容回答；資料不夠的地方直接說缺什麼，不要自己編。回答用繁體中文。\n\n{cards}\n{links}\n{neighbors}",
  'ask.defaultQuestion': "請整理這幾張卡片的重點、指出它們之間的關聯與矛盾，並提出 3 個值得繼續想的問題。",
  'ask.groups': "它們在這些群組裡：{list}。",
  'ask.card': "=== 卡片：{title} ===\n{text}\n",
  'ask.untitled': "（沒有標題）",
  'ask.empty': "（空白）",
  'ask.omitted': "（太長，內容略過）",
  'ask.linksHead': "--- 卡片之間的連線 ---",
  'ask.link': "· {from} → {to}{label}",
  'ask.via': "（{label}）",
  'ask.neighborsHead': "--- 用線連到這些卡片的其他卡片（只附開頭）---",
  'ask.neighbor': "· {title}{label}：{text}",
  'ask.title': "問 AI",
  'ask.lead': "會把 {n} 張卡片的內容（加上用線連到它們的 {m} 張卡片的開頭）組成提示詞，複製到剪貼簿，再開啟你選的 AI。Leafpile 不會自己把資料送出去。",
  'ask.question': "想問什麼（可以留空）",
  'ask.questionPh': "留空就請 AI 整理重點、找關聯、提出問題",
  'ask.privateAsk': "裡面有 {n} 張私人筆記。複製給 AI 等於把內容交給那個網站，確定嗎？",
  'ask.privateOk': "確定，複製",
  'ask.copied': "提示詞已複製，到 AI 那邊貼上即可",
  'ask.copyFailed': "瀏覽器不讓複製，請在下一個視窗手動複製",
  'ask.manualTitle': "手動複製提示詞",
  'ask.none': "選取的卡片沒有可以問的文字（圖片、網頁、PDF 不會帶進去）",
  'ask.menu': "問 AI…",
  'ask.button': "問 AI",
  'ask.buttonTitle': "把這篇筆記（與畫布上連到它的卡片）組成提示詞，交給 AI",
  'journal.title': "{date} 日記",
  'journal.palette': "今天的日記",
  'journal.today': "今天的日記",
  'journal.todayTitle': "打開今天的日記；還沒有就建立（預設私人）",
  'journal.dayTitle': "{date} 的日記（打開或建立）",
  'journal.created': "已建立日記：{path}",
  'journal.none': "{date} 還沒有日記（這個書庫不能寫入）",
  'capture.title': "記到收件匣",
  'capture.hint': "寫一句話就好，存成「{topic}」裡的新筆記；第一行當標題。之後再整理。",
  'capture.label': "想到什麼",
  'capture.placeholder': "例如：讀書會可以聊第三章的反例",
  'capture.save': "存起來",
  'capture.empty': "沒有寫字，沒有存",
  'capture.done': "已存到收件匣：{title}",
  'capture.open': "打開",
  'capture.palette': "記到收件匣（快速收集）",
  'slash.col': "欄 {n}",
  'slash.aria': "格式選單",
  'slash.head': "插入",
  'slash.h1': "大標題",
  'slash.h2': "中標題",
  'slash.h3': "小標題",
  'slash.bullet': "項目清單",
  'slash.number': "編號清單",
  'slash.todo': "待辦清單",
  'slash.quote': "引言",
  'slash.code': "程式碼區塊",
  'slash.table': "表格",
  'slash.divider': "分隔線",
  'slash.link': "連結到筆記",
  'slash.embed': "摘錄嵌入",
  'slash.highlight': "螢光標記",
  'slash.image': "圖片",
  'slash.date': "今天的日期",
  'slash.now': "現在時間",
  'ne.saving': '儲存中…',
  'ne.saved': '已儲存',
  'ne.unsaved': '尚未儲存',
  'ne.savedToast': '已儲存到你的資料夾',
  'ne.saveFailed': '儲存失敗:{error}',
  'ne.denied': '沒有寫入權限。請在瀏覽器的詢問視窗按「允許」。',
  'ne.readonly': '這個書庫是唯讀的:用 Chrome 或 Edge 按「開啟本機資料夾」才能儲存。',
  'ne.readonlyRepo': '內建範例不能在這裡存檔;可以到 GitHub 上編輯。',
  'ne.editOnGitHub': '到 GitHub 編輯',
  'ne.textLabel': '筆記內容(Markdown)',
  'ne.suggest': '可以連結的筆記與簡報',
  'ne.draftTitle': '找到還沒儲存的草稿',
  'ne.draftAsk': '這篇筆記有一份 {time} 留在這台電腦的草稿,要還原嗎?',
  'ne.draftRestore': '還原草稿',
  'ne.draftDiscard': '丟掉草稿',
  'ne.staleTitle': '檔案被別的程式改過',
  'ne.staleAsk': '你打開之後,這個檔案在別的地方被修改了。要用你的版本覆蓋,還是載入新的版本?(載入時,你的版本會留在草稿裡)',
  'ne.staleReload': '載入新的版本',
  'ne.staleOverwrite': '用我的版本覆蓋',
  'ne.reloadedKeptDraft': '已載入新的版本;你的版本留在草稿裡。',
  'ne.leaveAsk': '還有沒儲存的修改,確定要離開嗎?(草稿會留在這台電腦)',
  'ne.leave': '離開',
  'newNote.title': '新增筆記',
  'newNote.name': '標題',
  'newNote.placeholder': '例如:原子習慣 第 1 章',
  'newNote.topic': '放在哪個主題',
  'newNote.create': '建立',
  'newNote.needTitle': '請先輸入標題。',
  'newNote.exists': '今天已經有同名的筆記了。',
  'pack.button': '書庫包',
  'pack.buttonTitle': '把書庫打包成 zip（備份或分享），或匯入別人或 AI 給的書庫包',
  'pack.title': '書庫包',
  'pack.lead': '書庫包是一個 zip，裡面就是 notes/、slides/、boards/ 與 _site.yml。可以當備份，也可以傳給別人：對方在首頁按「開啟 zip 書庫包」就能看，不用安裝。',
  'pack.importNote': '「匯出公開的部分」只放判斷為公開的筆記；簡報跟著主題的預設公開；畫布不放。匯入時絕不覆蓋你原本的檔案，寫入前會先預覽。',
  'pack.readonlyNote': '這個書庫是唯讀的，只能匯出。要匯入，請用 Chrome 或 Edge 開啟你的本機資料夾。',
  'pack.exportAll': '匯出整個書庫',
  'pack.exportPublic': '匯出公開的部分',
  'pack.import': '匯入…',
  'pack.exporting': '正在打包⋯',
  'pack.empty': '沒有可以匯出的檔案。',
  'pack.exported': '已匯出 {n} 個檔案。',
  'pack.exportedPublic': '已匯出 {n} 個公開的檔案（略過 {priv} 個不公開的）。分享前建議再跑一次「發布前檢查」。',
  'pack.importTitle': '匯入書庫包',
  'pack.importLead': '從哪裡匯入?zip 檔、解壓縮後的資料夾，或 AI 給你的文字書庫包都可以。下一步會先列出預覽，你確認後才寫入。',
  'pack.fromZip': 'zip 檔',
  'pack.fromFolder': '資料夾',
  'pack.fromText': '貼上 AI 給的文字',
  'pack.pasteTitle': '貼上文字書庫包',
  'pack.pasteLead': '把 AI 回覆的內容整段貼進來（前後的說明文字沒關係）。每個檔案以「=== FILE: 路徑 ===」開頭、「=== END ===」結尾。',
  'pack.pasteLabel': '書庫包內容',
  'pack.next': '下一步',
  'pack.labelText': '貼上的文字',
  'pack.noFilesInText': '這段文字裡找不到任何檔案。請確認每個檔案都以「=== FILE: 路徑 ===」開頭。',
  'pack.previewTitle': '匯入預覽',
  'pack.summary': '來源：{from}。{list}。',
  'pack.count.add': '新增 {n} 個',
  'pack.count.rename': '另存 {n} 個（和你的檔案同名但內容不同）',
  'pack.count.merge': '合併 {n} 個',
  'pack.count.same': '相同而略過 {n} 個',
  'pack.count.keep': '保留你原本的設定 {n} 個',
  'pack.count.skip': '不收 {n} 個',
  'pack.siteRestored': '_site.yml 已還原。',
  'pack.nothing': '沒有需要寫入的檔案：{list}。',
  'pack.safeNote': '不會覆蓋或刪除你原本的任何檔案。匯入後可以按「復原」，把這次新增的檔案移到 _archive/。',
  'pack.lostComments': '_site.yml 的分類那一段會重新寫出，段落裡的 {n} 行註解會不見。',
  'pack.doImport': '匯入 {n} 個檔案',
  'pack.sep': '、',
  'pack.line.add': '新增 {path}',
  'pack.line.rename': '另存 {from} → {to}（同名但內容不同）',
  'pack.line.keep': '保留你原本的 {path}',
  'pack.line.merge': '{path}：補上分類 {list}',
  'pack.line.deck': '簡報和你原有的同名但不同，整份另存到 {path}',
  'pack.line.skip': '不收 {path}（{reason}）',
  'pack.line.more': '⋯還有 {n} 項',
  'pack.reason.archive': '封存區',
  'pack.reason.tool': '工具檔',
  'pack.reason.outside': '不在 notes/、slides/、boards/ 裡',
  'pack.reason.type': '不支援的檔案類型',
  'pack.reason.duplicate': '包裡重複出現',
  'pack.reason.path': '路徑不安全',
  'pack.reason.size': '檔案太大',
  'pack.reason.encrypted': '加密的檔案',
  'pack.reason.method': '不支援的壓縮方式',
  'pack.imported': '已匯入 {n} 個檔案。',
  'pack.someFailed': '有 {n} 個檔案沒有寫入',
  'pack.undone': '已復原：{n} 個檔案移到 {dir}。',
  'pack.zipError': '這個檔案不是書庫包能讀的 zip（可能壞掉、加密或太大）。',
  'pack.failed': '書庫包處理失敗：{error}',
  'home.openZip': '開啟 zip 書庫包',
  'home.openZipTitle': '別人給你的書庫包（.zip）：不用解壓縮，任何瀏覽器都能看（唯讀）',
  'gen.button': "AI 生成",
  'gen.buttonTitle': "把你的資料交給常用的 AI（Claude、ChatGPT、Gemini），生成筆記、簡報或畫布，再匯入這個書庫",
  'gen.title': "用 AI 生成",
  'gen.lead': "一次生成一種。填好後按下方的 AI 按鈕，提示詞會複製到剪貼簿並開新分頁。提示詞會請 AI 先讀 Leafpile 的書庫包規格，再交一個 zip 給你下載。",
  'gen.note': "你的資料只會送到你選的 AI；Leafpile 不會傳到任何地方。品質取決於資料：給得越具體，結果越好。",
  'gen.kind': "要生成什麼",
  'gen.kind.note': "筆記",
  'gen.kind.deck': "簡報",
  'gen.kind.board': "畫布",
  'gen.topic': "放在哪個主題",
  'gen.newTopic': "（新主題：收件匣）",
  'gen.titleLabel': "標題",
  'gen.titlePh': "例如：原子習慣 第 1 章",
  'gen.extra': "補充要求（可省略）",
  'gen.extraPh': "例如：給新手看、大約 8 張投影片、用條列",
  'gen.data': "資料（劃線、摘要、會議紀錄、網頁內容…；也可以留空，到 AI 那邊上傳檔案）",
  'gen.dataAttached': "(資料在我上傳的附件裡;若沒有附件,請先問我要資料,不要自己編)",
  'gen.dataPh': "貼資料；或留空，開啟 AI 後再上傳 PDF、文件、圖片",
  'gen.copyOnly': "只複製提示詞",
  'gen.open': "開啟 {name}",
  'gen.needTitle': "請填標題。",
  'gen.copied': "提示詞已複製。",
  'gen.copyFailed': "沒辦法自動複製，請在下一步的方框裡手動複製提示詞。",
  'gen.pasteTitle': "貼上 AI 的回覆",
  'gen.pasteLead': "{where}在輸入框按 Ctrl+V（Mac 是 ⌘V）貼上提示詞並送出；要用檔案當資料，先把檔案拖進 AI 的對話框。AI 交了 zip 就按「選擇 zip 檔」；給的是文字就整段貼到下面。下一步會先預覽，不會覆蓋你原本的檔案。",
  'gen.whereOpened': "已經開好 {name}。",
  'gen.whereNone': "把提示詞貼到你常用的 AI。",
  'gen.promptLabel': "提示詞(已複製;要的話可以再複製一次)",
  'gen.replyLabel': "AI 的回覆",
  'gen.replyPh': "=== FILE: notes/… ===\n…\n=== END ===",
  'gen.empty': "回覆裡沒有內容。請把 AI 的回覆整段貼上，或選擇 AI 給的 zip 檔。",
  'gen.labelAI': "AI 的回覆",
  'gen.extraLine': "補充要求:{extra}",
  'gen.specFailed': "沒辦法複製規格。請到 GitHub 的 docs/AI_PACK.md 手動複製。",
  'gen.specCopied': "規格全文已複製。貼給 AI，告訴它「照這份規格做」。",
  'gen.copySpec': "複製規格全文",
  'gen.pickZip': "選擇 zip 檔",
  'gen.what.board': "一張畫布(概念圖)",
  'gen.what.deck': "一份簡報",
  'gen.what.note': "筆記(資料長就拆成幾篇加一篇總覽)",
  'gen.prompt': "請先讀 Leafpile 書庫包規格:{spec}\n(讀不到網址就告訴我,我會貼上全文。)\n\n照規格把資料做成{what}。\n主題資料夾:{topicId}(主題名稱:{topic})\n標題:{title}\n{extra}\n只用資料裡的內容,不確定的標「待確認」。\n交付:建立 zip 檔讓我下載;不能建立檔案時,改用規格第 7 節的文字書庫包。\n\n資料:\n{data}",
  'gen.inboxName': '收件匣',
  'palette.generate': '用 AI 生成筆記、簡報或畫布',
  'palette.pack': '書庫包(匯出或匯入)',
  'dialog.ok': '確定',
  'dialog.cancel': '取消',
  'palette.open': '指令面板(Ctrl+K)',
  'palette.label': '指令面板',
  'palette.placeholder': '搜尋筆記、簡報,或輸入指令…',
  'palette.move': '選擇',
  'palette.go': '開啟',
  'palette.close': '關閉',
  'palette.none': '沒有符合的項目',
  'palette.flashThis': '快閃播放這篇筆記',
  'palette.editThis': '編輯這篇筆記',
  'palette.newNote': '新增筆記',
  'palette.shelf': '回到書庫首頁',
  'palette.check': '檢查這個書庫',
  'palette.openFolder': '開啟本機資料夾',
  'palette.repo': '看內建範例',
  'palette.home': '回首頁',
  'palette.lang': '切換語言(中文 / English)',
  'palette.theme': '切換外觀(下一個主題)',
  'promote.noteHint': '(升級自筆記;請補上這一張要講的話)',
  'promote.opening': '開場',
  'promote.end': '謝謝聆聽',
  'promote.sourceComment': 'Leafpile:升級自這份筆記(之後各自獨立,不會自動同步)',
  'promote.usage': '用法:node scripts/promote.mjs <書庫> <筆記或筆記本的路徑> [--dry-run] [--author 名字]\n例:node scripts/promote.mjs ~/我的頁堆 notes/10-reading/2026-11-book/01-ch1.md',
  'promote.notNote': '{path} 不在 notes/ 裡,或找不到。',
  'promote.exists': '{path} 已經存在,不會覆蓋。請改名或刪除後再試。',
  'promote.done': '已建立簡報 {path}({sections} 章、{slides} 張)。這是一次性的複製,之後和筆記各自獨立。',
  'promote.dry': '(預覽,沒有寫入任何檔案)',
  'promote.button': '做成簡報',
  'promote.buttonTitle': '把這篇筆記複製成一份新簡報的骨架(之後各自獨立)',
  'promote.ask': '要在 slides/{topic}/ 建立「{folder}」嗎?會有 {sections} 章、{slides} 張投影片。這是一次性的複製:之後修改筆記,簡報不會跟著變。',
  'promote.scope': '要升級什麼',
  'promote.scopeNote': '只有這篇筆記',
  'promote.scopeBook': '整本筆記本(每篇一章)',
  'promote.create': '建立簡報',
  'distill.title': '講後筆記:{title}',
  'distill.lead': '這篇由簡報「{title}」的大綱與講者備註產生。請補上現場的問答與下次要改的地方。',
  'distill.tag': '講後筆記',
  'distill.outline': '講了什麼',
  'distill.qa': '現場問答',
  'distill.q': '問:',
  'distill.a': '答:',
  'distill.slideRef': '(第 {n} 張)',
  'pv.qa': '問答',
  'pv.qaPlaceholder': '記下現場的問題…(Enter 記下,Shift+Enter 換行)',
  'pv.qaAdd': '記下',
  'pv.qaHint': '產生講後筆記時會自動帶入。',
  'pv.qaDownload': '下載問答',
  'pv.qaAnswer': '答案(可以之後再補)',
  'pv.qaDelete': '刪除',
  'pv.qaDeleteConfirm': '再按一次刪除',
  'pv.qaEmpty': '還沒有問題。按 Q 開始記錄。',
  'pv.qaSlide': '第 {n} 張',
  'pv.qaSaveFailed': '問答沒有存到(瀏覽器不允許本機儲存)',
  'distill.withQA': '會帶入講者視窗記下的 {n} 則問答。',
  'distill.qaMissing': '讀不到問答檔 {path}。',
  'distill.qaEmpty': '{path} 裡沒有讀到任何問題(格式:講者視窗下載的 JSON,或每題一行「Q: 問題」、下一行「A: 答案」)。',
  'distill.next': '下次要改',
  'distill.suffix': '講後',
  'distill.usage': '用法:node scripts/after-talk.mjs <書庫> <簡報的路徑> [--dry-run] [--qa <問答檔>]\n例:node scripts/after-talk.mjs ~/我的頁堆 slides/10-reading/2026-11-share',
  'distill.notDeck': '{path} 不是 slides/ 裡的簡報資料夾。',
  'distill.done': '已建立講後筆記 {path}(預設私人)。',
  'distill.action': '把這份簡報存成講後筆記',
  'distill.ask': '要在 notes/{topic}/ 建立講後筆記「{file}」嗎?內容是簡報大綱與講者備註,預設私人。',
  'distill.create': '建立筆記',
  'bridge.needWrite': '需要可以寫入的書庫:請用 Chrome 或 Edge 按「開啟本機資料夾」。',
  'bridge.needVault': '這個功能需要 Leafpile 書庫(有 notes/ 與 slides/ 的資料夾)。',
  'embed.missing': '有 {n} 個摘錄找不到來源筆記,會顯示原本的文字。',
};
return { LOCALE_ZH_HANT };
})();

// ───────── app/core/locales/en.js ─────────
__m["app/core/locales/en.js"] = (() => {
// English strings. Every key here must also exist in zh-Hant.js (tests/i18n.test.mjs checks this).
// {name} is a placeholder; both languages must use the same placeholders.

const LOCALE_EN = {
  // ---------- Config files (YAML) ----------
  'yaml.line': 'Line {line}: {message}',
  'yaml.tab': 'Indent with spaces, not tabs',
  'yaml.inconsistent': 'Inconsistent indentation',
  'yaml.tooDeep': 'Too much indentation',
  'yaml.notList': 'Expected "key: value" here, not a list item',
  'yaml.unknown': 'Cannot read "{text}"; expected "key: value"',
  'yaml.array': 'Inline list is missing ]',

  // ---------- Parse warnings ----------
  'lib.defaultLabel': 'Library',
  'issue.color': 'Invalid color "{value}"; using the default color',
  'issue.slideStyle': 'Could not understand {key}: "{value}"; ignored. See section 4 of the guide for valid values',
  'issue.mark': 'Could not understand mark "{value}"; ignored. Use <!-- mark: left top width height label -->, numbers are percentages of the image (0–100)',
  'issue.slideColor': 'Invalid color "{value}"; using the section color',
  'issue.readFailed': 'Could not read file',
  'issue.noSlides': 'No slides (.md files) found in this folder',
  'issue.newerSchema': 'This deck needs a newer version of the tool (mdslide: {version})',
  'issue.frontMatter': 'Front matter: {detail}',
  'issue.frontMatterParse': 'could not be parsed',
  'issue.layout': 'Unknown layout "{layout}"; using auto. Available: {list}',
  'issue.brandFont': 'brand font "{value}" contains characters that are not allowed; ignored',

  // ---------- Check ----------
  'check.noTable': 'chart layout has no table',
  'check.badCell': 'Chart row {row}, column {col}: "{text}" is not a number and will be shown as blank',
  'check.missingMedia': 'Missing media {src} (resolved path {path})',
  'check.missingBg': 'Missing background image {src}',
  'check.missingCover': 'Missing cover_image {src}',
  'check.dupPrefix': 'More than one item at this level uses prefix {prefix}: {names}. Their order is decided by name and may not be what you want',
  'check.mixedPrefix': 'Prefixes have different widths: {names}. Your file manager may sort them differently from the player; use two digits (01-, 02-)',
  'check.emptySlide': 'Slide {n} is empty (settings only, no content)',
  'check.sep': ', ',
  'check.overflow': 'Slide {n} runs about {px}px past the slide and will be cut off. Split it, or add size: small',
  'check.overflowCompact': 'Slide {n} is already small but still runs about {px}px over. Split it into two slides',
  'check.missingLogo': 'Missing brand.logo {src}',
  'check.missingFootnote': 'Footnote [^{id}] is not defined',
  'check.deckFolder': '(deck folder)',
  'check.tooMany': '{n} slides; a 25–30 minute talk usually needs 20–30',
  'check.opening': '(opening)',
  'check.unreadable': 'Could not read: {error}',
  'check.kind.library': 'library',
  'check.kind.topic': 'topic',
  'check.kind.deck': 'single deck',
  'check.report.title': '📚 {title} (detected as: {kind})',
  'check.report.topic': '▸ Topic: {title}',
  'check.report.empty': '  (no decks yet)',
  'check.report.deck': '  ▪ {title}{date} — {sections} sections, {total} slides, {layouts} layouts, notes {noted}/{total}{noConfig}',
  'check.report.date': ' ({date})',
  'check.report.noConfig': ', no deck.yml',
  'check.report.section': '      {title}: {count} slides',
  'check.report.untitled': '(untitled)',
  'check.report.auto': '  (auto)',
  'check.report.problems': '⚠ {n} problems:',
  'check.report.ok': '✓ No problems found',
  'check.usage': 'Usage: node scripts/check.mjs <folder> [--slides] [--index[=json]] [--public] [--lang en|zh-Hant]',
  'index.title': 'Library index: {title}',
  'index.summary': 'topics: {topics} · notes: {notes} · decks: {decks} · boards: {boards} · generated {date} (UTC)',
  'index.publicOnly': '> Public notes only (--public).',
  'index.howto': '> For AI: this index lists every note with its path, date, tags, sections and links. Find the files you need here, then open the originals; regenerate after changing files (node leafpile-check.mjs <library> --index). Rules: docs/SPEC.md.',
  'index.sep': ', ',
  'index.more': '…and {n} more',
  'index.topicPublic': 'public by default',
  'index.localOnly': 'local only',
  'index.public': 'public',
  'index.private': 'private',
  'index.pinned': 'urgent (until {date})',
  'index.book': 'notebook: {title}',
  'index.aliases': 'Aliases: {list}',
  'index.fields': 'Fields: {list}',
  'index.headings': 'Sections: {list}',
  'index.links': 'Links to: {list}',
  'index.missing': 'Not found: {list}',
  'index.backlinks': 'Linked from: {list}',
  'index.onBoards': 'Boards: {list}',
  'index.fromDeck': 'After-talk note from {path}',
  'index.deck': '[deck]',
  'index.source': 'Upgraded from {path}',
  'index.boards': 'Boards',
  'index.boardStats': 'note or deck cards: {cards} · text cards: {texts}',
  'index.groups': 'Groups: {list}',
  'index.cards': 'Cards: {list}',
  'catalog.done': 'catalog.json: {topics} topics, {notes} notes, {decks} decks, {slides} slides',

  // ---------- Sources ----------
  'source.repoLabel': 'Built-in examples',
  'source.localLabel': 'Local folder',
  'source.noCatalog': 'catalog.json not found. The built-in library needs it: run node scripts/build-catalog.mjs in the project folder. To play your own decks, go back home and choose "Open local folder" instead',

  // ---------- Auto slide text (follows the deck language) ----------
  'slide.thanks': 'Thank you',
  'slide.agenda': 'Agenda',
  'slide.noMedia': 'No media',
  'slide.missingMedia': 'Media not found',

  // ---------- Themes and stages ----------
  'theme.paper': 'Paper',
  'theme.ink': 'Ink',
  'theme.slate': 'Slate',
  'theme.sepia': 'Sepia',
  'theme.nord': 'Nord',
  'theme.auto': 'Automatic',
  'theme.menu': 'Appearance',
  'theme.hint': 'Changes the library, notes and boards in this browser only; decks keep their own theme. Automatic uses the library setting, or dark when your computer is in dark mode.',
  'theme.now': 'Appearance: {name}',
  'stage.pile': 'Pile',
  'stage.coverflow': 'Cover flow',
  'stage.carousel': 'Carousel',
  'stage.helix': 'Helix',
  'stage.sphere': 'Sphere',
  'stage.overview': 'Overview',
  'stage.side': 'Side by side',

  // ---------- Home and navigation ----------
  'doc.title': 'Leafpile · One folder: notes by day, slides on stage',
  'nav.repo': 'Examples',
  'nav.home': 'My library',
  'nav.backHome': 'Back to home',
  'lang.label': '語言 / Language',
  'lang.zhShort': '中',
  'loading': 'Loading…',
  'loading.library': 'Reading the library…',
  'loading.deck': 'Loading the deck…',
  'err.title': 'Something went wrong',
  'err.offlineTitle': 'You are offline',
  'err.offline': 'The built-in examples and repository decks need a connection. Decks in folders on your computer or USB drive work without internet: go back home and choose a folder.',
  'err.noRecord': 'This library is no longer remembered. Please open the folder again.',
  'err.sessionGone': 'The folder you opened is no longer available (after a reload you need to choose it again).',
  'err.cannotRead': 'Cannot read this folder. It may have been moved, or the USB drive is not connected.',
  'err.noDeck': 'Deck not found. It may have been renamed or removed.',
  'err.emptyDeck': 'This deck has no slides.',
  'err.dropFolder': 'Please drop a folder, not a single file.',
  'drop.hint': 'Drop to open this folder',
  'home.eyebrow': 'Notes and slides in one folder',
  'home.title': 'Notes by day,<br>slides on stage.',
  'home.lead': 'Collect notes in Markdown and play them as a 3D pile of slides when it is time to share. Your files stay on your computer or USB drive; this site only reads them. Nothing to install, nothing uploaded.',
  'home.open': 'Open a local folder',
  'home.repo': 'See the examples',
  'home.tipPicker': 'You can also drag a folder into this window. Chrome / Edge remember the libraries you open.',
  'home.tipNoPicker': 'You can also drag a folder into this window. This browser cannot remember folders, so you need to choose again after a reload; Chrome or Edge work best.',
  'home.recent': 'Recent libraries',
  'home.forget': 'Remove from list (files are not deleted)',
  'home.step1.title': 'Prepare a folder',
  'home.step1.text': 'Put notes/ and slides/ in your library. One .md file is one note, or one slide.',
  'home.step2.title': 'Open it',
  'home.step2.text': 'Open the whole library to see all its notes and decks. A single deck folder (or a Mdslide Pile library) works too; it is detected automatically.',
  'home.step3.title': 'Read, write, present',
  'home.step3.text': 'Connect notes with [[links]]. Press ▶ to play a note as slides, or open a full deck: Enter to zoom, S for speaker view, P to save a PDF.',
  'home.rules': 'Rules: ',
  'home.guideName': 'docs/SPEC.md',
  'home.guidePath': 'docs/SPEC.md',
  'perm.title': 'Reconnect "{name}"',
  'perm.text': 'To protect your files, the browser asks for read permission again each time.<br>If it is on a USB drive, make sure it is connected.',
  'perm.writeTitle': 'Write permission needed',
  'perm.writeText': 'To save changes into your folder, the browser needs your permission once. After you press “Allow”, the browser will ask again; choose “Save changes” or “Allow”.',
  'perm.writeAllow': 'Allow',
  'perm.grant': 'Allow access',

  // ---------- Library page ----------
  'lib.repo': 'Built-in library',
  'lib.local': 'Local library',
  'lib.eyebrow': '{kind} · {topics} topics · {decks} decks',
  'lib.search': 'Search titles and tags…',
  'lib.found': 'Showing {n} of {total} decks',
  'lib.noResults': 'No decks match “{q}”',
  'lib.check': '✓ Check',
  'lib.checkTitle': 'Check every deck against the rules',
  'lib.refresh': '↻ Refresh',
  'lib.refreshTitle': 'Read the folder again',
  'lib.all': 'All',
  'lib.issues': '⚠ {n} config problems',
  'lib.empty': 'No decks in this topic yet',
  'lib.chapters': 'Sections: {n}',

  // ---------- Check panel ----------
  'checkp.aria': 'Check results',
  'checkp.title': 'Check',
  'checkp.close': 'Close (Esc)',
  'checkp.progress': 'Checking ({i}/{n}): {title}',
  'checkp.finishing': 'Summarizing…',
  'checkp.failed': 'Check failed: {error}',
  'checkp.problems': '⚠ {n} problems',
  'checkp.summary': '{decks} decks · {slides} slides',
  'checkp.problemsHeading': 'Problems',
  'checkp.decksHeading': 'Decks',
  'checkp.sections': '{n} sections',
  'checkp.slides': '{n} slides',
  'checkp.layouts': '{n} layouts',
  'checkp.notes': 'Notes {a}/{b}',
  'checkp.auto': 'auto',
  'checkp.noDecks': 'No decks yet',
  'checkp.foot': 'Rules: docs/SPEC.md (notes and library) and docs/slides/GUIDE.en.md (decks). Aim for at least 4 layouts and speaker notes on every slide. Edit your files, then press Check again.',
  // ---------- Player ----------
  'player.back': '‹ Library',
  'player.backTitle': 'Back to the library (Esc)',
  'player.stageTitle': 'Stage (L)',
  'player.theme': 'Theme',
  'player.themeTitle': 'Switch theme (T)',
  'player.check': 'Check',
  'player.rotate': 'Turn your phone sideways for much bigger slides.',
  'player.rotateLock': 'Full screen, landscape',
  'player.rotateOk': 'Got it',
  'player.export': 'Export',
  'player.exportTitle': 'Export as a single HTML file (plays offline)',
  'export.title': 'Export as a single HTML file',
  'export.text': 'The player, styles, slides and images go into one file. Double-click it to present offline — no internet or website needed. Online videos (YouTube etc.) still need a connection.',
  'export.measuring': 'Measuring file size…',
  'export.size': 'Estimated size: {size}',
  'export.videos': 'Include video and audio (count: {n}, about {size})',
  'export.go': 'Download',
  'export.cancel': 'Cancel',
  'export.working': 'Building the file…',
  'export.done': 'Exported ({size})',
  'export.failed': 'Export failed. Please try again.',
  'player.checkTitle': 'Check this deck',
  'player.presentTitle': 'Present (Enter)',
  'player.helpTitle': 'Shortcuts (?)',
  'player.hint': '← → slides · ↑ ↓ sections · Enter zoom · L stage · ? help',
  'player.issues': '⚠ {n} warnings',
  'player.slideLabel': 'Slide {n}: {title}',
  'player.reloaded': 'Reloaded',
  'player.reloadUnsupported': 'This source cannot be reloaded; please open the folder again',
  'help.title': 'Shortcuts',
  'help.foot': 'Click a card to select it, click again to zoom. The mouse wheel also turns slides.',
  'help.motion': 'Animation',
  'help.motionFull': 'Full',
  'help.motionReduced': 'Reduced',
  'key.prevNext': 'Previous / next slide (clickers work too)',
  'key.section': 'Previous / next section (the pile shuffles)',
  'key.enter': 'Zoom in / out',
  'key.esc': 'Zoom out, leave overview, back to library',
  'key.jump': 'Jump to section',
  'key.homeEnd': 'First / last slide',
  'key.overview': 'Overview',
  'key.side': 'Side by side (large slide + thumbnails)',
  'key.stage': 'Switch stage',
  'key.theme': 'Switch theme',
  'key.black': 'Black screen',
  'key.full': 'Full screen',
  'key.presenter': 'Open presenter view',
  'key.print': 'Print / save as PDF',
  'key.video': 'Play / pause local video on the zoomed slide',
  'key.reload': 'Reload the deck',
  'key.help': 'This help',
  'toast.theme': 'Theme: {name}',
  'toast.noPresenter': 'This browser does not support the presenter view',
  'toast.popupBlocked': 'The browser blocked the pop-up; allow it and press S again',
  'toast.printing': 'Preparing to print…',

  // ---------- Presenter view ----------
  'pv.docTitle': 'Presenter view · Leafpile',
  'pv.current': 'Current',
  'pv.elapsed': 'Elapsed',
  'pv.now': 'Now',
  'pv.reset': 'Reset',
  'pv.next': 'Next',
  'pv.notes': 'Notes',
  'pv.waiting': 'Waiting for the main window… (press S there)',
  'pv.keys': '← → slides · ↑ ↓ sections · Enter zoom · B black screen (press again to return) · Q record a question · keys here control the main window (except full screen)',
  'pv.last': '(last slide)',
  'pv.steps': ' · step {a}/{b}',
  'pv.notViewing': ' · <em>main screen not zoomed</em>',
  'pv.noNotes': 'No notes for this slide',
  'scaffold.usage': 'Usage: node scripts/new-deck.mjs <folder> [--title "Title"] [--deck-lang zh-Hant|en]\nExample: node scripts/new-deck.mjs content/02-work/2026-11-Q4-update',
  'scaffold.notEmpty': '{dir} already has files. To avoid overwriting your work, choose a new folder.',
  'scaffold.done': 'Created a deck skeleton: {dir}',
  'scaffold.next': 'Next: edit the Markdown files in each section (rules: docs/GUIDE.en.md), then run node scripts/check.mjs again.',
  'scaffold.subtitle': 'Subtitle: this deck in one sentence',
  'scaffold.end': 'Thank you',
  'scaffold.sec1Folder': '01-Opening',
  'scaffold.sec1Title': 'Opening',
  'scaffold.sec2Folder': '02-Key-points',
  'scaffold.sec2Title': 'Key points',
  'scaffold.sec3Folder': '03-Wrap-up',
  'scaffold.sec3Title': 'Wrap-up',
  'scaffold.slide1File': '01-Agenda.md',
  'scaffold.slide1': '<!-- layout: agenda -->\n# Today',
  'scaffold.slide2File': '01-First-point.md',
  'scaffold.slide2': '# First point\n\n- One idea per slide\n- One line per bullet\n\nNote:\nSpeaker notes go here; they only appear in the presenter view (press S).',
  'scaffold.slide3File': '02-Key-number.md',
  'scaffold.slide3': '## 3x\n\nOne number the audience will remember\n\nSource: add the source and date',
  'scaffold.slide4File': '01-Summary.md',
  'scaffold.slide4': '# Three things to take away\n\n1. First\n2. Second\n3. Third',
  'player.read': 'Read',
  'player.readTitle': 'Reading view: scroll through with speaker notes (M)',
  'player.inkTitle': 'Pen and laser pointer (D)',
  'ink.bar': 'Drawing tools',
  'ink.laser': 'Laser',
  'ink.pen': 'Pen',
  'ink.highlight': 'Highlighter',
  'ink.eraser': 'Eraser',
  'ink.color': 'Change pen colour',
  'ink.undo': 'Undo',
  'ink.undoTitle': 'Undo (Ctrl+Z)',
  'ink.clear': 'Clear',
  'ink.clearTitle': 'Clear drawings on this slide (X)',
  'ink.offTitle': 'Close drawing tools (Esc)',
  'lightbox.label': 'Enlarged image',
  'lightbox.hint': 'Click or press Esc to close',
  'reader.label': 'Reading view',
  'reader.close': '‹ Back to slides',
  'reader.closeTitle': 'Back to slides (M or Esc)',
  'reader.print': 'Print handout',
  'reader.printTitle': 'Print a handout with speaker notes (P)',
  'key.ink': 'Pen and laser pointer',
  'key.read': 'Reading view (with notes)',
  'pv.inkNone': 'Off',
  'pv.inkHint': 'Draw on the slide above; it appears on the audience screen',
  'update.ready': 'A new version of the site is ready.',
  'update.reload': 'Reload',
  'update.later': 'Later',
  'pv.fullscreenHint': 'Press F on the audience window to go full screen (click it first). Browsers do not allow the presenter view to do it.',
  'toast.kNone': 'No video or audio on this slide (K plays / pauses local video on the zoomed slide)',
  'toast.kZoom': 'Press Enter to zoom in first; K then plays / pauses the video on it',
  'toast.kEmbed': 'Use the play button on online videos; K only controls local video',
  'toast.kPlay': '▶ Playing',
  'toast.kPause': '❚❚ Paused',
  'slide.interactive': 'Interactive page',
  'slide.openPage': '↗ Open in new tab',
  'player.edit': 'Edit',
  'player.editTitle': "Edit this slide's Markdown (E)",
  'key.edit': "Edit this slide's source",
  'key.clear': 'Clear drawings on this slide (while the pen is on)',
  'key.goto': "Type a slide number to jump to it",
  'jump.label': "Go to slide",
  'jump.total': "of {total}",
  'editor.prevTitle': "Previous slide (Alt+PageUp). Saves first when switching files",
  'editor.nextTitle': "Next slide (Alt+PageDown). Saves first when switching files",
  'editor.position': "Slide {n} / {total}",
  'editor.tools': "Insert tools",
  'editor.layout': "Layout",
  'editor.layoutAuto': "Currently detected as “{name}”",
  'editor.tHeading': "Heading",
  'editor.tHeadingTitle': "Make this line a heading; press again for a smaller one",
  'editor.tBold': "Bold",
  'editor.tBoldTitle': "Make the selected text bold",
  'editor.tList': "List",
  'editor.tListTitle': "Turn the selected lines into a list (press again to undo)",
  'editor.tMedia': "Image / video",
  'editor.tMediaTitle': "Pick a file from the media folder, or insert an online video link",
  'editor.tColumns': "Columns",
  'editor.tColumnsTitle': "Insert a +++ column break (for the columns layout)",
  'editor.tSplit': "New slide",
  'editor.tSplitTitle': "Insert --- at the cursor to start a new slide",
  'editor.tNotes': "Notes",
  'editor.tNotesTitle': "Jump to this slide's speaker notes, or add them",
  'editor.guide': "Syntax guide ↗",
  'editor.guideURL': 'https://github.com/ToruSmith/Leafpile/blob/main/docs/slides/GUIDE.en.md',
  'editor.ok': "OK",
  'editor.cancel': "Cancel",
  'editor.discard': "Don't save",
  'editor.overwrite': "Overwrite with my version",
  'editor.keepTheirs': "Keep their changes",
  'editor.sampleBold': "key point",
  'editor.sampleTitle': "New title",
  'editor.sampleCaption': "caption",
  'editor.mediaLoading': "Loading…",
  'editor.mediaNone': "The deck's media/ folder has no images or videos yet. Put files there and press this again.",
  'editor.mediaVideo': "＋ Online video link (YouTube etc.)",
  'editor.mediaTemplate': "＋ Image template (edit the file name)",
  'layoutName.auto': "Auto",
  'layoutName.text': "Text",
  'layoutName.center': "Centered",
  'layoutName.split': "Text left, media right",
  'layoutName.split-left': "Media left, text right",
  'layoutName.full': "Full-bleed media",
  'layoutName.quote': "Quote",
  'layoutName.number': "Big number",
  'layoutName.stats': "Stat cards",
  'layoutName.timeline': "Timeline",
  'layoutName.columns': "Columns",
  'layoutName.agenda': "Agenda",
  'layoutName.chart': "Chart",
  'layoutName.flow': 'Flow chart',
  'layoutName.gallery': 'Images side by side',
  'layoutName.grid': 'Grid of blocks',
  'layoutName.end': "Closing",
  'layoutName.title': "Title",
  'layoutName.section': "Section",
  'editor.autoSaved': 'Saved {name} automatically',
  'editor.overflow': 'Content runs about {px}px past the slide and will be cut off. Split it with "New slide", or add <!-- size: small --> at the top of this slide (about 20% smaller text)',
  'editor.overflowCompact': 'Already small, but content still runs about {px}px past the slide. Split it into two slides',
  'editor.markHint': 'Drag on the image on the right to add a highlight box',
  'editor.markAdded': 'Highlight added. The cursor is where the label goes, so just type it; add a #hex color to change its color',
  'editor.look': "Look",
  'editor.lookTitle': "Text size, background, colors, font, alignment (this slide only)",
  'editor.lookDefault': "Default",
  'editor.lookClear': "Clear",
  'editor.lookNone': "None",
  'editor.lookPick': "Choose image…",
  'editor.lookSize': "Text size",
  'editor.sizeSmall': "Small (data-heavy)",
  'editor.sizeNormal': "Normal",
  'editor.sizeLarge': "Large",
  'editor.sizeXl': "Extra large",
  'editor.lookBgColor': "Background color",
  'editor.lookBgImage': "Background image",
  'editor.lookOverlay': "Image overlay",
  'editor.overlayDark': "Dark (light text)",
  'editor.overlayLight': "Light",
  'editor.overlayNone': "None",
  'editor.lookAccent': "Accent color",
  'editor.lookText': "Text color",
  'editor.lookFont': "Font",
  'editor.lookAlign': "Alignment",
  'editor.alignLeft': "Left",
  'editor.alignCenter': "Center",
  'editor.alignRight': "Right",
  'editor.lookRatio': "Column ratio",
  'editor.lookStep': "Reveal step by step",
  'editor.lookHidden': "Skip this slide when playing",
  'editor.lookFooter': "Show footer",
  'editor.lookNote': "Each choice writes a settings comment at the top of this slide; choosing Default removes it. Text turns light on dark backgrounds.",
  'editor.label': 'Edit Markdown',
  'editor.close': '‹ Close',
  'editor.save': 'Save',
  'editor.revert': 'Revert',
  'editor.add': '+ New slide',
  'editor.addTitle': 'Add a slide to this section',
  'editor.archive': 'Archive',
  'editor.archiveTitle': 'Move this file to _封存/ (it is not deleted)',
  'editor.ready': 'Ready to edit. Ctrl+S saves; ‹ › switch slides (saves first when switching files)',
  'editor.readOnly': 'Saving is not available here; "Save" downloads the edited file',
  'editor.unsaved': 'Unsaved changes',
  'editor.noChange': 'No changes',
  'editor.saving': 'Saving…',
  'editor.saved': 'Saved at {time}',
  'editor.failed': 'Could not save: {message}',
  'editor.denied': 'No permission to write. Choose "Allow" in the browser prompt',
  'editor.staleAsk': 'Another program changed this file while you were editing. Overwrite it with your version, or keep their changes? (If you keep theirs, your text stays in the editor so you can copy it first.)',
  'editor.staleKept': 'Kept the other version. Your text is still in the editor - copy it before continuing',
  'editor.downloaded': 'Downloaded the edited file',
  'editor.revertAsk': 'Discard unsaved changes and go back to how the file was when you opened it?',
  'editor.reverted': 'Back to the opened version',
  'editor.unsavedAsk': 'You have unsaved changes.',
  'editor.addAsk': 'Title for the new slide (can be empty):',
  'editor.added': 'Added {name}',
  'editor.archiveAsk': 'Move {name} to _封存/? The file is not deleted and you can get it back from the folder.',
  'editor.archived': 'Moved to {path}',
  'editor.segment': 'This file has {total} slides; showing number {n} (the one your cursor is in)',
  'pv.editNotes': 'Edit notes',
  'pv.saveNotes': 'Save notes',
  'pv.savingNotes': 'Saving…',
  'pv.notesSaved': 'Saved',
  'pv.notesFailed': 'Could not save',
  'editor.autoSlide': 'This is an automatic cover / section page with no file of its own. You are editing deck.yml, where its title lives',
  "editor.yamlNote": "This is the deck's config file, so there is no preview. The deck reloads after you save",
  'editor.openFailed': 'Could not open {path}',
  'editor.onGitHub': '↗ Edit on GitHub',

  // ---------- Leafpile:書架、筆記、互通 ----------
  'brand.zh': 'notes × slides',
  'home.engine': 'Slide engine: ',
  'nav.backShelf': 'Back to the library',
  'loading.note': 'Loading note…',
  'loading.link': 'Resolving link…',
  'err.noNotes': 'This library has no notes/ folder.',
  'err.noNote': 'Note not found ({path}). It may have been renamed or removed.',
  'notes.unfiled': 'Unfiled',
  'issue.newerLeafpile': 'This library uses a newer format (leafpile: {version}); some settings may be ignored. Please update Leafpile.',
  'note.layoutKeys': 'Layout settings in note front matter ({keys}). Layout belongs to slides; move it to a slide.',
  'check.kind.leafpile': 'Leafpile library',
  'check.linkMissing': 'Link {link} has no target',
  'check.embedMissing': 'Excerpt {link} has no target',
  'check.linkAmbiguous': 'Link {link} matches several targets ({paths}); write the path instead',
  'check.headingMissing': '{link}: no such heading in “{title}”',
  'check.embedLong': 'Excerpt {link} is over {n} characters; slides should be shorter than notes',
  'check.pinnedNoExpiry': 'Pinned notes need an expires date',
  'check.expired': 'Expired on {date}; delete it or move it to _archive/',
  'note.sourceChanged': 'note updated',
  'note.sourceChangedTip': 'This note changed after the deck was created. The deck may need to catch up.',
  'deck.sourceChanged': 'The source note of this deck changed after it was promoted; the deck may need to catch up.',
  'dialog.close': 'Close',
  'deck.openSourceShort': 'Open source note',
  'deck.markSyncedShort': 'Caught up, stop reminding',
  'deck.openSource': 'Open the source note of this deck',
  'deck.markSynced': 'Mark the deck as caught up with its source note',
  'deck.trackSource': 'Start tracking changes to the source note',
  'deck.markedSynced': 'Updated source_hash in deck.yml.',
  'check.sourceChanged': 'Source note “{source}” changed after promotion; the deck may need to catch up (then update source_hash, or run node scripts/source-sync.mjs)',
  'sync.usage': 'Usage: node scripts/source-sync.mjs <library> [<deck path> --mark]\nLists decks promoted from notes and whether the source note changed since; --mark records that the deck has caught up.',
  'sync.notDeck': 'No promoted deck at {path} (paths look like slides/10-reading/2026-11-share).',
  'sync.marked': 'Set source_hash in {path}/deck.yml to {hash}.',
  'sync.none': 'No decks promoted from notes (no source in any deck.yml).',
  'sync.changed': '{n} deck(s) have a changed source note. Once a deck has caught up, run with --mark.',
  'sync.allSame': 'Every trackable deck matches its source note.',
  'sync.status.same': '[same]     ',
  'sync.status.changed': '[changed]  ',
  'sync.status.missing': '[missing]  ',
  'sync.status.untracked': '[untracked]',
  'link.tipNote': 'Links to the note “{title}” ({path})',
  'link.tipDeck': 'Links to the deck “{title}” ({path})',
  'link.tipMissing': 'Link “{target}” has no matching target',
  'link.tipRaw': 'Links to {target}',
  'check.boardBroken': 'Cannot read this board: {error}',
  'check.boardIssue': 'An item on this board was skipped ({issue})',
  'check.boardMissing': 'A card on this board points to a missing file: {file}',
  'check.sourceMissing': 'deck.yml source “{source}” does not match any note',
  'check.report.notes': '📝 Notes: {topics} topics, {books} notebooks, {notes} notes, {links} links',
  'check.report.warnings': '{n} reminders (these do not fail the check):',
  'checkp.warnings': '{n} reminders',
  'checkp.warningsHeading': 'Reminders (do not fail the check)',
  'checkp.notesSummary': '{notes} notes · {links} links',
  'shelf.eyebrow': '{kind} · {topics} topics · {notes} notes · {decks} decks',
  'shelf.search': 'Search notes and decks…',
  'shelf.viewLabel': 'Channel',
  'shelf.view.all': 'All',
  'shelf.view.notes': 'Notes',
  'shelf.view.slides': 'Slides',
  'shelf.view.table': 'Table',
  'side.label': 'Library navigation',
  'side.toggle': 'Library navigation (sidebar)',
  'side.collapse': 'Hide sidebar',
  'side.shelf': 'Library overview',
  'side.table': 'Table',
  'side.search': 'Search',
  'side.pins': 'Pinned',
  'side.pinThis': 'Pin this page',
  'side.unpinThis': 'Unpin',
  'side.pin': 'Pin',
  'side.unpin': 'Unpin',
  'side.pinsEmpty': 'Open a note, deck or board and choose “Pin this page” to keep it here. Saved in this browser only.',
  'side.recent': 'Recent',
  'side.boards': 'Boards',
  'side.topics': 'Categories and topics',
  'side.topicsEmpty': 'No topics yet',
  'side.loading': 'Loading…',
  'tm.publicUnset': 'Not set (each note decides)',
  'tm.publicYes': 'Public',
  'tm.publicNo': 'Not public',
  'tm.noCategory': '(No category)',
  'tm.newTitle': 'New topic',
  'tm.editTitle': 'Edit topic: {name}',
  'tm.newHint': 'Creates a topic folder under notes/ with its _topic.yml. The folder name stays fixed afterwards (changing it means moving the whole folder).',
  'tm.editHint': 'Only {path} changes. No note, deck or link is affected.',
  'tm.folder': 'Folder',
  'tm.name': 'Name',
  'tm.description': 'Description',
  'tm.category': 'Category',
  'tm.color': 'Color',
  'tm.public': 'Public by default',
  'tm.next': 'Next: preview',
  'tm.idErr.empty': 'Enter a folder name',
  'tm.idErr.spaces': 'The folder name can’t start or end with a space',
  'tm.idErr.chars': 'The folder name can’t contain / \\ : * ? " < > | # or end with a space or dot',
  'tm.idErr.reserved': 'The folder name can’t start with . or _ (reserved)',
  'tm.idErr.long': 'The folder name is too long (80 characters max)',
  'tm.idErr.exists': 'A topic with that name already exists',
  'tm.nameRequired': 'Enter a topic name',
  'tm.colorErr': 'Use #rrggbb or #rgb for the color, like #4f73a6, or leave it empty',
  'tm.previewFile': 'Writes {path}:',
  'tm.back': 'Go back',
  'tm.save': 'Write changes',
  'tm.unset': '(not set)',
  'tm.change': '{field}: {from} → {to}',
  'tm.catsTitle': 'Manage categories',
  'tm.catsHint': 'Categories live in the library’s _site.yml. Their order is the order on the library page and in the sidebar. Categories still used by topics can’t be removed.',
  'tm.catName': 'Category name',
  'tm.catId': 'Category id (topics point to it)',
  'tm.catIdPh': 'id, like health',
  'tm.catUsed': '{n} topics',
  'tm.up': 'Move up',
  'tm.down': 'Move down',
  'tm.delete': 'Remove',
  'tm.catInUse': 'Still used by topics',
  'tm.catAdd': '+ Add category',
  'tm.catNameRequired': 'Every category needs a name',
  'tm.catIdErr.empty': 'The new category needs an id',
  'tm.catIdErr.chars': 'Category id “{id}” can only use letters, digits, - and _',
  'tm.catIdErr.exists': 'Category id “{id}” is used twice',
  'tm.stale': '{path} was changed elsewhere, so nothing was written. Refresh and try again.',
  'tm.writeFailed': 'Couldn’t write {path}',
  'tm.undo': 'Undo',
  'tm.undone': 'Undone',
  'tm.undoFailed': 'Couldn’t undo: {path} has changed since',
  'tm.noChange': 'Nothing changed',
  'tm.previewTitle': 'Confirm topic settings',
  'tm.willCreate': 'This topic has no _topic.yml yet, so one will be added. No note, deck or link is affected.',
  'tm.noLinks': 'Only the settings file changes. No note, deck or link is affected. You can undo after writing.',
  'tm.saved': 'Updated {path}',
  'tm.newFolder': 'New folder {path}',
  'tm.previewNew': 'Confirm new topic',
  'tm.newNote': 'Only the folder and its settings file are created. Use “+ Note” in this topic to add notes.',
  'tm.create': 'Create',
  'tm.created': 'Topic “{name}” created',
  'tm.catBlocked': 'These categories are still used by topics and can’t be removed: {names}. Move those topics to another category first.',
  'tm.catOrder': 'Order: {list}',
  'tm.catAdded': 'Add category “{name}” (id: {id})',
  'tm.catRemoved': 'Remove category “{name}”',
  'tm.catRenamed': 'Rename category: {from} → {to}',
  'tm.catRecolor': 'Color of “{name}” → {to}',
  'tm.catNote': 'Only the categories section of _site.yml changes; other settings and comments stay. You can undo after writing.',
  'tm.lostComments': 'Note: {n} comment lines inside the categories section will be lost (comments elsewhere stay).',
  'tm.previewCats': 'Confirm category changes',
  'tm.newBtn': '+ New topic',
  'tm.catsBtn': 'Manage categories',
  'tm.editBtn': 'Edit',
  'table.modeLabel': 'Table content',
  'table.mode.notes': 'Notes',
  'table.mode.topics': 'Topics',
  'table.topicCount': '{n} topics',
  'table.topicsHint': 'Changes the settings files (_topic.yml, _site.yml), always with a preview first',
  'table.topicsReadonly': 'Read-only: open a local folder in Chrome or Edge to make changes',
  'table.notes': 'Notes',
  'table.decks': 'Decks',
  'side.manage': 'Manage',
  'side.manageTitle': 'Manage topics and categories',
  'table.loading': 'Collecting note fields…',
  'table.title': 'Title',
  'table.topic': 'Topic',
  'table.book': 'Notebook',
  'table.date': 'Date',
  'table.tags': 'Tags',
  'table.count': '{n} / {total} notes',
  'table.clearTag': 'Clear tag filter',
  'table.readonly': 'Read-only: columns come from each note’s front matter; edit the note to change them',
  'table.groupBy': 'Group by',
  'table.layoutLabel': "Layout",
  'table.layout.table': "Table",
  'table.layout.kanban': "Kanban",
  'table.layout.calendar': "Calendar",
  'table.layout.cards': "Cards",
  'table.boardBy': "Board",
  'table.boardAll': "All",
  'table.boardNone': "Not on any board",
  'table.cardsHint': "One card per note; below it, the boards it is on (click to open it there)",
  'table.sortBy': "Sort",
  'table.sortAsc': "Ascending",
  'table.sortDesc': "Descending",
  'table.openOnBoard': "Open it on this board",
  'table.addToBoard': "+ Add to board",
  'table.addToBoardTitle': "Add to board",
  'table.alreadyOnBoard': "Already on “{name}”",
  'table.addedToBoard': "Added to “{name}”",
  'table.openBoard': "Open board",
  'table.kanbanBy': "Columns",
  'table.calPrev': "Previous month",
  'table.calNext': "Next month",
  'table.calToday': "This month",
  'table.calMonthList': "Notes this month ({n})",
  'table.calNone': "No notes this month. Use ‹ › to change months.",
  'table.calUndated': "{n} more notes have no date and are not on the calendar.",
  'table.group.none': 'No grouping',
  'table.group.category': 'Category',
  'table.group.topic': 'Topic',
  'table.group.book': 'Notebook',
  'table.group.year': 'Year',
  'table.group.month': 'Month',
  'table.group.tags': 'Tag',
  'table.groupEmpty': '(none)',
  'table.foldAll': 'Collapse all',
  'table.unfoldAll': 'Expand all',
  'table.empty': 'No matching notes',
  'table.private': 'Not public',
  'shelf.otherCategory': 'Other',
  'shelf.newNote': '+ Note',
  'shelf.readonly': 'Read-only',
  'shelf.readonlyTip': 'This library is read-only, so you cannot create or save notes. Use Chrome or Edge, click “Open a local folder” on the home page and allow write access.',
  'shelf.readonlyBrowserTip': 'This browser cannot save files, so you can only read and play. To create notes, use Chrome or Edge (Brave turns this feature off by default).',
  'move.more': 'More ▾',
  'move.moreTitle': 'Rename, move, archive',
  'move.rename': 'Rename…',
  'move.move': 'Move to another folder…',
  'move.archive': 'Archive…',
  'move.renameTitle': 'Rename',
  'move.renameHint': 'Changes the title and the file name (keeping any date or number prefix) and updates [[links]] to this note. The next step lists the files that will change.',
  'move.newTitle': 'New title',
  'move.next': 'Next',
  'move.moveTitle': 'Move to another folder',
  'move.moveHint': 'Links written with the title keep working; links written with a path are updated. Relative image paths in the note are adjusted.',
  'move.dest': 'Move to',
  'move.nothing': 'Nothing to change.',
  'move.summaryRename': 'Rename “{from}” to “{title}”\nNew file: {to}',
  'move.summaryMove': 'Move “{from}” to\n{to}',
  'move.summaryLinks': '{links} link(s) in {files} file(s) will be updated:',
  'move.summaryNoLinks': 'No other files need updating.',
  'move.andMore': '…and {n} more',
  'move.doRename': 'Rename',
  'move.doMove': 'Move',
  'move.exists': 'A file with that name already exists at the destination. Nothing was changed.',
  'move.done': 'Done: {path} ({links} link(s) updated)',
  'move.partial': 'The note was moved, but links in {n} file(s) could not be updated: {files}. Use “Check” to find the remaining links.',
  'move.archiveAsk': 'Move “{path}” to _archive/notes/?\nThe file is not deleted; you can move it back yourself.',
  'move.archiveRefs': '{n} note(s) or deck(s) link here; those links will break (Check will list them):',
  'move.doArchive': 'Archive',
  'move.archived': 'Archived to {path}',
  'privacy.button': '🔒 Pre-publish check',
  'privacy.buttonTitle': 'Which notes will be public, and where personal data might be',
  'privacy.title': 'Pre-publish check',
  'privacy.scanning': 'Reading every note and slide…',
  'privacy.ok': 'No personal data found in content that will be public',
  'privacy.bad': '{n} public file(s) may contain personal data',
  'privacy.counts': '{public} public · {private} private · {localOnly} local-only',
  'privacy.rule': 'Rule: the note’s public → notebook → topic → otherwise private; local_only topics are never public. Decks have no public setting and become public once on GitHub.',
  'privacy.visitorOn': 'Browse as a visitor',
  'privacy.visitorOff': 'Exit visitor view',
  'privacy.visitorHint': 'Shows only notes and decks that will be public: what others see on GitHub Pages.',
  'privacy.visitorBar': 'Visitor view: showing only content that will be public',
  'privacy.piiHeading': 'Possible personal data',
  'privacy.piiNote': 'A reminder only, nothing is blocked. Matches email addresses, Taiwanese mobile numbers and national IDs; example domains and code blocks are ignored. Masked on screen.',
  'privacy.exposed': 'public',
  'privacy.hidden': 'not public',
  'privacy.line': 'line {n}',
  'privacy.kind.email': 'Email',
  'privacy.kind.phone': 'Mobile',
  'privacy.kind.tw-id': 'National ID',
  'privacy.noPII': 'No possible personal data found.',
  'privacy.publicList': 'Notes that will be public ({n})',
  'privacy.noPublic': 'No notes will be public.',
  'privacy.hiddenTitle': 'Visitors cannot see this note',
  'privacy.hiddenText': 'It is private or in a local-only topic. Exit visitor view to see it.',
  'board.heading': 'Boards',
  'board.new': '+ New board',
  'board.newTitle': 'New board',
  'board.newName': 'Name',
  'board.newPlaceholder': 'e.g. Reading plan',
  'board.create': 'Create',
  'board.open': 'Open board: {name}',
  'board.notFound': 'Board “{name}” not found (it should be in the boards/ folder).',
  'board.aria': 'Board {name}',
  'board.readonly': 'Read-only: view only',
  'board.addText': '+ Text',
  'board.addTextTitle': 'Add a text card (or double-click empty space)',
  'board.addCard': '+ Note or deck',
  'board.addCardTitle': 'Put a note or a deck on the board',
  'board.pick': 'Choose',
  'board.add': 'Add',
  'board.noChoices': 'This library has no notes or decks yet.',
  'board.undo': 'Undo (Ctrl+Z)',
  'board.zoomIn': 'Zoom in',
  'board.zoomOut': 'Zoom out',
  'board.zoomReset': 'Back to 100% (press 0)',
  'board.fit': 'Fit',
  'board.fitTitle': 'Fit all cards on screen (press F)',
  'board.empty': 'This board is empty.',
  'board.emptyEdit': 'This board is empty. Double-click anywhere to add text, or use “+ Note or deck” above.',
  'board.hint': 'Drag to pan · Ctrl+wheel to zoom · F to fit · Ctrl+F to search',
  'board.hintEdit': 'Drag to move (snaps; Alt to skip) · Shift+click or drag to multi-select · drag dots to connect · double-click to add or edit · Ctrl+C/V/D · Ctrl+F search · Ctrl+Z undo',
  'board.kindNote': 'Note',
  'board.kindDeck': 'Deck',
  'board.kindLink': 'Link',
  'board.kindMissing': 'File not found',
  'board.editText': 'Edit text (Ctrl+Enter or Esc to finish)',
  'board.edgeTitle': 'Connection label',
  'board.edgeLabel': 'Text (leave empty to hide)',
  'board.unsaved': 'Unsaved',
  'board.saving': 'Saving…',
  'board.saved': 'Saved',
  'board.denied': 'No write permission; auto-save paused',
  'board.deniedLong': 'No write permission, so nothing was saved and auto-save is paused (you won’t be asked again and again). When you want to save, press “Retry save” or Ctrl+S, then “Allow”.',
  'board.retrySave': 'Retry save',
  'board.saveFailed': 'Save failed',
  'board.stale': 'Changed elsewhere; autosave stopped',
  'board.staleLong': 'This board was changed somewhere else. To avoid overwriting those changes, autosave has stopped; reload the page before editing.',
  'note.onBoards': 'On these boards',
  'board.addLink': '+ URL',
  'board.addLinkTitle': 'Add a URL: a link card, or embed a web page, a video or Google Slides',
  'board.addFile': '+ Image or file',
  'board.addFileTitle': 'Images, HTML, PDF (you can also drop files on the board or paste a screenshot)',
  'board.linkHint': 'You can paste the whole embed code from Google Slides “Publish to the web”. YouTube and Google Slides embed automatically.',
  'board.urlLabel': 'URL',
  'board.linkMode': 'Show as',
  'board.linkCard': 'Link card',
  'board.embedWeb': 'Embed web page',
  'board.urlBad': 'Enter a URL starting with http:// or https://.',
  'board.httpsOnly': 'Only https pages can be embedded; showing a link card for now.',
  'board.editUrl': 'URL',
  'board.present': '▶ Present',
  'board.presentTitle': 'Zoom into each group in turn (or each card if there are no groups); ←/→ to move, Esc to exit',
  'board.presentExit': 'Exit',
  'board.full': 'Full screen',
  'board.fullExit': 'Exit full screen',
  'board.fullTitle': 'Fill the whole screen. Open the toolbar with the ☰ button at the top right; Esc leaves',
  'board.menu': 'Show / hide toolbar',
  'board.more': 'More ▾',
  'board.moreTitle': 'Links, images, drawing, present, export and zoom',
  'board.minimap': 'Minimap',
  'board.minimapTitle': 'Minimap: click or drag to move there (M)',
  'board.ctxTitle': 'More actions',
  'board.ctxOpen': 'Open',
  'board.ctxPeek': 'Open in side panel',
  'board.ctxPage': 'Open note page',
  'board.fold': 'Fold',
  'board.unfold': 'Unfold',
  'board.foldTitle': 'Show only the title (unfold restores the height)',
  'board.unfoldTitle': 'Unfold to the previous height',
  'board.fitContent': 'Fit to content',
  'board.fitContentTitle': 'Resize the card to fit its content',
  'board.onBoardsTitle': 'This note appears on {n} boards',
  'board.onBoardsHead': 'On {n} boards',
  'board.onBoardsHere': 'this one',
  'peek.aria': 'Side card panel',
  'peek.edit': 'Edit',
  'peek.editTitle': 'Edit this note in the panel (Ctrl+S to save, Esc to cancel)',
  'peek.add': '+ Add to board',
  'peek.addTitle': 'Put this note on this board',
  'peek.pageTitle': 'Open note page',
  'peek.closeTitle': 'Close panel (Esc)',
  'peek.readFailed': 'Could not read this note. It may have been renamed, moved or archived.',
  'peek.discardAsk': 'Discard unsaved changes? (A draft stays on this computer.)',
  'peek.discard': 'Discard',
  'board.ctxFocus': 'Zoom to this',
  'board.ctxCopy': 'Copy',
  'board.ctxCut': 'Cut',
  'board.ctxDup': 'Duplicate',
  'board.ctxFront': 'Bring to front',
  'board.ctxBack': 'Send to back',
  'board.paste': 'Paste',
  'board.ctxGroup': 'Wrap in a group',
  'board.ctxUrl': 'Edit link',
  'board.ctxGroupLabel': 'Rename group',
  'board.ctxEdgeText': 'Edit connection text',
  'board.pin': 'Keep toolbar visible',
  'board.prev': 'Previous',
  'board.next': 'Next',
  'board.loadEmbed': 'Load',
  'board.interact': 'Interact',
  'board.interactTitle': 'Let the mouse operate inside the card (press again to drag the board)',
  'board.fullscreen': 'Show this card full screen',
  'board.openTab': 'Open in a new tab',
  'board.embedFailed': 'Could not load. Use ↗ to open it in a new tab.',
  'board.scripts': 'Allow scripts',
  'board.scriptsTitle': 'Code in the HTML runs in an isolated frame and cannot reach your library; enable only for files you trust',
  'board.scriptsOn': 'scripts on',
  'board.edgeText': 'Label',
  'board.editShort': 'Edit',
  'board.groupLabel': 'Group name',
  'board.color': 'Colour',
  'board.remove': 'Remove',
  'board.removeTitle': 'Remove from the board (the file is kept)',
  'board.toNote': 'Turn into a note',
  'board.toNoteHint': 'Creates a new note and replaces the card with a note card; connections stay.',
  'board.toNoteDone': 'Created note {path}',
  'board.fileType': '“{name}” cannot go on a board: only images, HTML and PDF.',
  'board.fileTooLarge': '“{name}” is too large: HTML up to 500 KB, others up to 5 MB.',
  'board.draw': '✎ Draw',
  'board.drawTitle': 'Draw with a pen; it becomes an image card',
  'board.drawing': 'Drawing',
  'board.drawDone': 'Done',
  'board.search': 'Search',
  'board.searchTitle': 'Search the board (Ctrl+F)',
  'board.searchPlaceholder': 'Search card text, titles, URLs…',
  'board.searchCount': '{i} / {n}',
  'board.export': 'Export',
  'board.exportTitle': 'Export as an image',
  'board.exportFormat': 'Format',
  'board.exportScope': 'Scope',
  'board.exportSel': 'The {n} selected',
  'board.exportAll': 'The whole board',
  'board.selected': '{n} selected',
  'board.groupUnnamed': "Group",
  'board.groupUnnamedEdit': "Untitled group (double-click to rename)",
  'board.ungroup': "Ungroup",
  'board.ungroupTitle': "Ungroup (removes only the frame; cards stay)",
  'board.makeGroupKey': "Put the selected cards in a group ({key})",
  'board.makeGroup': 'Group',
  'board.makeGroupTitle': 'Put this card in a group',
  'board.align.left': 'Align left',
  'board.align.hcenter': 'Center horizontally',
  'board.align.right': 'Align right',
  'board.align.top': 'Align top',
  'board.align.vcenter': 'Center vertically',
  'board.align.bottom': 'Align bottom',
  'board.distH': 'Distribute horizontally',
  'board.distV': 'Distribute vertically',
  'board.outline': 'Turn into an outline note',
  'board.outlineView': "Outline",
  'board.outlineViewTitle': "List groups, cards and connections; click an item to jump to its card",
  'board.outlineLoose': "Ungrouped",
  'board.outlineEmpty': "This board has no cards yet.",
  'board.outlineSave': "Save as note",
  'board.outlineSaveTitle': "Save the outline of the whole board as a new note",
  'board.outlineCopy': "Copy",
  'board.outlineCopyTitle': "Copy the outline as Markdown",
  'board.outlineCopied': "Outline copied as Markdown.",
  'board.outlineCopyFailed': "Could not copy: the browser did not allow clipboard access.",
  'board.outlineSaved': "Outline saved as a note.",
  'board.pdfPage': "Page",
  'board.pdfPageN': "p. {n}",
  'board.pdfPageTitle': "Open at page",
  'board.pdfPageLabel': "Page (leave empty for the first page)",
  'board.pdfPageBad': "The page must be a whole number from 1.",
  'board.outlineTitle': 'List the cards in this group by position as a Markdown outline in a new note',
  'board.outlineEdge': 'outline',
  'board.copied': 'Copied {n}',
  'board.cut': 'Cut {n}',
  'board.kindImage': 'Image',
  'shelf.newNoteTitle': 'Create a note',
  'shelf.emptyTopics': 'Topics with nothing in them yet: {list}',
  'shelf.emptyLibrary': 'This library is empty. Put .md files in a topic folder under notes/ or slides/, then press Refresh.',
  'shelf.fullText': 'Notes matching in the text ({n})',
  'shelf.urgent': 'Pinned',
  'shelf.until': 'until {date}',
  'shelf.countNotes': '{n} notes',
  'shelf.countDecks': '{n} decks',
  'shelf.dot': ' · ',
  'shelf.localOnly': 'Local only',
  'shelf.localOnlyTitle': 'This topic is local_only and must not be pushed to GitHub',
  'shelf.publicTopic': 'Public by default',
  'shelf.emptyTopic': 'Nothing yet',
  'book.count': '{n} notes',
  'book.status.reading': 'Reading',
  'book.status.done': 'Finished',
  'book.status.paused': 'Paused',
  'book.status.other': '{status}',
  'note.crumbs': 'Location',
  'note.chapters': 'Notes in this notebook',
  'note.inTopic': 'Notes in this topic',
  'note.public': 'Public',
  'note.private': 'Private',
  'note.localOnly': 'Local only',
  'note.publicTitle': 'This note resolves to public (note > notebook > topic)',
  'note.privateTitle': 'This note is private; do not push it to GitHub',
  'note.localOnlyTitle': 'This topic stays on this computer only',
  'note.pinned': 'Pinned',
  'note.pinnedUntil': 'Pinned · until {date}',
  'note.sourceLabel': 'Source: ',
  'note.prev': 'Previous',
  'note.next': 'Next',
  'note.flash': 'Flash play',
  'note.flashTitle': 'Play this note as slides for now (P). No files are created',
  'note.edit': 'Edit',
  'note.editTitle': 'Edit this note (E)',
  'note.smaller': 'Smaller text',
  'note.larger': 'Larger text',
  'note.scaleReset': 'Text size. Click to reset to 100%',
  'note.immersive': 'Focus reading',
  'note.immersiveTitle': 'Hide menus, keep only the text, and go full screen (F)',
  'rd.chapters': 'Chapters',
  'rd.toolbar': 'Focus reading tools',
  'rd.menu': 'Show / hide toolbar',
  'rd.fullscreen': 'Full screen',
  'rd.exit': 'Leave focus',
  'note.toc': 'Contents',
  'note.backlinks': 'Backlinks',
  'note.indexing': 'Indexing…',
  'note.indexFailed': 'Indexing failed. Please reload.',
  'note.noBacklinks': 'No other notes link here yet.',
  'note.usedByDecks': 'Used by these decks',
  'note.viaSource': 'promoted from this note',
  'note.viaLink': 'linked from a slide',
  'note.linkMissing': 'This link has no target',
  'note.linkAmbiguous': '{n} targets share this name; the closest one was chosen',
  'note.linkMissingToast': 'Nothing called “{link}”. It may not exist yet, or was renamed.',
  'note.linkAmbiguousToast': '{n} targets share this name; opened the closest one.',
  'ne.docTitle': 'Editing: {title}',
  'ne.back': '← Back to note',
  'ne.toolbar': 'Insert',
  'ne.bold': 'Bold (Ctrl+B)',
  'ne.boldSample': 'bold',
  'ne.heading': 'Heading',
  'ne.list': 'List item',
  'ne.task': 'Task',
  'ne.quote': 'Quote',
  'ne.link': 'Link to a note or deck',
  'ne.save': 'Save',
  'ne.saveTitle': 'Save (Ctrl+S)',
  'ask.prompt': "Below are {n} cards from a board in my note app (Markdown). {groups}\n\nMy question: {question}\n\nAnswer only from this material; where it is not enough, say what is missing instead of making things up.\n\n{cards}\n{links}\n{neighbors}",
  'ask.defaultQuestion': "Summarize the key points of these cards, point out how they connect or contradict each other, and suggest 3 questions worth exploring next.",
  'ask.groups': "They are in these groups: {list}.",
  'ask.card': "=== Card: {title} ===\n{text}\n",
  'ask.untitled': "(untitled)",
  'ask.empty': "(empty)",
  'ask.omitted': "(too long; content left out)",
  'ask.linksHead': "--- Links between the cards ---",
  'ask.link': "· {from} → {to}{label}",
  'ask.via': " ({label})",
  'ask.neighborsHead': "--- Other cards linked to these (opening only) ---",
  'ask.neighbor': "· {title}{label}: {text}",
  'ask.title': "Ask AI",
  'ask.lead': "The text of {n} cards (plus the opening of {m} cards linked to them) becomes a prompt, copied to the clipboard, and the AI you pick opens. Leafpile never sends anything by itself.",
  'ask.question': "Your question (optional)",
  'ask.questionPh': "Leave empty to get key points, connections and questions",
  'ask.privateAsk': "This includes {n} private notes. Copying them to an AI hands their content to that website. Continue?",
  'ask.privateOk': "Yes, copy",
  'ask.copied': "Prompt copied. Paste it into the AI.",
  'ask.copyFailed': "The browser blocked copying; copy it by hand in the next window",
  'ask.manualTitle': "Copy the prompt",
  'ask.none': "The selection has no text to ask about (images, web pages and PDFs are not included)",
  'ask.menu': "Ask AI…",
  'ask.button': "Ask AI",
  'ask.buttonTitle': "Turn this note (and the cards linked to it on the board) into a prompt for an AI",
  'journal.title': "Journal {date}",
  'journal.palette': "Today’s journal",
  'journal.today': "Today’s journal",
  'journal.todayTitle': "Open today’s journal, creating it if needed (private by default)",
  'journal.dayTitle': "Journal for {date} (open or create)",
  'journal.created': "Journal created: {path}",
  'journal.none': "No journal for {date} yet (this library is read-only)",
  'capture.title': "Capture to inbox",
  'capture.hint': "One line is enough. It becomes a new note in “{topic}”; the first line is the title. Sort it out later.",
  'capture.label': "What’s on your mind",
  'capture.placeholder': "e.g. The reading group could discuss the counterexample in chapter 3",
  'capture.save': "Save",
  'capture.empty': "Nothing written, nothing saved",
  'capture.done': "Saved to the inbox: {title}",
  'capture.open': "Open",
  'capture.palette': "Capture to inbox (quick capture)",
  'slash.col': "Col {n}",
  'slash.aria': "Format menu",
  'slash.head': "Insert",
  'slash.h1': "Heading 1",
  'slash.h2': "Heading 2",
  'slash.h3': "Heading 3",
  'slash.bullet': "Bullet list",
  'slash.number': "Numbered list",
  'slash.todo': "To-do list",
  'slash.quote': "Quote",
  'slash.code': "Code block",
  'slash.table': "Table",
  'slash.divider': "Divider",
  'slash.link': "Link to a note",
  'slash.embed': "Embed excerpt",
  'slash.highlight': "Highlight",
  'slash.image': "Image",
  'slash.date': "Today’s date",
  'slash.now': "Current time",
  'ne.saving': 'Saving…',
  'ne.saved': 'Saved',
  'ne.unsaved': 'Unsaved changes',
  'ne.savedToast': 'Saved to your folder',
  'ne.saveFailed': 'Could not save: {error}',
  'ne.denied': 'No permission to write. Choose Allow when the browser asks.',
  'ne.readonly': 'This library is read-only. Open the folder with Chrome or Edge to save changes.',
  'ne.readonlyRepo': 'Built-in examples cannot be saved here; edit them on GitHub instead.',
  'ne.editOnGitHub': 'Edit on GitHub',
  'ne.textLabel': 'Note text (Markdown)',
  'ne.suggest': 'Notes and decks you can link',
  'ne.draftTitle': 'Unsaved draft found',
  'ne.draftAsk': 'A draft from {time} is stored in this browser. Restore it?',
  'ne.draftRestore': 'Restore draft',
  'ne.draftDiscard': 'Discard draft',
  'ne.staleTitle': 'The file changed on disk',
  'ne.staleAsk': 'This file was changed elsewhere after you opened it. Overwrite it with your version, or load the new one? (Your version is kept as a draft if you load.)',
  'ne.staleReload': 'Load the new version',
  'ne.staleOverwrite': 'Overwrite with mine',
  'ne.reloadedKeptDraft': 'Loaded the new version; yours is kept as a draft.',
  'ne.leaveAsk': 'You have unsaved changes. Leave anyway? (A draft stays in this browser.)',
  'ne.leave': 'Leave',
  'newNote.title': 'New note',
  'newNote.name': 'Title',
  'newNote.placeholder': 'e.g. Atomic Habits, chapter 1',
  'newNote.topic': 'Topic',
  'newNote.create': 'Create',
  'newNote.needTitle': 'Please enter a title.',
  'newNote.exists': 'A note with this name already exists today.',
  'pack.button': 'Library pack',
  'pack.buttonTitle': 'Pack the library into a zip (backup or sharing), or import a pack from someone else or an AI',
  'pack.title': 'Library pack',
  'pack.lead': 'A library pack is a zip containing notes/, slides/, boards/ and _site.yml. Use it as a backup or send it to someone: they press "Open a zip library pack" on the home page to view it, nothing to install.',
  'pack.importNote': '"Export the public part" includes only notes judged public; decks follow their topic\'s default; boards are left out. Importing never overwrites your files, and you see a preview before anything is written.',
  'pack.readonlyNote': 'This library is read-only, so you can only export. To import, open your local folder in Chrome or Edge.',
  'pack.exportAll': 'Export the whole library',
  'pack.exportPublic': 'Export the public part',
  'pack.import': 'Import…',
  'pack.exporting': 'Packing…',
  'pack.empty': 'Nothing to export.',
  'pack.exported': 'Exported {n} files.',
  'pack.exportedPublic': 'Exported {n} public files (left out {priv} private ones). Run the pre-publish check before sharing.',
  'pack.importTitle': 'Import a library pack',
  'pack.importLead': 'Import from where? A zip file, an unzipped folder, or a text pack an AI gave you. Next you will see a preview; nothing is written until you confirm.',
  'pack.fromZip': 'Zip file',
  'pack.fromFolder': 'Folder',
  'pack.fromText': 'Paste text from an AI',
  'pack.pasteTitle': 'Paste a text library pack',
  'pack.pasteLead': 'Paste the AI\'s whole reply (text before and after is fine). Each file starts with "=== FILE: path ===" and ends with "=== END ===".',
  'pack.pasteLabel': 'Pack contents',
  'pack.next': 'Next',
  'pack.labelText': 'pasted text',
  'pack.noFilesInText': 'No files found in this text. Make sure each file starts with "=== FILE: path ===".',
  'pack.previewTitle': 'Import preview',
  'pack.summary': 'From {from}: {list}.',
  'pack.count.add': 'add {n}',
  'pack.count.rename': 'save {n} under a new name (same name as yours, different content)',
  'pack.count.merge': 'merge {n}',
  'pack.count.same': 'skip {n} identical',
  'pack.count.keep': 'keep your own settings for {n}',
  'pack.count.skip': 'leave out {n}',
  'pack.siteRestored': '_site.yml restored.',
  'pack.nothing': 'Nothing to write: {list}.',
  'pack.safeNote': 'None of your existing files will be overwritten or deleted. After importing, Undo moves the new files to _archive/.',
  'pack.lostComments': 'The categories block of _site.yml is rewritten, so {n} comment lines in it will be lost.',
  'pack.doImport': 'Import {n} files',
  'pack.sep': ', ',
  'pack.line.add': 'Add {path}',
  'pack.line.rename': 'Save {from} as {to} (same name, different content)',
  'pack.line.keep': 'Keep your own {path}',
  'pack.line.merge': '{path}: add categories {list}',
  'pack.line.deck': 'A deck with the same name but different content is saved to {path}',
  'pack.line.skip': 'Leave out {path} ({reason})',
  'pack.line.more': '…and {n} more',
  'pack.reason.archive': 'archive',
  'pack.reason.tool': 'tool file',
  'pack.reason.outside': 'not in notes/, slides/ or boards/',
  'pack.reason.type': 'unsupported file type',
  'pack.reason.duplicate': 'appears twice in the pack',
  'pack.reason.path': 'unsafe path',
  'pack.reason.size': 'file too large',
  'pack.reason.encrypted': 'encrypted file',
  'pack.reason.method': 'unsupported compression',
  'pack.imported': 'Imported {n} files.',
  'pack.someFailed': '{n} files were not written',
  'pack.undone': 'Undone: {n} files moved to {dir}.',
  'pack.zipError': 'This file is not a zip the library pack can read (it may be damaged, encrypted or too large).',
  'pack.failed': 'Library pack failed: {error}',
  'home.openZip': 'Open a zip library pack',
  'home.openZipTitle': 'A library pack (.zip) someone gave you: view it in any browser without unzipping (read-only)',
  'gen.button': "Generate with AI",
  'gen.buttonTitle': "Give your material to an AI you use (Claude, ChatGPT, Gemini) to generate a note, deck or board, then import it into this library",
  'gen.title': "Generate with AI",
  'gen.lead': "One kind at a time. Fill this in and press an AI below: the prompt is copied and a new tab opens. The prompt asks the AI to read Leafpile's library pack spec first and give you a zip to download.",
  'gen.note': "Your material goes only to the AI you choose; Leafpile sends it nowhere. Quality depends on the material: the more specific, the better.",
  'gen.kind': "What to generate",
  'gen.kind.note': "Note",
  'gen.kind.deck': "Deck",
  'gen.kind.board': "Board",
  'gen.topic': "Topic",
  'gen.newTopic': "(new topic: Inbox)",
  'gen.titleLabel': "Title",
  'gen.titlePh': "e.g. Atomic Habits, chapter 1",
  'gen.extra': "Extra requests (optional)",
  'gen.extraPh': "e.g. for beginners, about 8 slides, use bullet points",
  'gen.data': "Material (highlights, summaries, meeting notes, web text…), or leave it empty and upload files in the AI",
  'gen.dataAttached': "(The material is in the files I attached. If nothing is attached, ask me for it first; do not make things up.)",
  'gen.dataPh': "Paste material, or leave empty and upload a PDF, document or image after the AI opens",
  'gen.copyOnly': "Copy prompt only",
  'gen.open': "Open {name}",
  'gen.needTitle': "Please enter a title.",
  'gen.copied': "Prompt copied.",
  'gen.copyFailed': "Could not copy automatically; copy the prompt from the box in the next step.",
  'gen.pasteTitle': "Paste the AI’s reply",
  'gen.pasteLead': "{where}Paste the prompt into its input box with Ctrl+V (⌘V on Mac) and send it. To use files as material, drag them into the AI chat first. If the AI gives you a zip, press “Choose zip file”; if it gives text, paste all of it below. You will see a preview next; none of your files are overwritten.",
  'gen.whereOpened': "{name} is open. ",
  'gen.whereNone': "Use the AI you prefer. ",
  'gen.promptLabel': "Prompt (already copied; copy again if needed)",
  'gen.replyLabel': "The AI’s reply",
  'gen.replyPh': "=== FILE: notes/… ===\n…\n=== END ===",
  'gen.empty': "The reply is empty. Paste the AI’s whole reply, or choose the zip it gave you.",
  'gen.labelAI': "the AI reply",
  'gen.extraLine': "Extra requests: {extra}",
  'gen.specFailed': "Could not copy the spec. Copy docs/AI_PACK.md from GitHub by hand.",
  'gen.specCopied': "Spec copied. Paste it to the AI and say “follow this spec”.",
  'gen.copySpec': "Copy full spec",
  'gen.pickZip': "Choose zip file",
  'gen.what.board': "one board (concept map)",
  'gen.what.deck': "one deck",
  'gen.what.note': "notes (split long material into several notes plus an overview)",
  'gen.prompt': "First read the Leafpile library pack spec: {spec}\n(If you cannot open the link, tell me and I will paste it.)\n\nFollowing the spec, turn the material into {what}.\nTopic folder: {topicId} (topic name: {topic})\nTitle: {title}\n{extra}\nUse only what is in the material; mark anything uncertain as \"to be checked\".\nDeliver a zip file for me to download; if you cannot create files, use the text pack in section 7 of the spec.\n\nMaterial:\n{data}",
  'gen.inboxName': 'Inbox',
  'palette.generate': 'Generate a note, deck or board with AI',
  'palette.pack': 'Library pack (export or import)',
  'dialog.ok': 'OK',
  'dialog.cancel': 'Cancel',
  'palette.open': 'Command palette (Ctrl+K)',
  'palette.label': 'Command palette',
  'palette.placeholder': 'Search notes and decks, or type a command…',
  'palette.move': 'move',
  'palette.go': 'open',
  'palette.close': 'close',
  'palette.none': 'Nothing matches',
  'palette.flashThis': 'Flash play this note',
  'palette.editThis': 'Edit this note',
  'palette.newNote': 'New note',
  'palette.shelf': 'Go to the library page',
  'palette.check': 'Check this library',
  'palette.openFolder': 'Open a local folder',
  'palette.repo': 'Browse built-in examples',
  'palette.home': 'Home',
  'palette.lang': 'Switch language (中文 / English)',
  'palette.theme': 'Switch appearance (next theme)',
  'promote.noteHint': '(Promoted from a note; add what you will say on this slide.)',
  'promote.opening': 'Opening',
  'promote.end': 'Thank you',
  'promote.sourceComment': 'Leafpile: promoted from this note (independent afterwards; never synced)',
  'promote.usage': 'Usage: node scripts/promote.mjs <library> <path to a note or notebook> [--dry-run] [--author name]\nExample: node scripts/promote.mjs ~/my-library notes/10-reading/2026-11-book/01-ch1.md',
  'promote.notNote': '{path} is not under notes/, or does not exist.',
  'promote.exists': '{path} already exists and will not be overwritten. Rename or remove it first.',
  'promote.done': 'Created deck {path} ({sections} sections, {slides} slides). This is a one-time copy; it is independent of the note from now on.',
  'promote.dry': '(Preview only; nothing was written.)',
  'promote.button': 'Make a deck',
  'promote.buttonTitle': 'Copy this note into a new deck skeleton (independent afterwards)',
  'promote.ask': 'Create “{folder}” in slides/{topic}/? It will have {sections} sections and {slides} slides. This is a one-time copy: later edits to the note will not change the deck.',
  'promote.scope': 'What to promote',
  'promote.scopeNote': 'This note only',
  'promote.scopeBook': 'The whole notebook (one section per note)',
  'promote.create': 'Create deck',
  'distill.title': 'After the talk: {title}',
  'distill.lead': 'Generated from the outline and speaker notes of “{title}”. Add the Q&A and what to change next time.',
  'distill.tag': 'after-talk',
  'distill.outline': 'What was covered',
  'distill.qa': 'Q&A',
  'distill.q': 'Q:',
  'distill.a': 'A:',
  'distill.slideRef': '(slide {n})',
  'pv.qa': 'Q&A',
  'pv.qaPlaceholder': 'Jot down a question… (Enter to add, Shift+Enter for a new line)',
  'pv.qaAdd': 'Add',
  'pv.qaHint': 'Included automatically in the after-talk note.',
  'pv.qaDownload': 'Download Q&A',
  'pv.qaAnswer': 'Answer (fill in later if you like)',
  'pv.qaDelete': 'Delete',
  'pv.qaDeleteConfirm': 'Click again to delete',
  'pv.qaEmpty': 'No questions yet. Press Q to start.',
  'pv.qaSlide': 'Slide {n}',
  'pv.qaSaveFailed': 'Could not save Q&A (this browser blocks local storage)',
  'distill.withQA': 'It will include {n} question(s) recorded in the presenter view.',
  'distill.qaMissing': 'Cannot read the Q&A file {path}.',
  'distill.qaEmpty': 'No questions found in {path} (use the JSON downloaded from the presenter view, or plain text with “Q: question” and “A: answer” lines).',
  'distill.next': 'Next time',
  'distill.suffix': 'after-talk',
  'distill.usage': 'Usage: node scripts/after-talk.mjs <library> <path to a deck> [--dry-run] [--qa <file>]\nExample: node scripts/after-talk.mjs ~/my-library slides/10-reading/2026-11-share',
  'distill.notDeck': '{path} is not a deck folder under slides/.',
  'distill.done': 'Created after-talk note {path} (private by default).',
  'distill.action': 'Save this deck as an after-talk note',
  'distill.ask': 'Create the after-talk note “{file}” in notes/{topic}/? It holds the outline and speaker notes, and is private by default.',
  'distill.create': 'Create note',
  'bridge.needWrite': 'This needs a writable library: open the folder with Chrome or Edge.',
  'bridge.needVault': 'This needs a Leafpile library (a folder with notes/ and slides/).',
  'embed.missing': '{n} excerpts could not find their note and are shown as written.',
};
return { LOCALE_EN };
})();

// ───────── app/core/i18n.js ─────────
__m["app/core/i18n.js"] = (() => {
// 介面語言(瀏覽器與 Node 共用)。字串表在 locales/,新增文字時兩份都要加。
//
// 兩種語言分開決定:
//   介面語言:使用者選擇 → 瀏覽器語言(zh 開頭 = 繁中,其他 = 英文)→ 繁中
//   簡報語言:deck.yml 的 lang → 標題等文字含中日韓字元 = 繁中,否則英文
// 簡報語言只影響「自動產生的投影片文字」(謝謝、大綱…)與英文字型,不受介面語言影響。

const { LOCALE_ZH_HANT } = __m["app/core/locales/zh-Hant.js"];
const { LOCALE_EN } = __m["app/core/locales/en.js"];
const LANGS = ['zh-Hant', 'en'];
const TABLES = { 'zh-Hant': LOCALE_ZH_HANT, en: LOCALE_EN };
let current = 'zh-Hant';

/** 把各種寫法(zh-TW、zh_hant、en-US…)整理成支援的語言代碼;不支援時回傳 null。 */
function normalizeLang(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  if (v.startsWith('zh')) return 'zh-Hant';
  if (v.startsWith('en')) return 'en';
  return null;
}

function setLang(lang) { current = normalizeLang(lang) || 'zh-Hant'; return current; }
function getLang() { return current; }

/** 取字串。lang 省略時用目前介面語言;找不到時退回繁中,再退回鍵名本身。 */
function t(key, params, lang) {
  const table = TABLES[normalizeLang(lang) || current];
  let s = table[key] ?? TABLES['zh-Hant'][key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** 簡報語言:明確設定優先;否則看標題、副標、資料夾與章節名稱是否含中日韓字元。 */
function detectDeckLang(explicit, ...texts) {
  return normalizeLang(explicit) || (texts.some(s => CJK.test(String(s ?? ''))) ? 'zh-Hant' : 'en');
}
return { LANGS, normalizeLang, setLang, getLang, t, detectDeckLang };
})();

// ───────── app/core/yaml.js ─────────
__m["app/core/yaml.js"] = (() => {
// 精簡 YAML 解析器:只支援設定檔需要的子集,零依賴。
//
// 支援:
//   key: value            字串、數字、布林、null、引號字串
//   巢狀物件              以縮排表示
//   - item / - key: v     清單與「物件清單」
//   [a, b, c]             行內陣列
//   key: |                多行文字(保留換行);> 會把換行併成空白
//   # 註解
// 不支援:錨點、標籤、多文件、行內物件 {}。
// 解析失敗時丟出 YamlError(含行號),呼叫端負責轉成使用者看得懂的提示。

const { t } = __m["app/core/i18n.js"];
class YamlError extends Error {
  constructor(message, line) {
    super(line ? t('yaml.line', { line, message }) : message);
    this.line = line;
  }
}

function parseYaml(text) {
  const lines = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
    const stripped = stripComment(raw);
    if (!stripped.trim()) { lines.push({ blank: true, raw, no: i + 1 }); return; }
    if (/^\t/.test(raw)) throw new YamlError(t('yaml.tab'), i + 1);
    lines.push({ indent: stripped.match(/^ */)[0].length, text: stripped.trim(), raw, no: i + 1 });
  });
  const state = { lines, i: 0 };
  skipBlank(state);
  if (state.i >= lines.length) return {};
  const value = parseBlock(state, lines[state.i].indent);
  skipBlank(state);
  if (state.i < lines.length) throw new YamlError(t('yaml.inconsistent'), lines[state.i].no);
  return value;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function skipBlank(s) { while (s.i < s.lines.length && s.lines[s.i].blank) s.i++; }

function parseBlock(s, indent) {
  skipBlank(s);
  const first = s.lines[s.i];
  return first.text.startsWith('- ') || first.text === '-' ? parseList(s, indent) : parseMap(s, indent);
}

function parseMap(s, indent) {
  const obj = {};
  while (true) {
    skipBlank(s);
    const ln = s.lines[s.i];
    if (!ln || ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlError(t('yaml.tooDeep'), ln.no);
    if (ln.text.startsWith('- ')) throw new YamlError(t('yaml.notList'), ln.no);
    const m = ln.text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
    if (!m) throw new YamlError(t('yaml.unknown', { text: ln.text }), ln.no);
    const key = unquote(m[1]);
    const rest = m[2] ?? '';
    s.i++;
    obj[key] = parseValueAfterKey(s, indent, rest, ln.no);
  }
  return obj;
}

function parseList(s, indent) {
  const arr = [];
  while (true) {
    skipBlank(s);
    const ln = s.lines[s.i];
    if (!ln || ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlError(t('yaml.tooDeep'), ln.no);
    if (!(ln.text.startsWith('- ') || ln.text === '-')) break;
    const rest = ln.text === '-' ? '' : ln.text.slice(2).trim();
    if (!rest) { s.i++; skipBlank(s); arr.push(s.lines[s.i] && s.lines[s.i].indent > indent ? parseBlock(s, s.lines[s.i].indent) : null); continue; }
    // 「- key: value」才算物件;「- https://x」這種冒號後面沒有空白的不算
    if (/^("[^"]*"|'[^']*'|[^"'\[\s][^:]*?)\s*:(\s|$)/.test(rest)) {
      // 物件清單:把「- 」後面當成縮排 +2 的物件第一行
      const childIndent = ln.indent + 2;
      s.lines[s.i] = { ...ln, indent: childIndent, text: rest };
      arr.push(parseMap(s, childIndent));
    } else {
      s.i++;
      arr.push(scalar(rest, ln.no));
    }
  }
  return arr;
}

function parseValueAfterKey(s, indent, rest, no) {
  if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') return blockScalar(s, indent, rest[0] === '>');
  if (rest !== '') return scalar(rest, no);
  skipBlank(s);
  const next = s.lines[s.i];
  if (next && next.indent > indent) return parseBlock(s, next.indent);
  if (next && next.indent === indent && next.text.startsWith('- ')) return parseList(s, indent);
  return null;
}

function blockScalar(s, indent, fold) {
  const out = [];
  let base = null;
  while (s.i < s.lines.length) {
    const ln = s.lines[s.i];
    if (ln.blank) { out.push(''); s.i++; continue; }
    if (ln.indent <= indent) break;
    if (base == null) base = ln.indent;
    out.push(ln.raw.slice(base));
    s.i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return fold ? out.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : out.join('\n');
}

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function scalar(v, no) {
  v = v.trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new YamlError(t('yaml.array'), no);
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map(x => scalar(x, no));
  }
  if (/^["']/.test(v)) return unquote(v);
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^(null|~)$/i.test(v)) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function splitTopLevel(s) {
  const out = []; let cur = '', q = null, depth = 0;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
return { YamlError, parseYaml };
})();

// ───────── app/core/names.js ─────────
__m["app/core/names.js"] = (() => {
// 檔名與路徑的共用規則。瀏覽器與 Node 腳本都會用到,請保持零依賴。

/** 以 `/` 串接路徑片段,忽略空字串。 */
function join(...parts) {
  return parts.filter(p => p !== '' && p != null).join('/').replace(/\/+/g, '/');
}

/** 取得副檔名(小寫、不含點)。 */
function ext(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 底線或點開頭 = 草稿或系統檔,解析時略過(設定檔另外處理)。 */
function isHidden(name) {
  return name.startsWith('.') || name.startsWith('_');
}

/** 保留名稱:這些資料夾只放素材,不會被當成章節。 */
const RESERVED_DIRS = new Set(['media', 'assets', 'images', 'img', 'video', 'videos', 'node_modules']);

/** 不當成投影片的 MD 檔(說明文件)。 */
function isDocFile(name) {
  return /^(readme|agents|claude|license|changelog)(\..*)?$/i.test(name);
}

function isMarkdown(name) {
  return ext(name) === 'md' && !isHidden(name) && !isDocFile(name);
}

/**
 * 拆出排序前綴:`01-問題` → { order: 1, label: '問題' }。
 * 沒有前綴時 order 為 null,label 為原名(去掉副檔名)。
 */
function splitOrder(name) {
  const base = name.replace(/\.(md|ya?ml)$/i, '');
  // 日期前綴 `2026-11-筆記`、`2026-11-20 讀書會`:不是排序數字,而是日期
  const d = base.match(/^(\d{4}-\d{2}(?:-\d{2})?)[\s._-]+(.+)$/);
  if (d) return { order: null, date: d[1], label: d[2].trim() };
  const m = base.match(/^(\d+)[\s._-]+(.+)$/);
  return m ? { order: Number(m[1]), label: m[2].trim() } : { order: null, label: base };
}

/** 依前綴數字排序,沒有前綴的依名稱排在後面。 */
function byOrder(a, b) {
  const A = splitOrder(a.name), B = splitOrder(b.name);
  if (A.order != null && B.order != null && A.order !== B.order) return A.order - B.order;
  if (A.order != null && B.order == null) return -1;
  if (A.order == null && B.order != null) return 1;
  return a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
}

/** 連結是否為外部網址。 */
function isURL(s) {
  return /^(https?:)?\/\//i.test(s) || /^data:/i.test(s);
}
return { join, ext, isHidden, RESERVED_DIRS, isDocFile, isMarkdown, splitOrder, byOrder, isURL };
})();

// ───────── app/core/media.js ─────────
__m["app/core/media.js"] = (() => {
// 判斷媒體類型:本機圖片 / 本機影片 / 線上嵌入(YouTube、Bilibili、Google Drive、Vimeo)/
// 互動網頁(GitHub Pages、CodePen、簡報資料夾裡的 .html 檔)。

const { ext, isURL } = __m["app/core/names.js"];
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const PAGE = new Set(['html', 'htm']);

/**
 * @returns {{ kind: 'image'|'video'|'audio'|'embed'|'page'|'unknown', src: string, provider?: string, embed?: string, thumb?: string, interactive?: boolean, remote: boolean }}
 */
/** 影片網址裡的開始時間(t=90、t=90s、t=1m30s、t=1h2m3s、start=90)→ 秒數;沒有就是 0。 */
function startSeconds(url) {
  const m = String(url || '').match(/[?&#](?:t|start)=([\dhms]+)/i);
  if (!m) return 0;
  if (/^\d+$/.test(m[1])) return +m[1];
  const p = m[1].match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  return p ? (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0) : 0;
}

function classifyMedia(src) {
  const s = src.trim();
  const remote = isURL(s);
  if (remote) {
    let m;
    if ((m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/))) {
      const t = startSeconds(s);
      return { kind: 'embed', src: s, remote, provider: 'YouTube',
        embed: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1${t ? `&start=${t}` : ''}`,
        thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
    }
    if ((m = s.match(/bilibili\.com\/video\/(BV[\w]+|av\d+)/i)) || (m = s.match(/b23\.tv\/(BV[\w]+)/i))) {
      const id = m[1];
      const q = id.startsWith('av') ? `aid=${id.slice(2)}` : `bvid=${id}`;
      const p = s.match(/[?&]p=(\d+)/);
      return { kind: 'embed', src: s, remote, provider: 'Bilibili',
        embed: `https://player.bilibili.com/player.html?${q}&page=${p ? p[1] : 1}&autoplay=0&high_quality=1${startSeconds(s) ? `&t=${startSeconds(s)}` : ''}` };
    }
    if ((m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/))) {
      return { kind: 'embed', src: s, remote, provider: 'Google Drive', embed: `https://drive.google.com/file/d/${m[1]}/preview` };
    }
    if ((m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
      return { kind: 'embed', src: s, remote, provider: 'Vimeo', embed: `https://player.vimeo.com/video/${m[1]}${startSeconds(s) ? `#t=${startSeconds(s)}s` : ''}` };
    }
    // 互動網頁:CodePen 的作品(顯示執行結果)、GitHub Pages 上的網頁
    if ((m = s.match(/^https:\/\/codepen\.io\/([\w-]+)\/(?:pen|full|details|embed)\/([\w-]+)/i))) {
      return { kind: 'embed', src: s, remote, provider: 'CodePen', interactive: true,
        embed: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result&editable=false` };
    }
    const path = s.split(/[?#]/)[0];
    if (/^https:\/\/[\w-]+\.github\.io(\/|$)/i.test(s) && !IMAGE.has(ext(path)) && !VIDEO.has(ext(path)) && !AUDIO.has(ext(path))) {
      return { kind: 'embed', src: s, remote, provider: 'GitHub Pages', interactive: true, embed: s };
    }
  }
  const e = ext(s.split(/[?#]/)[0]);
  if (!remote && PAGE.has(e)) return { kind: 'page', src: s, remote, provider: 'HTML', interactive: true };
  if (IMAGE.has(e)) return { kind: 'image', src: s, remote };
  if (VIDEO.has(e)) return { kind: 'video', src: s, remote };
  if (AUDIO.has(e)) return { kind: 'audio', src: s, remote };
  if (/^data:image\//.test(s)) return { kind: 'image', src: s, remote: true };
  return { kind: remote ? 'image' : 'unknown', src: s, remote };
}

/**
 * 素材路徑規則:
 *   media/a.jpg   → 相對於「簡報資料夾」(建議寫法,任何章節都通用)
 *   ./a.jpg       → 相對於這個 MD 檔所在的資料夾
 *   ../x/a.jpg    → 同上,可往上
 *   /a.jpg        → 相對於簡報資料夾
 */
function resolveMediaPath(src, { projectPath, filePath }) {
  if (isURL(src)) return src;
  const parts = [];
  let rel = src;
  if (rel.startsWith('./') || rel.startsWith('../')) {
    parts.push(...filePath.split('/').slice(0, -1));
  } else {
    parts.push(...projectPath.split('/').filter(Boolean));
    rel = rel.replace(/^\/+/, '');
  }
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
return { startSeconds, classifyMedia, resolveMediaPath };
})();

// ───────── app/core/slide.js ─────────
__m["app/core/slide.js"] = (() => {
// 把一個 MD 檔解析成一張或多張投影片的資料(還不是 HTML)。

const { parseYaml, YamlError } = __m["app/core/yaml.js"];
const { classifyMedia } = __m["app/core/media.js"];
const { safeColor } = __m["app/core/color.js"];
const { readSlideStyle } = __m["app/core/style.js"];
const { t } = __m["app/core/i18n.js"];
/** 所有支援的版型。新增版型時,記得同步更新 製作專案指南.md 與 app/player/render.js。 */
const LAYOUTS = ['auto', 'text', 'center', 'split', 'split-left', 'full', 'quote', 'number', 'stats', 'timeline', 'columns', 'agenda', 'chart', 'flow', 'gallery', 'grid', 'title', 'section', 'end'];

const MEDIA_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$/;
const NOTE_LINE = /^\s*(?:note|notes|備註|講者備註)\s*[:：]\s*(.*)$/i; // i18n-ok:語法關鍵字,不是介面文字
const META_LINE = /^\s*<!--\s*([\w-]+)\s*:\s*(.*?)\s*-->\s*$/;

/**
 * @param {string} text 檔案內容
 * @param {{ path: string }} info
 * @returns {{ slides: object[], issues: {path:string, message:string}[] }}
 */
function parseSlideFile(text, { path }) {
  const issues = [];
  let src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let fileMeta = {};

  // 檔案開頭的 front matter
  const fm = src.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (fm) {
    try { fileMeta = parseYaml(fm[1]) || {}; }
    catch (e) { issues.push({ path, message: t('issue.frontMatter', { detail: e instanceof YamlError ? e.message : t('issue.frontMatterParse') }) }); }
    src = src.slice(fm[0].length);
  }

  const segments = splitSegments(src);
  const slides = [];
  segments.forEach((seg, index) => {
    if (!seg.trim() && segments.length > 1) return;
    slides.push(parseSegment(seg, { path, index, fileMeta, issues }));
  });
  if (!slides.length) slides.push(parseSegment('', { path, index: 0, fileMeta, issues }));
  return { slides, issues };
}

/** 依單獨一行的 `---` 切開(程式碼區塊裡的不算)。 */
function splitSegments(src) {
  const out = [[]];
  let fence = null;
  for (const line of src.split('\n')) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^---\s*$/.test(line)) { out.push([]); continue; }
    out.at(-1).push(line);
  }
  return out.map(l => l.join('\n'));
}

function parseSegment(seg, { path, index, fileMeta, issues }) {
  const meta = { ...fileMeta };
  let lines = seg.split('\n');

  // 段落開頭的 <!-- key: value --> 設定(只影響這一張)
  while (lines.length && (lines[0].trim() === '' || META_LINE.test(lines[0]))) {
    const m = lines[0].match(META_LINE);
    if (m && m[1].toLowerCase() === 'mark') { // 標註可以有很多行
      const mk = parseMark(m[2]);
      if (mk) (meta.marks ||= []).push(mk);
      else issues.push({ path, message: t('issue.mark', { value: m[2] }) });
    } else if (m) meta[m[1]] = coerce(m[2]);
    lines.shift();
  }

  // 講者備註
  let notes = '';
  const n = lines.findIndex(l => NOTE_LINE.test(l));
  if (n >= 0) {
    const first = lines[n].match(NOTE_LINE)[1];
    notes = [first, ...lines.slice(n + 1)].join('\n').trim();
    lines = lines.slice(0, n);
  }

  // 單獨一行的圖片 / 影片 = 這張投影片的主要媒體
  const media = [];
  let fence = false;
  const bodyLines = [];
  // 分欄與多區塊:圖片留在原來的區塊裡顯示(其他版型則抽出來當主要媒體)
  const inline = ['columns', 'grid'].includes(String(meta.layout || '').toLowerCase());
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(MEDIA_LINE);
    if (m) media.push({ alt: m[1], caption: m[3] || m[1], ...classifyMedia(m[2]) });
    if (!m || inline) bodyLines.push(l);
  }
  const body = bodyLines.join('\n').replace(/^\n+|\n+$/g, '');

  if (meta.color != null && !safeColor(meta.color)) {
    issues.push({ path, message: t('issue.slideColor', { value: meta.color }) });
    delete meta.color;
  }

  const style = readSlideStyle(meta, { path, issues, t });

  let layout = String(meta.layout || 'auto').toLowerCase();
  if (!LAYOUTS.includes(layout)) {
    issues.push({ path, message: t('issue.layout', { layout, list: LAYOUTS.join(', ') }) });
    layout = 'auto';
  }
  if (layout === 'auto') layout = autoLayout(body, media);

  const heading = body.match(/^#{1,3}\s+(.+)$/m);
  const firstLine = body.split('\n').find(l => l.trim())?.replace(/^\s*(>|[-*+]|\d+[.)])\s*/, '').replace(/[*_`~=#]/g, '').trim() || '';
  const title = String(meta.title || (heading ? heading[1].replace(/[*_`~=]/g, '').trim() : (media[0]?.caption || firstLine.slice(0, 40))));

  return { file: path, index, meta, style, layout, body, notes, media, title };
}

/**
 * 截圖標註:`x y w h [#顏色] [標籤文字]`,前四個是在圖片上的百分比位置(左、上、寬、高)。
 * 例:`52 5 40 25 我說需求`、`10 40 30 20 #1e88e5 AI 給做法`。
 */
function parseMark(value) {
  const parts = String(value).trim().split(/\s+/);
  const nums = parts.slice(0, 4).map(Number);
  if (nums.length < 4 || nums.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return null;
  const [x, y, w, h] = nums;
  if (w <= 0 || h <= 0 || x + w > 100.5 || y + h > 100.5) return null;
  let rest = parts.slice(4);
  let color = null;
  if (rest[0] && /^#[0-9a-f]{3,8}$/i.test(rest[0])) { color = safeColor(rest[0]); rest = rest.slice(1); }
  const label = rest.join(' ').replace(/^["']|["']$/g, '').slice(0, 40);
  return { x, y, w, h, color, label };
}

function autoLayout(body, media) {
  const text = body.trim();
  if (media.length > 1) return 'gallery'; // 好幾個單獨一行的圖片 / 影片:並排
  if (media.length && !text) return 'full';
  if (media.length && text.split('\n').filter(l => l.trim()).every(l => /^\s*>/.test(l) || /^\s*(—|--|──)/.test(l))) return 'quote'; // 引言 + 照片 = 引言加頭像
  if (media.length) return 'split';
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length && lines.every(l => /^\s*>/.test(l) || /^\s*(—|--|──)/.test(l))) return 'quote';
  const big = lines[0]?.match(/^##\s+(.+)$/);
  if (big && big[1].length <= 14 && lines.length <= 3) return 'number';
  return 'text';
}

function coerce(v) {
  if (/^(true|false)$/i.test(v)) return /^true$/i.test(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
}
return { LAYOUTS, parseSlideFile, parseMark };
})();

// ───────── app/core/library.js ─────────
__m["app/core/library.js"] = (() => {
// 書庫掃描:把「資料來源」轉成 書庫 → 主題 → 專案(簡報)→ 章節 → 投影片。
//
// 讀取分三層,只在需要時往下讀(本機資料可能在隨身碟上,越少讀越好):
//   1. scanLibrary()  只讀資料夾清單 + _site.yml / _topic.yml / deck.yml   → 目錄頁
//   2. loadCover()    進入畫面範圍的專案才讀:章節數、第一張投影片        → 封面卡片
//   3. loadDeck()     點進簡報才讀全部 MD                                 → 播放器
// 圖片與影片則由播放器在「快要看到時」才向來源要網址。
//
// 資料來源(source)只需要實作:
//   list(path)     → Promise<{ name, kind: 'file'|'dir' }[]>   path '' 代表根目錄
//   readText(path) → Promise<string>
//   mediaURL(path) → Promise<string>

const { safeFonts } = __m["app/core/style.js"];
const { parseYaml, YamlError } = __m["app/core/yaml.js"];
const { join, isHidden, isMarkdown, RESERVED_DIRS, splitOrder, byOrder } = __m["app/core/names.js"];
const { parseSlideFile } = __m["app/core/slide.js"];
const { safeColor } = __m["app/core/color.js"];
const { t, detectDeckLang } = __m["app/core/i18n.js"];
const SCHEMA_VERSION = 1;
const PALETTE = ['#c0674a', '#5f8a64', '#4f73a6', '#b08a3a', '#8a5fa6', '#3f8f8f', '#b0566e', '#6b7a8f'];

const CONFIG = { site: '_site.yml', topic: '_topic.yml', deck: 'deck.yml' };

/** 同時最多幾個讀取,避免隨身碟或網路被塞爆。 */
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = limiter(6);

async function listSafe(source, path) {
  try { return await source.list(path); } catch { return []; }
}

async function readYaml(source, path, issues) {
  let text;
  try { text = await limit(() => source.readText(path)); } catch { return null; }
  try { return parseYaml(text) || {}; }
  catch (e) {
    issues.push({ path, message: e instanceof YamlError ? e.message : String(e.message || e) });
    return {};
  }
}

const has = (entries, name, kind = 'file') => entries.some(e => e.name === name && e.kind === kind);
const dirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).sort(byOrder);
const mds = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).sort(byOrder);

/**
 * 判斷使用者開啟的資料夾是哪一層。
 * 規則(依序):deck.yml → 簡報;_topic.yml → 主題;_site.yml → 書庫;
 * 根目錄直接有 MD → 簡報;子資料夾有 deck.yml → 主題;子資料夾有 _topic.yml → 書庫;
 * 子資料夾直接有 MD → 簡報(子資料夾是章節);孫資料夾有 deck.yml → 書庫;其他 → 書庫。
 */
async function detectRootKind(source) {
  const root = await source.list('');
  if (has(root, CONFIG.deck)) return 'deck';
  if (has(root, CONFIG.topic)) return 'topic';
  if (has(root, CONFIG.site)) return 'library';
  if (mds(root).length) return 'deck';
  const children = dirs(root).slice(0, 8);
  const lists = await Promise.all(children.map(d => listSafe(source, d.name)));
  if (lists.some(l => has(l, CONFIG.deck))) return 'topic';
  if (lists.some(l => has(l, CONFIG.topic))) return 'library';
  if (lists.some(l => mds(l).length)) return 'deck';
  return 'library';
}

/**
 * 第 1 層:目錄。只讀資料夾清單與設定檔。
 * opts.kind:強制指定層級(Leafpile 的 slides/ 渠道一定是書庫,不必猜)。
 */
async function scanLibrary(source, opts = {}) {
  const issues = [];
  const kind = opts.kind || await detectRootKind(source);
  const rootEntries = await source.list('');
  const label = source.label || t('lib.defaultLabel');

  if (kind === 'deck') {
    const project = await readProject(source, '', label, '_', issues);
    return finish({ kind, title: project.title, description: '', theme: project.theme, topics: [makeTopic('_', '', { name: label }, [project], 0)] });
  }
  if (kind === 'topic') {
    const conf = (await readYaml(source, CONFIG.topic, issues)) || {};
    const projects = await readProjects(source, '', rootEntries, conf, '_', issues);
    const topic = makeTopic('_', '', { name: label, ...conf, color: color(conf.color, null, CONFIG.topic, issues) }, projects, 0);
    return finish({ kind, title: topic.title, description: topic.description, theme: conf.theme, topics: [topic] });
  }

  const site = (await readYaml(source, CONFIG.site, issues)) || {};
  let topicDirs = dirs(rootEntries);
  topicDirs = applyOrder(topicDirs, site.topics);
  const topics = await Promise.all(topicDirs.map(async (d, i) => {
    const entries = await listSafe(source, d.name);
    const conf = (await readYaml(source, join(d.name, CONFIG.topic), issues)) || {};
    const projects = await readProjects(source, d.name, entries, conf, d.name, issues);
    return makeTopic(d.name, d.name, { ...conf, color: color(conf.color, null, join(d.name, CONFIG.topic), issues) }, projects, i);
  }));
  return finish({ kind, title: site.title || label, description: site.description || '', theme: site.theme, topics });

  function finish(lib) { return { ...lib, source: label, issues, scannedAt: Date.now() }; }
}

function applyOrder(list, order) {
  if (!Array.isArray(order) || !order.length) return list;
  const key = n => [n, splitOrder(n).label];
  const picked = [];
  for (const want of order.map(String)) {
    const hit = list.find(d => key(d.name).includes(want) && !picked.includes(d));
    if (hit) picked.push(hit);
  }
  return [...picked, ...list.filter(d => !picked.includes(d))];
}

function makeTopic(id, path, conf, projects, i) {
  const folder = path.split('/').pop() || conf.name || '';
  return {
    id, path,
    title: conf.name || conf.title || splitOrder(folder).label,
    description: conf.description || '',
    color: conf.color || PALETTE[i % PALETTE.length],
    category: conf.category ? String(conf.category) : '',
    projects,
  };
}

async function readProjects(source, topicPath, entries, topicConf, topicId, issues) {
  let list = dirs(entries);
  list = applyOrder(list, topicConf.order);
  const projects = await Promise.all(list.map(d => readProject(source, join(topicPath, d.name), d.name, topicId, issues)));
  if (!Array.isArray(topicConf.order)) {
    // 沒指定順序:有前綴的依前綴,其他依日期新到舊
    projects.sort((a, b) => {
      const A = splitOrder(a.folder).order, B = splitOrder(b.folder).order;
      if (A != null || B != null) return (A ?? 1e9) - (B ?? 1e9);
      return String(b.date || '').localeCompare(String(a.date || '')) || a.folder.localeCompare(b.folder, 'zh-Hant');
    });
  }
  return projects;
}

async function readProject(source, path, folder, topicId, issues) {
  const conf = (await readYaml(source, join(path, CONFIG.deck), issues)) || {};
  const label = splitOrder(folder).label;
  return {
    id: folder || '_', topicId, folder, path,
    hasConfig: Object.keys(conf).length > 0,
    title: str(conf.title) || label,
    subtitle: str(conf.subtitle),
    author: str(conf.author),
    date: conf.date != null ? String(conf.date) : (splitOrder(folder).date || ''),
    event: str(conf.event),
    tags: Array.isArray(conf.tags) ? conf.tags.map(String) : [],
    theme: str(conf.theme),
    accent: color(conf.accent, null, join(path, CONFIG.deck), issues) || safeColor(Array.isArray(conf.sections) && conf.sections[0]?.color) || '',
    coverImage: str(conf.cover_image || conf.coverImage),
    lang: detectDeckLang(conf.lang, conf.title, conf.subtitle, conf.kicker, folder, ...(Array.isArray(conf.sections) ? conf.sections.map(s => s && (s.title || s.folder)) : [])),
    brand: readBrand(conf.brand, join(path, CONFIG.deck), issues),
    config: conf,
  };
}


/** deck.yml 的 brand 欄位:logo、footer、font_display、font_body。不合法的字型名稱會回報並忽略。 */
function readBrand(b, path, issues) {
  if (!b || typeof b !== 'object') return null;
  const font = v => {
    if (v == null || v === '') return '';
    const f = safeFonts(v);
    if (!f) { issues.push({ path, message: t('issue.brandFont', { value: v }) }); return ''; }
    return f;
  };
  return { logo: str(b.logo), footer: str(b.footer), fontDisplay: font(b.font_display), fontBody: font(b.font_body) };
}

const str = v => (v == null ? '' : String(v));

/** 設定檔裡的顏色:不合法就回報並改用預設值。 */
function color(value, fallback, path, issues) {
  if (value == null || value === '') return fallback;
  const c = safeColor(value);
  if (!c) issues.push({ path, message: t('issue.color', { value }) });
  return c || fallback;
}

/** 重新讀取一份簡報的 deck.yml(即時重新載入用)。 */
async function refreshProject(source, project) {
  return readProject(source, project.path, project.folder, project.topicId, []);
}

/** 第 2 層:封面。只列出專案資料夾,必要時讀第一張投影片。 */
async function loadCover(source, project) {
  const entries = await listSafe(source, project.path);
  const sectionDirs = dirs(entries);
  const info = { sections: sectionDirs.length || (mds(entries).length ? 1 : 0), firstSlide: null };
  if (project.hasConfig && project.config.title) return info; // 有標題就用自動產生的標題頁當封面,不必再讀
  let file = mds(entries)[0] && join(project.path, mds(entries)[0].name);
  if (!file && sectionDirs[0]) {
    const inner = await listSafe(source, join(project.path, sectionDirs[0].name));
    if (mds(inner)[0]) file = join(project.path, sectionDirs[0].name, mds(inner)[0].name);
  }
  if (file) {
    try { info.firstSlide = parseSlideFile(await limit(() => source.readText(file)), { path: file }).slides[0]; } catch { /* 封面讀不到就用預設 */ }
  }
  return info;
}

/** 第 3 層:整份簡報。 */
async function loadDeck(source, project) {
  const issues = [];
  const conf = project.config || {};
  const entries = await source.list(project.path);
  const confSections = Array.isArray(conf.sections) ? conf.sections.filter(s => s && typeof s === 'object') : [];

  // 章節順序一律依資料夾前綴;deck.yml 的 sections 只覆寫標題、顏色、隱藏等屬性
  const sectionDirs = dirs(entries);

  const sections = [];
  const rootFiles = mds(entries);
  if (rootFiles.length) sections.push({ folder: '', path: project.path, files: rootFiles.map(f => join(project.path, f.name)), intro: sectionDirs.length > 0 });
  await Promise.all(sectionDirs.map(async d => {
    const path = join(project.path, d.name);
    const files = mds(await source.list(path)).map(f => join(path, f.name));
    sections.push({ folder: d.name, path, files });
  }));
  const orderOf = s => s.folder === '' ? -1 : sectionDirs.findIndex(d => d.name === s.folder);
  sections.sort((a, b) => orderOf(a) - orderOf(b));

  const autoCovers = conf.section_covers !== false && conf.sectionCovers !== false;
  let colorIndex = 0;
  const built = [];
  for (const s of sections) {
    const c = confSections.find(x => x.folder === s.folder || x.folder === splitOrder(s.folder).label) || {};
    if (c.hidden) continue;
    const texts = await Promise.all(s.files.map(f => limit(() => source.readText(f)).then(text => [f, text], () => [f, null])));
    const slides = [];
    for (const [f, text] of texts) {
      if (text == null) { issues.push({ path: f, message: t('issue.readFailed') }); continue; }
      const r = parseSlideFile(text, { path: f });
      issues.push(...r.issues);
      slides.push(...r.slides.filter(sl => !sl.meta.hidden));
    }
    const title = c.title || (s.folder ? splitOrder(s.folder).label : '');
    const auto = s.folder ? PALETTE[colorIndex++ % PALETTE.length] : project.accent || PALETTE[PALETTE.length - 1];
    const secColor = color(c.color, auto, join(project.path, CONFIG.deck), issues);
    const section = { id: s.folder || '_intro', folder: s.folder, path: s.path, title, subtitle: str(c.subtitle), color: secColor, slides };
    if (autoCovers && s.folder && sections.filter(x => x.folder).length > 1 && c.cover !== false) {
      slides.unshift({ file: s.path, index: -1, meta: {}, layout: 'section', body: '', notes: str(c.notes), media: [], title, auto: true });
    }
    if (slides.length) built.push(section);
  }

  // 自動標題頁與結尾頁
  if (conf.cover !== false && conf.cover !== 'none') {
    // 標題頁放在第一個章節的最前面,不另外成一疊
    const titleSlide = { file: project.path, index: -1, meta: {}, layout: 'title', body: '', notes: str(conf.cover_notes), media: [], title: project.title, auto: true };
    if (built[0]) built[0].slides.unshift(titleSlide);
  }
  if (conf.end) {
    const last = built.at(-1);
    if (last) last.slides.push({ file: project.path, index: -1, meta: {}, layout: 'end', body: '', notes: str(conf.end_notes), media: [], title: String(conf.end), auto: true });
  }

  if (!built.some(s => s.slides.some(sl => !sl.auto))) issues.push({ path: project.path, message: t('issue.noSlides') });
  if (conf.mdslide && Number(conf.mdslide) > SCHEMA_VERSION) issues.push({ path: join(project.path, CONFIG.deck), message: t('issue.newerSchema', { version: conf.mdslide }) });

  const layout = typeof conf.layout === 'object' && conf.layout ? conf.layout : { stage: conf.layout };
  return {
    ...project,
    sections: built,
    stage: str(layout.stage || layout.default || 'pile'),
    transition: str(layout.transition || 'shuffle'),
    size: /^(small|compact|normal|large|xl)$/i.test(str(conf.size)) ? str(conf.size).toLowerCase() : '',
    issues,
  };
}

/** 給播放器用:把所有章節攤平成一個陣列,並標上章節索引。 */
function flatten(deck) {
  const out = [];
  deck.sections.forEach((sec, si) => sec.slides.forEach((s, i) => out.push({ ...s, sec: si, i, count: sec.slides.length })));
  return out;
}
return { SCHEMA_VERSION, PALETTE, limiter, detectRootKind, scanLibrary, refreshProject, loadCover, loadDeck, flatten };
})();

// ───────── app/core/chart.js ─────────
__m["app/core/chart.js"] = (() => {
// 圖表資料解析與座標軸級距。render.js(畫圖)與 check.js(檢查)共用,純函式、零依賴。

/**
 * 把表格裡的一格轉成數字。支援千分位、全形負號(−)、%、單位後綴(點、億、張…)與常見貨幣前綴。
 * 無法解析(空白、N/A、—、文字)時回傳 null。
 */
const MISSING = /^(n\/?a|na|null|none|—|–|-|－|無|缺)$/i; // i18n-ok:缺值的寫法

function parseNumber(cell) {
  let s = String(cell ?? '').trim();
  if (!s || MISSING.test(s)) return null;
  s = s.replace(/^(NT\$|US\$|HK\$|NTD|USD|\$|¥|€|£)\s*/i, '');
  const m = s.match(/^([+\-−–－]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([^\d].*)?$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[1] && m[1] !== '+' ? -n : n;
}

/**
 * 從投影片內文取出第一個表格。第一欄是標籤,其餘欄是數列。
 * @returns {null | { labels: string[], series: { name: string, values: (number|null)[] }[], before: string, after: string, bad: { row: number, col: number, text: string }[] }}
 */
function parseChartTable(body) {
  const lines = String(body).split('\n');
  const start = lines.findIndex((l, k) => l.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[k + 1] || ''));
  if (start < 0) return null;
  let end = start + 2;
  while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
  const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  const header = row(lines[start]);
  const rows = lines.slice(start + 2, end).map(row);
  const bad = [];
  const series = header.slice(1).map((name, k) => ({
    name,
    values: rows.map((r, ri) => {
      const v = parseNumber(r[k + 1]);
      if (v == null && String(r[k + 1] ?? '').trim() && !MISSING.test(String(r[k + 1]).trim())) bad.push({ row: ri + 1, col: k + 2, text: String(r[k + 1]) });
      return v;
    }),
  }));
  return { labels: rows.map(r => r[0] ?? ''), series, before: lines.slice(0, start).join('\n'), after: lines.slice(end).join('\n'), bad };
}

/**
 * 座標軸範圍:一定包含 0,級距為 1/2/5×10ⁿ,選「不超過 6 格」中最細的級距。
 * @returns {{ lo: number, hi: number, step: number, ticks: number[] }}
 */
function niceScale(min, max) {
  let lo = Math.min(0, min), hi = Math.max(0, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) hi = lo + 1;
  const range = hi - lo;
  let step = 1;
  for (let e = Math.floor(Math.log10(range / 6)) - 1; ; e++) {
    const hit = [1, 2, 5].map(m => m * 10 ** e).find(s => Math.ceil(hi / s - 1e-9) - Math.floor(lo / s + 1e-9) <= 6);
    if (hit) { step = hit; break; }
  }
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)));
  return { lo: ticks[0], hi: ticks.at(-1), step, ticks };
}
return { parseNumber, parseChartTable, niceScale };
})();

// ───────── app/core/highlight.js ─────────
__m["app/core/highlight.js"] = (() => {
// 程式碼上色:精簡的 tokenizer,支援 js / ts / python / json / bash / sql。
// 輸出一律先跳脫 HTML,只加上 <span class="tk-…">;不認得的語言就原樣跳脫輸出。

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KEYWORDS = {
  js: 'await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield async',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self',
  bash: 'if then else elif fi for while do done case esac in function return export local echo cd exit set unset source sudo',
  sql: 'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit offset as distinct null is in like between union all case when then else end primary key',
  json: 'true false null',
};
KEYWORDS.ts = KEYWORDS.js + ' interface type enum implements private public protected readonly declare namespace keyof any number string boolean void never unknown';

const ALIASES = { javascript: 'js', mjs: 'js', jsx: 'js', typescript: 'ts', tsx: 'ts', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', postgres: 'sql', mysql: 'sql' };

const COMMENT = {
  js: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, ts: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
  python: '#[^\\n]*', bash: '#[^\\n]*', sql: '--[^\\n]*', json: null,
};
const STRING = {
  js: String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60`,
  python: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`,
  bash: String.raw`"(?:\\.|[^"\\])*"|'[^']*'`,
  sql: String.raw`'(?:''|[^'])*'`,
  json: String.raw`"(?:\\.|[^"\\\n])*"`,
};
STRING.ts = STRING.js;

const cache = new Map();
function tokenizer(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const parts = [];
  if (COMMENT[lang]) parts.push(`(?<c>${COMMENT[lang]})`);
  parts.push(`(?<s>${STRING[lang]})`);
  parts.push(String.raw`(?<n>\b\d+(?:\.\d+)?\b)`);
  parts.push(String.raw`(?<w>[A-Za-z_$][\w$]*)`);
  const re = new RegExp(parts.join('|'), 'g');
  const kw = new Set(KEYWORDS[lang].split(' '));
  const t = { re, kw, ci: lang === 'sql' };
  cache.set(lang, t);
  return t;
}

/** 回傳上色後(已跳脫)的 HTML。lang 不支援時回傳單純跳脫的文字。 */
function highlight(code, lang) {
  const key = ALIASES[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  if (!KEYWORDS[key]) return esc(code);
  const { re, kw, ci } = tokenizer(key);
  let out = '', last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(code));) {
    out += esc(code.slice(last, m.index));
    const g = m.groups;
    if (g.c) out += `<span class="tk-c">${esc(g.c)}</span>`;
    else if (g.s) out += `<span class="tk-s">${esc(g.s)}</span>`;
    else if (g.n) out += `<span class="tk-n">${g.n}</span>`;
    else if (g.w && kw.has(ci ? g.w.toLowerCase() : g.w)) out += `<span class="tk-k">${esc(g.w)}</span>`;
    else out += esc(m[0]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
return { highlight };
})();

// ───────── app/core/note.js ─────────
__m["app/core/note.js"] = (() => {
// 筆記:把一個 .md 檔解析成筆記資料(front matter、標題、段落、[[連結]])。
// 純邏輯,瀏覽器與 Node 共用。規則見 docs/SPEC.md 第 4、5 節。

const { parseYaml, YamlError } = __m["app/core/yaml.js"];
const { splitOrder } = __m["app/core/names.js"];
const { t } = __m["app/core/i18n.js"];
/** 筆記裡不該出現的版型設定(版型只屬於簡報,見 docs/INTEROP.md「刻意不做的事」)。 */
const LAYOUT_KEYS = ['layout', 'size', 'background', 'overlay', 'stage', 'transition', 'align', 'fit', 'ratio', 'font', 'text', 'footer', 'step', 'mark'];

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FENCE = /^\s*(```+|~~~+)/;

/** 拆出 front matter。回傳 { data, body, raw, error }。解析失敗時 data = {}、error = 訊息。 */
function splitFrontMatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const m = src.match(FM);
  if (!m) return { data: {}, body: src, raw: '', error: null };
  let data = {}, error = null;
  try {
    const parsed = parseYaml(m[1]);
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) { error = e instanceof YamlError ? e.message : String(e.message || e); }
  return { data, body: src.slice(m[0].length), raw: m[1], error };
}

/** 標題轉成網址片段:小寫、空白變 -、去掉標點(保留中日韓文字)。 */
function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[*_`~=[\]()<>]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

/** 去掉行內 Markdown 符號,給目錄與搜尋用。 */
function plainInline(s) {
  return String(s)
    .replace(/!?\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a.replace(/^slides:/, '').replace('#', ' › '))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '')
    .trim();
}

/** 逐行走訪,告訴 fn 這一行是否在程式碼區塊裡。 */
function eachLine(body, fn) {
  let fence = null;
  body.split('\n').forEach((line, i) => {
    const f = line.match(FENCE);
    if (f) {
      if (!fence) { fence = f[1]; fn(line, i, true); return; }
      if (line.trim().startsWith(fence)) { fence = null; fn(line, i, true); return; }
    }
    fn(line, i, !!fence);
  });
}

/** 所有標題(程式碼區塊裡的不算)。slug 重複時加上 -2、-3。 */
function headingsOf(body) {
  const out = [], seen = new Map();
  eachLine(body, (line, i, code) => {
    if (code) return;
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!m) return;
    const text = plainInline(m[2]);
    let slug = slugify(text);
    const n = (seen.get(slug) || 0) + 1;
    seen.set(slug, n);
    if (n > 1) slug += '-' + n;
    out.push({ level: m[1].length, text, slug, line: i });
  });
  return out;
}

const WIKI = /(!?)\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;

/** 解析一個連結目標:`slides:名稱`、`名稱#標題`。 */
function parseTarget(raw) {
  let s = String(raw).trim(), channel = 'notes';
  if (/^slides:/i.test(s)) { channel = 'slides'; s = s.slice(7).trim(); }
  else if (/^notes:/i.test(s)) s = s.slice(6).trim();
  const i = s.indexOf('#');
  return { channel, target: (i < 0 ? s : s.slice(0, i)).trim(), heading: i < 0 ? '' : s.slice(i + 1).trim() };
}

/**
 * 找出所有 [[連結]] 與 ![[摘錄]](程式碼區塊與行內程式碼裡的不算)。
 * @returns {{ raw, embed, channel, target, heading, label, line }[]}
 */
function wikilinksOf(body) {
  const out = [];
  eachLine(body, (line, i, code) => {
    if (code) return;
    const text = line.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    for (const m of text.matchAll(WIKI)) {
      const p = parseTarget(m[2]);
      if (!p.target && !p.heading) continue;
      out.push({ raw: m[0], embed: m[1] === '!', ...p, label: (m[3] || '').trim(), line: i });
    }
  });
  return out;
}

/**
 * 改寫文字裡的 [[連結]](程式碼區塊與行內程式碼裡的不動)。
 * fn(link) 回傳新的整段連結文字;回傳 null 表示不改。
 * @returns {{ text: string, count: number }}
 */
function replaceWikilinks(text, fn) {
  let count = 0;
  const out = [];
  eachLine(String(text), (line, i, code) => {
    if (code) { out.push(line); return; }
    const masked = line.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    let res = '', last = 0;
    for (const m of masked.matchAll(WIKI)) {
      const p = parseTarget(m[2]);
      if (!p.target && !p.heading) continue;
      const next = fn({ raw: line.slice(m.index, m.index + m[0].length), embed: m[1] === '!', ...p, label: (m[3] || '').trim() });
      if (next == null || next === m[0]) continue;
      res += line.slice(last, m.index) + next;
      last = m.index + m[0].length;
      count++;
    }
    out.push(res + line.slice(last));
  });
  return { text: out.join('\n'), count };
}

/** 把連結物件寫回文字:`![[slides:目標#標題|顯示]]`。 */
function formatWikilink(link) {
  return `${link.embed ? '!' : ''}[[${link.channel === 'slides' ? 'slides:' : ''}${link.target || ''}${link.heading ? '#' + link.heading : ''}${link.label ? '|' + link.label : ''}]]`;
}

/** 連結預設顯示的文字。 */
function linkLabel(link) {
  if (link.label) return link.label;
  const name = link.target ? link.target.split('/').pop() : '';
  return link.heading ? (name ? `${name} › ${link.heading}` : link.heading) : name;
}

/**
 * 取出某個標題底下的一段(到下一個同級或更高級的標題為止,不含標題本身)。
 * heading 可以是標題文字或 slug;找不到回傳 null。
 */
function sectionOf(body, heading) {
  const hs = headingsOf(body);
  const want = String(heading).trim().toLowerCase();
  const h = hs.find(x => x.text.toLowerCase() === want) || hs.find(x => x.slug === slugify(heading));
  if (!h) return null;
  const next = hs.find(x => x.line > h.line && x.level <= h.level);
  const lines = body.split('\n');
  return lines.slice(h.line + 1, next ? next.line : lines.length).join('\n').replace(/^\n+|\n+$/g, '');
}

const list = v => Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean)
  : typeof v === 'string' && v.trim() ? v.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [];
const bool = v => typeof v === 'boolean' ? v : undefined;
const str = v => v == null ? '' : String(v).trim();

/** 第一段文字(給卡片與搜尋結果用)。 */
function excerptOf(body, max = 120) {
  const lines = [];
  eachLine(body, (line, i, code) => {
    if (code || lines.length >= 4) return;
    const s = line.trim();
    if (!s || /^(#{1,6}\s|---|\||!\[)/.test(s)) { if (lines.length) lines.push(''); return; }
    lines.push(plainInline(s.replace(/^(>|[-*+]|\d+[.)])\s*(\[[ xX]\]\s*)?/, '')));
  });
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * 解析一篇筆記。
 * @param {string} text 檔案內容
 * @param {{ path: string }} info path = 在筆記渠道裡的相對路徑
 */
function parseNote(text, { path }) {
  const issues = [];
  const fm = splitFrontMatter(text);
  if (fm.error) issues.push({ path, message: t('issue.frontMatter', { detail: fm.error }) });
  const d = fm.data;
  const body = fm.body.replace(/\r\n?/g, '\n');
  const headings = headingsOf(body);
  const file = path.split('/').pop();
  const name = splitOrder(file);
  const h1 = headings.find(h => h.level === 1);
  const layoutKeys = Object.keys(d).filter(k => LAYOUT_KEYS.includes(k));
  if (layoutKeys.length) issues.push({ path, level: 'warn', message: t('note.layoutKeys', { keys: layoutKeys.join(', ') }) });
  return {
    path, file,
    title: str(d.title) || h1?.text || name.label,
    date: d.date != null ? String(d.date) : (name.date || ''),
    tags: list(d.tags),
    aliases: list(d.aliases),
    public: bool(d.public),
    lang: str(d.lang),
    source: str(d.source),
    pinned: d.pinned === true,
    expires: d.expires != null ? String(d.expires) : '',
    fromDeck: str(d.from_deck),
    data: d,
    body,
    headings,
    links: wikilinksOf(body),
    excerpt: excerptOf(body),
    layoutKeys,
    issues,
  };
}

/**
 * 來源筆記的內容指紋(升級成簡報時記在 deck.yml 的 source_hash)。
 * 只看內文(不含 front matter),依路徑排序;換行與行尾空白不算改動。
 * FNV-1a 32 位元,8 個十六進位字元:夠用來判斷「有沒有改過」,不是安全用途。
 * @param {{ path: string, body: string }[]} notes
 */
function sourceFingerprint(notes) {
  let h = 0x811c9dc5;
  const feed = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const n of [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    feed(String(n.body || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim());
    feed('\u0000');
  }
  return h.toString(16).padStart(8, '0');
}

/** 新筆記的檔名:日期 + 標題(去掉檔名不能用的字元)。 */
function newNoteFileName(title, date = new Date().toISOString().slice(0, 10)) {
  const safe = String(title).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'note';
  return `${date}-${safe}.md`;
}

/** 新筆記的內容(front matter + 標題)。 */
function newNoteText(title, date = new Date().toISOString().slice(0, 10)) {
  return `---\ntitle: ${/[:#'"[\]{},&*!|>%@`]/.test(title) ? JSON.stringify(title) : title}\ndate: ${date}\ntags: []\n---\n# ${title}\n\n`;
}

/**
 * 快速收集(記到收件匣):一段隨手寫的文字 → 新筆記。
 * 第一行(去掉 # 與 Markdown 記號)當標題,太長就截斷;其餘當內文。只有一行時內文就是那一行。
 * @returns {{ title: string, fileName: string, text: string } | null}  沒有字時回傳 null
 */
function captureNote(raw, date = new Date().toISOString().slice(0, 10)) {
  const lines = String(raw ?? '').replace(/\r/g, '').split('\n');
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return null;
  const first = lines[i].trim();
  const clean = first.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').replace(/[*_`=~[\]]/g, '').trim();
  const title = (clean.length > 40 ? clean.slice(0, 39).trimEnd() + '…' : clean) || first.slice(0, 40);
  const rest = lines.slice(i + 1).join('\n').trim();
  const isHeading = /^#{1,6}\s/.test(first);
  const body = isHeading ? rest : [clean.length > 40 || clean !== first ? first : '', rest].filter(Boolean).join('\n\n');
  return { title, fileName: newNoteFileName(title, date), text: newNoteText(title, date) + (body ? body + '\n' : '') };
}

/** 檔名已經有人用:a.md → a-2.md、a-3.md…(第 n 個候選)。 */
function numberedName(fileName, n) {
  return n < 2 ? fileName : String(fileName).replace(/(\.md)?$/i, m => `-${n}${m || ''}`);
}

// ---------- 日記 ----------
// 一天一篇:notes/<日記主題>/YYYY-MM-DD.md。日記主題依序找:
//   1. _site.yml 的 journal: <主題資料夾>
//   2. 資料夾名稱含 journal 或 diary 的主題
//   3. 預設的「生活紀錄」50-life(只留本機,不會放上 GitHub)
//   4. 收件匣
// 日記一律不寫 public,所以預設是私人(除非主題本身設成公開)。

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** 選日記主題。topics = [{ id }]。找不到回傳 ''(筆記渠道最上層)。 */
function journalTopic(topics, site = {}) {
  const ids = topics.map(tp => tp.id).filter(id => id && id !== '_');
  const want = String(site?.journal || '').trim();
  if (want && ids.includes(want)) return want;
  return ids.find(id => /journal|diary/i.test(id)) || ids.find(id => /^50-life$/.test(id)) || ids.find(id => /life/i.test(id)) || ids.find(id => /inbox/i.test(id)) || '';
}

/** 某一天的日記:路徑與新檔的內容。title 由畫面依語言給(例如「2026-11-14 日記」)。 */
function journalNote(day, topicId, title) {
  if (!isDay(day)) throw new Error('day');
  const name = String(title || day).trim();
  return {
    rel: [topicId, `${day}.md`].filter(Boolean).join('/'),
    text: `---\ntitle: ${/[:#'"[\]{},&*!|>%@`]/.test(name) ? JSON.stringify(name) : name}\ndate: ${day}\ntags: [journal]\n---\n# ${name}\n\n`,
  };
}
return { LAYOUT_KEYS, splitFrontMatter, slugify, plainInline, headingsOf, parseTarget, wikilinksOf, replaceWikilinks, formatWikilink, linkLabel, sectionOf, parseNote, sourceFingerprint, newNoteFileName, newNoteText, captureNote, numberedName, isDay, journalTopic, journalNote };
})();

// ───────── app/core/markdown.js ─────────
__m["app/core/markdown.js"] = (() => {
// 精簡 Markdown 轉 HTML,零依賴。只處理簡報會用到的語法,所有原始 HTML 一律跳脫(安全)。
//
// 區塊:標題、段落、清單(巢狀、有序、核取)、引言、程式碼區塊、表格、分隔線
// 行內:**粗體** *斜體* ~~刪除~~ ==螢光== `程式碼` [連結](網址) ![圖](路徑) 腳註[^1]
// 腳註定義:單獨一行 [^1]: 內容,會依引用順序編號,放在內容最後(小字)。
// 與 GitHub 不同處:段落中的單一換行會保留成換行(簡報通常是逐行排版)。
// Leafpile:[[連結]] 與 ![[摘錄]](由 opts.wikilink 決定怎麼顯示;預設是一般文字樣式的標記)。

const { highlight } = __m["app/core/highlight.js"];
const { parseTarget, linkLabel, slugify, plainInline } = __m["app/core/note.js"];
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:\s*(.*)$/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const defaultImage = (src, alt) => `<img data-media="${escapeHTML(src)}" alt="${escapeHTML(alt)}">`;

/**
 * 沒有指定時,[[連結]] 顯示成帶樣式的文字(簡報與匯出的單檔不能跳轉)。
 * data-link / data-heading 記下目標,播放器據此補上「連到哪裡」的說明(player/render.js 的 describeLinks)。
 */
const defaultWikilink = link => `<span class="wikilink${link.embed ? ' embed' : ''}" data-link="${escapeHTML(linkKey(link))}"${link.heading ? ` data-heading="${escapeHTML(link.heading)}"` : ''}>${escapeHTML(linkLabel(link))}</span>`;

/** 連結目標的鍵(簡報的 deck.links 用它查目標說明)。 */
const linkKey = link => `${link.channel === 'slides' ? 'slides' : 'notes'}:${link.target}`;

/**
 * @param {string} src
 * @param {{ image?: (src: string, alt: string) => string, wikilink?: (link: object) => string, headingIds?: boolean }} [opts]
 *   headingIds:標題加上 id(筆記閱讀頁的目錄用)
 */
function renderMarkdown(src, opts = {}) {
  const { body, defs } = splitFootnotes(src.replace(/\r\n?/g, '\n').split('\n'));
  const ctx = { image: opts.image || defaultImage, wikilink: opts.wikilink || defaultWikilink, notes: { defs, order: [] }, slugs: opts.headingIds ? new Map() : null };
  let html = renderBlocks(body, ctx);
  if (ctx.notes.order.length) {
    html += '<div class="footnotes">' + ctx.notes.order.map((id, k) =>
      `<p class="source"><sup>${k + 1}</sup> ${inline(defs.get(id), { image: ctx.image, wikilink: ctx.wikilink })}</p>`).join('') + '</div>';
  }
  return html;
}

/** 把腳註定義行([^id]: 內容)抽出來;程式碼區塊裡的不算。 */
function splitFootnotes(lines) {
  const defs = new Map(), body = [];
  let fence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(FOOTNOTE_DEF);
    if (m) defs.set(m[1], m[2]); else body.push(l);
  }
  return { body, defs };
}

/** 找出有引用但沒有定義的腳註(給檢查工具用)。 */
function undefinedFootnotes(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const { body, defs } = splitFootnotes(lines);
  const missing = new Set();
  let fence = false;
  for (const l of body) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    for (const m of l.replace(/`[^`]*`/g, '').matchAll(FOOTNOTE_REF)) if (!defs.has(m[1])) missing.add(m[1]);
  }
  return [...missing];
}

function renderInline(text, opts = {}) {
  return inline(text, { image: opts.image || defaultImage, wikilink: opts.wikilink || defaultWikilink });
}

function renderBlocks(lines, ctx) {
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // 程式碼區塊
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` data-lang="${escapeHTML(fence[2])}"` : '';
      html += `<pre${lang}><code>${highlight(body.join('\n'), fence[2])}</code></pre>`; // highlight 會先跳脫 HTML
      continue;
    }

    // 標題
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      let id = '';
      if (ctx.slugs) {
        // 與 core/note.js 的 headingsOf() 同一套規則,目錄才對得上
        let slug = slugify(plainInline(h[2]));
        const n = (ctx.slugs.get(slug) || 0) + 1;
        ctx.slugs.set(slug, n);
        if (n > 1) slug += '-' + n;
        id = ` id="h-${escapeHTML(slug)}"`;
      }
      html += `<h${h[1].length}${id}>${inline(h[2], ctx)}</h${h[1].length}>`; i++; continue;
    }

    // 分隔線
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    // 引言
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderBlocks(body, ctx)}</blockquote>`;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      const al = k => aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
      html += '<table><thead><tr>' + head.map((c, k) => `<th${al(k)}>${inline(c, ctx)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + head.map((_, k) => `<td${al(k)}>${inline(r[k] ?? '', ctx)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>';
      continue;
    }

    // 清單
    if (listMarker(line)) {
      const block = [];
      while (i < lines.length && (lines[i].trim() === '' ? (i + 1 < lines.length && (listMarker(lines[i + 1]) || /^\s{2,}/.test(lines[i + 1]))) : (listMarker(lines[i]) || /^\s{2,}/.test(lines[i])))) block.push(lines[i++]);
      html += renderList(block, ctx);
      continue;
    }

    // 段落
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) para.push(lines[i++].trim());
    html += `<p>${para.map(l => inline(l, ctx)).join('<br>')}</p>`;
  }
  return html;
}

function isBlockStart(lines, i) {
  const l = lines[i];
  return /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || !!listMarker(l)
    || (l.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]));
}

function listMarker(line) {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  return m ? { indent: m[1].length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3] } : null;
}

function renderList(block, ctx) {
  const first = listMarker(block[0]);
  const base = first.indent;
  const items = [];
  for (const l of block) {
    const m = listMarker(l);
    if (m && m.indent <= base + 1) items.push({ text: m.text, children: [] });
    else if (items.length) items.at(-1).children.push(l.slice(Math.min(base + 2, l.search(/\S|$/))));
  }
  const tag = first.ordered ? 'ol' : 'ul';
  const start = first.ordered && first.start !== 1 ? ` start="${first.start}"` : '';
  return `<${tag}${start}>` + items.map(it => {
    let text = it.text, cls = '';
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) { cls = ` class="task${task[1] !== ' ' ? ' done' : ''}"`; text = task[2]; }
    const kids = it.children.filter(c => c.trim()).length ? renderBlocks(it.children, ctx) : '';
    return `<li${cls}>${inline(text, ctx)}${kids}</li>`;
  }).join('') + `</${tag}>`;
}

function cells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

// 網址可以含一層成對括號,例如 https://en.wikipedia.org/wiki/Foo_(bar)
const URL_PART = '((?:[^()\\s<>]|\\([^()\\s<>]*\\))+)';
const IMAGE_RE = new RegExp(`!\\[([^\\]]*)\\]\\(\\s*<?${URL_PART}>?(?:\\s+"[^"]*")?\\s*\\)`, 'g');
const LINK_RE = new RegExp(`\\[((?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\(\\s*<?${URL_PART}>?(?:\\s+"[^"]*")?\\s*\\)`, 'g');
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>\u0000]+/g;
const WIKI_RE = /(!?)\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;
const SAFE_HREF = /^(https?:|mailto:|#|\.{0,2}\/)/i;

/** slots 由巢狀呼叫共用,連結文字裡的圖片才不會變成 undefined。 */
function inline(text, ctx, slots = []) {
  const keep = html => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text;
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${escapeHTML(c)}</code>`));
  if (ctx.notes) {
    s = s.replace(FOOTNOTE_REF, (_, id) => {
      if (!ctx.notes.defs.has(id)) return keep('<sup class="fn missing">?</sup>');
      let n = ctx.notes.order.indexOf(id) + 1;
      if (!n) n = ctx.notes.order.push(id);
      return keep(`<sup class="fn">${n}</sup>`);
    });
  }
  s = s.replace(WIKI_RE, (_, bang, target, label) => keep(ctx.wikilink({ ...parseTarget(target), label: (label || '').trim(), embed: bang === '!' })));
  s = s.replace(IMAGE_RE, (_, alt, src) => keep(ctx.image(src, alt)));
  s = s.replace(LINK_RE, (_, label, href) => {
    const safe = SAFE_HREF.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href);
    return keep(`<a href="${safe ? escapeHTML(href) : '#'}" target="_blank" rel="noopener">${inline(label, ctx, slots)}</a>`);
  });
  s = s.replace(BARE_URL_RE, url => keep(escapeHTML(url))); // 裸網址不做粗體、斜體處理
  s = escapeHTML(s);
  const W = '\\p{L}\\p{N}_';
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
       .replace(new RegExp(`(^|[^${W}])__(?=\\S)([\\s\\S]*?\\S)__(?![${W}])`, 'gu'), '$1<strong>$2</strong>')
       .replace(/(^|[^*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
       .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
       .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
  // 還原佔位(可能有多層)
  for (let i = 0; i < 5 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[n]);
  return s;
}
return { escapeHTML, linkKey, renderMarkdown, undefinedFootnotes, renderInline };
})();

// ───────── app/core/vault.js ─────────
__m["app/core/vault.js"] = (() => {
// Leafpile 書庫:一個資料夾、兩個渠道(notes/ 筆記、slides/ 簡報),同名主題自動配對。
// 規則見 docs/SPEC.md 第 1、9 節。
//
// 開啟的資料夾沒有 notes/ 也沒有 slides/ 時,整個資料夾當成簡報渠道(相容 Mdslide Pile 書庫)。

const { parseYaml, YamlError } = __m["app/core/yaml.js"];
const { join, isHidden, isMarkdown, RESERVED_DIRS, splitOrder, byOrder } = __m["app/core/names.js"];
const { scanLibrary, limiter, PALETTE } = __m["app/core/library.js"];
const { safeColor } = __m["app/core/color.js"];
const { t } = __m["app/core/i18n.js"];
const LEAFPILE_SCHEMA = 1;
const CHANNELS = ['notes', 'slides'];
const ARCHIVE_DIR = '_archive';

const limit = limiter(6);
const listSafe = async (source, path) => { try { return await source.list(path); } catch { return []; } };
const dirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).sort(byOrder);
const mds = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).sort(byOrder);
const str = v => v == null ? '' : String(v).trim();

async function readYaml(source, path, issues) {
  let text;
  try { text = await limit(() => source.readText(path)); } catch { return null; }
  try {
    const v = parseYaml(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    issues?.push({ path, message: e instanceof YamlError ? e.message : String(e.message || e) });
    return {};
  }
}

/**
 * 把書庫的一個子資料夾包成獨立的資料來源(路徑自動加上前綴)。
 * 寫入、監看、封存都會轉給原來的來源;封存一律搬到書庫根目錄的 _archive/,保留原本的相對路徑。
 */
function subSource(parent, prefix) {
  const p = path => join(prefix, path);
  const sub = {
    kind: parent.kind,
    label: parent.label,
    prefix,
    parent,
    base: parent.base ? parent.base + prefix + '/' : undefined,
    list: path => parent.list(p(path)),
    readText: path => parent.readText(p(path)),
    ...(parent.readBytes ? { readBytes: path => parent.readBytes(p(path)) } : {}),
    mediaURL: path => parent.mediaURL(p(path)),
    releaseMedia: () => parent.releaseMedia?.(),
  };
  if (parent.refresh) sub.refresh = () => parent.refresh();
  if (parent.canWrite) {
    Object.defineProperty(sub, 'canWrite', { get: () => parent.canWrite });
    sub.ensureWritable = () => parent.ensureWritable();
    sub.stat = path => parent.stat(p(path));
    sub.writeText = (path, text, opts) => parent.writeText(p(path), text, opts);
    if (parent.move) sub.move = async (from, to, text, opts) => (await parent.move(p(from), p(to), text, opts)).slice(prefix.length + 1);
    sub.archive = async path => {
      const full = p(path);
      const dir = full.split('/').slice(0, -1).join('/');
      const to = await parent.archive(full, join(ARCHIVE_DIR, dir));
      return to;
    };
  }
  if (parent.watch) sub.watch = (paths, onChange, interval) => parent.watch(paths.map(x => p(x)), onChange, interval);
  return sub;
}

/** 依前綴或日期排序:有數字前綴的依前綴(章節),有日期的新到舊,其他依名稱。 */
function sortItems(items) {
  return items.sort((a, b) => {
    const A = splitOrder(a.name), B = splitOrder(b.name);
    if (A.order != null || B.order != null) return (A.order ?? 1e9) - (B.order ?? 1e9) || byOrder(a, b);
    if (A.date || B.date) return String(B.date || '').localeCompare(String(A.date || '')) || byOrder(a, b);
    return byOrder(a, b);
  });
}

function noteStub(path, topicId, bookPath) {
  const file = path.split('/').pop();
  const n = splitOrder(file);
  return { kind: 'note', path, file, name: file, topicId, bookPath, title: n.label, date: n.date || '' };
}

/** 筆記本:一個子資料夾。裡面更深的資料夾也算(最多三層),依路徑排序。 */
async function readBook(source, path, topicId, issues) {
  const entries = await listSafe(source, path);
  const conf = (await readYaml(source, join(path, '_book.yml'), issues)) || {};
  const notes = [];
  const walk = async (dir, list, depth) => {
    for (const f of mds(list)) notes.push(noteStub(join(dir, f.name), topicId, path));
    if (depth >= 3) return;
    for (const d of dirs(list)) await walk(join(dir, d.name), await listSafe(source, join(dir, d.name)), depth + 1);
  };
  await walk(path, entries, 1);
  const folder = path.split('/').pop();
  const n = splitOrder(folder);
  return {
    kind: 'book', path, folder, name: folder, topicId, conf,
    title: str(conf.title) || n.label,
    author: str(conf.author),
    status: str(conf.status),
    cover: str(conf.cover),
    date: conf.date != null ? String(conf.date) : (n.date || ''),
    tags: Array.isArray(conf.tags) ? conf.tags.map(String) : [],
    public: typeof conf.public === 'boolean' ? conf.public : undefined,
    notes,
  };
}

/** 筆記渠道的目錄:只讀資料夾清單與 _topic.yml / _book.yml,不讀筆記內容。 */
async function scanNotes(source) {
  const issues = [];
  const root = await listSafe(source, '');
  const topics = await Promise.all(dirs(root).map(async d => {
    const entries = await listSafe(source, d.name);
    const conf = (await readYaml(source, join(d.name, '_topic.yml'), issues)) || {};
    const loose = mds(entries).map(f => noteStub(join(d.name, f.name), d.name, ''));
    const books = await Promise.all(dirs(entries).map(x => readBook(source, join(d.name, x.name), d.name, issues)));
    const items = sortItems([...loose, ...books.filter(b => b.notes.length || Object.keys(b.conf).length)]);
    return { id: d.name, path: d.name, conf, title: str(conf.name || conf.title) || splitOrder(d.name).label, items };
  }));
  const rootNotes = mds(root).map(f => noteStub(f.name, '_', ''));
  if (rootNotes.length) topics.unshift({ id: '_', path: '', conf: {}, title: t('notes.unfiled'), items: sortItems(rootNotes) });
  return { topics, issues };
}

/** 一個主題裡所有的筆記(含筆記本裡的)。 */
const notesOfTopic = topic => (topic?.items || []).flatMap(i => i.kind === 'book' ? i.notes : [i]);

/**
 * 開啟書庫。只讀資料夾清單與設定檔(第 1 層),筆記內容由 core/graph.js 在背景讀取。
 * @returns 書庫物件:{ kind: 'leafpile'|'mdslide', title, description, theme, categories, topics, slides, notes, ... }
 */
async function openVault(source) {
  const root = await source.list('');
  const hasDir = n => root.some(e => e.kind === 'dir' && e.name === n);
  const label = source.label || t('lib.defaultLabel');

  if (!hasDir('notes') && !hasDir('slides')) {
    const slides = await scanLibrary(source);
    return assemble({ kind: 'mdslide', title: slides.title, description: slides.description, theme: slides.theme, site: {}, issues: [], slides, slidesSource: source, slidesPrefix: '', notes: { topics: [], issues: [] }, notesSource: null, boards: [] });
  }

  const issues = [];
  const site = (await readYaml(source, '_site.yml', issues)) || {};
  if (site.leafpile && Number(site.leafpile) > LEAFPILE_SCHEMA) issues.push({ path: '_site.yml', message: t('issue.newerLeafpile', { version: site.leafpile }) });
  const slidesSource = hasDir('slides') ? subSource(source, 'slides') : null;
  const notesSource = hasDir('notes') ? subSource(source, 'notes') : null;
  const boards = hasDir('boards')
    ? (await source.list('boards').catch(() => [])).filter(e => e.kind === 'file' && /\.canvas$/i.test(e.name) && !e.name.startsWith('.'))
      .map(e => ({ name: e.name.replace(/\.canvas$/i, ''), path: `boards/${e.name}` })).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const [slides, notes] = await Promise.all([
    slidesSource ? scanLibrary(slidesSource, { kind: 'library' }) : { kind: 'library', topics: [], issues: [] },
    notesSource ? scanNotes(notesSource) : { topics: [], issues: [] },
  ]);
  return assemble({ kind: 'leafpile', title: str(site.title) || label, description: str(site.description), theme: str(site.theme), site, issues, slides, slidesSource, slidesPrefix: 'slides', notes, notesSource, boards });
}

function assemble(v) {
  const prefixIssues = (list, prefix) => list.map(i => ({ ...i, path: prefix ? join(prefix, i.path) : i.path }));
  const ids = [...new Set([...v.notes.topics.map(x => x.id), ...v.slides.topics.map(x => x.id)])]
    .sort((a, b) => a === '_' ? -1 : b === '_' ? 1 : byOrder({ name: a }, { name: b }));
  const topics = ids.map((id, i) => {
    const n = v.notes.topics.find(x => x.id === id);
    const s = v.slides.topics.find(x => x.id === id);
    const conf = n?.conf || {};
    return {
      id,
      title: n?.title || s?.title || splitOrder(id).label,
      description: str(conf.description) || s?.description || '',
      color: safeColor(conf.color) || s?.color || PALETTE[i % PALETTE.length],
      category: str(conf.category) || s?.category || '',
      conf,
      notes: n || null,
      decks: s?.projects || [],
      slidesTopic: s || null,
    };
  });
  const categories = readCategories(v.site.categories, topics);
  return {
    ...v,
    topics,
    categories,
    issues: [...v.issues, ...prefixIssues(v.notes.issues, 'notes'), ...prefixIssues(v.slides.issues, v.slidesPrefix)],
    deckPath: project => join(v.slidesPrefix, project.path),
    notePath: rel => join('notes', rel),
    scannedAt: Date.now(),
  };
}

/** _site.yml 的 categories;沒有列出的分類放在最後的「其他」。 */
function readCategories(list, topics) {
  const out = (Array.isArray(list) ? list : [])
    .filter(c => c && typeof c === 'object' && c.id != null)
    .map(c => ({ id: String(c.id), name: str(c.name) || String(c.id), color: safeColor(c.color) || '' }));
  const known = new Set(out.map(c => c.id));
  const rest = topics.filter(tp => !known.has(tp.category));
  if (rest.length && out.length) out.push({ id: '', name: t('shelf.otherCategory'), color: '' });
  for (const c of out) c.topics = topics.filter(tp => c.id ? tp.category === c.id : !known.has(tp.category));
  return out.filter(c => c.topics.length);
}

/** 找筆記(rel = 在 notes/ 裡的路徑)。 */
function findNote(vault, rel) {
  for (const tp of vault.notes.topics) for (const n of notesOfTopic(tp)) if (n.path === rel) return { note: n, topic: tp, book: tp.items.find(i => i.kind === 'book' && i.path === n.bookPath) || null };
  return null;
}

/** 找簡報。 */
function findDeck(vault, topicId, projectId) {
  return vault.slides.topics.find(tp => tp.id === topicId)?.projects.find(p => p.id === projectId) || null;
}
return { LEAFPILE_SCHEMA, CHANNELS, ARCHIVE_DIR, readYaml, subSource, scanNotes, notesOfTopic, openVault, findNote, findDeck };
})();

// ───────── app/core/links.js ─────────
__m["app/core/links.js"] = (() => {
// [[連結]] 的目標比對與反向連結。純邏輯,只吃「紀錄」不讀檔案。
//
// 紀錄(由 core/graph.js 產生):
//   筆記 { kind: 'note', path: 'notes/10-reading/x.md', rel: '10-reading/x.md', topicId, title, aliases, date }
//   簡報 { kind: 'deck', path: 'slides/10-reading/2026-x', rel: '10-reading/2026-x', topicId, title, folder, date }
//
// 比對順序(docs/SPEC.md 第 5 節):title → aliases → 檔名(去前綴)→ 檔名 → 路徑。
// 多個符合時:同主題優先,再來是較新的日期;同一層仍有多個 = ambiguous(檢查工具提醒改寫成路徑)。

const { splitOrder } = __m["app/core/names.js"];
const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const stripExt = s => s.replace(/\.md$/i, '');

/** 一筆紀錄可以被哪些名稱找到。exact = 路徑(唯一,不算重名)。 */
function keysOf(rec) {
  const base = rec.kind === 'note' ? stripExt(rec.rel.split('/').pop()) : rec.folder || rec.rel.split('/').pop();
  const loose = [rec.title, ...(rec.aliases || []), splitOrder(base).label, base];
  const exact = rec.kind === 'note' ? [stripExt(rec.rel), stripExt(rec.path)] : [rec.rel, rec.path];
  return { loose: [...new Set(loose.filter(Boolean).map(norm))], exact: [...new Set(exact.filter(Boolean).map(norm))] };
}

/**
 * 建立比對器。
 * @param {object[]} records 筆記與簡報紀錄
 */
function createResolver(records) {
  const maps = { note: { loose: new Map(), exact: new Map() }, deck: { loose: new Map(), exact: new Map() } };
  for (const r of records) {
    const m = maps[r.kind];
    if (!m) continue;
    const k = keysOf(r);
    for (const key of k.exact) m.exact.set(key, r);
    for (const key of k.loose) {
      if (!m.loose.has(key)) m.loose.set(key, []);
      if (!m.loose.get(key).includes(r)) m.loose.get(key).push(r);
    }
  }

  /**
   * @param {{ channel: 'notes'|'slides', target: string }} link
   * @param {{ fromTopic?: string, fromPath?: string }} [ctx]
   * @returns {{ status: 'ok'|'missing'|'ambiguous'|'self', target?: object, candidates?: object[] }}
   */
  function resolve(link, ctx = {}) {
    const kind = link.channel === 'slides' ? 'deck' : 'note';
    const m = maps[kind];
    if (!link.target) {
      // [[#標題]]:同一篇筆記裡的段落
      return kind === 'note' && ctx.fromPath ? { status: 'self' } : { status: 'missing' };
    }
    const key = norm(stripExt(link.target).replace(/^\/+/, ''));
    const exact = m.exact.get(key);
    if (exact) return { status: 'ok', target: exact };
    const found = m.loose.get(key) || [];
    if (!found.length) return { status: 'missing' };
    if (found.length === 1) return { status: 'ok', target: found[0] };
    const same = found.filter(r => ctx.fromTopic && r.topicId === ctx.fromTopic);
    const tier = same.length ? same : found;
    const sorted = [...tier].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return { status: tier.length > 1 ? 'ambiguous' : 'ok', target: sorted[0], candidates: sorted };
  }
  return { resolve };
}

/**
 * 反向連結:目標路徑 → 連到它的紀錄。
 * 每筆來源紀錄需要 links([{ channel, target }])與 topicId;簡報另外看 source(升級自哪一份筆記)。
 * 一份簡報在圖譜裡只算一個點(不是每張投影片)。
 * @returns {Map<string, { from: object, via: 'link'|'source' }[]>}
 */
function computeBacklinks(records, resolver) {
  const out = new Map();
  const add = (target, from, via) => {
    if (!target || target === from) return;
    if (!out.has(target.path)) out.set(target.path, []);
    const list = out.get(target.path);
    if (!list.some(x => x.from === from)) list.push({ from, via });
  };
  for (const r of records) {
    for (const l of r.links || []) {
      const res = resolver.resolve(l, { fromTopic: r.topicId, fromPath: r.path });
      if (res.target) add(res.target, r, 'link');
    }
    if (r.kind === 'deck' && r.source) {
      // source 可以指向一篇筆記或一個筆記本資料夾;筆記本的每一篇都算被引用
      const src = norm(stripExt(r.source).replace(/^\/+|\/+$/g, ''));
      for (const n of records) {
        if (n.kind !== 'note') continue;
        const p = norm(stripExt(n.path));
        if (p === src || p.startsWith(src + '/')) add(n, r, 'source');
      }
    }
  }
  return out;
}
return { norm, createResolver, computeBacklinks };
})();

// ───────── app/core/privacy.js ─────────
__m["app/core/privacy.js"] = (() => {
// 公開與私人:唯一的判斷規則。網站、守門腳本、匯出都呼叫這裡(docs/SPEC.md 第 6 節)。
//   筆記 front matter 的 public → 筆記本 _book.yml → 主題 _topic.yml → 私人
//   主題設定 local_only: true → 不管 public 寫什麼,都不能放上 GitHub

const bool = v => typeof v === 'boolean' ? v : undefined;

/** @returns {boolean} 這篇筆記是否公開 */
function resolvePublic({ note = {}, book = {}, topic = {} } = {}) {
  for (const v of [note.public, book?.public, topic?.public]) {
    const b = bool(v);
    if (b !== undefined) return b;
  }
  return false;
}

/** 主題是否只留在本機。 */
const isLocalOnly = topic => topic?.local_only === true || topic?.localOnly === true;

/**
 * 這篇筆記能不能放上公開的地方(GitHub、匯出給別人)。
 * @returns {{ ok: boolean, reason: '' | 'local-only' | 'private' }}
 */
function publishable(ctx) {
  if (isLocalOnly(ctx.topic)) return { ok: false, reason: 'local-only' };
  if (!resolvePublic(ctx)) return { ok: false, reason: 'private' };
  return { ok: true, reason: '' };
}

// 個資樣式(沿用讀書筆記 Vault 的個資掃描):只用來提醒,不自動擋下。
const PII = [
  { key: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { key: 'phone', re: /(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/ },
  { key: 'tw-id', re: /(?<![A-Za-z0-9])[A-Z][12]\d{8}(?!\d)/ },
];

/** 掃描個資(程式碼區塊裡的不算)。每種樣式只回報第一個。 */
function scanPII(text) {
  const body = String(text).replace(/(```|~~~)[\s\S]*?\1/g, '');
  const out = [];
  for (const { key, re } of PII) {
    const m = body.match(re);
    if (m) out.push({ key, match: m[0] });
  }
  return out;
}

// 範例網域與保留網域:文件裡常見,不算個資
const EXAMPLE_MAIL = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;

/**
 * 掃描個資,列出每一筆(含行號)。程式碼區塊裡的、範例網域的 Email 不算。
 * @returns {{ key: string, match: string, line: number }[]}  line 從 1 開始
 */
function scanPIIAll(text) {
  const out = [], seen = new Set();
  let fence = null;
  String(text).split('\n').forEach((line, i) => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1]; else if (line.trim().startsWith(fence)) fence = null; return; }
    if (fence) return;
    const plain = line.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    for (const { key, re } of PII) {
      for (const m of plain.matchAll(new RegExp(re.source, 'g'))) {
        if (key === 'email' && EXAMPLE_MAIL.test(m[0])) continue;
        const id = key + '|' + m[0];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ key, match: m[0], line: i + 1 });
      }
    }
  });
  return out;
}

/** 螢幕上顯示用:遮掉中間,只留頭尾(截圖時不會整筆外流)。 */
function maskPII(key, s) {
  const str = String(s);
  if (key === 'email') {
    const [user, domain] = str.split('@');
    return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, user.length - 1))}@${domain}`;
  }
  const keep = Math.min(3, Math.floor(str.length / 4));
  return str.slice(0, keep) + str.slice(keep, str.length - keep).replace(/[A-Za-z0-9]/g, '*') + str.slice(str.length - keep);
}

/**
 * 發布前檢查:哪些筆記會公開、哪些有個資。
 * @param {{ rel: string, title: string, text: string, public: boolean, localOnly: boolean, kind?: 'note'|'slide' }[]} items
 */
function auditPrivacy(items) {
  const notes = items.filter(i => i.kind !== 'slide');
  const counts = {
    public: notes.filter(n => n.public && !n.localOnly).length,
    private: notes.filter(n => !n.public && !n.localOnly).length,
    localOnly: notes.filter(n => n.localOnly).length,
  };
  const exposed = i => i.kind === 'slide' ? !i.localOnly : i.public && !i.localOnly; // 簡報沒有 public 設定:會跟著書庫公開
  const pii = items.map(i => ({ ...i, exposed: exposed(i), hits: scanPIIAll(i.text) })).filter(i => i.hits.length)
    .map(({ text, ...rest }) => rest)
    .sort((a, b) => Number(b.exposed) - Number(a.exposed) || a.rel.localeCompare(b.rel));
  return { counts, publicNotes: notes.filter(n => n.public && !n.localOnly).map(n => ({ rel: n.rel, title: n.title })), pii };
}

/**
 * 訪客視角:只留下會公開的筆記(書庫的其他結構不變,可以直接交給書架畫面)。
 * 只留本機的主題裡的簡報也拿掉。
 * @param {object} vault  core/vault.js 的書庫物件
 * @param {(rel: string) => boolean} visible  這篇筆記訪客看不看得到
 */
function visitorVault(vault, visible) {
  const keep = nt => nt && {
    ...nt,
    items: nt.items
      .map(i => (i.kind === 'book' ? { ...i, notes: i.notes.filter(n => visible(n.path)) } : i))
      .filter(i => (i.kind === 'book' ? i.notes.length : visible(i.path))),
  };
  const notesTopics = (vault.notes?.topics || []).map(keep);
  const byId = new Map(notesTopics.map(x => [x.id, x]));
  const topics = vault.topics.map(tp => {
    const local = isLocalOnly(tp.conf) || isLocalOnly(tp.notes?.conf);
    return { ...tp, notes: tp.notes ? byId.get(tp.notes.id) : tp.notes, decks: local ? [] : tp.decks };
  });
  const byTopic = new Map(topics.map(x => [x.id, x]));
  return {
    ...vault,
    topics,
    notes: vault.notes ? { ...vault.notes, topics: notesTopics } : vault.notes,
    categories: (vault.categories || []).map(c => ({ ...c, topics: c.topics.map(tp => byTopic.get(tp.id) || tp) })),
  };
}
return { resolvePublic, isLocalOnly, publishable, PII, scanPII, scanPIIAll, maskPII, auditPrivacy, visitorVault };
})();

// ───────── app/core/table.js ─────────
__m["app/core/table.js"] = (() => {
// 筆記的表格檢視(唯讀):把每篇筆記的 front matter 排成一列,可以排序、篩選。
// 純邏輯,瀏覽器與測試共用。只讀不寫,不會改到任何檔案。

const { LAYOUT_KEYS } = __m["app/core/note.js"];
// 已經有固定欄位或屬於系統用途的鍵,不再當成自訂欄位
const RESERVED = new Set(['title', 'date', 'tags', 'aliases', 'public', 'private', 'local_only', 'lang', 'source', 'source_hash',
  'pinned', 'expires', 'from_deck', 'cssclasses', ...LAYOUT_KEYS]);

/** front matter 裡可以當成欄位的鍵值(只收文字、數字、是非、與由這些組成的清單)。 */
function noteFields(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (RESERVED.has(k) || k.startsWith('x-') || v == null || v === '') continue;
    const ok = x => ['string', 'number', 'boolean'].includes(typeof x) || x instanceof Date;
    if (ok(v)) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    else if (Array.isArray(v) && v.length && v.every(ok)) out[k] = v.map(x => (x instanceof Date ? x.toISOString().slice(0, 10) : x));
  }
  return out;
}

/** 至少一篇筆記有的自訂欄位,依出現次數(多的在前)、再依名稱排序,最多 max 個。 */
function tableColumns(rows, max = 6) {
  const count = new Map();
  for (const r of rows) for (const k of Object.keys(r.fields || {})) count.set(k, (count.get(k) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
}

/** 儲存格顯示的文字。 */
function cellText(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(cellText).join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}

/** 一列在某欄的值:固定欄位直接取,其餘從 fields 取。 */
const valueOf = (row, key) => (key in row && key !== 'fields' ? row[key] : row.fields?.[key]);

/** 比大小:數字照數字、其餘照文字(日期 YYYY-MM-DD 照文字比就對)。空的一律排最後。 */
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);

function compareCells(a, b) {
  const ea = isEmpty(a), eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** 依某欄排序(不改原陣列)。空值不管升冪降冪都排最後;同值依標題。 */
function sortRows(rows, key, dir = 'asc') {
  const s = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = valueOf(x, key), b = valueOf(y, key);
    if (isEmpty(a) !== isEmpty(b)) return isEmpty(a) ? 1 : -1;
    return (compareCells(a, b) * s) || compareCells(x.title, y.title);
  });
}

/**
 * 篩選:words 每個字都要出現在這列的某處(標題、路徑、標籤、欄位值);
 * tag 指定時只留有這個標籤的;keep(row) 是額外條件(例如分類)。
 */
function filterRows(rows, { words = [], tag = '', keep = null } = {}) {
  return rows.filter(r => {
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (keep && !keep(r)) return false;
    if (!words.length) return true;
    const hay = [r.title, r.rel, r.topic, r.book, r.date, ...(r.tags || []), ...Object.values(r.fields || {}).map(cellText)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

// ---------- 分組 ----------
// 依某個欄位把列分成幾組(每組可以在畫面上折疊)。組內保留傳進來的順序(先排序再分組)。
// 標籤或清單欄位:一列可以同時出現在好幾組。沒有值的列放在最後一組(id 為 '')。

/** 內建的分組依據;另外任何自訂欄位名稱都可以。 */
const GROUP_KEYS = ['category', 'topic', 'book', 'year', 'month', 'tags'];

/** 一列在某個分組依據下屬於哪些組(id 清單)。 */
function groupIdsOf(row, key) {
  if (key === 'category') return [row.category || ''];
  if (key === 'topic') return [row.topicId || ''];
  if (key === 'year') return [/^\d{4}/.test(row.date || '') ? row.date.slice(0, 4) : ''];
  if (key === 'month') return [/^\d{4}-\d{2}/.test(row.date || '') ? row.date.slice(0, 7) : ''];
  const v = key === 'tags' ? row.tags : key === 'book' ? row.book : row.fields?.[key];
  if (Array.isArray(v)) return v.length ? [...new Set(v.map(cellText))] : [''];
  return [isEmpty(v) ? '' : cellText(v)];
}

/**
 * 分組。
 * @param {object[]} rows 已經排序、篩選過的列
 * @param {string} key 分組依據('' = 不分組)
 * @param {{ order?: string[], labels?: Map<string,string>|object }} [opts]
 *   order:這些 id 依給定順序排在前面(分類、主題用書庫的順序);其餘:年、月由新到舊,其他依名稱
 *   labels:id → 顯示名稱(分類 id → 分類名稱)
 * @returns {{ id: string, label: string, rows: object[] }[]}
 */
function groupRows(rows, key, { order = [], labels = {} } = {}) {
  if (!key) return [{ id: '*', label: '', rows: [...rows] }];
  const lab = id => (labels instanceof Map ? labels.get(id) : labels[id]) || id;
  const groups = new Map();
  for (const r of rows) {
    for (const id of groupIdsOf(r, key)) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(r);
    }
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  const desc = key === 'year' || key === 'month';
  const ids = [...groups.keys()].sort((a, b) => {
    if (!a || !b) return a === b ? 0 : a ? -1 : 1; // 沒有值的放最後
    const pa = pos.get(a), pb = pos.get(b);
    if (pa != null || pb != null) return pa == null ? 1 : pb == null ? -1 : pa - pb;
    return desc ? b.localeCompare(a) : lab(a).localeCompare(lab(b), undefined, { numeric: true, sensitivity: 'base' });
  });
  return ids.map(id => ({ id, label: id ? lab(id) : '', rows: groups.get(id) }));
}

// ---------- 月曆 ----------
// 依筆記的 date 欄位排進月曆。月份用 'YYYY-MM' 字串表示;週日開始。

const pad2 = n => String(n).padStart(2, '0');

/** 'YYYY-MM' 往前後移 n 個月。 */
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/**
 * 一個月的月曆格子:幾週,每週 7 天(週日開始),前後補上個月、下個月的日子。
 * @returns {{ date: string, day: number, inMonth: boolean }[][]}
 */
function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const weeks = [];
  for (let d = new Date(start); weeks.length < 6; ) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
    if (d.getUTCMonth() !== m - 1) break;
  }
  return weeks;
}

/** 依日期(date 的前 10 個字)分好的筆記;沒有合法日期的略過。 */
function rowsByDay(rows) {
  const out = new Map();
  for (const r of rows) {
    const d = String(r.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!out.has(d)) out.set(d, []);
    out.get(d).push(r);
  }
  return out;
}

/** 一開始顯示哪個月:這個月有筆記就是這個月,否則是最近一個有筆記的月份(都沒有就是這個月)。 */
function defaultMonth(rows, today) {
  const now = String(today).slice(0, 7);
  const months = [...new Set(rows.map(r => String(r.date || '').slice(0, 7)).filter(x => /^\d{4}-\d{2}$/.test(x)))].sort();
  if (!months.length || months.includes(now)) return now;
  const past = months.filter(x => x <= now);
  return past.length ? past.at(-1) : months[0];
}

/** 看板的欄:沒選分組依據時,有 status 欄位就用它,否則用主題。 */
function kanbanKey(chosen, fieldKeys) {
  if (chosen) return chosen;
  return fieldKeys.includes('status') ? 'status' : 'topic';
}

/**
 * 依畫布篩選(卡片庫用):'' = 全部、'!' = 還沒放上任何畫布、其他 = 畫布名稱。
 * row.boards 是這篇筆記出現的畫布名稱(core/canvas.js 的 boardRefs)。
 */
const NO_BOARD = '!';
function matchBoard(row, filter) {
  if (!filter) return true;
  const list = row?.boards || [];
  return filter === NO_BOARD ? list.length === 0 : list.includes(filter);
}

/** 卡片上的內文摘要:拿掉 Markdown 記號,只留可讀的文字;開頭和 title 相同的 # 標題略過。 */
function plainExcerpt(body, max = 280, title = '') {
  const text = String(body || '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^\s*#\s+(.+)\n?/, (m, h) => (title && h.trim() === String(title).trim() ? '' : m)) // 和卡片標題一樣的 # 標題略過
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, a, b) => b || a.replace(/^slides:/i, ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, ' ') // 表格的分隔列
    .replace(/\|/g, ' ')
    .replace(/[*_~`=]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
return { noteFields, tableColumns, cellText, valueOf, compareCells, sortRows, filterRows, GROUP_KEYS, groupIdsOf, groupRows, shiftMonth, monthGrid, rowsByDay, defaultMonth, kanbanKey, NO_BOARD, matchBoard, plainExcerpt };
})();

// ───────── app/core/graph.js ─────────
__m["app/core/graph.js"] = (() => {
// 書庫圖譜:在背景讀完所有筆記(與投影片裡的 [[連結]]),建立標題、連結、反向連結與搜尋索引。
// 書架不必等它:沒建好之前用檔名當標題,建好後再補上。

const { limiter } = __m["app/core/library.js"];
const { join, isHidden, isMarkdown, RESERVED_DIRS } = __m["app/core/names.js"];
const { parseNote, wikilinksOf, sourceFingerprint } = __m["app/core/note.js"];
const { createResolver, computeBacklinks, norm } = __m["app/core/links.js"];
const { resolvePublic, isLocalOnly } = __m["app/core/privacy.js"];
const { notesOfTopic } = __m["app/core/vault.js"];
const { noteFields } = __m["app/core/table.js"];
const limit = limiter(6);

/** 簡報資料夾裡所有投影片檔(第一層與章節資料夾)。 */
async function slideFiles(source, deckPath) {
  const out = [];
  let entries;
  try { entries = await source.list(deckPath); } catch { return out; }
  for (const e of entries) {
    if (e.kind === 'file' && isMarkdown(e.name)) out.push(join(deckPath, e.name));
    if (e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())) {
      try { for (const f of await source.list(join(deckPath, e.name))) if (f.kind === 'file' && isMarkdown(f.name)) out.push(join(deckPath, e.name, f.name)); } catch { /* 讀不到就略過 */ }
    }
  }
  return out;
}

/**
 * @param vault core/vault.js 的 openVault() 結果
 * @param {{ onProgress?: (done: number, total: number) => void, slides?: boolean }} [opts]
 */
async function buildGraph(vault, { onProgress, slides = true } = {}) {
  const notes = [], decks = [], issues = [];
  const jobs = [];
  for (const tp of vault.notes.topics) {
    for (const stub of notesOfTopic(tp)) {
      const book = tp.items.find(i => i.kind === 'book' && i.path === stub.bookPath) || null;
      jobs.push(async () => {
        let text;
        try { text = await limit(() => vault.notesSource.readText(stub.path)); } catch { issues.push({ path: vault.notePath(stub.path), message: 'read' }); return; }
        const n = parseNote(text, { path: stub.path });
        // 書架上的卡片直接共用 stub:補上真正的標題與日期
        stub.title = n.title; stub.date = n.date; stub.excerpt = n.excerpt; stub.tags = n.tags; stub.pinned = n.pinned;
        notes.push({
          kind: 'note', path: vault.notePath(stub.path), rel: stub.path, topicId: tp.id, bookPath: stub.bookPath,
          title: n.title, aliases: n.aliases, date: n.date, tags: n.tags, excerpt: n.excerpt,
          pinned: n.pinned, expires: n.expires, fromDeck: n.fromDeck, links: n.links, headings: n.headings,
          public: resolvePublic({ note: n, book: book?.conf, topic: tp.conf }), localOnly: isLocalOnly(tp.conf),
          layoutKeys: n.layoutKeys, issues: n.issues, body: n.body, fields: noteFields(n.data),
          search: norm([n.title, ...n.aliases, ...n.tags, n.body].join(' ')),
          stub,
        });
      });
    }
  }
  for (const tp of vault.slides.topics) {
    for (const p of tp.projects) {
      const rec = { kind: 'deck', path: vault.deckPath(p), rel: p.path, topicId: tp.id, title: p.title, folder: p.folder, date: p.date, source: p.config?.source ? String(p.config.source) : '', sourceHash: p.config?.source_hash != null ? String(p.config.source_hash) : '', links: [], project: p, search: norm([p.title, p.subtitle, p.author, ...p.tags].join(' ')) };
      decks.push(rec);
      if (!slides) continue;
      jobs.push(async () => {
        for (const f of await slideFiles(vault.slidesSource, p.path)) {
          try {
            const text = await limit(() => vault.slidesSource.readText(f));
            for (const l of wikilinksOf(text)) rec.links.push({ ...l, file: join(vault.slidesPrefix, f) });
          } catch { /* 讀不到的檔案由檢查工具回報 */ }
        }
      });
    }
  }
  let done = 0;
  onProgress?.(0, jobs.length);
  await Promise.all(jobs.map(j => j().finally(() => onProgress?.(++done, jobs.length))));
  notes.sort((a, b) => a.path.localeCompare(b.path));
  const records = [...notes, ...decks];
  const resolver = createResolver(records);
  return {
    notes: new Map(notes.map(n => [n.path, n])),
    decks: new Map(decks.map(d => [d.path, d])),
    records, resolver, issues,
    backlinks: computeBacklinks(records, resolver),
    builtAt: Date.now(),
  };
}

/** deck.yml 的 source 指到的筆記:一篇筆記,或筆記本資料夾裡的所有筆記(依路徑排序)。 */
function sourceNotesOf(graph, source) {
  const src = norm(String(source || '').replace(/\.md$/i, '').replace(/^\/+|\/+$/g, ''));
  if (!src) return [];
  return [...graph.notes.values()].filter(n => { const p = norm(n.path.replace(/\.md$/i, '')); return p === src || p.startsWith(src + '/'); });
}

/**
 * 簡報與來源筆記的關係(docs/INTEROP.md 第 4 節):
 *   ''          沒有 source
 *   'missing'   source 找不到
 *   'untracked' 有 source 但沒有 source_hash(手寫或舊版升級的簡報)
 *   'same'      升級之後來源筆記沒改過
 *   'changed'   升級之後來源筆記改過了:簡報可能需要跟上
 * @returns {{ status: string, notes: object[], hash: string }}
 */
function sourceStatus(graph, deck) {
  if (!deck?.source) return { status: '', notes: [], hash: '' };
  return { ...compareSource(deck.sourceHash, sourceNotesOf(graph, deck.source)), notes: sourceNotesOf(graph, deck.source) };
}

/**
 * 比對指紋。notes = [{ path, body }]:可以是圖譜裡的,也可以是剛重新讀取的(圖譜可能是之前建的)。
 * @returns {{ status: 'missing'|'untracked'|'same'|'changed', hash: string }}
 */
function compareSource(sourceHash, notes) {
  if (!notes.length) return { status: 'missing', hash: '' };
  const hash = sourceFingerprint(notes);
  if (!sourceHash) return { status: 'untracked', hash };
  return { status: String(sourceHash).toLowerCase() === hash ? 'same' : 'changed', hash };
}

/**
 * 搜尋:多個關鍵字全部符合才算;標題符合的排前面。
 * @returns {object[]} 筆記與簡報紀錄
 */
function searchGraph(graph, query, { limit: max = 50 } = {}) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const r of graph.records) {
    if (!words.every(w => r.search.includes(w))) continue;
    const title = norm(r.title);
    hits.push({ r, score: words.filter(w => title.includes(w)).length * 10 + (title.startsWith(words[0]) ? 5 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || String(b.r.date || '').localeCompare(String(a.r.date || ''))).slice(0, max).map(h => h.r);
}
return { buildGraph, sourceNotesOf, sourceStatus, compareSource, searchGraph };
})();

// ───────── app/core/canvas.js ─────────
__m["app/core/canvas.js"] = (() => {
// 畫布:boards/*.canvas,JSON Canvas 1.0(https://jsoncanvas.org/)。純邏輯,不碰畫面。
//
// 原則(docs/SPEC.md 第 7 節、docs/INTEROP.md 第 6 節):
//   - 畫布只存位置與連線,不複製筆記或簡報的內容;卡片顯示時才去讀標題。
//   - 讀寫時保留所有不認得的欄位(包括 Obsidian 與其他工具加的),Leafpile 自訂的欄位一律 x- 開頭。
//   - 從畫布移除卡片只改畫布,不會動到筆記或簡報檔案。

const { norm } = __m["app/core/links.js"];
const NODE_TYPES = ['text', 'file', 'link', 'group'];
const SIDES = ['top', 'right', 'bottom', 'left'];
/** JSON Canvas 的預設色 1–6(紅橙黃綠青紫),對應 Leafpile 的色票。 */
const PRESET_COLORS = { 1: '#c0504d', 2: '#d9822b', 3: '#c9a227', 4: '#5a8f5a', 5: '#3f8c9a', 6: '#8a6bb0' };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** 顏色:"1"–"6" 或 #rrggbb;其他一律不用(避免把任意字串放進樣式)。 */
function canvasColor(c) {
  if (c == null || c === '') return '';
  const s = String(c).trim();
  if (PRESET_COLORS[s]) return PRESET_COLORS[s];
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(s) ? s : '';
}

/**
 * 解析畫布檔。壞掉的節點與連線略過並記在 issues,其餘照常顯示。
 * @returns {{ nodes: object[], edges: object[], extra: object, issues: string[] }}
 */
function parseCanvas(text) {
  let data;
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '') || '{}'); } catch (e) { throw new Error(`JSON: ${e.message}`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON: not an object');
  const { nodes = [], edges = [], ...extra } = data;
  const issues = [], ids = new Set(), out = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || typeof n !== 'object' || !n.id || !NODE_TYPES.includes(n.type)) { issues.push(`node ${n?.id ?? '?'}: type`); continue; }
    if (ids.has(n.id)) { issues.push(`node ${n.id}: duplicate id`); continue; }
    ids.add(n.id);
    out.push({ ...n, x: num(n.x, 0), y: num(n.y, 0), width: Math.max(40, num(n.width, 260)), height: Math.max(30, num(n.height, 120)) });
  }
  const outEdges = [];
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || !e.id || !ids.has(e.fromNode) || !ids.has(e.toNode)) { issues.push(`edge ${e?.id ?? '?'}: node`); continue; }
    outEdges.push({ ...e });
  }
  return { nodes: out, edges: outEdges, extra, issues };
}

/** 存檔用的文字:群組放最前面(畫在最底下),其他照原順序;2 格縮排,結尾換行。 */
function serializeCanvas(board) {
  const groups = board.nodes.filter(n => n.type === 'group'), rest = board.nodes.filter(n => n.type !== 'group');
  const round = n => ({ ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) });
  return JSON.stringify({ ...board.extra, nodes: [...groups, ...rest].map(round), edges: board.edges }, null, 2) + '\n';
}

const emptyCanvas = () => '{\n  "nodes": [],\n  "edges": []\n}\n';

/** 新的 id(不和現有的重複)。 */
function newId(board, prefix = 'n') {
  const used = new Set([...board.nodes.map(n => n.id), ...board.edges.map(e => e.id)]);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${Date.now().toString(36)}${i > 1 ? '-' + i : ''}`;
    if (!used.has(id)) return id;
  }
}

/** 一條邊在節點上的端點;沒指定邊就挑面對另一個節點的那一側。 */
function anchor(node, side, other) {
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
  let s = SIDES.includes(side) ? side : null;
  if (!s && other) {
    const ox = other.x + other.width / 2, oy = other.y + other.height / 2;
    const dx = (ox - cx) / node.width, dy = (oy - cy) / node.height;
    s = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }
  switch (s) {
    case 'top': return { x: cx, y: node.y, side: s };
    case 'bottom': return { x: cx, y: node.y + node.height, side: s };
    case 'left': return { x: node.x, y: cy, side: s };
    default: return { x: node.x + node.width, y: cy, side: 'right' };
  }
}

/** 連線的路徑(三次貝茲曲線)與標籤位置。 */
function edgePath(from, to, fromSide, toSide) {
  const a = anchor(from, fromSide, to), b = anchor(to, toSide, from);
  const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
  const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  const [ax, ay] = dir[a.side], [bx, by] = dir[b.side];
  const c1 = { x: a.x + ax * k, y: a.y + ay * k }, c2 = { x: b.x + bx * k, y: b.y + by * k };
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, a, b, mid, endDir: [bx, by] };
}

/** 所有節點的外框(沒有節點時回傳 null)。 */
function bounds(nodes) {
  if (!nodes.length) return null;
  const xs = nodes.flatMap(n => [n.x, n.x + n.width]), ys = nodes.flatMap(n => [n.y, n.y + n.height]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * file 節點指到什麼:
 *   筆記 notes/…/x.md → { kind: 'note', rec }
 *   簡報 slides/…/deck.yml(或簡報資料夾) → { kind: 'deck', rec }
 *   其他檔案或找不到 → { kind: 'missing' }
 * @param {{ notes: Map, decks: Map }} graph
 */
function resolveFile(file, graph) {
  const p = norm(String(file || '').replace(/^\/+/, ''));
  if (!p) return { kind: 'missing' };
  for (const n of graph.notes.values()) if (norm(n.path) === p) return { kind: 'note', rec: n };
  const deckDir = p.replace(/\/deck\.ya?ml$/, '');
  for (const d of graph.decks.values()) if (norm(d.path) === deckDir) return { kind: 'deck', rec: d };
  return { kind: 'missing' };
}

/** 畫布裡指不到檔案的卡片(給檢查工具)。 */
function missingFiles(board, graph) {
  return board.nodes.filter(n => n.type === 'file' && resolveFile(n.file, graph).kind === 'missing').map(n => n.file);
}

/** 畫布檔名:去掉不能用的字元,加上 .canvas。 */
function boardFileName(name) {
  const safe = String(name).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'board';
  return `${safe}.canvas`;
}

// ---------- 檔案卡的種類與嵌入 ----------

const EXT = p => (String(p).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']);

/** file 卡片指的是哪一種檔案:note / deck(由 resolveFile 判斷)、image、html、pdf、other。 */
function fileKind(file) {
  const e = EXT(file);
  if (IMAGE_EXT.has(e)) return 'image';
  if (e === 'html' || e === 'htm') return 'html';
  if (e === 'pdf') return 'pdf';
  if (e === 'md') return 'note';
  if (/(^|\/)deck\.ya?ml$/i.test(String(file))) return 'deck';
  return 'other';
}

/** PDF 卡從第幾頁開始:JSON Canvas 的 subpath 欄位寫 "#page=3"(和 Obsidian 相同);沒有或不合法就是 0。 */
function pdfPage(node) {
  const m = String(node?.subpath || '').match(/^#page=(\d{1,5})$/);
  return m && +m[1] > 0 ? +m[1] : 0;
}

/** 使用者貼上的可能是整段 <iframe ...>(Google 簡報的嵌入碼):取出 src。 */
function extractURL(input) {
  const s = String(input || '').trim();
  const m = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  return (m ? m[1] : s).replace(/&amp;/g, '&').trim();
}

/**
 * 連結卡能不能嵌入、嵌入哪個網址:
 *   YouTube、Vimeo、Bilibili、Google 雲端硬碟 → 播放器(一定嵌入)
 *   Google 簡報 → /embed(一定嵌入)
 *   其他 https 網頁 → 卡片設了 x-embed 才嵌入
 * 只接受 https。
 * @param {(url: string) => object} classify  core/media.js 的 classifyMedia
 * @returns {{ url: string, provider: string, auto: boolean } | null}
 */
function embedFor(node, classify) {
  const url = String(node?.url || '');
  if (!/^https:\/\//i.test(url)) return null;
  const c = classify(url);
  if (c.kind === 'embed' && c.embed && !c.interactive) return { url: c.embed, provider: c.provider, auto: true };
  let m;
  if ((m = url.match(/^https:\/\/docs\.google\.com\/presentation\/d\/(e\/[\w-]+|[\w-]+)/))) {
    return { url: `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`, provider: 'Google Slides', auto: true };
  }
  if (node['x-embed'] === true) return { url: c.kind === 'embed' && c.embed ? c.embed : url, provider: c.provider || new URL(url).hostname, auto: false };
  return null;
}

/**
 * 簡報模式的順序:有群組就一個群組一頁,沒有就一張卡片一頁。
 * 由上到下、同一列由左到右(上緣差不到一半高度算同一列)。
 */
function slideOrder(board) {
  const groups = board.nodes.filter(n => n.type === 'group');
  const items = groups.length ? groups : board.nodes;
  return [...items].sort((a, b) => {
    const row = Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2;
    return row ? a.x - b.x : a.y - b.y;
  });
}

/** 文字卡轉成筆記:標題取第一個標題或第一行;內文保留(標題那一行拿掉)。 */
function textToNote(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return { title: '', body: '' };
  const first = lines[i].trim();
  const title = first.replace(/^#{1,6}\s+/, '').replace(/[*_`[\]]/g, '').trim().slice(0, 80);
  const body = (/^#{1,6}\s/.test(first) ? [...lines.slice(0, i), ...lines.slice(i + 1)] : lines).join('\n').trim();
  return { title, body };
}

/** 比對畫布卡片的 file 欄位用的鍵(boardRefs 的鍵)。 */
const fileKey = file => norm(String(file || '').replace(/^\/+/, ''));

/** 筆記出現在哪些畫布的哪些卡片(只比對 file 欄位)。 */
function boardsWith(boards, path) {
  return boardRefs(boards).get(fileKey(path)) || [];
}

/**
 * 每個檔案出現在哪些畫布:Map(正規化的路徑 → 畫布名稱[],依 boards 的順序、不重複)。
 * 筆記頁的「出現在這些畫布」、畫布卡片的徽章、書庫索引共用這一份。
 * @param {{ name: string, board: { nodes: object[] } }[]} boards
 */
function boardRefs(boards) {
  const out = new Map();
  for (const b of boards) {
    for (const n of b.board?.nodes || []) {
      if (n.type !== 'file') continue;
      const k = fileKey(n.file);
      if (!k) continue;
      if (!out.has(k)) out.set(k, []);
      const list = out.get(k);
      if (!list.includes(b.name)) list.push(b.name);
    }
  }
  return out;
}

/** 這張卡片(file)還出現在哪些「其他」畫布。 */
function otherBoards(refs, file, current) {
  return (refs?.get(fileKey(file)) || []).filter(name => name !== current);
}

// ---------- 摺疊與適合內容(Leafpile 自訂欄位,Obsidian 會略過) ----------
const FOLD_KEY = 'x-leafpile-folded';
const FOLD_HEIGHT_KEY = 'x-leafpile-height';
const FOLDED_HEIGHT = 56;
const FOLDABLE = n => n.type === 'text' || (n.type === 'file' && fileKind(n.file) === 'note');

const isFolded = n => n?.[FOLD_KEY] === true;

/** 摺疊:只留標題列;原本的高度記在 x-leafpile-height,展開時還原。回傳有沒有改。 */
function foldNode(n) {
  if (!n || isFolded(n) || !FOLDABLE(n)) return false;
  n[FOLD_HEIGHT_KEY] = n.height;
  n[FOLD_KEY] = true;
  n.height = FOLDED_HEIGHT;
  return true;
}

/** 展開:還原摺疊前的高度(沒有記錄或太小就用 240)。回傳有沒有改。 */
function unfoldNode(n) {
  if (!n || !isFolded(n)) return false;
  const h = Number(n[FOLD_HEIGHT_KEY]);
  n.height = Number.isFinite(h) && h > FOLDED_HEIGHT ? h : 240;
  delete n[FOLD_KEY];
  delete n[FOLD_HEIGHT_KEY];
  return true;
}

/** 適合內容:量到的內容高度 → 卡片高度(有上下限,取整數)。 */
function fitHeight(contentHeight, { min = 60, max = 2400 } = {}) {
  const h = Math.ceil(Number(contentHeight) || 0);
  return Math.min(max, Math.max(min, h));
}

/**
 * 從畫布外放一張筆記卡進來(卡片庫的「放到畫布」):放在現有卡片的右邊,和最上面的卡片對齊;
 * 空的畫布放在原點。已經在畫布上就回傳 null。
 */
function placeFileNode(board, file, size = [340, 300], gap = 60) {
  const key = fileKey(file);
  if (board.nodes.some(n => n.type === 'file' && fileKey(n.file) === key)) return null;
  const b = bounds(board.nodes);
  const [width, height] = size;
  const node = { id: newId(board), type: 'file', file: String(file).replace(/^\/+/, ''), x: b ? Math.round(b.x + b.width + gap) : 0, y: b ? Math.round(b.y) : 0, width, height };
  board.nodes.push(node);
  return node;
}
return { NODE_TYPES, SIDES, PRESET_COLORS, canvasColor, parseCanvas, serializeCanvas, emptyCanvas, newId, anchor, edgePath, bounds, resolveFile, missingFiles, boardFileName, IMAGE_EXT, fileKind, pdfPage, extractURL, embedFor, slideOrder, textToNote, fileKey, boardsWith, boardRefs, otherBoards, FOLD_KEY, FOLD_HEIGHT_KEY, FOLDED_HEIGHT, FOLDABLE, isFolded, foldNode, unfoldNode, fitHeight, placeFileNode };
})();

// ───────── app/core/check.js ─────────
__m["app/core/check.js"] = (() => {
// 檢查書庫或單份簡報是否符合規則。網站的「檢查」按鈕、scripts/check.mjs、
// 書庫裡的單檔版 mdslide-check.mjs 都用這一份,規則只在這裡維護。
// 只使用資料來源介面(list / readText),瀏覽器與 Node 都能跑。

const { scanLibrary, loadDeck } = __m["app/core/library.js"];
const { resolveMediaPath } = __m["app/core/media.js"];
const { parseChartTable } = __m["app/core/chart.js"];
const { undefinedFootnotes } = __m["app/core/markdown.js"];
const { t } = __m["app/core/i18n.js"];
const { isHidden, isMarkdown, RESERVED_DIRS, join } = __m["app/core/names.js"];
const { openVault } = __m["app/core/vault.js"];
const { buildGraph, sourceStatus } = __m["app/core/graph.js"];
const { parseCanvas, missingFiles, fileKind } = __m["app/core/canvas.js"];
const { sectionOf } = __m["app/core/note.js"];
const MAX_SLIDES = 45;

/** 檔案是否存在:列出上一層資料夾來確認(本機來源會快取清單,不會重複讀)。 */
async function exists(source, path) {
  const i = path.lastIndexOf('/');
  try {
    const entries = await source.list(i < 0 ? '' : path.slice(0, i));
    return entries.some(e => e.name === path.slice(i + 1) && e.kind === 'file');
  } catch { return false; }
}

/**
 * 同一層的排序前綴:數字重複(`01-a`、`1-b`)或位數混用(`2-`、`10-`)。
 * 日期前綴(`2026-11-…`)不是排序數字,不檢查。
 * @param {string[]} names 同一層、同一種類(都是檔案或都是資料夾)的名稱
 * @returns {{ kind: 'dup' | 'width', prefix?: string, names: string[] }[]}
 */
function prefixProblems(names) {
  const out = [];
  const nums = names
    .filter(n => !/^\d{4}-\d{2}(-\d{2})?[\s._-]/.test(n))
    .map(n => ({ name: n, m: n.match(/^(\d+)[\s._-]/) }))
    .filter(x => x.m);
  const byNum = new Map();
  for (const x of nums) {
    const k = Number(x.m[1]);
    byNum.set(k, [...(byNum.get(k) || []), x.name]);
  }
  for (const [, list] of byNum) if (list.length > 1) out.push({ kind: 'dup', prefix: list[0].match(/^\d+/)[0], names: list });
  // 位數混用:已經回報為重複的不再算一次;依數字排序,每種位數只列第一個,訊息不會太長
  const rest = nums.filter(x => byNum.get(Number(x.m[1])).length === 1).sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  const widths = new Set(rest.map(x => x.m[1].length));
  if (widths.size > 1) {
    const seen = new Set();
    out.push({ kind: 'width', names: rest.filter(x => !seen.has(x.m[1].length) && seen.add(x.m[1].length)).map(x => x.name) });
  }
  return out;
}

const visibleDirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).map(e => e.name);
const mdNames = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).map(e => e.name);

/** 檢查簡報資料夾與各章節資料夾裡的前綴。 */
async function orderProblems(source, project) {
  const problems = [];
  const report = (path, list) => {
    for (const p of prefixProblems(list)) {
      problems.push({ path: path || t('check.deckFolder'), message: p.kind === 'dup'
        ? t('check.dupPrefix', { prefix: p.prefix, names: p.names.join(t('check.sep')) })
        : t('check.mixedPrefix', { names: p.names.join(t('check.sep')) }) });
    }
  };
  let entries;
  try { entries = await source.list(project.path); } catch { return problems; }
  const dirs = visibleDirs(entries);
  report(project.path, mdNames(entries));
  report(project.path, dirs);
  for (const d of dirs) {
    const path = project.path ? project.path + '/' + d : d;
    try { report(path, mdNames(await source.list(path))); } catch { /* 讀不到的資料夾由其他規則回報 */ }
  }
  return problems;
}

/** 只有設定、沒有內容的投影片(自動產生的標題頁、章節頁、結尾頁不算)。 */
function isEmptySlide(sl) {
  if (sl.auto || ['title', 'section', 'end'].includes(sl.layout)) return false;
  return !sl.body.trim() && !sl.media.length && !sl.meta?.background;
}

/**
 * 檢查一份簡報。
 * @returns {{ title, date, hasConfig, total, noted, layouts: string[], sections: {title, count}[], slides: {layout, title, notes: boolean, auto: boolean}[], problems: {path, message}[] }}
 */
async function checkDeck(source, project) {
  const deck = await loadDeck(source, project);
  const problems = [...deck.issues];
  const all = deck.sections.flatMap(s => s.slides);

  problems.push(...await orderProblems(source, project));

  for (const sl of all) {
    if (isEmptySlide(sl)) problems.push({ path: sl.file, message: t('check.emptySlide', { n: sl.index + 1 }) });
    if (sl.layout === 'chart') {
      const tbl = parseChartTable(sl.body);
      if (!tbl) problems.push({ path: sl.file, message: t('check.noTable') });
      else for (const b of tbl.bad) problems.push({ path: sl.file, message: t('check.badCell', b) });
    }
    for (const id of undefinedFootnotes(sl.body)) problems.push({ path: sl.file, message: t('check.missingFootnote', { id }) });
    for (const m of sl.media) {
      if (m.remote) continue;
      const path = resolveMediaPath(m.src, { projectPath: project.path, filePath: sl.file });
      if (!(await exists(source, path))) problems.push({ path: sl.file, message: t('check.missingMedia', { src: m.src, path: path || t('check.deckFolder') }) });
    }
    const bg = sl.style ? sl.style.bgImage : sl.meta?.background; // 背景色不是檔案,不用檢查
    if (bg && !/^(https?:|data:)/.test(String(bg))) {
      const path = resolveMediaPath(String(bg), { projectPath: project.path, filePath: sl.file });
      if (!(await exists(source, path))) problems.push({ path: sl.file, message: t('check.missingBg', { src: bg }) });
    }
  }
  if (project.coverImage && !(await exists(source, resolveMediaPath(project.coverImage, { projectPath: project.path, filePath: project.path + '/deck.yml' })))) {
    problems.push({ path: project.path || t('check.deckFolder'), message: t('check.missingCover', { src: project.coverImage }) });
  }
  if (project.brand?.logo && !/^(https?:|data:)/.test(project.brand.logo) && !(await exists(source, resolveMediaPath(project.brand.logo, { projectPath: project.path, filePath: project.path + '/deck.yml' })))) {
    problems.push({ path: project.path || t('check.deckFolder'), message: t('check.missingLogo', { src: project.brand.logo }) });
  }
  if (all.length > MAX_SLIDES) problems.push({ path: project.path || t('check.deckFolder'), message: t('check.tooMany', { n: all.length }) });

  return {
    title: deck.title,
    date: deck.date,
    hasConfig: project.hasConfig,
    total: all.length,
    noted: all.filter(s => s.notes).length,
    layouts: [...new Set(all.map(s => s.layout))],
    sections: deck.sections.map(s => ({ title: s.title || t('check.opening'), count: s.slides.length })),
    slides: all.map(s => ({ layout: s.layout, title: s.title, notes: !!s.notes, auto: !!s.auto })),
    problems,
  };
}

/**
 * 檢查整個資料夾(書庫、主題或單份簡報都可以)。
 * @param {(done: number, total: number, title: string) => void} [onProgress]
 */
async function checkLibrary(source, onProgress, opts = {}) {
  const lib = await scanLibrary(source, opts);
  const total = lib.topics.reduce((n, tp) => n + tp.projects.length, 0);
  let done = 0;
  const topics = [];
  for (const tp of lib.topics) {
    const decks = [];
    for (const p of tp.projects) {
      onProgress?.(done, total, p.title);
      try { decks.push({ id: p.id, ...(await checkDeck(source, p)) }); }
      catch (e) { decks.push({ id: p.id, title: p.title, total: 0, noted: 0, layouts: [], sections: [], slides: [], problems: [{ path: p.path, message: t('check.unreadable', { error: e.message || e }) }] }); }
      done++;
    }
    topics.push({ id: tp.id, title: tp.title, decks });
  }
  onProgress?.(done, total, '');
  const problems = [...lib.issues, ...topics.flatMap(tp => tp.decks.flatMap(d => d.problems))];
  return { kind: lib.kind, title: lib.title, topics, problems };
}


/** 摘錄超過幾個字就提醒(簡報應該比筆記短,docs/INTEROP.md 第 3 節)。 */
const EMBED_MAX_CHARS = 120;

/**
 * 檢查 Leafpile 書庫:簡報渠道沿用 checkLibrary,另外檢查筆記與跨渠道的連結。
 * 沒有 notes/ 與 slides/ 的資料夾(Mdslide Pile 書庫、單一簡報)只做簡報檢查。
 * problems = 會讓 CI 失敗的錯誤;warnings = 提醒(連結找不到、急件到期…)。
 * @param {{ today?: string }} [opts] today = 判斷急件到期用的日期(YYYY-MM-DD)
 */
async function checkVault(source, onProgress, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const vault = await openVault(source);
  if (vault.kind === 'mdslide') return { ...(await checkLibrary(source, onProgress)), warnings: [], notes: null };

  const slides = vault.slidesSource
    ? await checkLibrary(vault.slidesSource, onProgress, { kind: 'library' })
    : { kind: 'library', topics: [], problems: [] };
  const pre = p => ({ ...p, path: join('slides', p.path) });
  for (const tp of slides.topics) for (const d of tp.decks) d.problems = d.problems.map(pre);
  const problems = [...vault.issues.filter(i => !i.path.startsWith('slides/') && i.level !== 'warn'), ...slides.problems.map(pre)];
  const warnings = vault.issues.filter(i => i.level === 'warn');

  const graph = await buildGraph(vault);
  const say = (level, path, message) => (level === 'warn' ? warnings : problems).push({ path, message });
  for (const i of graph.issues) problems.push({ path: i.path, message: t('issue.readFailed') });

  /** 檢查一個連結(筆記或投影片裡的)。 */
  const checkLink = (rec, l, where) => {
    const res = graph.resolver.resolve(l, { fromTopic: rec.topicId, fromPath: rec.path });
    if (res.status === 'missing') return say(l.embed && rec.kind === 'deck' ? 'error' : 'warn', where, t(l.embed ? 'check.embedMissing' : 'check.linkMissing', { link: l.raw }));
    if (res.status === 'ambiguous') say('warn', where, t('check.linkAmbiguous', { link: l.raw, paths: res.candidates.map(c => c.path).join(t('check.sep')) }));
    const target = res.status === 'self' ? rec : res.target;
    if (!l.heading || target?.kind !== 'note') return;
    const text = sectionOf(target.body, l.heading);
    if (text == null) say(l.embed && rec.kind === 'deck' ? 'error' : 'warn', where, t('check.headingMissing', { link: l.raw, title: target.title }));
    else if (l.embed && rec.kind === 'deck' && text.replace(/\s+/g, '').length > EMBED_MAX_CHARS) say('warn', where, t('check.embedLong', { link: l.raw, n: EMBED_MAX_CHARS }));
  };

  let books = 0, links = 0;
  for (const tp of vault.notes.topics) books += tp.items.filter(i => i.kind === 'book').length;
  for (const n of graph.notes.values()) {
    for (const i of n.issues) say(i.level === 'warn' ? 'warn' : 'error', n.path, i.message);
    for (const l of n.links) { links++; checkLink(n, l, n.path); }
    if (n.pinned && !n.expires) say('warn', n.path, t('check.pinnedNoExpiry'));
    if (n.expires && n.expires < today) say('warn', n.path, t('check.expired', { date: n.expires }));
  }
  for (const d of graph.decks.values()) {
    for (const l of d.links) { links++; checkLink(d, l, l.file || d.path); }
    const st = sourceStatus(graph, d).status;
    if (st === 'missing') say('warn', join(d.path, 'deck.yml'), t('check.sourceMissing', { source: d.source }));
    if (st === 'changed') say('warn', join(d.path, 'deck.yml'), t('check.sourceChanged', { source: d.source }));
  }
  for (const b of vault.boards || []) {
    let board;
    try { board = parseCanvas(await source.readText(b.path)); } catch (e) { say('error', b.path, t('check.boardBroken', { error: e.message })); continue; }
    for (const i of board.issues) say('warn', b.path, t('check.boardIssue', { issue: i }));
    for (const f of missingFiles(board, graph)) {
      // 圖片、HTML、PDF 不在圖譜裡:看檔案在不在
      if (['image', 'html', 'pdf'].includes(fileKind(f))) {
        const i = f.lastIndexOf('/');
        const names = await source.list(i < 0 ? '' : f.slice(0, i)).then(l => l.map(e => e.name), () => []);
        if (names.includes(f.slice(i + 1))) continue;
      }
      say('warn', b.path, t('check.boardMissing', { file: f }));
    }
  }
  return {
    kind: 'leafpile', title: vault.title, topics: slides.topics, problems, warnings,
    notes: { topics: vault.notes.topics.length, notes: graph.notes.size, books, links },
  };
}

/** 把檢查結果排成純文字報告(給命令列用)。 */
function formatReport(report, { verbose = false } = {}) {
  const out = [t('check.report.title', { title: report.title, kind: t('check.kind.' + report.kind) })];
  for (const tp of report.topics) {
    if (report.kind === 'library' || report.kind === 'leafpile') out.push('', t('check.report.topic', { title: tp.title }));
    if (!tp.decks.length) out.push(t('check.report.empty'));
    for (const d of tp.decks) {
      out.push(t('check.report.deck', { title: d.title, date: d.date ? t('check.report.date', { date: d.date }) : '', sections: d.sections.length, total: d.total, layouts: d.layouts.length, noted: d.noted, noConfig: d.hasConfig === false ? t('check.report.noConfig') : '' }));
      if (!verbose) continue;
      let k = 0;
      for (const s of d.sections) {
        out.push(t('check.report.section', s));
        for (const sl of d.slides.slice(k, k + s.count)) out.push(`        - [${sl.layout}] ${sl.title || t('check.report.untitled')}${sl.notes ? '  📝' : ''}${sl.auto ? t('check.report.auto') : ''}`);
        k += s.count;
      }
    }
  }
  if (report.notes) out.push('', t('check.report.notes', report.notes));
  if (report.warnings?.length) {
    out.push('', t('check.report.warnings', { n: report.warnings.length }));
    for (const i of report.warnings) out.push(`  - ${i.path}:${i.message}`);
  }
  if (report.problems.length) {
    out.push('', t('check.report.problems', { n: report.problems.length }));
    for (const i of report.problems) out.push(`  - ${i.path}:${i.message}`);
  } else {
    out.push('', t('check.report.ok'));
  }
  return out.join('\n');
}
return { MAX_SLIDES, prefixProblems, checkDeck, checkLibrary, EMBED_MAX_CHARS, checkVault, formatReport };
})();

// ───────── app/core/index.js ─────────
__m["app/core/index.js"] = (() => {
// 書庫索引:一次列出所有筆記、簡報、畫布,以及它們之間的連結,給 AI(與人)先看全貌再動手。
// 用的時候才產生、不存檔,所以不會有「索引過期」的問題。
// 網站的關聯圖(graph.js)與檢查工具共用同一套資料,這裡只是換一種輸出。
//
//   node leafpile-check.mjs <書庫> --index          Markdown(給 AI 讀)
//   node leafpile-check.mjs <書庫> --index=json     JSON(給程式讀)
//   加上 --public 只列公開的筆記(要把索引交給外部服務時用)

const { openVault } = __m["app/core/vault.js"];
const { buildGraph } = __m["app/core/graph.js"];
const { parseCanvas, resolveFile } = __m["app/core/canvas.js"];
const { cellText } = __m["app/core/table.js"];
const { t } = __m["app/core/i18n.js"];
/** 主題 id → 筆記本路徑 → 筆記本標題 */
function bookTitles(vault) {
  const out = new Map();
  for (const tp of vault.notes?.topics || []) for (const i of tp.items || []) if (i.kind === 'book') out.set(i.path, i.title || i.path);
  return out;
}

/**
 * 組出索引資料(純資料,JSON 直接輸出;Markdown 由 indexMarkdown 排版)。
 * @param {{ vault: object, graph: object, boards?: { name: string, path: string, board: object }[] }} input
 * @param {{ publicOnly?: boolean, now?: string }} [opts]
 */
function buildIndex({ vault, graph, boards = [] }, { publicOnly = false, now = new Date().toISOString() } = {}) {
  const books = bookTitles(vault);
  const keep = rec => rec.kind !== 'note' || !publicOnly || rec.public;
  const ref = rec => ({ kind: rec.kind, path: rec.path, title: rec.title });

  const linksOf = rec => {
    const out = [], missing = [], seen = new Set();
    for (const l of rec.links || []) {
      const res = graph.resolver.resolve(l, { fromTopic: rec.topicId, fromPath: rec.path });
      const target = res.status === 'self' ? null : res.target;
      if (target) {
        if (!keep(target) || seen.has(target.path)) continue;
        seen.add(target.path);
        out.push({ ...ref(target), ...(l.embed ? { embed: true } : {}) });
      } else if (res.status === 'missing' || res.status === 'ambiguous') missing.push(l.raw);
    }
    return { links: out, missing: [...new Set(missing)] };
  };
  const backOf = rec => (graph.backlinks.get(rec.path) || []).filter(b => keep(b.from)).map(b => ({ ...ref(b.from), via: b.via }));

  const boardRefs = new Map(); // 筆記或簡報的路徑 → 出現在哪些畫布
  const boardList = boards.map(b => {
    const cards = [];
    for (const n of b.board.nodes || []) {
      if (n.type !== 'file') continue;
      const r = resolveFile(n.file, graph);
      if (r.kind === 'missing' || !keep(r.rec)) continue;
      if (!cards.some(c => c.path === r.rec.path)) cards.push(ref(r.rec));
      if (!boardRefs.has(r.rec.path)) boardRefs.set(r.rec.path, []);
      if (!boardRefs.get(r.rec.path).includes(b.name)) boardRefs.get(r.rec.path).push(b.name);
    }
    const texts = (b.board.nodes || []).filter(n => n.type === 'text').length;
    const groups = (b.board.nodes || []).filter(n => n.type === 'group').map(n => String(n.label || '')).filter(Boolean);
    return { name: b.name, path: b.path, cards, texts, groups };
  });

  const notes = [...graph.notes.values()].filter(keep).map(n => ({
    path: n.path, title: n.title, topic: n.topicId,
    book: n.bookPath ? { path: n.bookPath, title: books.get(n.bookPath) || n.bookPath } : null,
    date: n.date || '', tags: n.tags || [], aliases: n.aliases || [],
    public: !!n.public, ...(n.localOnly ? { localOnly: true } : {}),
    ...(n.pinned ? { pinned: true, expires: n.expires || '' } : {}),
    ...(n.fromDeck ? { fromDeck: n.fromDeck } : {}),
    fields: n.fields || {},
    headings: (n.headings || []).map(h => ({ level: h.level, text: h.text })),
    excerpt: n.excerpt || '',
    ...linksOf(n),
    backlinks: backOf(n),
    boards: boardRefs.get(n.path) || [],
  }));
  const decks = [...graph.decks.values()].map(d => ({
    path: d.path, title: d.title, topic: d.topicId, date: d.date || '',
    source: d.source || '', ...linksOf(d), backlinks: backOf(d), boards: boardRefs.get(d.path) || [],
  }));

  const catOf = new Map();
  for (const c of vault.categories || []) for (const tp of c.topics) catOf.set(tp.id, c.id);
  const topics = (vault.topics || []).map(tp => ({
    id: tp.id, title: tp.title, description: tp.description || '', category: catOf.get(tp.id) ?? tp.category ?? '',
    public: tp.conf?.public === true, ...(tp.conf?.local_only === true ? { localOnly: true } : {}),
    notes: notes.filter(n => n.topic === tp.id).length, decks: decks.filter(d => d.topic === tp.id).length,
  }));

  return {
    leafpileIndex: 1,
    generated: now,
    library: { title: vault.title || '', kind: vault.kind, publicOnly },
    counts: { topics: topics.length, notes: notes.length, decks: decks.length, boards: boardList.length },
    categories: (vault.categories || []).map(c => ({ id: c.id, name: c.name, topics: c.topics.map(tp => tp.id) })),
    topics, notes, decks, boards: boardList,
  };
}

const code = s => '`' + String(s).replace(/`/g, "'") + '`';
const list = (items, max = 12) => (items.length > max ? [...items.slice(0, max), t('index.more', { n: items.length - max })] : items).join(t('index.sep'));
const name = r => `${r.title} ${code(r.path)}`;

/** 把索引排成 Markdown:依分類 → 主題分段,每篇一行,有內容的細節才往下縮排。 */
function indexMarkdown(idx) {
  const out = [];
  const c = idx.counts;
  out.push(`# ${t('index.title', { title: idx.library.title })}`, '');
  out.push(t('index.summary', { topics: c.topics, notes: c.notes, decks: c.decks, boards: c.boards, date: idx.generated.slice(0, 16).replace('T', ' ') }));
  if (idx.library.publicOnly) out.push('', t('index.publicOnly'));
  out.push('', t('index.howto'), '');

  const topicById = new Map(idx.topics.map(tp => [tp.id, tp]));
  const catName = new Map(idx.categories.map(x => [x.id, x.name]));
  const ordered = [...idx.categories.flatMap(x => x.topics), ...idx.topics.map(tp => tp.id)].filter((id, i, a) => a.indexOf(id) === i);

  for (const id of ordered) {
    const tp = topicById.get(id);
    if (!tp) continue;
    const notes = idx.notes.filter(n => n.topic === id), decks = idx.decks.filter(d => d.topic === id);
    if (!notes.length && !decks.length) continue;
    const cat = catName.get(tp.category);
    const flags = [tp.public ? t('index.topicPublic') : '', tp.localOnly ? t('index.localOnly') : ''].filter(Boolean);
    out.push(`## ${cat ? cat + ' › ' : ''}${tp.title} ${code(tp.id)}${flags.length ? ' · ' + flags.join(' · ') : ''}`);
    if (tp.description) out.push('', tp.description);
    out.push('');
    for (const n of notes) {
      const meta = [n.date, n.tags.map(x => '#' + x).join(' '), n.public ? t('index.public') : t('index.private'), n.pinned ? t('index.pinned', { date: n.expires }) : '', n.book ? t('index.book', { title: n.book.title }) : ''].filter(Boolean);
      out.push(`- **${n.title}** ${code(n.path)} · ${meta.join(' · ')}`);
      const sub = [];
      const fields = Object.entries(n.fields).map(([k, v]) => `${k}: ${cellText(v)}`);
      if (n.aliases.length) sub.push(t('index.aliases', { list: n.aliases.join(t('index.sep')) }));
      if (fields.length) sub.push(t('index.fields', { list: fields.join(t('index.sep')) }));
      const hs = n.headings.filter(h => h.level <= 2 && h.text !== n.title).map(h => h.text);
      if (hs.length) sub.push(t('index.headings', { list: list(hs, 10) }));
      if (n.links.length) sub.push(t('index.links', { list: list(n.links.map(name)) }));
      if (n.missing.length) sub.push(t('index.missing', { list: n.missing.join(t('index.sep')) }));
      if (n.backlinks.length) sub.push(t('index.backlinks', { list: list(n.backlinks.map(name)) }));
      if (n.boards.length) sub.push(t('index.onBoards', { list: n.boards.join(t('index.sep')) }));
      if (n.fromDeck) sub.push(t('index.fromDeck', { path: code(n.fromDeck) }));
      for (const s of sub) out.push(`  - ${s}`);
    }
    for (const d of decks) {
      out.push(`- ${t('index.deck')} **${d.title}** ${code(d.path)}${d.date ? ' · ' + d.date : ''}`);
      if (d.source) out.push(`  - ${t('index.source', { path: code(d.source) })}`);
      if (d.links.length) out.push(`  - ${t('index.links', { list: list(d.links.map(name)) })}`);
      if (d.missing.length) out.push(`  - ${t('index.missing', { list: d.missing.join(t('index.sep')) })}`);
      if (d.boards.length) out.push(`  - ${t('index.onBoards', { list: d.boards.join(t('index.sep')) })}`);
    }
    out.push('');
  }

  if (idx.boards.length) {
    out.push(`## ${t('index.boards')}`, '');
    for (const b of idx.boards) {
      out.push(`- **${b.name}** ${code(b.path)} · ${t('index.boardStats', { cards: b.cards.length, texts: b.texts })}`);
      if (b.groups.length) out.push(`  - ${t('index.groups', { list: b.groups.join(t('index.sep')) })}`);
      if (b.cards.length) out.push(`  - ${t('index.cards', { list: list(b.cards.map(name), 20) })}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** 從資料來源產生索引(命令列用;網站已經有圖譜時可以直接呼叫 buildIndex)。 */
async function libraryIndex(source, opts = {}) {
  const vault = await openVault(source);
  const graph = await buildGraph(vault);
  const boards = [];
  for (const b of vault.boards || []) {
    try { boards.push({ ...b, board: parseCanvas(await source.readText(b.path)) }); } catch { /* 壞掉的畫布由檢查工具回報 */ }
  }
  return buildIndex({ vault, graph, boards }, opts);
}
return { buildIndex, indexMarkdown, libraryIndex };
})();

// ───────── scripts/node-source.mjs ─────────
__m["scripts/node-source.mjs"] = (() => {
// Node 版資料來源:讓建置腳本與檢查工具使用和瀏覽器完全相同的解析器(app/core)。

// 用命名空間匯入,避免打包成單檔時與 app/core 的同名函式衝突


function nodeSource(root) {
  const abs = nodePath.resolve(root);
  return {
    label: nodePath.basename(abs),
    root: abs,
    async list(path) {
      const entries = await fsp.readdir(nodePath.join(abs, path), { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
    },
    async readText(path) { return fsp.readFile(nodePath.join(abs, path), 'utf8'); },
    async mediaURL(path) { return path; },
  };
}

/**
 * 命令列的輸出語言:--lang 參數 → 環境變數(LC_ALL、LC_MESSAGES、LANG)→ 作業系統語系 → 繁中。
 * Windows 通常沒有 LANG,所以會用作業系統語系(繁中 Windows 會得到 zh-TW)。
 */
function detectNodeLang(argv = process.argv) {
  const i = argv.indexOf('--lang');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find(a => a.startsWith('--lang='));
  if (eq) return eq.slice(7);
  for (const k of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = process.env[k];
    if (v && !/^(C|POSIX)(\.|$)/i.test(v)) return v;
  }
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'zh-Hant'; }
}

/** 走訪整棵樹,回傳 { 路徑: 清單 }(給 catalog.json 用)。 */
async function walkTree(source, path = '', tree = {}) {
  const entries = await source.list(path);
  tree[path] = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) if (e.kind === 'dir') await walkTree(source, path ? `${path}/${e.name}` : e.name, tree);
  return tree;
}
return { nodeSource, detectNodeLang, walkTree };
})();

// ───────── 命令列 ─────────
const { checkVault, formatReport } = __m['app/core/check.js'];
const { setLang } = __m['app/core/i18n.js'];
const { nodeSource, detectNodeLang } = __m['scripts/node-source.mjs'];
setLang(detectNodeLang());
const __args = process.argv.slice(2);
const __dir = __args.find((a, i) => !a.startsWith('--') && __args[i - 1] !== '--lang') || __toPath(new URL('.', import.meta.url));
const __index = __args.find(a => a === '--index' || a.startsWith('--index='));
if (__index) {
  const { libraryIndex, indexMarkdown } = __m['app/core/index.js'];
  const __idx = await libraryIndex(nodeSource(__dir), { publicOnly: __args.includes('--public') });
  console.log(__index === '--index=json' ? JSON.stringify(__idx, null, 2) : indexMarkdown(__idx));
} else {
  const __report = await checkVault(nodeSource(__dir));
  console.log(formatReport(__report, { verbose: process.argv.includes('--slides') }));
  if (__report.problems.length) process.exitCode = 1;
}
