// 筆記:把一個 .md 檔解析成筆記資料(front matter、標題、段落、[[連結]])。
// 純邏輯,瀏覽器與 Node 共用。規則見 docs/SPEC.md 第 4、5 節。

import { parseYaml, YamlError } from './yaml.js';
import { splitOrder } from './names.js';
import { t } from './i18n.js';

/** 筆記裡不該出現的版型設定(版型只屬於簡報,見 docs/INTEROP.md「刻意不做的事」)。 */
export const LAYOUT_KEYS = ['layout', 'size', 'background', 'overlay', 'stage', 'transition', 'align', 'fit', 'ratio', 'font', 'text', 'footer', 'step', 'mark'];

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FENCE = /^\s*(```+|~~~+)/;

/** 拆出 front matter。回傳 { data, body, raw, error }。解析失敗時 data = {}、error = 訊息。 */
export function splitFrontMatter(text) {
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
export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[*_`~=[\]()<>]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

/** 去掉行內 Markdown 符號,給目錄與搜尋用。 */
export function plainInline(s) {
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
export function headingsOf(body) {
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
export function parseTarget(raw) {
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
export function wikilinksOf(body) {
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
export function replaceWikilinks(text, fn) {
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
export function formatWikilink(link) {
  return `${link.embed ? '!' : ''}[[${link.channel === 'slides' ? 'slides:' : ''}${link.target || ''}${link.heading ? '#' + link.heading : ''}${link.label ? '|' + link.label : ''}]]`;
}

/** 連結預設顯示的文字。 */
export function linkLabel(link) {
  if (link.label) return link.label;
  const name = link.target ? link.target.split('/').pop() : '';
  return link.heading ? (name ? `${name} › ${link.heading}` : link.heading) : name;
}

/**
 * 取出某個標題底下的一段(到下一個同級或更高級的標題為止,不含標題本身)。
 * heading 可以是標題文字或 slug;找不到回傳 null。
 */
export function sectionOf(body, heading) {
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
export function parseNote(text, { path }) {
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
export function sourceFingerprint(notes) {
  let h = 0x811c9dc5;
  const feed = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const n of [...notes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    feed(String(n.body || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim());
    feed('\u0000');
  }
  return h.toString(16).padStart(8, '0');
}

/** 新筆記的檔名:日期 + 標題(去掉檔名不能用的字元)。 */
export function newNoteFileName(title, date = new Date().toISOString().slice(0, 10)) {
  const safe = String(title).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'note';
  return `${date}-${safe}.md`;
}

/** 新筆記的內容(front matter + 標題)。 */
export function newNoteText(title, date = new Date().toISOString().slice(0, 10)) {
  return `---\ntitle: ${/[:#'"[\]{},&*!|>%@`]/.test(title) ? JSON.stringify(title) : title}\ndate: ${date}\ntags: []\n---\n# ${title}\n\n`;
}

/**
 * 快速收集(記到收件匣):一段隨手寫的文字 → 新筆記。
 * 第一行(去掉 # 與 Markdown 記號)當標題,太長就截斷;其餘當內文。只有一行時內文就是那一行。
 * @returns {{ title: string, fileName: string, text: string } | null}  沒有字時回傳 null
 */
export function captureNote(raw, date = new Date().toISOString().slice(0, 10)) {
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
export function numberedName(fileName, n) {
  return n < 2 ? fileName : String(fileName).replace(/(\.md)?$/i, m => `-${n}${m || ''}`);
}
