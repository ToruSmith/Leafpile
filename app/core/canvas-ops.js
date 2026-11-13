// 畫布的編輯工具(純函式,不碰畫面):群組歸屬、對齊與等距、吸附、複製貼上、搜尋、群組轉大綱、匯出 SVG。
// 輸入的節點不會被改動;回傳新的位置或新的物件,由畫面決定要不要套用。

import { edgePath, canvasColor, bounds, newId, fileKind, slideOrder } from './canvas.js';
import { norm } from './links.js';

/** 完全落在群組框裡的節點(不含群組自己)。 */
export function membersOf(nodes, group) {
  return nodes.filter(n => n !== group && n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height);
}

/** 選取的節點,加上被選取群組裡的節點(搬移、複製時一起帶走)。 */
export function withMembers(nodes, ids) {
  const set = new Set(ids);
  for (const n of nodes) if (set.has(n.id) && n.type === 'group') for (const m of membersOf(nodes, n)) set.add(m.id);
  return nodes.filter(n => set.has(n.id));
}

/**
 * 對齊:left / hcenter / right / top / vcenter / bottom。
 * @returns {{ id: string, x: number, y: number }[]}
 */
export function alignNodes(nodes, mode) {
  const b = bounds(nodes);
  if (!b || nodes.length < 2) return nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));
  return nodes.map(n => {
    let { x, y } = n;
    if (mode === 'left') x = b.x;
    if (mode === 'right') x = b.x + b.width - n.width;
    if (mode === 'hcenter') x = b.x + b.width / 2 - n.width / 2;
    if (mode === 'top') y = b.y;
    if (mode === 'bottom') y = b.y + b.height - n.height;
    if (mode === 'vcenter') y = b.y + b.height / 2 - n.height / 2;
    return { id: n.id, x: Math.round(x), y: Math.round(y) };
  });
}

/** 等距:axis = 'h'(水平)或 'v'(垂直)。頭尾不動,中間的間隔一樣大。 */
export function distribute(nodes, axis) {
  if (nodes.length < 3) return nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));
  const [pos, size] = axis === 'v' ? ['y', 'height'] : ['x', 'width'];
  const sorted = [...nodes].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = last[pos] + last[size] - first[pos];
  const gap = (span - sorted.reduce((s, n) => s + n[size], 0)) / (sorted.length - 1);
  let cur = first[pos];
  const out = new Map();
  for (const n of sorted) { out.set(n.id, Math.round(cur)); cur += n[size] + gap; }
  return nodes.map(n => ({ id: n.id, x: axis === 'v' ? n.x : out.get(n.id), y: axis === 'v' ? out.get(n.id) : n.y }));
}

/** 可以吸附的線:每張不動的卡片的左、中、右(x)與上、中、下(y)。 */
export function snapLines(nodes) {
  const xs = new Set(), ys = new Set();
  for (const n of nodes) {
    xs.add(n.x); xs.add(n.x + n.width / 2); xs.add(n.x + n.width);
    ys.add(n.y); ys.add(n.y + n.height / 2); ys.add(n.y + n.height);
  }
  return { xs: [...xs], ys: [...ys] };
}

/**
 * 被拖的框靠近某條線(tol 以內)就吸過去。
 * @returns {{ dx: number, dy: number, gx: number|null, gy: number|null }}  要補的位移與要畫的參考線
 */
export function snapMove(box, lines, tol) {
  const best = (cands, list) => {
    let hit = null;
    for (const c of cands) for (const l of list) {
      const d = l - c;
      if (Math.abs(d) <= tol && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, line: l };
    }
    return hit;
  };
  const hx = best([box.x, box.x + box.width / 2, box.x + box.width], lines.xs);
  const hy = best([box.y, box.y + box.height / 2, box.y + box.height], lines.ys);
  return { dx: hx ? hx.d : 0, dy: hy ? hy.d : 0, gx: hx ? hx.line : null, gy: hy ? hy.line : null };
}

// ---------- 複製貼上 ----------

const FRAGMENT = 'leafpile-canvas';

/** 複製:選取的卡片(含群組裡的)與兩端都在裡面的連線。 */
export function copyFragment(board, ids) {
  const nodes = withMembers(board.nodes, ids);
  const set = new Set(nodes.map(n => n.id));
  return { type: FRAGMENT, nodes: structuredClone(nodes), edges: structuredClone(board.edges.filter(e => set.has(e.fromNode) && set.has(e.toNode))) };
}

/** 讀剪貼簿的文字:Leafpile 複製的片段,或任何 JSON Canvas({ nodes, edges })。看不懂回傳 null。 */
export function parseFragment(text) {
  let d;
  try { d = JSON.parse(String(text || '')); } catch { return null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.nodes) || !d.nodes.length) return null;
  return { nodes: d.nodes, edges: Array.isArray(d.edges) ? d.edges : [] };
}

/**
 * 貼上:全部換新 id;左上角放到 at(沒給就往右下偏 40);網址只收 http(s);看不懂的節點略過。
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function pasteFragment(board, frag, { at = null } = {}) {
  const ok = n => n && typeof n === 'object' && ['text', 'file', 'link', 'group'].includes(n.type) && (n.type !== 'link' || /^https?:\/\//i.test(String(n.url || '')));
  const src = frag.nodes.filter(ok).map(n => ({ ...n, x: Number(n.x) || 0, y: Number(n.y) || 0, width: Math.max(40, Number(n.width) || 260), height: Math.max(30, Number(n.height) || 120) }));
  if (!src.length) return { nodes: [], edges: [] };
  const b = bounds(src);
  const dx = at ? at.x - b.x : 40, dy = at ? at.y - b.y : 40;
  const map = new Map(), work = { nodes: [...board.nodes], edges: [...board.edges] };
  const nodes = src.map(n => {
    const id = newId(work, n.type === 'group' ? 'g' : 'n');
    map.set(n.id, id);
    const copy = { ...structuredClone(n), id, x: Math.round(n.x + dx), y: Math.round(n.y + dy) };
    work.nodes.push(copy);
    return copy;
  });
  const edges = frag.edges.filter(e => map.has(e.fromNode) && map.has(e.toNode)).map(e => {
    const copy = { ...structuredClone(e), id: newId(work, 'e'), fromNode: map.get(e.fromNode), toNode: map.get(e.toNode) };
    work.edges.push(copy);
    return copy;
  });
  return { nodes, edges };
}

// ---------- 搜尋 ----------

/**
 * 畫布內搜尋:文字、群組名稱、網址、檔名,以及筆記/簡報的標題(titleOf)。依位置排序。
 * @param {(file: string) => string} [titleOf]
 * @returns {string[]} 符合的節點 id
 */
export function searchNodes(board, query, titleOf = () => '') {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hay = n => norm([n.text, n.label, n.url, n.file, n.type === 'file' ? titleOf(n.file) : ''].filter(Boolean).join(' '));
  const hits = board.nodes.filter(n => { const h = hay(n); return words.every(w => h.includes(w)); });
  return slideOrder({ nodes: hits.map(n => ({ ...n, type: 'text' })) }).map(n => n.id);
}

// ---------- 群組轉大綱 ----------

const firstLine = s => String(s || '').split('\n').map(l => l.trim()).find(Boolean)?.replace(/^#{1,6}\s+/, '') || '';

/**
 * 群組裡的卡片依位置排成 Markdown 清單(巢狀群組變成子清單)。
 * @param {(node: object) => { kind: 'note'|'deck'|'other', title: string }} describe
 * @returns {string} Markdown(第一行是 # 群組名稱)
 */
export function groupOutline(board, group, describe) {
  const lines = [`# ${group.label || 'Outline'}`, ''];
  const walk = (g, depth) => {
    const inner = membersOf(board.nodes, g);
    // 只取「直接」在這個群組裡的(不在更小的群組裡)
    const direct = inner.filter(n => !inner.some(o => o.type === 'group' && o !== n && membersOf([n], o).length));
    for (const n of slideOrder({ nodes: direct.map(x => ({ ...x, type: 'text', _ref: x })) }).map(x => x._ref)) {
      const pad = '  '.repeat(depth);
      if (n.type === 'group') { lines.push(`${pad}- **${n.label || ''}**`); walk(n, depth + 1); continue; }
      if (n.type === 'text') {
        const rest = String(n.text || '').split('\n').map(l => l.trim()).filter(Boolean);
        lines.push(`${pad}- ${firstLine(n.text)}`);
        for (const l of rest.slice(1)) lines.push(`${pad}  ${l.replace(/^[-*]\s+/, '')}`);
        continue;
      }
      if (n.type === 'link') { lines.push(`${pad}- [${n.url}](${n.url})`); continue; }
      const d = describe(n);
      if (d.kind === 'note') lines.push(`${pad}- [[${d.title}]]`);
      else if (d.kind === 'deck') lines.push(`${pad}- [[slides:${d.title}]]`);
      else lines.push(`${pad}- ${String(n.file || '').split('/').pop()}`);
    }
  };
  walk(group, 0);
  return lines.join('\n') + '\n';
}

// ---------- 整張畫布的大綱(大綱檢視) ----------

const byPos = list => slideOrder({ nodes: list.map(x => ({ ...x, type: 'text', _ref: x })) }).map(x => x._ref);

/**
 * 整張畫布排成大綱:頂層群組依位置排,群組裡的卡片(含巢狀群組)依位置排;不在任何群組裡的卡片放最後。
 * 每一項帶「往外的連線」(→ 目標,連線文字)。給大綱檢視用,也能存成筆記。
 * @param {(node: object) => { kind: 'note'|'deck'|'other', title: string }} describe
 * @param {{ title?: string, loose?: string }} [o]  loose:沒有群組的卡片那一節的標題
 * @returns {{ items: { id: string, depth: number, type: string, text: string, ref: string, edges: { id: string, text: string, label: string }[] }[], markdown: string }}
 */
export function boardOutline(board, describe, { title = '', loose = 'Other' } = {}) {
  const nodes = board.nodes || [];
  const groups = nodes.filter(n => n.type === 'group');
  const inGroup = n => groups.some(g => g !== n && membersOf([n], g).length);
  const direct = (inner) => inner.filter(n => !inner.some(o => o.type === 'group' && o !== n && membersOf([n], o).length));
  const textOf = n => {
    if (n.type === 'group') return n.label || '';
    if (n.type === 'text') return firstLine(n.text);
    if (n.type === 'link') return String(n.url || '');
    const d = describe(n);
    return d.title || String(n.file || '').split('/').pop();
  };
  const refOf = n => {
    if (n.type === 'link') return `[${n.url}](${n.url})`;
    if (n.type !== 'file') return textOf(n);
    const d = describe(n);
    return d.kind === 'note' ? `[[${d.title}]]` : d.kind === 'deck' ? `[[slides:${d.title}]]` : textOf(n);
  };
  const byIdMap = new Map(nodes.map(n => [n.id, n]));
  const edgesOf = n => (board.edges || []).filter(e => e.fromNode === n.id && byIdMap.has(e.toNode))
    .map(e => ({ id: e.toNode, text: textOf(byIdMap.get(e.toNode)), label: String(e.label || '') }));
  const items = [];
  const add = (n, depth) => items.push({ id: n.id, depth, type: n.type, text: textOf(n), ref: refOf(n), edges: edgesOf(n) });
  const walk = (g, depth) => { for (const n of byPos(direct(membersOf(nodes, g)))) { add(n, depth); if (n.type === 'group') walk(n, depth + 1); } };
  const top = byPos(nodes.filter(n => !inGroup(n)));
  const topGroups = top.filter(n => n.type === 'group'), rest = top.filter(n => n.type !== 'group');
  for (const g of topGroups) { add(g, 0); walk(g, 1); }
  if (rest.length && topGroups.length) items.push({ id: '', depth: 0, type: 'loose', text: loose, ref: loose, edges: [] });
  for (const n of rest) add(n, topGroups.length ? 1 : 0);

  const lines = title ? [`# ${title}`, ''] : [];
  for (const it of items) {
    const node = byIdMap.get(it.id);
    if (it.depth === 0 && (it.type === 'group' || it.type === 'loose')) { if (lines.length && lines.at(-1) !== '') lines.push(''); lines.push(`## ${it.text}`, ''); continue; }
    const pad = '  '.repeat(Math.max(0, it.depth - (topGroups.length ? 1 : 0)));
    lines.push(it.type === 'group' ? `${pad}- **${it.text}**` : `${pad}- ${it.ref}`);
    if (it.type === 'text') for (const l of String(node.text || '').split('\n').map(x => x.trim()).filter(Boolean).slice(1)) lines.push(`${pad}  ${l.replace(/^[-*]\s+/, '')}`);
    for (const e of it.edges) lines.push(`${pad}  - → ${e.text}${e.label ? ` (${e.label})` : ''}`);
  }
  return { items, markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

// ---------- 匯出 SVG ----------

const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = md => String(md || '').replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/[*_`]/g, '');

/** 依寬度折行(中日韓字算一個字寬,其他算半個)。 */
export function wrapText(text, width, size) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '', w = 0;
    for (const ch of para) {
      const cw = /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? size : size * 0.56;
      if (w + cw > width && line) { out.push(line); line = ''; w = 0; }
      line += ch; w += cw;
    }
    out.push(line);
  }
  return out;
}

/**
 * 把畫布(或選取的部分)畫成一張獨立的 SVG:白底、固定配色、不引用任何外部資源。
 * @param {object} p
 * @param {(node: object) => { kind: string, title: string }} p.describe
 * @param {Map<string, string>} [p.images]  file → data: 網址(圖片卡)
 * @param {string[]} [p.only]               只匯出這些節點
 */
export function buildBoardSvg(board, { describe, images = new Map(), only = null, labels = {} }) {
  const pick = only ? new Set(withMembers(board.nodes, only).map(n => n.id)) : null;
  const nodes = board.nodes.filter(n => !pick || pick.has(n.id));
  const b = bounds(nodes) || { x: 0, y: 0, width: 400, height: 300 };
  const pad = 40, top = nodes.some(n => n.type === 'group') ? 30 : 0;
  const vx = b.x - pad, vy = b.y - pad - top, W = b.width + pad * 2, H = b.height + pad * 2 + top;
  const ids = new Set(nodes.map(n => n.id)), byId = new Map(nodes.map(n => [n.id, n]));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${W} ${H}" width="${Math.round(W)}" height="${Math.round(H)}" font-family="system-ui, -apple-system, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif">`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8a8378"/></marker></defs>`,
    `<rect x="${vx}" y="${vy}" width="${W}" height="${H}" fill="#ffffff"/>`];
  for (const g of nodes.filter(n => n.type === 'group')) {
    const c = canvasColor(g.color) || '#8a8378';
    out.push(`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="12" fill="${c}" fill-opacity=".06" stroke="${c}" stroke-opacity=".55" stroke-dasharray="6 5"/>`);
    if (g.label) out.push(`<text x="${g.x + 10}" y="${g.y - 10}" font-size="15" font-weight="600" fill="${c}">${xml(g.label)}</text>`);
  }
  for (const e of board.edges) {
    if (!ids.has(e.fromNode) || !ids.has(e.toNode)) continue;
    const p = edgePath(byId.get(e.fromNode), byId.get(e.toNode), e.fromSide, e.toSide), c = canvasColor(e.color) || '#8a8378';
    out.push(`<path d="${p.d}" fill="none" stroke="${c}" stroke-width="2"${e.toEnd === 'none' ? '' : ' marker-end="url(#a)"'}/>`);
    if (e.label) out.push(`<text x="${p.mid.x}" y="${p.mid.y - 6}" font-size="13" text-anchor="middle" fill="#2b2925" stroke="#ffffff" stroke-width="5" paint-order="stroke">${xml(e.label)}</text>`);
  }
  for (const n of nodes.filter(x => x.type !== 'group')) {
    const c = canvasColor(n.color);
    const kind = n.type === 'file' ? fileKind(n.file) : n.type;
    if (kind === 'image' && images.has(n.file)) { out.push(`<image href="${xml(images.get(n.file))}" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" preserveAspectRatio="xMidYMid meet"/>`); continue; }
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="#fffdf8" stroke="${c || '#ddd6c8'}" stroke-width="${c ? 2 : 1}"/>`);
    let tag = '', body = '';
    if (n.type === 'text') body = plain(n.text);
    else if (n.type === 'link') { tag = labels.link || 'Link'; body = n.url; }
    else { const d = describe(n); tag = labels[d.kind] || d.kind.toUpperCase(); body = d.title || String(n.file || '').split('/').pop(); }
    let y = n.y + 14;
    if (tag) { out.push(`<text x="${n.x + 14}" y="${y + 11}" font-size="11" fill="#8a8378" letter-spacing="1">${xml(tag)}</text>`); y += 20; }
    const size = n.type === 'text' ? 15 : 16;
    const max = Math.max(1, Math.floor((n.y + n.height - y - 8) / (size * 1.45)));
    const lines = wrapText(body, n.width - 28, size).filter((l, i, a) => l || (i && a[i - 1]));
    lines.slice(0, max).forEach((l, i) => out.push(`<text x="${n.x + 14}" y="${y + size + i * size * 1.45}" font-size="${size}"${n.type !== 'text' ? ' font-weight="600"' : ''} fill="#2b2925">${xml(i === max - 1 && lines.length > max ? l.slice(0, -1) + '…' : l)}</text>`));
  }
  out.push('</svg>');
  return out.join('\n');
}

/** 手繪的筆畫(世界座標)→ 一張 SVG 圖與它的位置。 */
export function strokesToSvg(strokes, { color = '#2b2925', width = 3 } = {}) {
  const pts = strokes.flat();
  if (!pts.length) return null;
  const pad = width * 2;
  const x0 = Math.min(...pts.map(p => p.x)) - pad, y0 = Math.min(...pts.map(p => p.y)) - pad;
  const w = Math.max(...pts.map(p => p.x)) + pad - x0, h = Math.max(...pts.map(p => p.y)) + pad - y0;
  const paths = strokes.filter(s => s.length).map(s => `<path d="M ${s.map(p => `${(p.x - x0).toFixed(1)} ${(p.y - y0).toFixed(1)}`).join(' L ')}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w)}" height="${Math.round(h)}"><g fill="none" stroke="${xml(color)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return { svg, x: Math.round(x0), y: Math.round(y0), width: Math.max(20, Math.round(w)), height: Math.max(20, Math.round(h)) };
}

/**
 * 調整前後順序(JSON Canvas 的 nodes 順序就是上下疊放的順序)。
 * 群組永遠排在一般卡片前面(畫在底下),所以只在「群組」與「一般卡片」各自的範圍裡移動,
 * 不會把卡片移到群組底下而被蓋住。被移動的卡片保持原本的相對順序。
 * @param {'front'|'back'} dir
 */
export function reorderNodes(nodes, ids, dir) {
  const pick = new Set(ids);
  const part = list => {
    const moved = list.filter(n => pick.has(n.id)), rest = list.filter(n => !pick.has(n.id));
    return dir === 'front' ? [...rest, ...moved] : [...moved, ...rest];
  };
  return [...part(nodes.filter(n => n.type === 'group')), ...part(nodes.filter(n => n.type !== 'group'))];
}

/**
 * 小地圖要畫的範圍:所有卡片加上目前看得到的區域,再留一點邊,並撐成小地圖框的長寬比,
 * 讓卡片和「目前位置」的框都在裡面、不變形。
 * @param {{x,y,width,height}|null} content 卡片的範圍(bounds 的結果)
 * @param {{x,y,width,height}} viewport 目前看得到的區域(世界座標)
 * @param {number} aspect 小地圖框的寬／高
 * @returns {{x,y,width,height}}
 */
export function minimapFrame(content, viewport, aspect, pad = 0.06) {
  const a = content ? [content, viewport] : [viewport];
  const x0 = Math.min(...a.map(b => b.x)), y0 = Math.min(...a.map(b => b.y));
  const x1 = Math.max(...a.map(b => b.x + b.width)), y1 = Math.max(...a.map(b => b.y + b.height));
  let w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const px = w * pad, py = h * pad;
  w += px * 2; h += py * 2;
  let x = x0 - px, y = y0 - py;
  if (w / h > aspect) { const nh = w / aspect; y -= (nh - h) / 2; h = nh; } else { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
  return { x, y, width: w, height: h };
}
