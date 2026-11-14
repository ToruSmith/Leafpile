// 刪除:Leafpile 不真的刪檔,「刪除」= 整個檔案或資料夾搬到書庫根目錄的 _archive/,保留原本的相對路徑。
// 這裡只放純邏輯(路徑規則、編號、還原清單);實際搬檔在 sources/sources.js 的 archiveTree / moveTree。

export const ARCHIVE_ROOT = '_archive';
const DELETABLE = ['notes', 'slides', 'boards'];

const badPart = p => !p || p === '.' || p === '..' || p.includes('\0');

/** 可以刪除的路徑:在 notes/ slides/ boards/ 底下,至少兩層(不能把整個 notes/ 搬走)。 */
export function trashablePath(path) {
  const parts = String(path).split('/');
  return parts.length >= 2 && !parts.some(badPart) && DELETABLE.includes(parts[0]);
}

/** 搬移(刪除或還原)允許的路徑:上面那些,加上 _archive/ 底下。 */
export function treePath(path) {
  const parts = String(path).split('/');
  return parts.length >= 2 && !parts.some(badPart) && [...DELETABLE, ARCHIVE_ROOT].includes(parts[0]);
}

/** 封存位置。n > 1 時在最後一段加編號(a.md → a-2.md;資料夾 x → x-2)。 */
export function archivePath(path, n = 1, isDir = false) {
  const i = path.lastIndexOf('/');
  const dir = path.slice(0, i + 1), name = path.slice(i + 1);
  const numbered = n > 1 ? (isDir ? `${name}-${n}` : name.replace(/(\.[^./]*)?$/, `-${n}$1`)) : name;
  return `${ARCHIVE_ROOT}/${dir}${numbered}`;
}

/**
 * 從 _archive/ 底下所有檔案的路徑,整理出可以「還原」的項目:
 *   筆記(.md)、畫布(.canvas)、整份簡報(原本的簡報資料夾已經不在了)、整個主題(原本的主題資料夾已經不在了)。
 * 簡報還在、只是封存了其中幾張投影片,或匯入的復原資料夾(_archive/import-…),不列出來,那些請自己搬回去。
 * @param {string[]} files  _archive/ 底下每個檔案的路徑(含 _archive/ 開頭)
 * @param {{ liveTopics?: Set<string>, liveDecks?: Set<string> }} opts  目前還在的主題資料夾名稱(notes/ 與 slides/ 底下)、還在的簡報資料夾(「主題/簡報」)
 * @returns {{ kind: 'note'|'board'|'deck'|'topic', path: string, to: string, label: string }[]}
 */
export function trashItems(files, { liveTopics = new Set(), liveDecks = new Set() } = {}) {
  const out = [], topics = new Map(), decks = new Map(), skipTopic = new Set();
  const top = f => { const m = /^_archive\/(notes|slides)\/([^/]+)\//.exec(f); return m && !liveTopics.has(m[2]) ? [m[1], m[2]] : null; };
  for (const f of files) {
    const tp = top(f);
    if (tp) { topics.set(`${tp[0]}/${tp[1]}`, { kind: 'topic', path: `${ARCHIVE_ROOT}/${tp[0]}/${tp[1]}`, to: `${tp[0]}/${tp[1]}`, label: `${tp[0]}/${tp[1]}` }); skipTopic.add(f); }
  }
  for (const f of files) {
    if (skipTopic.has(f)) continue;
    let m;
    if ((m = /^_archive\/notes\/(.+\.md)$/i.exec(f))) {
      if (!m[1].split('/').some(p => p.startsWith('_'))) out.push({ kind: 'note', path: f, to: `notes/${m[1]}`, label: m[1] });
    } else if ((m = /^_archive\/boards\/([^/]+\.canvas)$/i.exec(f))) out.push({ kind: 'board', path: f, to: `boards/${m[1]}`, label: m[1].replace(/\.canvas$/i, '') });
    else if ((m = /^_archive\/slides\/([^/]+\/[^/]+)\/.+/.exec(f)) && !liveDecks.has(m[1])) decks.set(m[1], { kind: 'deck', path: `${ARCHIVE_ROOT}/slides/${m[1]}`, to: `slides/${m[1]}`, label: m[1] });
  }
  return [...out, ...decks.values(), ...topics.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}
