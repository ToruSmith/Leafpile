// 筆記的改名與搬移:算出要改哪些檔案,不讀寫檔案(呼叫端負責讀取與寫入)。
//
// 原則(docs/INTEROP.md 第 7 節):
//   - 只改「本來連到這篇、改完之後會找不到或找錯」的連結;用別名或仍然有效的寫法連過來的不動。
//   - 連結保留原本的 #標題、|顯示文字 與 ! 嵌入。
//   - 新的寫法優先用標題;標題在那個位置會撞名時,改用路徑(一定唯一)。
//   - 筆記裡相對路徑的圖片與連結,搬到別的資料夾後換算成新的相對路徑。

import { splitFrontMatter, replaceWikilinks, formatWikilink } from './note.js';
import { createResolver, norm } from './links.js';

const stripExt = s => String(s).replace(/\.md$/i, '');
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** 檔名裡不能用的字元拿掉;空白換成 -。 */
export function safeTitle(title) {
  return String(title).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'note';
}

/** 改名後的檔名:保留原本的日期或排序前綴(`2026-11-12-`、`03-`)。 */
export function renamedFile(oldName, title) {
  const prefix = (oldName.match(/^(\d{4}-\d{2}(?:-\d{2})?[\s._-]+|\d+[\s._-]+)/) || [''])[0];
  return `${prefix}${safeTitle(title)}.md`;
}

const yamlTitle = s => (/^[\s]|[\s]$|[:#'"[\]{},&*!|>%@`]/.test(s) || /^[-?]/.test(s) ? JSON.stringify(s) : s);

/**
 * 換標題:有 front matter 的 title 就改它(第一個 `# ` 標題和舊標題一樣時也一起改,免得畫面上兩個標題不一致);
 * 沒有 title 的話改第一個 `# ` 標題;都沒有就加上 title。其他內容一字不動。
 */
export function retitle(text, title, oldTitle = null) {
  const src = String(text);
  const fm = splitFrontMatter(src);
  const head = src.length - fm.body.length;
  const lines = fm.body.split('\n');
  let h1 = -1, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1]; else if (lines[i].trim().startsWith(fence)) fence = null; continue; }
    if (!fence && /^# /.test(lines[i])) { h1 = i; break; }
  }
  const setH1 = () => { const cr = lines[h1].endsWith('\r') ? '\r' : ''; lines[h1] = `# ${title}${cr}`; return lines.join('\n'); };
  if (fm.raw && /^title:.*$/m.test(fm.raw)) {
    const end = src.indexOf(fm.raw) + fm.raw.length;
    const top = src.slice(0, end).replace(/^title:.*$/m, `title: ${yamlTitle(title)}`) + src.slice(end, head);
    const same = h1 >= 0 && oldTitle != null && lines[h1].slice(2).trim() === String(oldTitle).trim();
    return top + (same ? setH1() : fm.body);
  }
  if (h1 >= 0) return src.slice(0, head) + setH1();
  if (fm.raw) {
    const end = src.indexOf(fm.raw) + fm.raw.length;
    return `${src.slice(0, end)}\ntitle: ${yamlTitle(title)}${src.slice(end)}`;
  }
  return `---\ntitle: ${yamlTitle(title)}\n---\n${src}`;
}

/** 正規化路徑(處理 . 與 ..);跑出根目錄時回傳 null。 */
function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join('/');
}

/** 從 fromDir 到 target 的相對路徑。 */
function relative(fromDir, target) {
  const a = fromDir ? fromDir.split('/') : [], b = target.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/**
 * 搬到別的資料夾:Markdown 裡相對路徑的圖片與連結換算成新的相對路徑
 * (網址、#錨點、/ 開頭、程式碼區塊裡的都不動)。
 */
export function rebaseLinks(text, fromDir, toDir) {
  if (fromDir === toDir) return String(text);
  let fence = null;
  return String(text).split('\n').map(line => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1]; else if (line.trim().startsWith(fence)) fence = null; return line; }
    if (fence) return line;
    return line.replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (m, pre, url, post) => {
      const bare = url.startsWith('<') ? url.slice(1, -1) : url;
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(bare)) return m;
      const [p, hash = ''] = bare.split(/(?=#)/);
      const abs = normalize(fromDir ? `${fromDir}/${p}` : p);
      if (abs == null) return m;
      const next = relative(toDir, abs) + hash;
      return pre + (url.startsWith('<') ? `<${next}>` : next) + post;
    });
  }).join('\n');
}

/**
 * 算出改名／搬移時要改的連結。
 * @param {object} p
 * @param {object[]} p.records  圖譜裡的筆記與簡報紀錄(core/graph.js)
 * @param {{ path: string, text: string, topicId: string }[]} p.files  可能連到這篇的檔案(筆記、投影片)
 * @param {object} p.from   被搬的筆記紀錄
 * @param {{ path: string, rel: string, topicId: string, title: string }} p.to  搬完之後
 * @returns {{ edits: { path: string, text: string, count: number }[], count: number }}
 */
export function planLinkUpdates({ records, files, from, to }) {
  const moved = { ...from, ...to };
  const before = createResolver(records);
  const after = createResolver(records.map(r => (r === from ? moved : r)));
  const edits = [];
  let total = 0;
  for (const f of files) {
    if (f.path === from.path) continue; // 筆記自己裡面的連結另外處理(內容會跟著搬)
    const ctx = { fromTopic: f.topicId, fromPath: f.path };
    const { text, count } = replaceWikilinks(f.text, link => {
      if (link.channel !== 'notes' || !link.target) return null;
      if (before.resolve(link, ctx).target !== from) return null;
      const now = after.resolve(link, ctx);
      if (now.status === 'ok' && now.target === moved) return null;
      const byTitle = after.resolve({ channel: 'notes', target: to.title }, ctx);
      const target = byTitle.status === 'ok' && byTitle.target === moved && !/[#|[\]]/.test(to.title) ? to.title : stripExt(to.rel);
      return formatWikilink({ ...link, target });
    });
    if (count) { edits.push({ path: f.path, text, count }); total += count; }
  }
  return { edits, count: total };
}

/** deck.yml 的 source 指到這篇筆記時,改成新路徑(只改那一行)。 */
export function retargetSource(yml, fromPath, toPath) {
  const re = /^source:[ \t]*(.*?)[ \t]*$/m;
  const m = String(yml).match(re);
  if (!m) return null;
  const cur = m[1].replace(/^["']|["']$/g, '');
  if (norm(stripExt(cur)) !== norm(stripExt(fromPath))) return null;
  return String(yml).replace(re, `source: ${stripExt(toPath)}`);
}

export { dirOf };
