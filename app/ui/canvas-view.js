// 畫布畫面:boards/*.canvas(JSON Canvas)。純邏輯在 app/core/canvas.js。
//
// 看:拖曳空白處平移、滾輪平移、Ctrl/⌘+滾輪或兩指縮放;F 適合畫面、0 回到 100%。
// 改(可寫入的書庫才有):拖曳卡片、右下角調整大小、拖曳卡片邊上的圓點連線、
//   雙擊空白處新增文字、雙擊文字或連線編輯、Delete 從畫布移除(不動檔案)、Ctrl+Z 復原。
// 存檔:改完 0.8 秒自動存;存之前比對檔案狀態,被別的程式改過就停下來。

import { escapeHTML as esc, renderMarkdown } from '../core/markdown.js';
import { t } from '../core/i18n.js';
import { serializeCanvas, canvasColor, edgePath, bounds, resolveFile, newId, SIDES } from '../core/canvas.js';
import { dialog, toast } from './dialog.js';

const MIN_Z = 0.15, MAX_Z = 2.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {{ nodes: object[], edges: object[], extra: object }} o.board
 * @param {string} o.name           畫布名稱(顯示用)
 * @param {string} o.header         上方導覽列 HTML
 * @param {object} o.href           網址產生器(note / deck / shelf)
 * @param {Promise<object>|null} o.graph
 * @param {null | ((text: string) => Promise<void>)} o.save  可寫入時才有
 * @param {{ value: string, label: string, file: string }[]} [o.choices]  「＋卡片」可以選的筆記與簡報
 */
export function renderBoard(root, { board, name, header, href, graph, save, choices = [], colorOf = () => '' }) {
  const canEdit = !!save;
  root.innerHTML = `<div class="board-shell">${header}
    <div class="board-page${canEdit ? ' editable' : ''}">
      <div class="board-bar">
        <a class="btn ghost" href="${href.shelf}">‹ ${esc(t('nav.backShelf'))}</a>
        <h1>${esc(name)}</h1>
        <span class="board-status" aria-live="polite">${esc(canEdit ? '' : t('board.readonly'))}</span>
        <span class="board-tools">
          ${canEdit ? `<button class="btn ghost" data-b="text" title="${esc(t('board.addTextTitle'))}">${esc(t('board.addText'))}</button>
          <button class="btn ghost" data-b="card" title="${esc(t('board.addCardTitle'))}">${esc(t('board.addCard'))}</button>
          <button class="btn ghost" data-b="undo" title="${esc(t('board.undo'))}" aria-label="${esc(t('board.undo'))}">↶</button>` : ''}
          <button class="btn ghost" data-b="out" aria-label="${esc(t('board.zoomOut'))}">−</button>
          <button class="btn ghost zoom" data-b="reset" title="${esc(t('board.zoomReset'))}">100%</button>
          <button class="btn ghost" data-b="in" aria-label="${esc(t('board.zoomIn'))}">+</button>
          <button class="btn ghost" data-b="fit" title="${esc(t('board.fitTitle'))}">${esc(t('board.fit'))}</button>
        </span>
      </div>
      <div class="board-view" tabindex="0" aria-label="${esc(t('board.aria', { name }))}">
        <div class="board-world"><svg class="board-edges" aria-hidden="true"><defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><g class="edges"></g></svg><div class="nodes"></div></div>
        ${board.nodes.length ? '' : `<p class="board-empty">${esc(t(canEdit ? 'board.emptyEdit' : 'board.empty'))}</p>`}
        <p class="board-hint">${esc(t(canEdit ? 'board.hintEdit' : 'board.hint'))}</p>
      </div>
    </div></div>`;

  const view = root.querySelector('.board-view'), world = root.querySelector('.board-world');
  const nodesEl = root.querySelector('.nodes'), edgesEl = root.querySelector('.edges');
  const status = root.querySelector('.board-status'), zoomBtn = root.querySelector('.zoom');
  let cam = { x: 0, y: 0, z: 1 }, sel = null, editing = null, g = null, alive = true;
  let dirty = false, saving = false, saveTimer = null, broken = false;
  const history = [serializeCanvas(board)], future = [];

  // ---------- 畫面 ----------
  const byId = id => board.nodes.find(n => n.id === id);
  const applyCam = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    zoomBtn.textContent = `${Math.round(cam.z * 100)}%`;
    view.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    view.style.backgroundSize = `${24 * cam.z}px ${24 * cam.z}px`;
  };
  const toWorld = (cx, cy) => { const r = view.getBoundingClientRect(); return { x: (cx - r.left - cam.x) / cam.z, y: (cy - r.top - cam.y) / cam.z }; };
  const zoomAt = (z, cx, cy) => {
    const r = view.getBoundingClientRect();
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const w = toWorld(px, py);
    cam.z = Math.min(MAX_Z, Math.max(MIN_Z, z));
    cam.x = px - r.left - w.x * cam.z; cam.y = py - r.top - w.y * cam.z;
    applyCam();
  };
  const fit = () => {
    const b = bounds(board.nodes), r = view.getBoundingClientRect();
    if (!b) { cam = { x: r.width / 2, y: r.height / 3, z: 1 }; return applyCam(); }
    const pad = 60, z = Math.min(1.2, Math.max(MIN_Z, Math.min((r.width - pad * 2) / b.width, (r.height - pad * 2) / b.height)));
    cam = { z, x: (r.width - b.width * z) / 2 - b.x * z, y: (r.height - b.height * z) / 2 - b.y * z };
    applyCam();
  };

  function cardHTML(n) {
    const color = canvasColor(n.color);
    const style = `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;${color ? `--nc:${color};` : ''}`;
    const cls = `bnode t-${n.type}${sel?.node === n.id ? ' sel' : ''}${color ? ' colored' : ''}`;
    let inner = '';
    if (n.type === 'group') inner = `<span class="glabel">${esc(n.label || '')}</span>`;
    else if (n.type === 'text') inner = `<div class="md">${renderMarkdown(String(n.text || ''))}</div>`;
    else if (n.type === 'link') {
      const ok = /^https?:\/\//i.test(String(n.url || ''));
      inner = `<span class="kind">${esc(t('board.kindLink'))}</span>${ok ? `<a class="open" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.url)}</a>` : `<span>${esc(n.url || '')}</span>`}`;
    } else {
      const r = g ? resolveFile(n.file, g) : null;
      if (!r) inner = `<span class="kind">…</span><b>${esc(String(n.file || '').split('/').pop())}</b>`;
      else if (r.kind === 'note') inner = `<span class="kind" style="--kc:${esc(colorOf(r.rec.topicId))}">${esc(t('board.kindNote'))}</span><a class="open" href="${href.note(r.rec.rel)}">${esc(r.rec.title)}</a><p>${esc(String(r.rec.excerpt || r.rec.body || '').replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 160))}</p>`;
      else if (r.kind === 'deck') inner = `<span class="kind deck" style="--kc:${esc(colorOf(r.rec.topicId))}">${esc(t('board.kindDeck'))}</span><a class="open" href="${href.deck(r.rec.topicId, r.rec.project.id)}">${esc(r.rec.title)}</a>${r.rec.date ? `<p>${esc(r.rec.date)}</p>` : ''}`;
      else inner = `<span class="kind missing">${esc(t('board.kindMissing'))}</span><code>${esc(n.file || '')}</code>`;
    }
    const handles = canEdit && sel?.node === n.id && !editing
      ? `<i class="resize" data-h="resize"></i>${n.type === 'group' ? '' : SIDES.map(s => `<i class="dot ${s}" data-h="link" data-side="${s}"></i>`).join('')}` : '';
    return `<div class="${cls}" data-id="${esc(n.id)}" style="${style}">${inner}${handles}</div>`;
  }

  function drawEdges(extra) {
    const parts = [];
    for (const e of board.edges) {
      const a = byId(e.fromNode), b = byId(e.toNode);
      if (!a || !b) continue;
      const p = edgePath(a, b, e.fromSide, e.toSide), color = canvasColor(e.color);
      const end = e.toEnd === 'none' ? '' : ' marker-end="url(#board-arrow)"', start = e.fromEnd === 'arrow' ? ' marker-start="url(#board-arrow)"' : '';
      parts.push(`<g class="bedge${sel?.edge === e.id ? ' sel' : ''}" data-edge="${esc(e.id)}"${color ? ` style="--ec:${color}"` : ''}>
        <path class="hit" d="${p.d}"/><path class="line" d="${p.d}"${end}${start}/>
        ${e.label ? `<text x="${p.mid.x}" y="${p.mid.y}" dy="-6">${esc(e.label)}</text>` : ''}</g>`);
    }
    if (extra) parts.push(`<path class="draft" d="${extra}"/>`);
    edgesEl.innerHTML = parts.join('');
  }

  function draw() {
    const groups = board.nodes.filter(n => n.type === 'group'), rest = board.nodes.filter(n => n.type !== 'group');
    nodesEl.innerHTML = [...groups, ...rest].map(cardHTML).join('');
    drawEdges();
    root.querySelector('.board-empty')?.toggleAttribute('hidden', board.nodes.length > 0);
  }

  // ---------- 存檔與復原 ----------
  const setStatus = key => { status.textContent = key ? t(key) : ''; status.dataset.s = key || ''; };
  function changed() {
    const text = serializeCanvas(board);
    if (text === history[history.length - 1]) return;
    history.push(text); future.length = 0;
    if (history.length > 100) history.shift();
    queueSave();
  }
  function queueSave() {
    if (!canEdit || broken) return;
    dirty = true; setStatus('board.unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 800);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty || saving || broken) return;
    saving = true; setStatus('board.saving');
    try {
      await save(serializeCanvas(board));
      dirty = false; setStatus('board.saved');
    } catch (e) {
      broken = e.message === 'stale';
      setStatus(broken ? 'board.stale' : 'board.saveFailed');
      toast(broken ? t('board.staleLong') : t('ne.saveFailed', { error: e.message || e }), { ms: 8000 });
    } finally { saving = false; }
    if (dirty && !broken) queueSave();
  }
  function restore(text) {
    const data = JSON.parse(text);
    board.nodes = data.nodes; board.edges = data.edges;
    sel = null; draw(); queueSave();
  }
  const undo = () => { if (history.length > 1) { future.push(history.pop()); restore(history[history.length - 1]); } };
  const redo = () => { if (future.length) { const s = future.pop(); history.push(s); restore(s); } };

  // ---------- 編輯 ----------
  function addNode(node) {
    board.nodes.push(node);
    sel = { node: node.id }; draw(); changed();
    return node;
  }
  function addTextAt(x, y) {
    const n = addNode({ id: newId(board), type: 'text', text: '', x: Math.round(x - 130), y: Math.round(y - 40), width: 260, height: 100 });
    editText(n.id);
  }
  function editText(id) {
    const n = byId(id);
    if (!n || n.type !== 'text' || !canEdit) return;
    editing = id; draw();
    const el = nodesEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    el.classList.add('editing');
    el.innerHTML = `<textarea aria-label="${esc(t('board.editText'))}">${esc(n.text || '')}</textarea>`;
    const ta = el.querySelector('textarea');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    const done = () => {
      if (editing !== id) return;
      editing = null;
      const text = ta.value;
      if (!text.trim() && !n.text) board.nodes = board.nodes.filter(x => x !== n); // 空的新文字:不留
      else n.text = text;
      draw(); changed(); view.focus({ preventScroll: true });
    };
    ta.addEventListener('blur', done);
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ta.blur(); } });
  }
  async function editEdge(id) {
    const e = board.edges.find(x => x.id === id);
    if (!e || !canEdit) return;
    const r = await dialog({ title: t('board.edgeTitle'), fields: [{ name: 'label', label: t('board.edgeLabel'), value: e.label || '' }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('dialog.ok'), value: true, primary: true }] });
    if (!r?.value) return;
    const label = String(r.fields.label || '').trim();
    if (label) e.label = label; else delete e.label;
    draw(); changed();
  }
  async function addCard() {
    if (!choices.length) return toast(t('board.noChoices'));
    const r = await dialog({ title: t('board.addCardTitle'), fields: [{ name: 'file', label: t('board.pick'), type: 'select', value: choices[0].value, options: choices }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('board.add'), value: true, primary: true }] });
    if (!r?.value) return;
    const c = choices.find(x => x.value === r.fields.file);
    const w = view.getBoundingClientRect(), mid = toWorld(w.left + w.width / 2, w.top + w.height / 2);
    addNode({ id: newId(board), type: 'file', file: c.file, x: Math.round(mid.x - 150), y: Math.round(mid.y - 60), width: 300, height: 120, ...(c.deck ? { 'x-kind': 'deck' } : {}) });
  }
  function removeSelected() {
    if (!sel || !canEdit) return;
    if (sel.node) {
      board.nodes = board.nodes.filter(n => n.id !== sel.node);
      board.edges = board.edges.filter(e => e.fromNode !== sel.node && e.toNode !== sel.node);
    } else board.edges = board.edges.filter(e => e.id !== sel.edge);
    sel = null; draw(); changed();
  }

  // ---------- 指標:平移、拖曳、調整大小、連線、兩指縮放 ----------
  const pointers = new Map();
  let act = null;
  const inside = (n, gnode) => n !== gnode && n.x >= gnode.x && n.y >= gnode.y && n.x + n.width <= gnode.x + gnode.width && n.y + n.height <= gnode.y + gnode.height;

  view.addEventListener('pointerdown', e => {
    if (editing || e.button > 0) return;
    if (e.target.closest('a.open, textarea')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { // 兩指縮放
      const [p, q] = [...pointers.values()];
      act = { type: 'pinch', d: Math.hypot(p.x - q.x, p.y - q.y), z: cam.z };
      return;
    }
    view.setPointerCapture(e.pointerId);
    const nodeEl = e.target.closest('.bnode'), edgeEl = e.target.closest('.bedge'), h = e.target.dataset?.h;
    const w = toWorld(e.clientX, e.clientY);
    if (nodeEl) {
      const n = byId(nodeEl.dataset.id);
      if (sel?.node !== n.id) { sel = { node: n.id }; draw(); }
      if (!canEdit) { act = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
      if (h === 'resize') act = { type: 'resize', n, w0: n.width, h0: n.height, sx: w.x, sy: w.y };
      else if (h === 'link') act = { type: 'link', n, side: e.target.dataset.side };
      else act = { type: 'move', n, sx: w.x, sy: w.y, items: [n, ...(n.type === 'group' ? board.nodes.filter(x => inside(x, n)) : [])].map(x => ({ x0: x.x, y0: x.y, node: x })), moved: false };
      return;
    }
    if (edgeEl) { sel = { edge: edgeEl.dataset.edge }; draw(); act = null; return; }
    if (sel) { sel = null; draw(); }
    act = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  });

  view.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!act) return;
    if (act.type === 'pinch' && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      return zoomAt(act.z * Math.hypot(p.x - q.x, p.y - q.y) / act.d, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    if (act.type === 'pan') { cam.x = act.cx + e.clientX - act.sx; cam.y = act.cy + e.clientY - act.sy; return applyCam(); }
    const w = toWorld(e.clientX, e.clientY);
    if (act.type === 'move') {
      const dx = w.x - act.sx, dy = w.y - act.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) act.moved = true;
      for (const it of act.items) {
        it.node.x = Math.round(it.x0 + dx); it.node.y = Math.round(it.y0 + dy);
        const el = nodesEl.querySelector(`[data-id="${CSS.escape(it.node.id)}"]`);
        if (el) { el.style.left = it.node.x + 'px'; el.style.top = it.node.y + 'px'; }
      }
      drawEdges();
    } else if (act.type === 'resize') {
      act.n.width = Math.max(80, Math.round(act.w0 + w.x - act.sx));
      act.n.height = Math.max(50, Math.round(act.h0 + w.y - act.sy));
      const el = nodesEl.querySelector(`[data-id="${CSS.escape(act.n.id)}"]`);
      el.style.width = act.n.width + 'px'; el.style.height = act.n.height + 'px';
      drawEdges();
    } else if (act.type === 'link') {
      const p = edgePath(act.n, { x: w.x, y: w.y, width: 0, height: 0 }, act.side);
      drawEdges(p.d);
    }
  });

  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (!act) return;
    const a = act; act = null;
    if (a.type === 'pinch') return;
    if (a.type === 'move' && a.moved) { changed(); draw(); }
    if (a.type === 'resize') { changed(); draw(); }
    if (a.type === 'link') {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bnode');
      const to = target && byId(target.dataset.id);
      if (to && to !== a.n && to.type !== 'group') {
        board.edges.push({ id: newId(board, 'e'), fromNode: a.n.id, fromSide: a.side, toNode: to.id });
        changed();
      }
      draw();
    }
  };
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);

  view.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam(); }
  }, { passive: false });

  view.addEventListener('dblclick', e => {
    if (!canEdit || editing) return;
    const nodeEl = e.target.closest('.bnode'), edgeEl = e.target.closest('.bedge');
    if (nodeEl) return editText(nodeEl.dataset.id);
    if (edgeEl) return editEdge(edgeEl.dataset.edge);
    const w = toWorld(e.clientX, e.clientY);
    addTextAt(w.x, w.y);
  });

  root.querySelector('.board-tools').addEventListener('click', e => {
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (b === 'in') zoomAt(cam.z * 1.25);
    if (b === 'out') zoomAt(cam.z / 1.25);
    if (b === 'reset') zoomAt(1);
    if (b === 'fit') fit();
    if (b === 'undo') undo();
    if (b === 'card') addCard();
    if (b === 'text') { const r = view.getBoundingClientRect(), w = toWorld(r.left + r.width / 2, r.top + r.height / 2); addTextAt(w.x, w.y); }
  });

  const onKey = e => {
    if (editing || e.target.closest?.('input, textarea, select, .lp-dialog, .palette')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return flush(); }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); removeSelected(); } return; }
    if (e.key === 'Escape' && sel) { sel = null; return draw(); }
    if (e.key === 'Enter' && sel?.node) { const n = byId(sel.node); if (n?.type === 'text') { e.preventDefault(); editText(n.id); } else nodesEl.querySelector(`[data-id="${CSS.escape(sel.node)}"] a.open`)?.click(); return; }
    if (e.key === 'f' || e.key === 'F') fit();
    else if (e.key === '0') zoomAt(1);
    else if (e.key === '+' || e.key === '=') zoomAt(cam.z * 1.25);
    else if (e.key === '-') zoomAt(cam.z / 1.25);
  };
  window.addEventListener('keydown', onKey);
  const onUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);

  draw();
  requestAnimationFrame(fit);
  graph?.then(x => { g = x; if (alive) draw(); }, () => {});

  return {
    cleanup: () => { alive = false; window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); if (dirty) flush(); },
    isDirty: () => false, // 離開時 cleanup 會把還沒存的立刻存掉,不用問
  };
}
