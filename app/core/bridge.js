// 橋接:筆記與簡報之間的三種轉換(docs/INTEROP.md 第 3、4、5 節)。純邏輯,網站與命令列共用。
//   expandEmbeds()   摘錄嵌入:投影片裡單獨一行的 ![[筆記#標題]] → 換成那一段筆記(播放時才做,不改檔案)
//   promoteNote()    升級成簡報:筆記 → 新簡報骨架的檔案清單(一次性的複製)
//   distillDeck()    講後筆記:簡報的大綱與講者備註 → 一篇新筆記的內容
// 原則:筆記是知識的唯一來源,簡報是一次演出;這裡沒有任何雙向同步。

import { sectionOf, parseTarget, plainInline, sourceFingerprint } from './note.js';
import { t } from './i18n.js';

const FENCE = /^\s*(```+|~~~+)/;
const EMBED_LINE = /^\s*!\[\[([^[\]\n|]+?)(?:\|[^[\]\n]*)?\]\]\s*$/;

// ---------------- 摘錄嵌入 ----------------

/**
 * 把簡報裡的 ![[筆記#標題]] 換成筆記內容(直接改 deck 物件裡的 slide.body,不碰檔案)。
 * @param deck loadDeck() 的結果
 * @param {{ resolve: (link) => object|null, readNote: (rec) => Promise<string> }} io
 *   resolve 回傳筆記紀錄(找不到回傳 null);readNote 回傳筆記的 Markdown 內文(不含 front matter)
 * @returns {Promise<{ path: string, message: string }[]>} 找不到的摘錄
 */
export async function expandEmbeds(deck, { resolve, readNote }) {
  const issues = [];
  const cache = new Map();
  const body = async rec => { if (!cache.has(rec.path)) cache.set(rec.path, readNote(rec).catch(() => null)); return cache.get(rec.path); };
  for (const sec of deck.sections) for (const slide of sec.slides) {
    if (!slide.body || !slide.body.includes('![[')) continue;
    const out = [];
    let fence = null, changed = false;
    for (const line of slide.body.split('\n')) {
      const f = line.match(FENCE);
      if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
      const m = !fence && line.match(EMBED_LINE);
      if (!m) { out.push(line); continue; }
      const link = parseTarget(m[1]);
      const rec = link.channel === 'notes' ? resolve(link) : null;
      const text = rec ? await body(rec) : null;
      const part = text == null ? null : link.heading ? sectionOf(text, link.heading) : text.replace(/^#\s+.*\n?/, '').trim();
      if (part == null) { issues.push({ path: slide.file, message: t('check.embedMissing', { link: m[0].trim() }) }); out.push(line); continue; }
      out.push(part);
      changed = true;
    }
    if (changed) { slide.body = out.join('\n'); slide.embedded = true; }
  }
  return issues;
}

// ---------------- 升級成簡報 ----------------

/** 資料夾與檔案名稱:去掉不能用的字元;全部被去掉時用 fallback。 */
export function safeName(text, fallback = 'untitled') {
  const s = plainInline(String(text)).replace(/[\\/:*?"<>|#^[\]\u0000-\u001f.]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  return s || fallback;
}
const pad = n => String(n).padStart(2, '0');
const yamlStr = s => /^[\w\u3040-\u30ff\u3400-\u9fff][^:#'"[\]{},&*!|>%@`\n]*$/.test(s) ? s : JSON.stringify(s);

/** 把內文依某一級標題切開:回傳 { intro, parts: [{ title, body }] }(程式碼區塊裡的不算)。 */
function splitBy(body, level) {
  const mark = '#'.repeat(level) + ' ';
  const parts = [], intro = [];
  let cur = null, fence = null;
  for (const line of body.split('\n')) {
    const f = line.match(FENCE);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && line.startsWith(mark)) { cur = { title: plainInline(line.slice(mark.length).replace(/\s*#*\s*$/, '')), lines: [] }; parts.push(cur); continue; }
    (cur ? cur.lines : intro).push(line);
  }
  return { intro: intro.join('\n').trim(), parts: parts.map(p => ({ title: p.title, body: p.lines.join('\n').trim() })) };
}

/**
 * 一段筆記 → 一張投影片:標題寫結論,清單、表格、引言、圖片、程式碼留在畫面上,
 * 其餘的說明文字放進講者備註(簡報要比筆記短)。
 */
export function slideFromSection(title, body) {
  const blocks = body.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const visual = b => /^(\s*([-*+]|\d+[.)])\s|>|\||!\[|```|~~~|<!--)/.test(b);
  const show = blocks.filter(visual), talk = blocks.filter(b => !visual(b));
  // 沒有清單可放時,第一段留在畫面上(不超過兩行),其他進備註
  if (!show.length && talk.length) show.push(talk.shift());
  const notes = talk.map(plainInline).join('\n').trim() || t('promote.noteHint');
  return `# ${title}\n\n${show.join('\n\n')}\n\nNote:\n${notes}\n`;
}

/**
 * 筆記 → 簡報骨架。
 * @param {{ title: string, body: string, date?: string, lang?: string, tags?: string[] }} note parseNote() 的結果
 * @param {{ source: string, today?: string, author?: string, theme?: string }} opts source = 筆記在書庫裡的路徑(寫進 deck.yml)
 * @returns {{ folder: string, files: Record<string, string>, slides: number, sections: number }} files 的路徑相對於簡報資料夾
 */
export function promoteNote(note, { source, today = new Date().toISOString().slice(0, 10), author = '', theme = 'paper' } = {}) {
  const body = note.body.replace(/^#\s+.*\n?/m, '');
  const top = splitBy(body, 2);
  const files = {};
  const sections = [];
  let slides = 0;
  const addSection = (title, text) => {
    const folder = `${pad(sections.length + 1)}-${safeName(title, 'section')}`;
    const inner = splitBy(text, 3);
    const list = [];
    if (inner.intro || !inner.parts.length) list.push({ title, body: inner.intro });
    list.push(...inner.parts);
    list.forEach((s, i) => { files[`${folder}/${pad(i + 1)}-${safeName(s.title, 'slide')}.md`] = slideFromSection(s.title, s.body); slides++; });
    sections.push({ folder, title });
  };
  const nested = top.parts.some(p => /^###\s/m.test(p.body));
  if (nested) {
    // 有 ### 的長筆記:每個 ## 一章,### 是投影片
    if (top.intro) addSection(t('promote.opening', null, note.lang), top.intro);
    for (const p of top.parts) addSection(p.title, p.body);
  } else if (top.parts.length) {
    // 短筆記:只有一章,每個 ## 一張(一章一張的簡報沒有意義)
    const folder = `01-${safeName(note.title, 'main')}`;
    const list = [...(top.intro ? [{ title: note.title, body: top.intro }] : []), ...top.parts];
    list.forEach((sl, i) => { files[`${folder}/${pad(i + 1)}-${safeName(sl.title, 'slide')}.md`] = slideFromSection(sl.title, sl.body); slides++; });
    sections.push({ folder, title: note.title });
  } else if (top.intro) addSection(note.title, top.intro);
  if (!sections.length) addSection(note.title, '');

  files['deck.yml'] = [
    'mdslide: 1',
    `title: ${yamlStr(note.title)}`,
    author ? `author: ${yamlStr(author)}` : null,
    `date: ${today}`,
    `theme: ${theme}`,
    note.lang ? `lang: ${note.lang}` : null,
    note.tags?.length ? `tags: [${note.tags.join(', ')}]` : null,
    'sections:',
    ...sections.flatMap(s => [`  - folder: ${s.folder}`, `    title: ${yamlStr(s.title)}`]),
    `end: ${yamlStr(t('promote.end', null, note.lang))}`,
    ...(source ? [ // 沒有來源筆記(AI 生成的簡報)就不寫
      `# ${t('promote.sourceComment')}`,
      `source: ${source.replace(/\.md$/i, '')}`,
      `source_hash: "${sourceFingerprint([note])}"`,
    ] : []),
    '',
  ].filter(l => l != null).join('\n');
  return { folder: `${today}-${safeName(note.title, 'deck')}`, files, slides, sections: sections.length };
}

/**
 * 筆記本(多篇筆記)→ 簡報骨架:每篇筆記是一個章節,筆記裡的每個 ## 是一張投影片。
 * @param {{ title: string, notes: object[] }} book notes = parseNote() 的結果(已排好順序)
 */
export function promoteBook(book, { source, today = new Date().toISOString().slice(0, 10), author = '', theme = 'paper', lang = '', tags = [] } = {}) {
  const files = {};
  const sections = [];
  let slides = 0;
  for (const n of book.notes) {
    const folder = `${pad(sections.length + 1)}-${safeName(n.title, 'section')}`;
    const parts = splitBy(n.body.replace(/^#\s+.*\n?/m, ''), 2);
    const list = [];
    if (parts.intro || !parts.parts.length) list.push({ title: n.title, body: parts.intro });
    list.push(...parts.parts);
    list.forEach((s, i) => { files[`${folder}/${pad(i + 1)}-${safeName(s.title, 'slide')}.md`] = slideFromSection(s.title, s.body); slides++; });
    sections.push({ folder, title: n.title });
  }
  files['deck.yml'] = [
    'mdslide: 1', `title: ${yamlStr(book.title)}`, author ? `author: ${yamlStr(author)}` : null, `date: ${today}`, `theme: ${theme}`,
    lang ? `lang: ${lang}` : null, tags.length ? `tags: [${tags.join(', ')}]` : null,
    'sections:', ...sections.flatMap(s => [`  - folder: ${s.folder}`, `    title: ${yamlStr(s.title)}`]),
    `end: ${yamlStr(t('promote.end', null, lang))}`, `# ${t('promote.sourceComment')}`, `source: ${source}`, `source_hash: "${sourceFingerprint(book.notes)}"`, '',
  ].filter(l => l != null).join('\n');
  return { folder: `${today}-${safeName(book.title, 'deck')}`, files, slides, sections: sections.length };
}

// ---------------- 講後筆記 ----------------

/**
 * 簡報 → 講後筆記的內容。
 * @param deck loadDeck() 的結果
 * @param {{ deckPath: string, today?: string, qa?: { q: string, a?: string }[] }} opts deckPath = 簡報在書庫裡的路徑
 * @returns {{ file: string, text: string }} file = 建議的檔名
 */
export function distillDeck(deck, { deckPath, today = new Date().toISOString().slice(0, 10), qa = [] } = {}) {
  const L = k => t(k, null, deck.lang);
  const title = t('distill.title', { title: deck.title }, deck.lang);
  const out = [
    '---', `title: ${yamlStr(title)}`, `date: ${today}`, `tags: [${L('distill.tag')}]`, 'public: false', `from_deck: ${deckPath}`, '---',
    `# ${title}`, '', `> ${t('distill.lead', { title: deck.title }, deck.lang)}`, '',
    `## ${L('distill.outline')}`, '',
  ];
  for (const sec of deck.sections) {
    const real = sec.slides.filter(s => !s.auto);
    if (!real.length) continue;
    if (sec.title) out.push(`### ${sec.title}`, '');
    for (const s of real) {
      out.push(`- **${plainInline(s.title) || L('check.report.untitled')}**`);
      if (s.notes) out.push(...s.notes.split('\n').filter(l => l.trim()).map(l => `  ${l.trim()}`));
    }
    out.push('');
  }
  out.push(`## ${L('distill.qa')}`, '');
  const lines = v => String(v || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const items = qa.filter(x => x && lines(x.q).length);
  for (const x of items) {
    const [q1, ...qs] = lines(x.q), [a1 = '', ...as] = lines(x.a);
    const ref = Number.isInteger(x.n) && x.n > 0 ? ` ${t('distill.slideRef', { n: x.n }, deck.lang)}` : '';
    out.push(`- **${L('distill.q')}** ${q1}${ref}`, ...qs.map(l => `  ${l}`), `  **${L('distill.a')}** ${a1}`, ...as.map(l => `  ${l}`));
  }
  if (!items.length) out.push(`- **${L('distill.q')}** `, `  **${L('distill.a')}** `);
  out.push('', `## ${L('distill.next')}`, '', '- [ ] ', '');
  return { file: `${today}-${safeName(deck.title, 'talk')}-${safeName(L('distill.suffix'), 'after')}.md`, text: out.join('\n') };
}

/**
 * 讀入問答紀錄:講者視窗下載的 JSON([{ q, a, n }]),或手寫的純文字:
 *   Q: 問題 / 問:問題   開始新的一題
 *   A: 答案 / 答:答案   這一題的答案
 *   其他行接在上一個欄位後面;空行忽略。
 * @returns {{ q: string, a: string, n?: number }[]}
 */
export function parseQA(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  if (/^\s*\[/.test(src)) {
    let arr;
    try { arr = JSON.parse(src); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(x => x && typeof x.q === 'string' && x.q.trim())
      .map(x => ({ q: x.q.trim(), a: typeof x.a === 'string' ? x.a.trim() : '', ...(Number.isInteger(x.n) && x.n > 0 ? { n: x.n } : {}) }));
  }
  const out = [];
  let cur = null, field = 'q';
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(Q|A|\u554f|\u7b54)\s*[:\uff1a]\s*(.*)$/i.exec(line);
    if (m) {
      const isQ = /^(q|\u554f)$/i.test(m[1]);
      if (isQ || !cur) { cur = { q: '', a: '' }; out.push(cur); }
      field = isQ ? 'q' : 'a';
      cur[field] = m[2];
    } else if (cur) cur[field] = cur[field] ? `${cur[field]}\n${line}` : line;
  }
  return out.filter(x => x.q.trim());
}

/**
 * 「簡報已跟上來源筆記」:把 deck.yml 的 source_hash 換成新的指紋(沒有就加在 source: 下一行)。
 * 只動這一行,其他內容、註解與排版保持原樣。
 */
export function withSourceHash(yml, hash) {
  const line = `source_hash: "${hash}"`;
  const text = String(yml);
  if (/^source_hash:.*$/m.test(text)) return text.replace(/^source_hash:.*$/m, line);
  if (/^source:.*$/m.test(text)) return text.replace(/^(source:.*)$/m, `$1\n${line}`);
  return `${text.replace(/\n*$/, '\n')}${line}\n`;
}
