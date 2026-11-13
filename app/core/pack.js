// 書庫包:把書庫打包成 zip、從 zip / 資料夾 / AI 給的文字匯入,並且安全地合併進現有的書庫。
// 純邏輯,瀏覽器與 Node 共用;真正寫檔的是呼叫端(main.js),這裡只產生「要做什麼」的清單。
//
// 合併規則(docs/SPEC.md「書庫包」):
//   全新的檔案 → 新增;同路徑同內容 → 略過;同路徑不同內容 → 絕不覆蓋,改存成「名稱-2」
//   已經有的 _topic.yml、_book.yml → 保留你原本的;已經有的簡報(deck.yml 不同)→ 整份簡報改存成「資料夾-2」
//   _site.yml → 只補上你沒有的分類;書庫根目錄的工具檔(README、leafpile-check.mjs…)與 _archive/ → 略過

import { parseYaml } from './yaml.js';
import { planCategories } from './topics.js';

export const TEXT_EXT = /\.(md|ya?ml|canvas)$/i;
export const BINARY_EXT = /\.(png|jpe?g|webp|gif|svg|avif|pdf|html?)$/i;
const ROOTS = new Set(['notes', 'slides', 'boards']);
const CONFIG = /(^|\/)(_topic|_book|deck)\.ya?ml$/i;
const TOOL_FILES = new Set(['README.md', 'README.en.md', 'leafpile-check.mjs', 'check-library.cmd', 'check-library.command']);

const dec = new TextDecoder();
const enc = new TextEncoder();

/** 這個路徑在書庫包裡算什麼:'text' | 'binary' | null(不收)。 */
export function fileKind(path) {
  if (TEXT_EXT.test(path)) return 'text';
  if (BINARY_EXT.test(path)) return 'binary';
  return null;
}

/** 書庫包收不收這個路徑;不收時回傳原因。 */
export function skipReason(path) {
  const top = path.split('/')[0];
  if (path === '_site.yml') return '';
  if (top === '_archive' || path.includes('/_archive/')) return 'archive';
  if (!path.includes('/')) return TOOL_FILES.has(path) ? 'tool' : 'outside';
  if (!ROOTS.has(top)) return 'outside';
  if (!fileKind(path)) return 'type';
  return '';
}

/** 走訪整個資料來源,列出所有檔案路徑(略過 . 開頭與 _archive/)。 */
export async function walkFiles(source, dir = '') {
  const out = [];
  let entries;
  try { entries = await source.list(dir); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_archive') continue;
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === 'dir') out.push(...await walkFiles(source, p));
    else out.push(p);
  }
  return out;
}

/**
 * 匯出時要放哪些檔案。
 * 公開包(publicOnly):只放判斷為公開的筆記(與它們所在主題、筆記本的設定檔、內文提到的圖片);
 * 簡報跟著主題的預設公開(_topic.yml 的 public: true);local_only 主題一律不放;畫布不放(文字卡可能有私人內容)。
 * @param {string[]} paths walkFiles 的結果
 * @param {{ vault: object, graph: object, publicOnly?: boolean }} ctx
 * @returns {{ include: string[], skipped: { path: string, reason: string }[] }}
 */
export function exportPlan(paths, { vault, graph, publicOnly = false }) {
  const include = [], skipped = [];
  const usable = paths.filter(p => { const r = skipReason(p); if (r) skipped.push({ path: p, reason: r }); return !r; });
  if (!publicOnly) return { include: usable, skipped };

  const notes = [...(graph?.notes?.values() || [])].filter(n => n.public && !n.localOnly);
  const notePaths = new Set(notes.map(n => n.path));
  const bodies = notes.map(n => n.body || '').join('\n');
  const topicOf = id => (vault.topics || []).find(tp => tp.id === id);
  const deckPublic = id => { const tp = topicOf(id); const c = tp?.conf || {}; const s = tp?.slidesTopic?.conf || {}; return (c.public === true || s.public === true) && c.local_only !== true && s.local_only !== true; };
  const decks = [...(graph?.decks?.values() || [])].filter(d => deckPublic(d.topicId)).map(d => d.path);
  const under = (dir, list) => list.some(p => p.startsWith(dir + '/'));

  for (const p of usable) {
    const parts = p.split('/'), dir = parts.slice(0, -1).join('/'), name = parts.at(-1);
    let ok = false;
    if (p === '_site.yml') ok = true;
    else if (parts[0] === 'notes') {
      if (/\.md$/i.test(p)) ok = notePaths.has(p);
      else if (CONFIG.test(p)) ok = under(dir, [...notePaths]);
      else if (fileKind(p) === 'binary') ok = bodies.includes(name); // 公開筆記的內文有提到這個檔名
    } else if (parts[0] === 'slides') {
      if (/^_topic\.ya?ml$/i.test(name) && parts.length === 3) ok = under(dir, decks);
      else ok = decks.some(d => p.startsWith(d + '/'));
    }
    if (ok) include.push(p); else skipped.push({ path: p, reason: 'private' });
  }
  return { include, skipped };
}

// ---------------- 文字書庫包(給 AI 輸出、貼回來匯入) ----------------
// 格式:每個檔案以「=== FILE: 路徑 ===」開頭、「=== END ===」結尾。前後的說明文字會被忽略。

const START = /^\s*={3,}\s*FILE:\s*(.+?)\s*={3,}\s*$/;
const END = /^\s*={3,}\s*END\s*={3,}\s*$/;

/** 文字書庫包 → [{ path, data }]。AI 常在每個檔案外面多包一層 ``` ,這裡會拿掉。 */
export function parsePackText(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    let body = cur.lines;
    while (body.length && !body[0].trim()) body = body.slice(1);
    while (body.length && !body.at(-1).trim()) body = body.slice(0, -1);
    const fence = body.length >= 2 && /^```[\w-]*\s*$/.test(body[0]) && /^```\s*$/.test(body.at(-1));
    if (fence && (!/\.md$/i.test(cur.path) || /^```(markdown|md)?\s*$/i.test(body[0]))) body = body.slice(1, -1);
    out.push({ path: cur.path.replace(/^`|`$/g, '').replace(/^\.?\//, ''), data: body.join('\n') + '\n' });
    cur = null;
  };
  for (const line of lines) {
    const m = line.match(START);
    if (m) { close(); cur = { path: m[1], lines: [] }; continue; }
    if (END.test(line)) { close(); continue; }
    if (cur) cur.lines.push(line);
  }
  close();
  return out;
}

/** [{ path, data(文字) }] → 文字書庫包。 */
export function packText(files) {
  return files.map(f => `=== FILE: ${f.path} ===\n${String(f.data).replace(/\n$/, '')}\n=== END ===`).join('\n\n') + '\n';
}

// ---------------- 匯入:整理、規劃 ----------------

const asText = d => (typeof d === 'string' ? d : dec.decode(d)).replace(/^﻿/, '');
const asBytes = d => (typeof d === 'string' ? enc.encode(d) : d);
const sameData = (a, b, kind) => {
  if (kind === 'text') return asText(a).replace(/\r\n?/g, '\n') === asText(b).replace(/\r\n?/g, '\n');
  const x = asBytes(a), y = asBytes(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

/**
 * 進來的檔案:zip 常常多包一層資料夾(leafpile-library/notes/…),去掉它;路徑統一用 /。
 * @param {{ path: string, data: Uint8Array|string }[]} files
 */
export function normalizeIncoming(files) {
  const list = files.map(f => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\/+/, '') })).filter(f => f.path && !f.path.endsWith('/'));
  const firsts = new Set(list.map(f => f.path.split('/')[0]));
  if (firsts.size === 1 && list.every(f => f.path.includes('/'))) {
    const [only] = firsts;
    if (!ROOTS.has(only)) return list.map(f => ({ ...f, path: f.path.slice(only.length + 1) }));
  }
  return list;
}

/**
 * 規劃匯入(不寫檔)。
 * @param {{ path: string, data: Uint8Array|string }[]} incoming normalizeIncoming 之後的檔案
 * @param {{ exists: (path) => Promise<boolean>, read: (path) => Promise<Uint8Array|string> }} target 現有的書庫
 * @returns {Promise<{ items: object[], counts: Record<string, number> }>}
 *   item:{ path(寫到哪), from(包裡的路徑), kind, action: 'add'|'rename'|'merge'|'same'|'keep'|'skip', reason?, data, note? }
 */
export async function planImport(incoming, target) {
  const items = [];
  const planned = new Set();
  const existsCache = new Map();
  const exists = async p => { if (!existsCache.has(p)) existsCache.set(p, await target.exists(p)); return existsCache.get(p); };

  // 簡報:已經有同名簡報而 deck.yml 不同 → 整份簡報換資料夾名稱(不要把兩份簡報的投影片混在一起)
  const deckMap = new Map();
  for (const f of incoming) {
    const m = f.path.match(/^(slides\/.+)\/deck\.ya?ml$/i);
    if (!m || !(await exists(f.path))) continue;
    if (sameData(f.data, await target.read(f.path), 'text')) continue;
    const dirTaken = async d => (await exists(`${d}/deck.yml`)) || (await exists(`${d}/deck.yaml`)) || [...deckMap.values()].includes(d);
    let n = 2, cand;
    do { cand = `${m[1]}-${n++}`; } while (await dirTaken(cand));
    deckMap.set(m[1], cand);
  }
  const mapDeck = p => { for (const [a, b] of deckMap) if (p.startsWith(a + '/')) return b + p.slice(a.length); return p; };

  for (const f of incoming) {
    const reason = skipReason(f.path);
    const kind = fileKind(f.path);
    if (reason) { items.push({ path: f.path, from: f.path, kind, action: 'skip', reason }); continue; }
    const path = mapDeck(f.path);
    const base = { path, from: f.path, kind, data: kind === 'text' ? asText(f.data) : asBytes(f.data) };
    if (path !== f.path) { items.push({ ...base, action: 'add', note: 'deckRenamed' }); planned.add(path); continue; }
    if (planned.has(path)) { items.push({ ...base, action: 'skip', reason: 'duplicate' }); continue; }
    if (!(await exists(path))) { items.push({ ...base, action: 'add' }); planned.add(path); continue; }
    const old = await target.read(path);
    if (sameData(base.data, old, kind)) { items.push({ ...base, action: 'same' }); continue; }
    if (path === '_site.yml') { items.push(mergeSite(base, asText(old))); continue; }
    if (CONFIG.test(path)) { items.push({ ...base, action: 'keep' }); continue; }
    const m = path.match(/^(.*?)(\.[^./]+)?$/);
    let n = 2, to;
    do { to = `${m[1]}-${n++}${m[2] || ''}`; } while (planned.has(to) || await exists(to));
    items.push({ ...base, path: to, action: 'rename' });
    planned.add(to);
  }
  const counts = {};
  for (const it of items) counts[it.action] = (counts[it.action] || 0) + 1;
  return { items, counts };
}

/** _site.yml:只補上沒有的分類,其他設定(標題、主題…)保留原本的。 */
function mergeSite(item, oldText) {
  let mine = [], theirs = [];
  try { mine = parseYaml(oldText)?.categories || []; } catch { /* 壞掉的設定檔:不合併 */ return { ...item, action: 'keep' }; }
  try { theirs = parseYaml(item.data)?.categories || []; } catch { return { ...item, action: 'keep' }; }
  const norm = list => (Array.isArray(list) ? list : []).filter(c => c && c.id != null).map(c => ({ id: String(c.id), name: String(c.name ?? c.id), color: c.color ? String(c.color) : '' }));
  const have = norm(mine), ids = new Set(have.map(c => c.id));
  const add = norm(theirs).filter(c => !ids.has(c.id));
  if (!add.length) return { ...item, action: 'keep' };
  const plan = planCategories(oldText, [...have, ...add], []);
  return { ...item, data: plan.text, old: oldText, action: 'merge', added: add.map(c => c.name), lostComments: plan.lostComments };
}
