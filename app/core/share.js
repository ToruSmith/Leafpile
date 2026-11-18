// 分享連結(Google Drive 書庫):決定「分享一篇筆記／一份簡報／一張畫布」要公開哪些檔案,
// 以及分享清單(manifest)的格式。不碰網路,只透過 source.list / readText 讀書庫。
//
// 分享清單是一個小 JSON,記下「路徑 → Drive 檔案 id」。它本身也設成公開,連結裡只放它的 id:
//   https://…/#/s/<清單的 id>
// 打開連結的人用這份清單組出一個唯讀的小書庫,沿用原本的筆記、簡報、畫布畫面。
// 檔案 id 不變,所以分享之後再改內容,對方看到的也會更新;新增的檔案要重新按一次分享才會加進去。

export const SHARE_DIR = '_shared';
export const SHARE_VERSION = 1;

const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
const isMedia = p => /\.(png|jpe?g|webp|gif|svg|avif|pdf|mp4|webm|mov)$/i.test(p);

/** 相對路徑轉成書庫內的完整路徑;往上跑出書庫、外部網址都回傳 null。 */
export function resolveRel(base, ref) {
  if (!ref || /^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(ref)) return null;
  let r;
  try { r = decodeURI(ref.split(/[?#]/)[0]); } catch { r = ref.split(/[?#]/)[0]; }
  const out = dirOf(base).split('/').filter(Boolean);
  for (const part of r.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join('/') || null;
}

/** Markdown 裡引用的圖片與檔案(![](…)、<img src>、[[!…]] 不算)。 */
export function mediaRefs(md) {
  const out = new Set();
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.add(m[1]);
  for (const m of md.matchAll(/<(?:img|video|source)\b[^>]*\bsrc=["']([^"']+)["']/gi)) out.add(m[1]);
  return [...out];
}

async function exists(source, path) {
  const i = path.lastIndexOf('/');
  const list = await source.list(i < 0 ? '' : path.slice(0, i)).catch(() => []);
  return list.some(e => e.kind === 'file' && e.name === path.slice(i + 1));
}

async function walk(source, dir, out) {
  for (const e of await source.list(dir)) {
    if (e.name.startsWith('.')) continue;
    const p = `${dir}/${e.name}`;
    if (e.kind === 'dir') { if (e.name !== '_archive') await walk(source, p, out); } else out.add(p);
  }
}

async function withMedia(source, path, out) {
  out.add(path);
  const text = await source.readText(path).catch(() => '');
  for (const ref of mediaRefs(text)) {
    const p = resolveRel(path, ref);
    if (p && isMedia(p) && await exists(source, p)) out.add(p);
  }
}

async function topicFile(source, root, topic, out) {
  const p = `${root}/${topic}/_topic.yml`;
  if (await exists(source, p)) out.add(p);
}

/**
 * item = { kind: 'note', path: 'notes/主題/a.md' }
 *      | { kind: 'deck', path: 'slides/主題/簡報' }
 *      | { kind: 'board', path: 'boards/名稱.canvas' }
 * (整個書庫 kind: 'library' 不走這裡:要公開哪些檔案由 core/pack.js 的 exportPlan(publicOnly) 決定,
 *  與「公開版書庫包」同一套規則。)
 * 回傳要公開的路徑(排好序)。
 */
export async function sharePaths(source, item) {
  const out = new Set();
  const parts = item.path.split('/');
  if (item.kind === 'note') {
    await withMedia(source, item.path, out);
    if (parts.length > 2) await topicFile(source, 'notes', parts[1], out);
  } else if (item.kind === 'deck') {
    await walk(source, item.path, out);
    if (parts.length > 2) await topicFile(source, 'slides', parts[1], out);
  } else if (item.kind === 'board') {
    out.add(item.path);
    let canvas = {};
    try { canvas = JSON.parse(await source.readText(item.path)); } catch { /* 壞掉的畫布:只分享畫布本身 */ }
    for (const n of canvas.nodes || []) {
      if (n.type !== 'file' || typeof n.file !== 'string') continue;
      const f = n.file.replace(/^\/+/, '');
      if (f.split('/').includes('..') || !(await exists(source, f))) continue;
      if (/(^|\/)deck\.ya?ml$/i.test(f)) await walk(source, f.replace(/\/[^/]+$/, ''), out); // 畫布上的簡報卡:整份簡報
      else if (/\.md$/i.test(f)) await withMedia(source, f, out);
      else out.add(f);
    }
  } else throw new Error('bad kind');
  return [...out].sort();
}

/** 分享清單的檔名:同一個項目每次分享都用同一個,重新分享時覆寫、不會越來越多。 */
export function manifestName(item) {
  let h = 0x811c9dc5;
  for (const ch of `${item.kind}:${item.path}`) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  const base = item.kind === 'library' ? 'library' : item.path.split('/').pop().replace(/\.(md|canvas)$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || item.kind;
  return `${SHARE_DIR}/${item.kind}-${base}-${h.toString(36)}.json`;
}

export function buildManifest(item, title, files) {
  return { leafpile: 'share', v: SHARE_VERSION, kind: item.kind, path: item.path, title: String(title || ''), files };
}

/** 讀分享清單:格式不對就丟出 'bad share'。路徑一律檢查,不接受往上跑出書庫的。 */
export function parseManifest(text) {
  let m;
  try { m = JSON.parse(text); } catch { throw new Error('bad share'); }
  if (!m || m.leafpile !== 'share' || !['note', 'deck', 'board', 'library'].includes(m.kind) || typeof m.path !== 'string' || !m.files || typeof m.files !== 'object') throw new Error('bad share');
  const files = {};
  for (const [p, id] of Object.entries(m.files)) {
    if (typeof id !== 'string' || !/^[\w-]{10,}$/.test(id)) continue;
    if (!p || p.startsWith('/') || p.split('/').some(x => !x || x === '.' || x === '..')) continue;
    files[p] = id;
  }
  const has = m.kind === 'library' ? Object.keys(files).length > 0 // 整個書庫:路徑是空的
    : m.kind === 'deck' ? Object.keys(files).some(p => p.startsWith(m.path + '/')) : m.path in files; // 簡報是資料夾
  if (!has) throw new Error('bad share');
  return { kind: m.kind, path: m.path, title: String(m.title || ''), files };
}

/** 重新分享時:上次公開、這次不再需要的檔案 id(改成私人、刪掉的投影片…)。keep = 其他分享還在用的。 */
export function noLongerShared(oldFiles, newFiles, keep = new Set()) {
  const now = new Set(Object.values(newFiles || {}));
  return [...new Set(Object.values(oldFiles || {}))].filter(id => !now.has(id) && !keep.has(id));
}

/** 對方打開連結時,要導到書庫裡的哪個畫面:{ mode, args }。 */
export function shareTarget(m) {
  if (m.kind === 'library') return { mode: 's', args: [] }; // 整個書庫:打開書架
  const p = m.path.split('/');
  if (m.kind === 'note') return { mode: 'n', args: [p.slice(1).join('/')] };
  if (m.kind === 'deck') return { mode: 'd', args: [p[1], p.slice(2).join('/')] };
  return { mode: 'b', args: [p.slice(1).join('/').replace(/\.canvas$/i, '')] };
}
