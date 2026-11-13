// 畫布:boards/*.canvas,JSON Canvas 1.0(https://jsoncanvas.org/)。純邏輯,不碰畫面。
//
// 原則(docs/SPEC.md 第 7 節、docs/INTEROP.md 第 6 節):
//   - 畫布只存位置與連線,不複製筆記或簡報的內容;卡片顯示時才去讀標題。
//   - 讀寫時保留所有不認得的欄位(包括 Obsidian 與其他工具加的),Leafpile 自訂的欄位一律 x- 開頭。
//   - 從畫布移除卡片只改畫布,不會動到筆記或簡報檔案。

import { norm } from './links.js';

export const NODE_TYPES = ['text', 'file', 'link', 'group'];
export const SIDES = ['top', 'right', 'bottom', 'left'];
/** JSON Canvas 的預設色 1–6(紅橙黃綠青紫),對應 Leafpile 的色票。 */
export const PRESET_COLORS = { 1: '#c0504d', 2: '#d9822b', 3: '#c9a227', 4: '#5a8f5a', 5: '#3f8c9a', 6: '#8a6bb0' };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** 顏色:"1"–"6" 或 #rrggbb;其他一律不用(避免把任意字串放進樣式)。 */
export function canvasColor(c) {
  if (c == null || c === '') return '';
  const s = String(c).trim();
  if (PRESET_COLORS[s]) return PRESET_COLORS[s];
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(s) ? s : '';
}

/**
 * 解析畫布檔。壞掉的節點與連線略過並記在 issues,其餘照常顯示。
 * @returns {{ nodes: object[], edges: object[], extra: object, issues: string[] }}
 */
export function parseCanvas(text) {
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
export function serializeCanvas(board) {
  const groups = board.nodes.filter(n => n.type === 'group'), rest = board.nodes.filter(n => n.type !== 'group');
  const round = n => ({ ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) });
  return JSON.stringify({ ...board.extra, nodes: [...groups, ...rest].map(round), edges: board.edges }, null, 2) + '\n';
}

export const emptyCanvas = () => '{\n  "nodes": [],\n  "edges": []\n}\n';

/** 新的 id(不和現有的重複)。 */
export function newId(board, prefix = 'n') {
  const used = new Set([...board.nodes.map(n => n.id), ...board.edges.map(e => e.id)]);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${Date.now().toString(36)}${i > 1 ? '-' + i : ''}`;
    if (!used.has(id)) return id;
  }
}

/** 一條邊在節點上的端點;沒指定邊就挑面對另一個節點的那一側。 */
export function anchor(node, side, other) {
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
export function edgePath(from, to, fromSide, toSide) {
  const a = anchor(from, fromSide, to), b = anchor(to, toSide, from);
  const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3);
  const dir = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  const [ax, ay] = dir[a.side], [bx, by] = dir[b.side];
  const c1 = { x: a.x + ax * k, y: a.y + ay * k }, c2 = { x: b.x + bx * k, y: b.y + by * k };
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, a, b, mid, endDir: [bx, by] };
}

/** 所有節點的外框(沒有節點時回傳 null)。 */
export function bounds(nodes) {
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
export function resolveFile(file, graph) {
  const p = norm(String(file || '').replace(/^\/+/, ''));
  if (!p) return { kind: 'missing' };
  for (const n of graph.notes.values()) if (norm(n.path) === p) return { kind: 'note', rec: n };
  const deckDir = p.replace(/\/deck\.ya?ml$/, '');
  for (const d of graph.decks.values()) if (norm(d.path) === deckDir) return { kind: 'deck', rec: d };
  return { kind: 'missing' };
}

/** 畫布裡指不到檔案的卡片(給檢查工具)。 */
export function missingFiles(board, graph) {
  return board.nodes.filter(n => n.type === 'file' && resolveFile(n.file, graph).kind === 'missing').map(n => n.file);
}

/** 畫布檔名:去掉不能用的字元,加上 .canvas。 */
export function boardFileName(name) {
  const safe = String(name).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'board';
  return `${safe}.canvas`;
}

// ---------- 檔案卡的種類與嵌入 ----------

const EXT = p => (String(p).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']);

/** file 卡片指的是哪一種檔案:note / deck(由 resolveFile 判斷)、image、html、pdf、other。 */
export function fileKind(file) {
  const e = EXT(file);
  if (IMAGE_EXT.has(e)) return 'image';
  if (e === 'html' || e === 'htm') return 'html';
  if (e === 'pdf') return 'pdf';
  if (e === 'md') return 'note';
  if (/(^|\/)deck\.ya?ml$/i.test(String(file))) return 'deck';
  return 'other';
}

/** PDF 卡從第幾頁開始:JSON Canvas 的 subpath 欄位寫 "#page=3"(和 Obsidian 相同);沒有或不合法就是 0。 */
export function pdfPage(node) {
  const m = String(node?.subpath || '').match(/^#page=(\d{1,5})$/);
  return m && +m[1] > 0 ? +m[1] : 0;
}

/** 使用者貼上的可能是整段 <iframe ...>(Google 簡報的嵌入碼):取出 src。 */
export function extractURL(input) {
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
export function embedFor(node, classify) {
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
export function slideOrder(board) {
  const groups = board.nodes.filter(n => n.type === 'group');
  const items = groups.length ? groups : board.nodes;
  return [...items].sort((a, b) => {
    const row = Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2;
    return row ? a.x - b.x : a.y - b.y;
  });
}

/** 文字卡轉成筆記:標題取第一個標題或第一行;內文保留(標題那一行拿掉)。 */
export function textToNote(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const i = lines.findIndex(l => l.trim());
  if (i < 0) return { title: '', body: '' };
  const first = lines[i].trim();
  const title = first.replace(/^#{1,6}\s+/, '').replace(/[*_`[\]]/g, '').trim().slice(0, 80);
  const body = (/^#{1,6}\s/.test(first) ? [...lines.slice(0, i), ...lines.slice(i + 1)] : lines).join('\n').trim();
  return { title, body };
}

/** 筆記出現在哪些畫布的哪些卡片(只比對 file 欄位)。 */
export function boardsWith(boards, path) {
  const p = norm(path);
  return boards.filter(b => b.board.nodes.some(n => n.type === 'file' && norm(String(n.file || '').replace(/^\/+/, '')) === p)).map(b => b.name);
}
