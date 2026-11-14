// 貼上的 HTML → Markdown(純邏輯,瀏覽器與 Node 共用,零依賴)。
// 從網頁、Word、Google 文件、Notion、Claude 對話複製時,剪貼簿除了純文字還有一份 HTML;
// 這裡把它轉成 Markdown,保留標題、粗體、連結、清單、待辦、引用、程式碼、表格的結構。
// 不用 DOMParser(Node 沒有),所以自己有一個寬鬆的小解析器;壞掉的 HTML 也不會丟錯。
// 轉不出任何結構(例如從程式編輯器複製的上色文字)時 pasteMarkdown 回傳 null,照原本貼純文字。

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'button', 'select', 'textarea', 'iframe', 'object', 'canvas', 'video', 'audio']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'hr', 'dl', 'dt', 'dd', 'details', 'summary', 'address', 'center', 'body', 'html', 'caption']);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', times: '×', laquo: '«', raquo: '»', rarr: '→', larr: '←', deg: '°' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return NAMED[e.toLowerCase()] ?? m;
});

function attrsOf(src) {
  const o = {};
  for (const m of src.matchAll(/([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) o[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return o;
}

/** 寬鬆的 HTML 解析:回傳 { tag: '#root', kids },節點是 { tag, attrs, kids } 或 { text }。 */
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  let last = 0, m, lower = null;
  const text = s => { if (s) top().kids.push({ text: decode(s) }); };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === name) { stack.length = i; break; } continue; }
    if (name === 'script' || name === 'style') { // 內容不是 HTML:整段跳過
      lower ||= html.toLowerCase();
      const end = lower.indexOf('</' + name, re.lastIndex);
      if (end < 0) { last = re.lastIndex = html.length; break; }
      const close = html.indexOf('>', end);
      last = re.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    // 省略結尾標籤的常見情況
    if (name === 'li') { for (let i = stack.length - 1; i > 0; i--) { const g = stack[i].tag; if (g === 'li') { stack.length = i; break; } if (g === 'ul' || g === 'ol') break; } }
    else if (name === 'p') { if (top().tag === 'p') stack.pop(); }
    else if (name === 'td' || name === 'th') { if (top().tag === 'td' || top().tag === 'th') stack.pop(); }
    else if (name === 'tr') { if (top().tag === 'td' || top().tag === 'th') stack.pop(); if (top().tag === 'tr') stack.pop(); }
    const node = { tag: name, attrs: attrsOf(m[3]), kids: [] };
    top().kids.push(node);
    if (!VOID.has(name) && !m[4]) stack.push(node);
  }
  text(html.slice(last));
  return root;
}

// ---------- 行內 ----------
const styleOf = n => {
  const o = {};
  for (const d of (n.attrs.style || '').split(';')) { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase(); }
  return o;
};
const isBold = v => v === 'bold' || v === 'bolder' || Number(v) >= 600;
const hasBlock = n => !!n.kids && n.kids.some(k => k.tag && (BLOCK.has(k.tag) || hasBlock(k)));

/** 標記包住文字;前後的空白留在標記外面(`** x **` 不是合法的粗體)。 */
function wrap(mark, s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
}
function textOf(n) { return n.text !== undefined ? n.text : SKIP.has(n.tag) ? '' : n.tag === 'br' ? ' ' : n.kids.map(textOf).join(''); }
function safeURL(u, { image = false } = {}) {
  u = String(u || '').trim();
  if (!u || /^(javascript|vbscript|file):/i.test(u) || (/^data:/i.test(u) && !image)) return '';
  if (image && /^data:/i.test(u)) return ''; // 內嵌圖片太長,不放進筆記
  return u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function inl(n) {
  if (n.text !== undefined) return n.text.replace(/\s+/g, ' ');
  const tag = n.tag;
  if (SKIP.has(tag) || n.attrs.hidden !== undefined) return '';
  if (tag === 'br') return '  \n';
  if (tag === 'input') return '';
  if (tag === 'img') {
    const src = safeURL(n.attrs.src, { image: true }), alt = (n.attrs.alt || '').replace(/[\[\]\n]/g, ' ').trim();
    return src ? `![${alt}](${src})` : alt;
  }
  const inner = () => n.kids.map(inl).join('');
  const st = styleOf(n);
  if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') {
    const s = textOf(n).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.includes('`') ? '`` ' + s + ' ``' : '`' + s + '`';
  }
  let s = inner();
  if (tag === 'a') {
    const href = /^#/.test(n.attrs.href || '') ? '' : safeURL(n.attrs.href);
    const label = s.replace(/\s*\n\s*/g, ' ').trim();
    return href && label ? `[${label}](${href})` : s;
  }
  const fw = st['font-weight'];
  const bold = tag === 'strong' || (tag === 'b' && (fw === undefined || isBold(fw))) || (fw !== undefined && isBold(fw));
  const italic = tag === 'em' || tag === 'i' || tag === 'cite' || st['font-style'] === 'italic';
  const strike = tag === 'del' || tag === 's' || tag === 'strike' || /line-through/.test(st['text-decoration'] || st['text-decoration-line'] || '');
  if (strike) s = wrap('~~', s);
  if (tag === 'mark') s = wrap('==', s);
  if (italic) s = wrap('*', s);
  if (bold) s = wrap('**', s);
  return s;
}

// ---------- 區塊 ----------
const clean = s => s.replace(/^\s+/, '').replace(/\s+$/, '').replace(/ {2,}(?!\n)/g, ' ').replace(/\n{2,}/g, '\n');
// 段落開頭長得像 Markdown 語法時加反斜線,免得原本的文字變成清單或標題
const escapeStart = s => (/^(#{1,6}\s|[-+*]\s|\d+[.)]\s|>|\||([-*_]\s*){3,}$|={3,}$)/.test(s) ? '\\' + s : s);
const indent = (s, pad) => s.split('\n').map(l => (l ? pad + l : l)).join('\n');

function rawText(n) { // 程式碼區塊:保留換行與空白
  if (n.text !== undefined) return n.text;
  if (SKIP.has(n.tag)) return '';
  if (n.tag === 'br') return '\n';
  const s = n.kids.map(rawText).join('');
  return BLOCK.has(n.tag) && n.tag !== 'pre' && !s.endsWith('\n') ? s + '\n' : s;
}

function preMd(k) {
  const code = k.kids.find(x => x.tag === 'code');
  const lang = ((code?.attrs.class || '') + ' ' + (k.attrs.class || '')).match(/(?:language|lang)-([\w+#-]+)/)?.[1] || k.attrs['data-language'] || code?.attrs['data-language'] || '';
  const text = rawText(k).replace(/\r/g, '').replace(/^\n+/, '').replace(/\s+$/, '');
  if (!text.trim()) return '';
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `${fence}${/^[\w+#-]+$/.test(lang) ? lang : ''}\n${text}\n${fence}`;
}

function cellMd(cell) {
  return blocks(cell.kids).join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}
function tableMd(t) {
  const rows = [];
  const walk = n => {
    for (const k of n.kids) {
      if (k.tag === 'tr') rows.push(k.kids.filter(c => c.tag === 'td' || c.tag === 'th'));
      else if (k.tag === 'thead' || k.tag === 'tbody' || k.tag === 'tfoot') walk(k);
    }
  };
  walk(t);
  const grid = rows.map(cells => cells.flatMap(c => [cellMd(c), ...Array(Math.max(0, Math.min(10, parseInt(c.attrs.colspan, 10) || 1) - 1)).fill('')])).filter(r => r.some(Boolean));
  if (!grid.length) return [];
  const width = Math.max(...grid.map(r => r.length));
  if (width === 1 && rows.length === 1) return blocks(rows[0][0].kids); // 拿表格排版的網頁:當一般內容
  const line = r => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
  return [[line(grid[0]), line(Array(width).fill('---')), ...grid.slice(1).map(line)].join('\n')];
}

function findCheckbox(li) {
  for (const k of li.kids) {
    if (k.tag === 'input' && /checkbox/i.test(k.attrs.type || '')) return k;
    if (k.tag && !BLOCK.has(k.tag) && k.kids) for (const g of k.kids) if (g.tag === 'input' && /checkbox/i.test(g.attrs.type || '')) return g;
  }
  return null;
}

function liParts(li) {
  const parts = [];
  let run = [];
  const flush = () => { const s = clean(run.join('')); run = []; if (s) parts.push({ md: s }); };
  for (const k of li.kids) {
    if (k.text !== undefined) { run.push(inl(k)); continue; }
    if (SKIP.has(k.tag)) continue;
    if (k.tag === 'ul' || k.tag === 'ol') { flush(); parts.push({ md: listMd(k), list: true }); }
    else if (BLOCK.has(k.tag) || hasBlock(k)) { flush(); for (const md of block(k.kids && !BLOCK.has(k.tag) ? { tag: 'div', attrs: {}, kids: k.kids } : k)) parts.push({ md }); }
    else run.push(inl(k));
  }
  flush();
  return parts;
}

function listMd(list) {
  const ordered = list.tag === 'ol';
  let n = parseInt(list.attrs.start, 10);
  if (!Number.isFinite(n)) n = 1;
  const lines = [];
  for (const li of list.kids) {
    if (li.tag === 'ul' || li.tag === 'ol') { lines.push(indent(listMd(li), '  ')); continue; }
    if (li.tag !== 'li') continue;
    const marker = ordered ? `${n++}. ` : '- ';
    const cb = findCheckbox(li);
    const task = cb ? (cb.attrs.checked !== undefined ? '[x] ' : '[ ] ') : '';
    const parts = liParts(li);
    const head = parts.length && !parts[0].list ? parts.shift().md : '';
    const pad = ' '.repeat(marker.length);
    let out = marker + task + head.replace(/\n/g, '\n' + pad);
    for (const p of parts) out += (p.list ? '\n' : '\n\n') + indent(p.md, pad);
    lines.push(out.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/** 一個區塊元素 → 一到多個 Markdown 區塊。 */
function block(k) {
  const tag = k.tag;
  if (/^h[1-6]$/.test(tag)) { const s = clean(k.kids.map(inl).join('')).replace(/\n/g, ' ').replace(/\*\*/g, ''); return s ? ['#'.repeat(+tag[1]) + ' ' + s] : []; }
  if (tag === 'hr') return ['---'];
  if (tag === 'pre') { const s = preMd(k); return s ? [s] : []; }
  if (tag === 'ul' || tag === 'ol') { const s = listMd(k); return s ? [s] : []; }
  if (tag === 'li') { const s = listMd({ tag: 'ul', attrs: {}, kids: [k] }); return s ? [s] : []; }
  if (tag === 'table') return tableMd(k);
  if (tag === 'blockquote') {
    const s = blocks(k.kids).join('\n\n');
    return s ? [s.split('\n').map(l => (l ? '> ' + l : '>')).join('\n')] : [];
  }
  if (tag === 'dt') { const s = clean(k.kids.map(inl).join('')); return s ? [wrap('**', s)] : []; }
  if (tag === 'summary') { const s = clean(k.kids.map(inl).join('')); return s ? [wrap('**', s)] : []; }
  return blocks(k.kids);
}

function blocks(kids) {
  const out = [];
  let run = [];
  const flush = () => { const s = clean(run.join('')); run = []; if (s) out.push(escapeStart(s)); };
  for (const k of kids) {
    if (k.text !== undefined) { run.push(inl(k)); continue; }
    if (SKIP.has(k.tag) || k.attrs.hidden !== undefined) continue;
    if (BLOCK.has(k.tag)) { flush(); out.push(...block(k)); }
    else if (hasBlock(k)) { flush(); out.push(...blocks(k.kids)); } // <b id="docs-internal-guid">…區塊…</b> 這類外層包裝
    else run.push(inl(k));
  }
  flush();
  return out;
}

/** HTML 字串 → Markdown(沒有內容就是空字串)。 */
export function htmlToMarkdown(html) {
  const md = blocks(parseHTML(String(html ?? '')).kids).join('\n\n');
  return md.replace(/\*\*\*\*/g, '').replace(/~~~~/g, '').replace(/====/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 貼上時用:剪貼簿有 HTML、而且轉出來比純文字多了結構(標題、粗體、連結、清單、表格…)就回傳 Markdown;
 * 否則回傳 null,呼叫端照原本貼純文字(例如從程式編輯器複製的上色文字、本來就是 Markdown 的文字)。
 */
export function pasteMarkdown(html, text = '') {
  if (!html || String(html).length > 3_000_000) return null;
  const md = htmlToMarkdown(html);
  if (!md) return null;
  const flat = s => String(s).replace(/\\/g, '').replace(/[\s ]+/g, '');
  return flat(md) === flat(text) ? null : md;
}
