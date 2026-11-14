// 斜線選單(參考 Heptabase、Notion):在編輯器輸入 / 列出常用的格式,選了就插入標準 Markdown。
// 純邏輯,不碰畫面;畫面在 ui/slash-menu.js。
//
// 規則:
//   - 只有行首(前面可以有空白)或空白後面的 / 才觸發,所以網址、路徑、日期「1/2」都不會跳出選單。
//   - 程式碼區塊(``` 或 ~~~)裡、front matter 裡不觸發。
//   - 插入的一律是任何 Markdown 軟體都看得懂的寫法;不加 HTML、不加 Leafpile 專屬語法。
//   - 「區塊」類(標題、清單、引言、程式碼、表格、分隔線)若不在行首,先換一行再插入;
//     程式碼、表格、分隔線自成一塊,後面同一行還有字就再換一行。

/** 一個選項:id、圖示、標籤的 i18n 鍵、搜尋用的別名、要插入的內容。 */
export const SLASH_ITEMS = [
  { id: 'h1', icon: 'H1', block: true, keys: ['h1', 'heading', 'title', '標題', '大標'], text: '# ' }, // i18n-ok:搜尋別名
  { id: 'h2', icon: 'H2', block: true, keys: ['h2', 'heading', '標題', '中標'], text: '## ' }, // i18n-ok:搜尋別名
  { id: 'h3', icon: 'H3', block: true, keys: ['h3', 'heading', '標題', '小標'], text: '### ' }, // i18n-ok:搜尋別名
  { id: 'bullet', icon: '•', block: true, keys: ['bullet', 'list', 'ul', '清單', '項目'], text: '- ' }, // i18n-ok:搜尋別名
  { id: 'number', icon: '1.', block: true, keys: ['number', 'ordered', 'ol', '編號', '數字'], text: '1. ' }, // i18n-ok:搜尋別名
  { id: 'todo', icon: '☐', block: true, keys: ['todo', 'task', 'check', '待辦', '核取'], text: '- [ ] ' }, // i18n-ok:搜尋別名
  { id: 'quote', icon: '❝', block: true, keys: ['quote', 'blockquote', '引言', '引用'], text: '> ' }, // i18n-ok:搜尋別名
  { id: 'code', icon: '</>', block: true, own: true, keys: ['code', 'snippet', '程式', '代碼'], text: '```\n\n```', caret: 4 }, // i18n-ok:搜尋別名
  { id: 'table', icon: '▦', block: true, own: true, keys: ['table', 'grid', '表格'], table: true }, // i18n-ok:搜尋別名
  { id: 'divider', icon: '—', block: true, own: true, keys: ['divider', 'hr', 'line', 'separator', '分隔線', '分隔'], text: '---\n' }, // i18n-ok:搜尋別名
  { id: 'link', icon: '[[', keys: ['link', 'note', 'wiki', '連結', '筆記'], text: '[[]]', caret: 2 }, // i18n-ok:搜尋別名
  { id: 'embed', icon: '![[', keys: ['embed', 'excerpt', 'transclude', '摘錄', '嵌入'], text: '![[]]', caret: 3 }, // i18n-ok:搜尋別名
  { id: 'highlight', icon: '==', keys: ['highlight', 'mark', '螢光', '標記'], text: '====', caret: 2 }, // i18n-ok:搜尋別名
  { id: 'image', icon: '▣', keys: ['image', 'picture', 'img', '圖片', '圖'], text: '![]()', caret: 4 }, // i18n-ok:搜尋別名
  { id: 'date', icon: '▤', keys: ['date', 'today', '日期', '今天'], date: 'date' }, // i18n-ok:搜尋別名
  { id: 'now', icon: '◷', keys: ['now', 'time', 'datetime', '現在', '時間'], date: 'now' }, // i18n-ok:搜尋別名
];

const FENCE = /^\s*(```|~~~)/;

/**
 * 游標前面有沒有正在輸入的斜線指令。
 * @returns {{ start: number, query: string } | null}  start = / 的位置
 */
export function slashQuery(text, caret) {
  const s = String(text ?? '');
  const i = Math.max(0, Math.min(caret ?? s.length, s.length));
  const lineStart = s.lastIndexOf('\n', i - 1) + 1;
  const line = s.slice(lineStart, i);
  const m = line.match(/(^|\s)\/([^\s/]{0,24})$/);
  if (!m) return null;
  // front matter 裡不算(檔案開頭的 --- … ---)
  const fm = s.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  if (fm && i <= fm[0].length) return null;
  // 程式碼區塊裡不算:游標前面的圍欄數是奇數
  let open = false;
  for (const l of s.slice(0, lineStart).split('\n')) if (FENCE.test(l)) open = !open;
  if (open) return null;
  return { start: i - m[2].length - 1, query: m[2] };
}

/**
 * 依輸入的字篩選選項:id、別名或顯示標籤以它開頭的排前面,包含它的排後面。
 * @param {string} query
 * @param {(id: string) => string} [label]  顯示標籤(目前語言)
 */
export function filterSlash(query, label = id => id) {
  const q = String(query || '').toLowerCase();
  if (!q) return SLASH_ITEMS.slice();
  const score = it => {
    const words = [it.id, ...it.keys, String(label(it.id) || '')].map(w => w.toLowerCase());
    if (words.some(w => w.startsWith(q))) return 2;
    if (words.some(w => w.includes(q))) return 1;
    return 0;
  };
  return SLASH_ITEMS.map(it => [it, score(it)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([it]) => it);
}

/** 兩欄一列的空表格。 */
function tableText(cols) {
  const c = cols.length ? cols : ['Col 1', 'Col 2'];
  return `| ${c.join(' | ')} |\n|${c.map(() => ' --- ').join('|')}|\n|${c.map(() => '  ').join('|')}|`;
}

const pad = n => String(n).padStart(2, '0');
/** 本地時間的 YYYY-MM-DD 與 YYYY-MM-DD HH:mm。 */
export function stamp(kind, d = new Date()) {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return kind === 'now' ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

/**
 * 把「/查詢字」換成選項的內容。
 * @param {{ now?: Date, cols?: string[] }} [opts]  cols = 表格的欄名(畫面依介面語言給)
 * @returns {{ text: string, selStart: number, selEnd: number }}  新的全文與游標(或選取範圍)
 */
export function applySlash(text, { start, query }, item, { now = new Date(), cols = ['Col 1', 'Col 2'] } = {}) {
  const s = String(text ?? '');
  const end = start + 1 + String(query || '').length;
  const before = s.slice(0, start), after = s.slice(end);
  const ins = item.date ? stamp(item.date, now) : item.table ? tableText(cols) : item.text;
  // 區塊:不在行首就先換行(把 / 前面多的空白去掉)
  let lead = '';
  const lineHead = before.slice(before.lastIndexOf('\n') + 1);
  if (item.block && lineHead.trim()) lead = '\n';
  const base = (lead ? before.replace(/[ \t]+$/, '') : before) + lead;
  // 自成一塊的(程式碼、表格)後面同一行還有字就換行,不要把後面的字吃進去
  const tail = item.own && after && !after.startsWith('\n') && !ins.endsWith('\n') ? '\n' : '';
  const out = base + ins + tail + after;
  const at = base.length;
  if (item.table) return { text: out, selStart: at + 2, selEnd: at + 2 + String(cols[0]).length }; // 選取第一個欄名,直接打字就換掉
  const c = at + (item.caret ?? ins.length);
  return { text: out, selStart: c, selEnd: c };
}
