// 畫布畫面:boards/*.canvas(JSON Canvas)。純邏輯在 app/core/canvas.js。
//
// 看:拖曳空白處平移、滾輪平移、Ctrl/⌘+滾輪或兩指縮放;F 適合畫面、0 回到 100%;「▶ 簡報」依群組逐頁放大。
// 改(可寫入的書庫才有):拖曳卡片、右下角調整大小、拖曳卡片邊上的圓點連線、雙擊新增或編輯、
//   選取後上方的小工具列(顏色、連線文字、嵌入、允許腳本、轉成筆記、移除)、Delete 從畫布移除(不動檔案)、
//   Ctrl+Z 復原;圖片/HTML/PDF 可以選檔、拖進來或 Ctrl+V 貼上。
// 嵌入(網頁、影片、HTML、PDF):先只顯示「▶ 載入」,最多同時 3 個;按「互動」才接收滑鼠;⛶ 全螢幕、↗ 新分頁。
// 存檔:改完 0.8 秒自動存;存之前比對檔案狀態,被別的程式改過就停下來。
//
// 畫面更新:卡片以 id 保留,只有內容變了才重畫那一張(載入中的嵌入不會因為選取或拖曳而重新載入)。

import { escapeHTML as esc, renderMarkdown } from '../core/markdown.js';
import { t } from '../core/i18n.js';
import { classifyMedia } from '../core/media.js';
import { serializeCanvas, canvasColor, edgePath, bounds, resolveFile, newId, SIDES, PRESET_COLORS, fileKind, embedFor, extractURL, slideOrder } from '../core/canvas.js';
import { hydrate, mountPage, openPageTab } from '../player/hydrate.js';
import { prepareMedia } from './media-import.js';
import { dialog, toast } from './dialog.js';

const MIN_Z = 0.1, MAX_Z = 2.5, MAX_LIVE = 3, DOUBLE_MS = 400;

/**
 * @param {HTMLElement} root
 * @param {object} o
 * @param {{ nodes: object[], edges: object[], extra: object }} o.board
 * @param {string} o.name
 * @param {string} o.header
 * @param {object} o.href
 * @param {Promise<object>|null} o.graph
 * @param {object} o.source            書庫根目錄的來源(讀素材、寫素材)
 * @param {null | ((text: string) => Promise<void>)} o.save
 * @param {{ value: string, label: string, file: string, deck?: boolean }[]} [o.choices]
 * @param {(topicId: string) => string} [o.colorOf]
 * @param {null | ((text: string) => Promise<string|null>)} [o.toNote]  文字卡轉成筆記,回傳新筆記的路徑
 */
export function renderBoard(root, { board, name, header, href, graph, source, save, choices = [], colorOf = () => '', toNote = null, reloadGraph = null }) {
  const canEdit = !!save;
  const canMedia = canEdit && !!source?.writeMedia;
  root.innerHTML = `<div class="board-shell">${header}
    <div class="board-page${canEdit ? ' editable' : ''}">
      <div class="board-bar">
        <a class="btn ghost" href="${href.shelf}">‹ ${esc(t('nav.backShelf'))}</a>
        <h1>${esc(name)}</h1>
        <span class="board-status" aria-live="polite">${esc(canEdit ? '' : t('board.readonly'))}</span>
        <span class="board-tools">
          ${canEdit ? `<button class="btn ghost" data-b="text" title="${esc(t('board.addTextTitle'))}">${esc(t('board.addText'))}</button>
          <button class="btn ghost" data-b="card" title="${esc(t('board.addCardTitle'))}">${esc(t('board.addCard'))}</button>
          <button class="btn ghost" data-b="link" title="${esc(t('board.addLinkTitle'))}">${esc(t('board.addLink'))}</button>
          ${canMedia ? `<button class="btn ghost" data-b="file" title="${esc(t('board.addFileTitle'))}">${esc(t('board.addFile'))}</button>` : ''}
          <button class="btn ghost" data-b="undo" title="${esc(t('board.undo'))}" aria-label="${esc(t('board.undo'))}">↶</button>` : ''}
          <button class="btn ghost" data-b="present" title="${esc(t('board.presentTitle'))}">${esc(t('board.present'))}</button>
          <button class="btn ghost" data-b="out" aria-label="${esc(t('board.zoomOut'))}">−</button>
          <button class="btn ghost zoom" data-b="reset" title="${esc(t('board.zoomReset'))}">100%</button>
          <button class="btn ghost" data-b="in" aria-label="${esc(t('board.zoomIn'))}">+</button>
          <button class="btn ghost" data-b="fit" title="${esc(t('board.fitTitle'))}">${esc(t('board.fit'))}</button>
        </span>
        <input type="file" class="board-file" accept="image/*,.html,.htm,.pdf" multiple hidden>
      </div>
      <div class="board-view" tabindex="0" aria-label="${esc(t('board.aria', { name }))}">
        <div class="board-world"><svg class="board-edges" aria-hidden="true"><defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs><g class="edges"></g></svg><div class="nodes"></div></div>
        <div class="board-pop" hidden></div>
        <p class="board-empty" hidden>${esc(t(canEdit ? 'board.emptyEdit' : 'board.empty'))}</p>
        <p class="board-hint">${esc(t(canEdit ? 'board.hintEdit' : 'board.hint'))}</p>
        <div class="board-present-bar" hidden><button data-p="prev" aria-label="${esc(t('board.prev'))}">‹</button><span class="n"></span><button data-p="next" aria-label="${esc(t('board.next'))}">›</button><button data-p="exit">${esc(t('board.presentExit'))}</button></div>
      </div>
    </div></div>`;

  const page = root.querySelector('.board-page');
  const view = root.querySelector('.board-view'), world = root.querySelector('.board-world');
  const nodesEl = root.querySelector('.nodes'), edgesEl = root.querySelector('.edges'), pop = root.querySelector('.board-pop');
  const status = root.querySelector('.board-status'), zoomBtn = root.querySelector('.zoom'), fileInput = root.querySelector('.board-file');
  let cam = { x: 0, y: 0, z: 1 }, sel = null, editing = null, g = null, alive = true, present = null;
  let dirty = false, saving = false, saveTimer = null, broken = false;
  const history = [serializeCanvas(board)], future = [];
  const els = new Map();   // id → { el, sig }
  const live = [];         // 載入中的嵌入卡 id(最舊的在前)
  const interactive = new Set();

  // ---------- 鏡頭 ----------
  const byId = id => board.nodes.find(n => n.id === id);
  const applyCam = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    zoomBtn.textContent = `${Math.round(cam.z * 100)}%`;
    view.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    view.style.backgroundSize = `${24 * cam.z}px ${24 * cam.z}px`;
    placePop();
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
  const fitTo = (b, pad = 60, maxZ = 1.2) => {
    const r = view.getBoundingClientRect();
    if (!b) { cam = { x: r.width / 2, y: r.height / 3, z: 1 }; return applyCam(); }
    const z = Math.min(maxZ, Math.max(MIN_Z, Math.min((r.width - pad * 2) / b.width, (r.height - pad * 2) / b.height)));
    cam = { z, x: (r.width - b.width * z) / 2 - b.x * z, y: (r.height - b.height * z) / 2 - b.y * z };
    applyCam();
  };
  const fit = () => fitTo(bounds(board.nodes));
  const center = () => { const r = view.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

  // ---------- 卡片 ----------
  const embedOf = n => (n.type === 'link' ? embedFor(n, classifyMedia) : null);
  const kindOf = n => (n.type === 'file' ? fileKind(n.file) : n.type);
  const toolsHTML = () => `<div class="embed-tools"><button data-x="interact" title="${esc(t('board.interactTitle'))}">${esc(t('board.interact'))}</button><button data-x="full" title="${esc(t('board.fullscreen'))}" aria-label="${esc(t('board.fullscreen'))}">⛶</button><button data-x="open" title="${esc(t('board.openTab'))}" aria-label="${esc(t('board.openTab'))}">↗</button></div>`;

  /** 卡片內容(不含位置與選取狀態);內容一樣就不重畫。 */
  function innerOf(n) {
    if (n.type === 'group') return `<span class="glabel">${esc(n.label || '')}</span>`;
    if (n.type === 'text') return `<div class="md">${renderMarkdown(String(n.text || ''))}</div>`;
    if (n.type === 'link') {
      const ok = /^https?:\/\//i.test(String(n.url || ''));
      const em = embedOf(n);
      const head = `<span class="kind">${esc(em ? em.provider : t('board.kindLink'))}</span>${ok ? `<a class="open" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.url)}</a>` : `<span>${esc(n.url || '')}</span>`}`;
      return em ? `${head}<div class="embed-box"><button class="embed-load">▶ ${esc(t('board.loadEmbed'))}</button></div>${toolsHTML()}` : head;
    }
    const k = kindOf(n), file = String(n.file || ''), base = file.split('/').pop();
    if (k === 'image') return `<img data-media="${esc(file)}" alt="${esc(base)}" draggable="false">`;
    if (k === 'html') return `<span class="kind">HTML${n['x-scripts'] === true ? ` · ${esc(t('board.scriptsOn'))}` : ''}</span><b>${esc(base)}</b><div class="embed-box"><button class="embed-load">▶ ${esc(t('board.loadEmbed'))}</button></div>${toolsHTML()}`;
    if (k === 'pdf') return `<span class="kind">PDF</span><b>${esc(base)}</b><div class="embed-box"><button class="embed-load">▶ ${esc(t('board.loadEmbed'))}</button></div>${toolsHTML()}`;
    const r = g ? resolveFile(file, g) : null;
    if (!r) return `<span class="kind">…</span><b>${esc(base)}</b>`;
    if (r.kind === 'note') return `<span class="kind" style="--kc:${esc(colorOf(r.rec.topicId))}">${esc(t('board.kindNote'))}</span><a class="open" href="${href.note(r.rec.rel)}">${esc(r.rec.title)}</a><p>${esc(String(r.rec.excerpt || r.rec.body || '').replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 160))}</p>`;
    if (r.kind === 'deck') return `<span class="kind deck" style="--kc:${esc(colorOf(r.rec.topicId))}">${esc(t('board.kindDeck'))}</span><a class="open" href="${href.deck(r.rec.topicId, r.rec.project.id)}">${esc(r.rec.title)}</a>${r.rec.date ? `<p>${esc(r.rec.date)}</p>` : ''}`;
    return `<span class="kind missing">${esc(t('board.kindMissing'))}</span><code>${esc(file)}</code>`;
  }

  function placeNode(n, el) {
    const color = canvasColor(n.color);
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;${color ? `--nc:${color};` : ''}z-index:${n.type === 'group' ? 0 : sel?.node === n.id ? 3 : 1}`;
    el.className = `bnode t-${n.type} k-${kindOf(n)}${sel?.node === n.id ? ' sel' : ''}${color ? ' colored' : ''}${interactive.has(n.id) ? ' interactive' : ''}${live.includes(n.id) ? ' live' : ''}${editing === n.id ? ' editing' : ''}`;
    let h = el.querySelector(':scope > .hdl');
    const want = canEdit && sel?.node === n.id && !editing && !present;
    if (want && !h) { h = document.createElement('div'); h.className = 'hdl'; h.innerHTML = `<i class="resize" data-h="resize"></i>${n.type === 'group' ? '' : SIDES.map(s => `<i class="dot ${s}" data-h="link" data-side="${s}"></i>`).join('')}`; el.append(h); }
    if (!want && h) h.remove();
  }

  function drawNodes() {
    const seen = new Set();
    for (const n of board.nodes) {
      seen.add(n.id);
      let rec = els.get(n.id);
      if (!rec) { const el = document.createElement('div'); el.dataset.id = n.id; nodesEl.append(el); rec = { el, sig: null }; els.set(n.id, rec); }
      if (editing !== n.id) {
        const sig = innerOf(n);
        if (rec.sig !== sig) {
          rec.el.innerHTML = sig; rec.sig = sig;
          const i = live.indexOf(n.id); if (i >= 0) live.splice(i, 1); // 內容換了:嵌入要重新載入
          interactive.delete(n.id);
        }
      }
      placeNode(n, rec.el);
    }
    for (const [id, rec] of els) if (!seen.has(id)) { rec.el.remove(); els.delete(id); const i = live.indexOf(id); if (i >= 0) live.splice(i, 1); interactive.delete(id); }
    if (source) hydrate(nodesEl, source).catch(() => {});
    root.querySelector('.board-empty').hidden = board.nodes.length > 0;
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

  function draw() { drawNodes(); drawEdges(); drawPop(); }

  // ---------- 選取後的小工具列 ----------
  function drawPop() {
    if (!canEdit || present || editing || !sel) { pop.hidden = true; return; }
    const colors = `<span class="swatches">${['', ...Object.keys(PRESET_COLORS)].map(c => `<button data-pop="color" data-c="${c}" title="${esc(t('board.color'))}" aria-label="${esc(t('board.color'))} ${c || '—'}" style="--sw:${c ? PRESET_COLORS[c] : 'transparent'}" class="${c ? '' : 'none'}"></button>`).join('')}</span>`;
    let items = '';
    if (sel.edge) items = `<button data-pop="label">✎ ${esc(t('board.edgeText'))}</button>${colors}`;
    else {
      const n = byId(sel.node);
      if (!n) { pop.hidden = true; return; }
      const k = kindOf(n);
      if (n.type === 'text') items += `<button data-pop="edit">✎ ${esc(t('board.editShort'))}</button>${toNote ? `<button data-pop="note">${esc(t('board.toNote'))}</button>` : ''}`;
      if (n.type === 'group') items += `<button data-pop="glabel">✎ ${esc(t('board.groupLabel'))}</button>`;
      if (n.type === 'link' && !embedOf(n)?.auto) items += `<label><input type="checkbox" data-pop="embed"${n['x-embed'] === true ? ' checked' : ''}> ${esc(t('board.embedWeb'))}</label>`;
      if (n.type === 'link') items += `<button data-pop="url">✎ ${esc(t('board.editUrl'))}</button>`;
      if (k === 'html') items += `<label title="${esc(t('board.scriptsTitle'))}"><input type="checkbox" data-pop="scripts"${n['x-scripts'] === true ? ' checked' : ''}> ${esc(t('board.scripts'))}</label>`;
      items += colors;
    }
    pop.innerHTML = `${items}<button data-pop="remove" class="danger" title="${esc(t('board.removeTitle'))}">${esc(t('board.remove'))}</button>`;
    pop.hidden = false;
    placePop();
  }
  function placePop() {
    if (pop.hidden || !sel) return;
    let x, y;
    if (sel.node) { const n = byId(sel.node); if (!n) return; x = n.x + n.width / 2; y = n.y; }
    else { const e = board.edges.find(v => v.id === sel.edge), a = e && byId(e.fromNode), b = e && byId(e.toNode); if (!a || !b) return; const p = edgePath(a, b, e.fromSide, e.toSide); x = p.mid.x; y = p.mid.y; }
    const r = view.getBoundingClientRect();
    pop.style.left = `${Math.min(r.width - 12, Math.max(12, x * cam.z + cam.x))}px`;
    pop.style.top = `${Math.max(46, y * cam.z + cam.y - 14)}px`;
  }

  pop.addEventListener('pointerdown', e => e.stopPropagation());
  pop.addEventListener('click', e => {
    const b = e.target.closest('[data-pop]');
    if (!b || b.tagName === 'INPUT') return;
    const what = b.dataset.pop;
    if (what === 'remove') return removeSelected();
    if (what === 'label') return editEdge(sel.edge);
    if (what === 'edit') return editText(sel.node);
    if (what === 'glabel') return editGroup(sel.node);
    if (what === 'url') return editLink(sel.node);
    if (what === 'note') return convertToNote(sel.node);
    if (what === 'color') {
      const target = sel.edge ? board.edges.find(x => x.id === sel.edge) : byId(sel.node);
      if (!target) return;
      if (b.dataset.c) target.color = b.dataset.c; else delete target.color;
      draw(); changed();
    }
  });
  pop.addEventListener('change', e => {
    const n = byId(sel?.node);
    if (!n) return;
    const key = e.target.dataset.pop === 'embed' ? 'x-embed' : e.target.dataset.pop === 'scripts' ? 'x-scripts' : null;
    if (!key) return;
    if (e.target.checked) n[key] = true; else delete n[key];
    draw(); changed();
  });

  // ---------- 嵌入 ----------
  function unload(id) {
    const i = live.indexOf(id); if (i >= 0) live.splice(i, 1);
    interactive.delete(id);
    const rec = els.get(id);
    if (rec) { rec.el.innerHTML = rec.sig; const n = byId(id); if (n) placeNode(n, rec.el); }
  }
  async function load(id) {
    const n = byId(id), rec = els.get(id);
    if (!n || !rec) return;
    const box = rec.el.querySelector('.embed-box');
    if (!box || live.includes(id)) return;
    while (live.length >= MAX_LIVE) unload(live[0]); // 最多同時 3 個:收掉最舊的
    live.push(id);
    box.innerHTML = '';
    const k = kindOf(n);
    try {
      if (n.type === 'link') {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation', 'allow-forms'].filter(x => f.sandbox?.supports?.(x) ?? true).join(' '));
        f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
        f.allowFullscreen = true;
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.src = embedOf(n).url;
        box.append(f);
      } else if (k === 'pdf') {
        const f = document.createElement('iframe');
        f.title = n.file;
        f.src = await source.mediaURL(n.file);
        box.append(f);
      } else if (k === 'html' && n['x-scripts'] === true) {
        box.dataset.page = n.file;
        await mountPage(box, source); // 中繼頁執行,拿不到本網站的資料
      } else if (k === 'html') {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', ''); // 不執行腳本、不能導覽
        f.srcdoc = (await source.readText(n.file)).replace(/<script\b[\s\S]*?<\/script\s*>/gi, ''); // 反正不會執行:先拿掉,免得主控台一直報錯
        box.append(f);
      }
    } catch { box.innerHTML = `<p class="embed-fail">${esc(t('board.embedFailed'))}</p>`; }
    placeNode(n, rec.el);
  }
  async function openTab(n) {
    const k = kindOf(n);
    if (n.type === 'link') return window.open(n.url, '_blank', 'noopener');
    if (k === 'html') return openPageTab(n.file, source);
    if (k === 'pdf' || k === 'image') return window.open(await source.mediaURL(n.file), '_blank', 'noopener');
  }
  nodesEl.addEventListener('click', e => {
    const b = e.target.closest('.embed-load, [data-x]');
    if (!b) return;
    const id = b.closest('.bnode')?.dataset.id, n = byId(id);
    if (!n) return;
    e.stopPropagation();
    if (b.classList.contains('embed-load')) return load(id);
    if (b.dataset.x === 'open') return openTab(n);
    if (b.dataset.x === 'interact') { if (!live.includes(id)) load(id); if (interactive.has(id)) interactive.delete(id); else interactive.add(id); return placeNode(n, els.get(id).el); }
    if (b.dataset.x === 'full') {
      const box = els.get(id).el.querySelector('.embed-box');
      if (!live.includes(id)) load(id);
      if (box?.requestFullscreen) box.requestFullscreen().catch(() => openTab(n)); else openTab(n);
    }
  });

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

  // ---------- 新增與編輯 ----------
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
    editing = id; pop.hidden = true;
    const rec = els.get(id);
    rec.el.innerHTML = `<textarea aria-label="${esc(t('board.editText'))}">${esc(n.text || '')}</textarea>`;
    rec.sig = null;
    placeNode(n, rec.el);
    const ta = rec.el.querySelector('textarea');
    const done = () => {
      if (editing !== id) return;
      editing = null;
      if (!ta.value.trim() && !n.text) { board.nodes = board.nodes.filter(x => x !== n); sel = null; } // 空的新文字:不留
      else n.text = ta.value;
      draw(); changed(); view.focus({ preventScroll: true });
    };
    // 下一個影格才聚焦、才開始聽 blur:這次點擊的預設動作(把焦點放到畫布)已經結束
    requestAnimationFrame(() => { if (editing !== id) return; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.addEventListener('blur', done); });
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ta.blur(); } });
  }
  const ask = (title, label, value) => dialog({ title, fields: [{ name: 'v', label, value: value || '' }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('dialog.ok'), value: true, primary: true }] }).then(r => (r?.value ? String(r.fields.v || '').trim() : null));
  async function editEdge(id) {
    const e = board.edges.find(x => x.id === id);
    if (!e || !canEdit) return;
    const v = await ask(t('board.edgeTitle'), t('board.edgeLabel'), e.label);
    if (v == null) return;
    if (v) e.label = v; else delete e.label;
    draw(); changed();
  }
  async function editGroup(id) {
    const n = byId(id);
    const v = n && await ask(t('board.groupLabel'), t('board.groupLabel'), n.label);
    if (v == null) return;
    if (v) n.label = v; else delete n.label;
    draw(); changed();
  }
  async function editLink(id) {
    const n = byId(id);
    const v = n && await ask(t('board.editUrl'), t('board.urlLabel'), n.url);
    if (!v) return;
    const url = extractURL(v);
    if (!/^https?:\/\//i.test(url)) return toast(t('board.urlBad'));
    n.url = url; draw(); changed();
  }
  const linkSize = em => (em ? [560, 360] : [320, 90]);
  async function addLink() {
    const r = await dialog({
      title: t('board.addLinkTitle'), message: t('board.linkHint'),
      fields: [{ name: 'url', label: t('board.urlLabel'), placeholder: 'https://' }, { name: 'mode', label: t('board.linkMode'), type: 'select', value: 'card', options: [{ value: 'card', label: t('board.linkCard') }, { value: 'embed', label: t('board.embedWeb') }] }],
      buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('board.add'), value: true, primary: true }],
    });
    if (!r?.value) return;
    const url = extractURL(r.fields.url);
    if (!/^https?:\/\//i.test(url)) return toast(t('board.urlBad'));
    const node = { id: newId(board), type: 'link', url, ...(r.fields.mode === 'embed' ? { 'x-embed': true } : {}) };
    const em = embedFor(node, classifyMedia);
    if (r.fields.mode === 'embed' && !em) toast(t('board.httpsOnly'));
    const c = center(), [w, h] = linkSize(em);
    addNode({ ...node, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), width: w, height: h });
  }
  async function addCard() {
    if (!choices.length) return toast(t('board.noChoices'));
    const r = await dialog({ title: t('board.addCardTitle'), fields: [{ name: 'file', label: t('board.pick'), type: 'select', value: choices[0].value, options: choices }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('board.add'), value: true, primary: true }] });
    if (!r?.value) return;
    const c = choices.find(x => x.value === r.fields.file), m = center();
    addNode({ id: newId(board), type: 'file', file: c.file, x: Math.round(m.x - 150), y: Math.round(m.y - 60), width: 300, height: 120, ...(c.deck ? { 'x-kind': 'deck' } : {}) });
  }
  /** 選檔、拖進來或貼上的圖片/HTML/PDF:存進 boards/media/,放成卡片。 */
  async function importFiles(files, at) {
    if (!canMedia) return toast(t('ne.readonly'));
    let p = at || center(), added = 0;
    for (const f of files) {
      try {
        const m = await prepareMedia(f);
        await source.writeMedia(m.path, m.blob);
        let w = 420, h = 300;
        if (m.kind === 'image' && m.width && m.height) { const k = Math.min(1, 480 / m.width, 480 / m.height); w = Math.max(80, Math.round(m.width * k)); h = Math.max(60, Math.round(m.height * k)); }
        if (m.kind === 'pdf') { w = 480; h = 600; }
        board.nodes.push({ id: newId(board), type: 'file', file: m.path, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), width: w, height: h });
        p = { x: p.x + 40, y: p.y + 40 }; added++;
      } catch (e) {
        toast(e.message === 'type' ? t('board.fileType', { name: f.name }) : e.message === 'too large' ? t('board.fileTooLarge', { name: f.name }) : t('ne.saveFailed', { error: e.message || e }), { ms: 6000 });
      }
    }
    if (added) { sel = { node: board.nodes[board.nodes.length - 1].id }; draw(); changed(); }
  }
  async function convertToNote(id) {
    const n = byId(id);
    if (!n || n.type !== 'text' || !toNote) return;
    const path = await toNote(String(n.text || ''));
    if (!path) return;
    n.type = 'file'; n.file = path; delete n.text;
    draw(); changed();
    if (reloadGraph) { try { g = await reloadGraph(); if (alive) draw(); } catch { /* 下次開啟就會有 */ } }
  }
  function removeSelected() {
    if (!sel || !canEdit) return;
    if (sel.node) {
      board.nodes = board.nodes.filter(n => n.id !== sel.node);
      board.edges = board.edges.filter(e => e.fromNode !== sel.node && e.toNode !== sel.node);
    } else board.edges = board.edges.filter(e => e.id !== sel.edge);
    sel = null; draw(); changed();
  }
  function select(next) {
    const same = JSON.stringify(next) === JSON.stringify(sel);
    sel = next;
    if (!same) { for (const n of board.nodes) { const r = els.get(n.id); if (r) placeNode(n, r.el); } drawEdges(); drawPop(); }
  }

  // ---------- 簡報模式 ----------
  function showSlide(i) {
    const order = present.order;
    present.i = Math.max(0, Math.min(order.length - 1, i));
    const n = order[present.i];
    world.classList.add('glide');
    const top = n.type === 'group' ? 34 : 0;
    fitTo({ x: n.x, y: n.y - top, width: n.width, height: n.height + top }, 40, 2.5);
    root.querySelector('.board-present-bar .n').textContent = `${present.i + 1} / ${order.length}`;
  }
  function startPresent() {
    const order = slideOrder(board);
    if (!order.length) return toast(t('board.empty'));
    present = { order, i: 0, cam: { ...cam } };
    sel = null; draw();
    page.classList.add('presenting');
    root.querySelector('.board-present-bar').hidden = false;
    page.requestFullscreen?.().catch(() => {});
    setTimeout(() => showSlide(0), 120); // 等全螢幕後的尺寸
  }
  function stopPresent() {
    if (!present) return;
    cam = present.cam; present = null;
    page.classList.remove('presenting');
    root.querySelector('.board-present-bar').hidden = true;
    if (document.fullscreenElement === page) document.exitFullscreen?.().catch(() => {});
    applyCam(); setTimeout(() => world.classList.remove('glide'), 600);
  }
  root.querySelector('.board-present-bar').addEventListener('click', e => {
    const p = e.target.closest('[data-p]')?.dataset.p;
    if (p === 'prev') showSlide(present.i - 1);
    if (p === 'next') showSlide(present.i + 1);
    if (p === 'exit') stopPresent();
  });
  const onFs = () => { if (present && !document.fullscreenElement) stopPresent(); };
  document.addEventListener('fullscreenchange', onFs);

  // ---------- 指標:平移、拖曳、調整大小、連線、兩指縮放、雙擊 ----------
  const pointers = new Map();
  let act = null, lastTap = { id: '', t: 0 };
  const inside = (n, gnode) => n !== gnode && n.x >= gnode.x && n.y >= gnode.y && n.x + n.width <= gnode.x + gnode.width && n.y + n.height <= gnode.y + gnode.height;
  /** 同一張卡片或同一條線 400 ms 內按兩次 = 雙擊(不靠瀏覽器的 dblclick:第一下選取時畫面會更新,瀏覽器就認不出來)。 */
  const isDouble = id => { const now = Date.now(); const d = lastTap.id === id && now - lastTap.t < DOUBLE_MS; lastTap = d ? { id: '', t: 0 } : { id, t: now }; return d; };

  view.addEventListener('pointerdown', e => {
    if (e.target.closest('.board-present-bar, a.open, textarea, .embed-tools, .embed-load, .interactive .embed-box')) return;
    if (present) { if (e.button === 0) act = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, still: true }; return; }
    if (editing || e.button > 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      act = { type: 'pinch', d: Math.hypot(p.x - q.x, p.y - q.y), z: cam.z };
      return;
    }
    view.setPointerCapture(e.pointerId);
    const nodeEl = e.target.closest('.bnode'), edgeEl = e.target.closest('.bedge'), h = e.target.dataset?.h;
    const w = toWorld(e.clientX, e.clientY);
    if (nodeEl) {
      const n = byId(nodeEl.dataset.id);
      if (!n) return;
      if (!h && isDouble('n:' + n.id)) { act = null; e.preventDefault(); if (canEdit) { if (n.type === 'text') editText(n.id); else if (n.type === 'group') editGroup(n.id); else if (n.type === 'link') editLink(n.id); } return; }
      select({ node: n.id });
      if (!canEdit) { act = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
      if (h === 'resize') act = { type: 'resize', n, w0: n.width, h0: n.height, sx: w.x, sy: w.y };
      else if (h === 'link') act = { type: 'link', n, side: e.target.dataset.side };
      else act = { type: 'move', n, sx: w.x, sy: w.y, items: [n, ...(n.type === 'group' ? board.nodes.filter(x => inside(x, n)) : [])].map(x => ({ x0: x.x, y0: x.y, node: x })), moved: false };
      return;
    }
    if (edgeEl) {
      const id = edgeEl.dataset.edge;
      if (isDouble('e:' + id)) { act = null; e.preventDefault(); return editEdge(id); }
      select({ edge: id }); act = null; return;
    }
    if (isDouble('bg') && canEdit) { act = null; e.preventDefault(); return addTextAt(w.x, w.y); } // preventDefault:不要讓瀏覽器把焦點搶回畫布
    select(null);
    act = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  });

  view.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!act) return;
    if (act.type === 'pinch' && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      return zoomAt(act.z * Math.hypot(p.x - q.x, p.y - q.y) / act.d, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    if (act.type === 'pan') {
      if (Math.abs(e.clientX - act.sx) + Math.abs(e.clientY - act.sy) > 4) act.still = false;
      if (act.still) return;
      world.classList.remove('glide'); cam.x = act.cx + e.clientX - act.sx; cam.y = act.cy + e.clientY - act.sy; return applyCam();
    }
    const w = toWorld(e.clientX, e.clientY);
    if (act.type === 'move') {
      const dx = w.x - act.sx, dy = w.y - act.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) { act.moved = true; pop.hidden = true; }
      for (const it of act.items) {
        it.node.x = Math.round(it.x0 + dx); it.node.y = Math.round(it.y0 + dy);
        const el = els.get(it.node.id)?.el;
        if (el) { el.style.left = it.node.x + 'px'; el.style.top = it.node.y + 'px'; }
      }
      drawEdges();
    } else if (act.type === 'resize') {
      act.n.width = Math.max(80, Math.round(act.w0 + w.x - act.sx));
      act.n.height = Math.max(50, Math.round(act.h0 + w.y - act.sy));
      const el = els.get(act.n.id).el;
      el.style.width = act.n.width + 'px'; el.style.height = act.n.height + 'px';
      drawEdges();
    } else if (act.type === 'link') {
      drawEdges(edgePath(act.n, { x: w.x, y: w.y, width: 0, height: 0 }, act.side).d);
    }
  });

  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (!act) return;
    const a = act; act = null;
    if (a.type === 'pan' && present && a.still) { // 簡報中點一下 = 下一頁(點左邊三分之一 = 上一頁)
      const r = view.getBoundingClientRect();
      return showSlide(present.i + (e.clientX - r.left < r.width / 3 ? -1 : 1));
    }
    if (a.type === 'move' && a.moved) { changed(); drawPop(); }
    if (a.type === 'resize') { changed(); drawPop(); }
    if (a.type === 'link') {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bnode');
      const to = target && byId(target.dataset.id);
      if (to && to !== a.n && to.type !== 'group') {
        const edge = { id: newId(board, 'e'), fromNode: a.n.id, fromSide: a.side, toNode: to.id };
        board.edges.push(edge);
        sel = { edge: edge.id };
        changed();
      }
      draw();
    }
  };
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);

  view.addEventListener('wheel', e => {
    if (e.target.closest('.interactive .embed-box')) return;
    e.preventDefault();
    world.classList.remove('glide');
    if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam(); }
  }, { passive: false });

  // 拖檔案進來、貼上
  view.addEventListener('dragover', e => { if (canMedia && [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); view.classList.add('drop'); } });
  view.addEventListener('dragleave', () => view.classList.remove('drop'));
  view.addEventListener('drop', e => {
    view.classList.remove('drop');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || !canMedia) return;
    e.preventDefault(); e.stopPropagation(); // 不要讓整頁的「拖資料夾進來開啟」接手
    importFiles(files, toWorld(e.clientX, e.clientY));
  });
  const onPaste = e => {
    if (!canEdit || editing || present || e.target.closest?.('input, textarea, .lp-dialog')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); return importFiles(files); }
    const text = extractURL(e.clipboardData?.getData('text') || '');
    if (/^https?:\/\/\S+$/i.test(text)) {
      e.preventDefault();
      const node = { id: newId(board), type: 'link', url: text }, c = center(), [w, h] = linkSize(embedFor(node, classifyMedia));
      addNode({ ...node, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), width: w, height: h });
    }
  };
  window.addEventListener('paste', onPaste);
  fileInput.addEventListener('change', () => { const files = [...fileInput.files]; fileInput.value = ''; if (files.length) importFiles(files); });

  root.querySelector('.board-tools').addEventListener('click', e => {
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (b === 'in') zoomAt(cam.z * 1.25);
    if (b === 'out') zoomAt(cam.z / 1.25);
    if (b === 'reset') zoomAt(1);
    if (b === 'fit') fit();
    if (b === 'undo') undo();
    if (b === 'card') addCard();
    if (b === 'link') addLink();
    if (b === 'file') fileInput.click();
    if (b === 'present') startPresent();
    if (b === 'text') { const c = center(); addTextAt(c.x, c.y); }
  });

  const onKey = e => {
    if (editing || e.target.closest?.('input, textarea, select, .lp-dialog, .palette')) return;
    if (present) {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); showSlide(present.i + 1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); showSlide(present.i - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); stopPresent(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return flush(); }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); removeSelected(); } return; }
    if (e.key === 'Escape' && sel) return select(null);
    if (e.key === 'Enter' && sel) {
      e.preventDefault();
      if (sel.edge) return editEdge(sel.edge);
      const n = byId(sel.node);
      if (n?.type === 'text') return editText(n.id);
      return els.get(sel.node)?.el.querySelector('a.open')?.click();
    }
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
    cleanup: () => {
      alive = false;
      window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste);
      window.removeEventListener('beforeunload', onUnload); document.removeEventListener('fullscreenchange', onFs);
      if (present && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      if (dirty) flush();
    },
    isDirty: () => false, // 離開時 cleanup 會把還沒存的立刻存掉,不用問
  };
}
