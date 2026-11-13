// 用 AI 生成筆記、簡報、畫布:組提示詞、AI 網址,以及把 AI 的回覆組成可以匯入的檔案。
// 原則:提示詞只請 AI 先讀 docs/AI_PACK.md(書庫包規格)再交完整的書庫包(zip 或文字書庫包);規則都在規格裡。
// AI 沒照規格、只回 Markdown 時,這裡仍會補上檔名、日期、front matter、deck.yml、畫布座標(退路)。品質取決於使用者給的資料。
// 產生的檔案交給 core/pack.js 的 planImport 合併(絕不覆蓋既有檔案)。

import { t } from './i18n.js';
import { parsePackText } from './pack.js';
import { newNoteFileName, newNoteText } from './note.js';
import { promoteNote } from './bridge.js';
import { boardFileName, serializeCanvas } from './canvas.js';
import { newTopicYaml } from './topics.js';

export const GEN_KINDS = ['note', 'deck', 'board'];

/** 常用的 AI:先複製提示詞再開新分頁;提示詞不長時,支援的網站另外用網址帶入(帶不進去時貼上一次也一定能用)。 */
export const AI_TARGETS = [
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', param: 'q' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', param: 'q' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
];
export const PREFILL_MAX = 1800; // 網址帶入的上限(各家都有長度限制;超過就只靠剪貼簿)

export function aiURL(id, prompt, max = PREFILL_MAX) {
  const a = AI_TARGETS.find(x => x.id === id);
  if (!a) return '';
  return a.param && prompt.length <= max ? `${a.url}?${a.param}=${encodeURIComponent(prompt)}` : a.url;
}

/** 給 AI 讀的書庫包規格(docs/AI_PACK.md):放在 GitHub,AI 可以直接開網址;網站上也有一份(「複製規格全文」用)。 */
export const SPEC_URLS = {
  'zh-Hant': 'https://raw.githubusercontent.com/ToruSmith/Leafpile/main/docs/AI_PACK.md',
  en: 'https://raw.githubusercontent.com/ToruSmith/Leafpile/main/docs/AI_PACK.en.md',
};
export const specPath = lang => (lang === 'en' ? 'docs/AI_PACK.en.md' : 'docs/AI_PACK.md');

/**
 * 組提示詞:請 AI 先讀規格,再照規格交一個完整的書庫包(zip,或文字書庫包)。
 * 規則都在規格裡,提示詞本身很短;資料留空時改指向附件。
 */
export function buildPrompt({ kind, title, topic = '', topicId = '01-inbox', extra = '', data = '', lang = 'zh-Hant' }) {
  if (!GEN_KINDS.includes(kind)) throw new Error('kind');
  return t('gen.prompt', {
    spec: SPEC_URLS[lang] || SPEC_URLS['zh-Hant'],
    what: t('gen.what.' + kind),
    topicId: String(topicId).trim() || '01-inbox',
    title: String(title).trim(),
    topic: String(topic).trim(),
    extra: String(extra).trim() ? t('gen.extraLine', { extra: String(extra).trim() }) : '',
    data: String(data).trim() || t('gen.dataAttached'),
  }).replace(/\n{3,}/g, '\n\n');
}

// ---------------- 把 AI 的回覆組成檔案 ----------------

const isLibraryPath = p => /^(notes|slides|boards)\//.test(p) || p === '_site.yml';
const h1Of = text => text.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.trim() || '';
const dropH1 = text => text.replace(/^#\s+.*\n?/m, '').replace(/^\s*\n/, '');

/** 回覆裡的檔案;沒有 === FILE 標記時把整段當成一份(使用者可能只貼了 Markdown)。 */
function filesOf(text, title) {
  const files = parsePackText(text);
  if (files.length) return files;
  const body = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  return body ? [{ path: `${title}.md`, data: body + '\n' }] : [];
}

/**
 * 把 AI 的回覆組成要匯入的檔案(書庫裡的路徑)。
 * @param {{ kind: string, text: string, title: string, topicId: string, topicName?: string, newTopic?: boolean, today?: string, theme?: string, lang?: string }} o
 * @returns {{ path: string, data: string }[]}
 */
export function assembleGenerated({ kind, text, title, topicId, topicName = '', newTopic = false, today = new Date().toISOString().slice(0, 10), theme = 'paper', lang = '' }) {
  const files = filesOf(text, title);
  if (!files.length) return [];
  if (files.some(f => isLibraryPath(f.path))) return files.filter(f => isLibraryPath(f.path)); // 已經是完整的書庫包
  const out = newTopic ? [{ path: `notes/${topicId}/_topic.yml`, data: newTopicYaml({ name: topicName || topicId }) }] : [];

  if (kind === 'note') {
    const used = new Set();
    for (const f of files) {
      const name = f.path.split('/').pop().replace(/\.md$/i, '');
      let body = f.data;
      let noteTitle = name;
      if (!/^---\n/.test(body)) {
        noteTitle = h1Of(body) || name || title;
        body = newNoteText(noteTitle, today) + dropH1(body).trimStart();
      }
      let path = `notes/${topicId}/${newNoteFileName(noteTitle, today)}`;
      for (let n = 2; used.has(path); n++) path = `notes/${topicId}/${newNoteFileName(`${noteTitle}-${n}`, today)}`;
      used.add(path);
      out.push({ path, data: body.endsWith('\n') ? body : body + '\n' });
    }
    return out;
  }

  if (kind === 'deck') {
    const all = files.map(f => f.data).join('\n\n');
    const deckTitle = h1Of(all) || title;
    const r = promoteNote({ title: deckTitle, body: dropH1(all), lang, tags: [] }, { source: '', today, theme });
    for (const [p, data] of Object.entries(r.files)) out.push({ path: `slides/${topicId}/${r.folder}/${p}`, data });
    return out;
  }

  if (kind === 'board') {
    const outline = parseOutline(files.map(f => f.data).join('\n'));
    out.push({ path: `boards/${boardFileName(title)}`, data: serializeCanvas(outlineToCanvas(outline)) });
    return out;
  }
  throw new Error('kind');
}

/**
 * 畫布大綱:## 群組、- 卡片;「## 連線」(或 Links / Connections)底下每行「A -> B : 關係」。
 * 沒有群組的卡片放進一個不具名的群組。
 */
export function parseOutline(text) {
  const groups = [], links = [];
  let cur = null, inLinks = false;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) {
      inLinks = /^(\u9023\u7DDA|\u95DC\u4FC2|links?|connections?|edges?)$/i.test(h[1].trim());
      if (!inLinks && !/^#\s/.test(line)) { cur = { label: h[1].trim(), cards: [] }; groups.push(cur); }
      continue;
    }
    const item = line.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!item) continue;
    const arrow = item[1].match(/^(.+?)\s*(?:->|→|=>)\s*(.+?)(?:\s*[:\uFF1A]\s*(.+))?$/);
    if (inLinks || (arrow && !cur)) { if (arrow) links.push({ from: arrow[1].trim(), to: arrow[2].trim(), label: (arrow[3] || '').trim() }); continue; }
    if (!cur) { cur = { label: '', cards: [] }; groups.push(cur); }
    cur.cards.push(item[1].trim());
  }
  return { groups: groups.filter(g => g.cards.length), links };
}

/** 大綱 → JSON Canvas:每個群組一欄,卡片由上往下排;連線依卡片文字對上。 */
export function outlineToCanvas({ groups, links }) {
  const W = 260, GAP = 24, PAD = 24, TOP = 56, COL = W + PAD * 2 + 60;
  const nodes = [], edges = [], idOf = new Map();
  const height = s => 56 + 22 * Math.max(0, Math.ceil([...s].length / 15) - 1);
  groups.forEach((g, i) => {
    const x = i * COL;
    let y = TOP;
    const cards = g.cards.map((text, j) => {
      const h = height(text);
      const n = { id: `c${i + 1}-${j + 1}`, type: 'text', text, x: x + PAD, y, width: W, height: h };
      y += h + GAP;
      if (!idOf.has(text)) idOf.set(text, n.id);
      return n;
    });
    if (g.label) nodes.push({ id: `g${i + 1}`, type: 'group', label: g.label, x, y: 0, width: W + PAD * 2, height: y - GAP + PAD });
    nodes.push(...cards);
  });
  const find = s => idOf.get(s) || [...idOf].find(([k]) => k.includes(s) || s.includes(k))?.[1];
  links.forEach((l, i) => {
    const a = find(l.from), b = find(l.to);
    if (a && b && a !== b) edges.push({ id: `e${i + 1}`, fromNode: a, fromSide: 'right', toNode: b, toSide: 'left', ...(l.label ? { label: l.label } : {}) });
  });
  return { nodes, edges };
}
