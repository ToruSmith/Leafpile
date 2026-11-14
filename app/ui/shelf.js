// 書架:Leafpile 的首頁畫面。一個主題一段,左邊筆記(筆記本 + 散篇),下面簡報卡片。
// 上方切換「全部|筆記|簡報」、依分類篩選、搜尋;圖譜建好之後補上標題、急件與全文搜尋。

import { escapeHTML as esc } from '../core/markdown.js';
import { applyUITheme } from '../player/themes.js';
import { t, getLang } from '../core/i18n.js';
import { notesOfTopic } from '../core/vault.js';
import { searchGraph } from '../core/graph.js';
import { deckCardHTML, wireDeckCards } from './library-view.js';
import { hydrate } from '../player/hydrate.js';
import { resolveMediaPath } from '../core/media.js';
import { canPickDirectory } from '../sources/sources.js';
import { readPref, writePref, readJSON, writeJSON } from './prefs.js';
import { tableColumns, cellText, sortRows, filterRows, valueOf, groupRows, monthGrid, rowsByDay, shiftMonth, defaultMonth, kanbanKey, matchBoard, plainExcerpt, NO_BOARD } from '../core/table.js';
import { otherBoards, fileKey } from '../core/canvas.js';

const VIEW_KEY = 'leafpile-shelf-view';
const VIEWS = ['all', 'notes', 'slides', 'table'];
const SORT_KEY = 'leafpile-table-sort';
const MODE_KEY = 'leafpile-table-mode'; // 表格看的是「筆記」還是「主題」
const GROUP_KEY = 'leafpile-table-group'; // 表格的分組依據:{ notes: 'category', topics: 'category' }
const FOLD_KEY = 'leafpile-table-fold'; // 收起來的組:{ '<模式>:<分組依據>': [組 id] }
const LAYOUT_KEY = 'leafpile-table-layout'; // 筆記用表格、看板還是月曆看
const LAYOUTS = ['table', 'cards', 'kanban', 'calendar'];

function savedView() {
  const v = readPref(VIEW_KEY); return VIEWS.includes(v) ? v : 'all';
}

/**
 * @param {HTMLElement} root
 * @param {{ vault, sourceKey: string, header: string, href: object, graph: Promise, onRefresh?: Function, onCheck: Function, onNewNote?: Function }} opts
 *   href = { note(rel), deck(topicId, projectId) } 產生連結
 * @returns {Function} 清理函式
 * boardRefs:每個檔案出現在哪些畫布(背景讀完所有畫布才有);onAddToBoard(rel):卡片庫的「放到畫布」,回傳放好的畫布名稱
 */
export function renderShelf(root, { vault, sourceKey, header, href, graph, onRefresh, onCheck, onNewNote, onPrivacy, onPack, onGenerate, onNewBoard, onTopicEdit, onTopicNew, onCategories, boardRefs = null, onAddToBoard = null, onJournal = null }) {
  applyUITheme(vault.theme || 'paper');
  const noteCount = vault.notes.topics.reduce((n, tp) => n + notesOfTopic(tp).length, 0);
  const deckCount = vault.topics.reduce((n, tp) => n + tp.decks.length, 0);
  const hasNotes = vault.kind === 'leafpile';
  let view = hasNotes ? savedView() : 'slides';
  const emptyTopics = vault.topics.filter(tp => !(tp.notes && notesOfTopic(tp.notes).length) && !tp.decks.length);
  const groups = vault.categories.length ? vault.categories : [{ id: '*', name: '', topics: vault.topics }];
  const chipsOf = vault.categories.length
    ? vault.categories.map(c => ({ id: 'c:' + c.id, name: c.name, color: c.color || c.topics[0]?.color, n: c.topics.length }))
    : vault.topics.length > 1 ? vault.topics.map(tp => ({ id: 't:' + tp.id, name: tp.title, color: tp.color, n: (tp.notes ? notesOfTopic(tp.notes).length : 0) + tp.decks.length })) : [];

  root.innerHTML = `
    <div class="library shelf" data-view="${view}">
      ${header}
      <div class="lib-head">
        <div>
          <div class="eyebrow">${esc(t(hasNotes ? 'shelf.eyebrow' : 'lib.eyebrow', { kind: t(sourceKey === 'repo' ? 'lib.repo' : 'lib.local'), topics: vault.topics.length, decks: deckCount, notes: noteCount }))}</div>
          <h1>${esc(vault.title)}</h1>
          ${vault.description ? `<p class="desc">${esc(vault.description)}</p>` : ''}
        </div>
        <div class="lib-tools">
          <input type="search" class="search" placeholder="${esc(t(hasNotes ? 'shelf.search' : 'lib.search'))}" aria-label="${esc(t('lib.search'))}">
          <button class="btn ghost palette-btn" title="${esc(t('palette.open'))}"><kbd>${/Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? '⌘K' : 'Ctrl K'}</kbd></button>
          ${onNewNote ? `<button class="btn ghost new-note" title="${esc(t('shelf.newNoteTitle'))}">${esc(t('shelf.newNote'))}</button>`
            : hasNotes && sourceKey !== 'repo' ? `<button class="ro-chip" title="${esc(t(canPickDirectory() ? 'shelf.readonlyTip' : 'shelf.readonlyBrowserTip'))}">${esc(t('shelf.readonly'))}</button>` : ''}
          <button class="btn ghost check" title="${esc(t('lib.checkTitle'))}">${esc(t('lib.check'))}</button>
          ${onPrivacy ? `<button class="btn ghost privacy" title="${esc(t('privacy.buttonTitle'))}">${esc(t('privacy.button'))}</button>` : ''}
          ${onGenerate ? `<button class="btn ghost gen-btn" title="${esc(t('gen.buttonTitle'))}">${esc(t('gen.button'))}</button>` : ''}
          ${onPack ? `<button class="btn ghost pack-btn" title="${esc(t('pack.buttonTitle'))}">${esc(t('pack.button'))}</button>` : ''}
          ${onRefresh ? `<button class="btn ghost refresh" title="${esc(t('lib.refreshTitle'))}">${esc(t('lib.refresh'))}</button>` : ''}
        </div>
      </div>
      <p class="ro-note" role="status" hidden></p>
      <div class="shelf-bar">
        ${hasNotes ? `<div class="segmented" role="tablist" aria-label="${esc(t('shelf.viewLabel'))}">${VIEWS.map(v => `<button role="tab" data-view="${v}" aria-selected="${v === view}">${esc(t('shelf.view.' + v))}<small>${v === 'notes' || v === 'table' ? noteCount : v === 'slides' ? deckCount : noteCount + deckCount}</small></button>`).join('')}</div>` : ''}
        ${chipsOf.length ? `<nav class="chips"><button class="chip on" data-filter="*">${esc(t('lib.all'))}</button>${chipsOf.map(c => `<button class="chip${c.n ? '' : ' zero'}" data-filter="${esc(c.id)}" style="${c.color ? `--c:${esc(c.color)};--on:#fff` : ''}">${esc(c.name)}<small>${c.n}</small></button>`).join('')}</nav>` : ''}
      </div>
      ${vault.issues.length ? `<details class="lib-issues"><summary>${esc(t('lib.issues', { n: vault.issues.length }))}</summary><ul>${vault.issues.map(i => `<li><code>${esc(i.path)}</code>${esc(i.message)}</li>`).join('')}</ul></details>` : ''}
      <section class="note-table" hidden aria-live="polite"></section>
      <section class="urgent" hidden></section>
      <section class="results" hidden></section>
      <p class="found" hidden></p>
      <p class="empty search-empty" hidden></p>
      <div class="topics">
        ${groups.map(g => `
          <div class="category" data-category="${esc(g.id)}">
            ${g.name ? `<h2 class="category-name">${esc(g.name)}</h2>` : ''}
            ${g.topics.map(tp => topicHTML(tp, vault, href)).join('')}
          </div>`).join('')}
      </div>
      ${hasNotes && (vault.boards?.length || onNewBoard) ? `<section class="boards-row"><h2>${esc(t('board.heading'))}</h2><div class="boards-list">
        ${(vault.boards || []).map(b => `<a class="board-card" href="${href.board(b.name)}"><span class="board-icon" aria-hidden="true"><i></i><i></i><i></i></span><b>${esc(b.name)}</b></a>`).join('')}
        ${onNewBoard ? `<button class="board-card new-board">${esc(t('board.new'))}</button>` : ''}</div></section>` : ''}
      ${emptyTopics.length && (noteCount || deckCount) ? `<p class="empty-topics">${esc(t('shelf.emptyTopics', { list: emptyTopics.map(tp => tp.title).join(t('check.sep')) }))}</p>` : ''}
      ${!noteCount && !deckCount ? `<div class="shelf-empty"><p>${esc(t('shelf.emptyLibrary'))}</p></div>` : ''}
    </div>`;

  const $ = s => root.querySelector(s);
  const shelf = $('.shelf');
  const cards = [...root.querySelectorAll('.deck-card')];
  const findDeck = el => vault.topics.find(tp => tp.id === el.dataset.topic)?.decks.find(p => p.id === el.dataset.project);
  const stopCards = wireDeckCards(cards, { find: findDeck, source: vault.slidesSource, theme: vault.theme });
  if (vault.notesSource) root.querySelectorAll('.books').forEach(el => hydrate(el, vault.notesSource)); // 筆記本封面(簡報封面由 wireDeckCards 用簡報渠道讀)

  // ---------- 篩選 ----------
  let filter = '*', words = [], raw = '', g = null;
  const matches = (el) => {
    if (filter === '*') return true;
    const tp = el.closest('.topic');
    return filter.startsWith('c:') ? tp?.closest('.category')?.dataset.category === filter.slice(2) : tp?.dataset.topic === filter.slice(2);
  };
  const apply = () => {
    shelf.dataset.view = view;
    renderTable();
    if (view === 'table') { $('.found').hidden = true; $('.search-empty').hidden = true; $('.results').hidden = true; return; }
    const items = [...root.querySelectorAll('.topics [data-search]')];
    let shown = 0;
    for (const el of items) {
      const kind = el.classList.contains('deck-card') ? 'slides' : 'notes';
      const ok = (view === 'all' || view === kind) && matches(el) && words.every(w => el.dataset.search.includes(w));
      el.hidden = !ok;
      if (ok) shown++;
    }
    for (const sec of root.querySelectorAll('.topic')) {
      sec.hidden = ![...sec.querySelectorAll('[data-search]')].some(el => !el.hidden);
      sec.querySelector('.notes-col').hidden = !sec.querySelector('.notes-col [data-search]:not([hidden])');
      sec.querySelector('.decks-col').hidden = !sec.querySelector('.decks-col [data-search]:not([hidden])');
    }
    for (const c of root.querySelectorAll('.category')) c.hidden = ![...c.querySelectorAll('.topic')].some(x => !x.hidden);
    const found = $('.found');
    found.hidden = !words.length && filter === '*';
    found.textContent = found.hidden ? '' : t('lib.found', { n: shown, total: items.length });
    const empty = $('.search-empty');
    empty.hidden = !(words.length && shown === 0 && !(g && searchGraph(g, raw).length));
    empty.textContent = empty.hidden ? '' : t('lib.noResults', { q: raw });
    renderResults();
  };

  // ---------- 表格檢視(唯讀):每篇筆記一列,front matter 的欄位當成欄 ----------
  let sort = { key: 'date', dir: 'desc' }, tagFilter = '', tableRows = null;
  { const v = readJSON(SORT_KEY); if (v?.key) sort = { key: String(v.key), dir: v.dir === 'asc' ? 'asc' : 'desc' }; }
  const catOf = new Map(vault.categories.flatMap(c => c.topics.map(tp => [tp.id, c.id])));
  const rowsOf = graphResult => [...graphResult.notes.values()].map(rec => {
    const tp = vault.topics.find(x => x.id === rec.topicId);
    const book = rec.bookPath ? (tp?.notes?.items || []).find(i => i.kind === 'book' && i.path === rec.bookPath) : null;
    return { rel: rec.rel, path: rec.path, title: rec.title, topic: tp?.title || '', topicId: rec.topicId, category: catOf.get(rec.topicId) || '', book: book?.title || '', date: rec.date || '', tags: rec.tags || [], fields: rec.fields || {}, private: !rec.public, body: rec.body || '', boards: otherBoards(refMap, rec.path, null) };
  });
  // ---------- 依畫布篩選(全部、還沒放上畫布、某張畫布);卡片庫與其他筆記檢視共用 ----------
  let refMap = null, boardFilter = '';
  const boardNames = (vault.boards || []).map(b => b.name);
  const boardBar = () => boardNames.length ? `<label class="tb-group"><span>${esc(t('table.boardBy'))}</span><select class="board-by">
      <option value=""${boardFilter === '' ? ' selected' : ''}>${esc(t('table.boardAll'))}</option>
      <option value="${NO_BOARD}"${boardFilter === NO_BOARD ? ' selected' : ''}>${esc(t('table.boardNone'))}</option>
      ${boardNames.map(n => `<option value="${esc(n)}"${boardFilter === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : '';
  boardRefs?.then(m => { refMap = m; tableRows = null; if (view === 'table' && mode === 'notes') renderTable(); }, () => {});
  let mode = readPref(MODE_KEY) === 'topics' ? 'topics' : 'notes';
  let layout = LAYOUTS.includes(readPref(LAYOUT_KEY)) ? readPref(LAYOUT_KEY) : 'table', calMonth = '';
  const layoutBar = () => `<span class="seg-mini" role="group" aria-label="${esc(t('table.layoutLabel'))}">${LAYOUTS.map(l => `<button data-layout="${l}" aria-pressed="${layout === l}">${esc(t('table.layout.' + l))}</button>`).join('')}</span>`;
  const modeBar = () => `<span class="seg-mini" role="group" aria-label="${esc(t('table.modeLabel'))}">${['notes', 'topics'].map(m => `<button data-mode="${m}" aria-pressed="${mode === m}">${esc(t('table.mode.' + m))}</button>`).join('')}</span>`;
  // ---------- 分組與折疊(兩種模式共用) ----------
  const groupPref = { notes: '', topics: '', ...(readJSON(GROUP_KEY) || {}) };
  const folds = readJSON(FOLD_KEY) || {};
  const foldId = () => `${mode}:${groupPref[mode]}`;
  const isFolded = id => (folds[foldId()] || []).includes(id);
  const saveFold = (id, on) => {
    const set = new Set(folds[foldId()] || []);
    if (on) set.add(id); else set.delete(id);
    folds[foldId()] = [...set];
    writeJSON(FOLD_KEY, folds);
  };
  const catName = new Map(vault.categories.map(c => [c.id, c.name]));
  const topicName = new Map(vault.topics.map(tp => [tp.id, tp.title]));
  const groupLabel = key => (key === 'category' || key === 'topic' || key === 'book' || key === 'year' || key === 'month' || key === 'tags' ? t('table.group.' + key) : key);
  const groupBar = options => {
    const cur = options.includes(groupPref[mode]) ? groupPref[mode] : '';
    return `<label class="tb-group"><span>${esc(t('table.groupBy'))}</span><select class="group-by">${['', ...options].map(k => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(k ? groupLabel(k) : t('table.group.none'))}</option>`).join('')}</select></label>
      ${cur ? `<button class="btn ghost fold-all" data-fold="close">${esc(t('table.foldAll'))}</button><button class="btn ghost fold-all" data-fold="open">${esc(t('table.unfoldAll'))}</button>` : ''}`;
  };
  /** 每組一個 <tbody>:第一列是可以折疊的標題列。不分組時只有一個沒有標題的 <tbody>。 */
  const groupBodies = (groups, span, rowHTML) => groups.map(g => {
    if (g.id === '*') return `<tbody>${g.rows.map(rowHTML).join('')}</tbody>`;
    const folded = isFolded(g.id);
    return `<tbody class="grp${folded ? ' folded' : ''}" data-g="${esc(g.id)}"><tr class="g-head"><th colspan="${span}" scope="rowgroup"><button class="g-toggle" aria-expanded="${!folded}"><i aria-hidden="true">\u25BE</i>${esc(g.label || t('table.groupEmpty'))}<span class="g-n">${g.rows.length}</span></button></th></tr>${g.rows.map(rowHTML).join('')}</tbody>`;
  }).join('');
  const groupOpts = key => ({
    order: key === 'category' ? vault.categories.map(c => c.id) : key === 'topic' ? vault.topics.map(tp => tp.id) : [],
    labels: key === 'category' ? catName : key === 'topic' ? topicName : {},
  });

  // 主題清單:不用等圖譜,書庫目錄就有
  const renderTopics = box => {
    const cats = new Map(vault.categories.map(c => [c.id, c.name]));
    const keep = filter === '*' ? () => true : tp => (filter.startsWith('c:') ? catOf.get(tp.id) === filter.slice(2) : tp.id === filter.slice(2));
    const list = vault.topics.filter(tp => tp.id !== '_' && keep(tp) && (!words.length || words.every(w => `${tp.title} ${tp.id} ${tp.description}`.toLowerCase().includes(w))));
    const pub = tp => (typeof tp.conf?.public === 'boolean' ? t(tp.conf.public ? 'tm.publicYes' : 'tm.publicNo') : '');
    const gkey = groupPref.topics === 'category' ? 'category' : '';
    const groups = groupRows(list.map(tp => ({ ...tp, topicId: tp.id, category: catOf.get(tp.id) || '' })), gkey, groupOpts(gkey));
    const span = onTopicEdit ? 7 : 6;
    const rowHTML = tp => `<tr>
          <td class="c-title"><span class="tm-head"><i class="tm-dot" style="background:${esc(tp.color)}"></i>${esc(tp.title)}</span>${tp.description ? `<small>${esc(tp.description)}</small>` : ''}</td>
          <td class="c-f"><code>${esc(tp.id)}</code></td>
          <td class="c-f">${esc(cats.get(tp.category) || tp.category || '')}</td>
          <td class="c-num">${tp.notes ? notesOfTopic(tp.notes).length : 0}</td>
          <td class="c-num">${tp.decks.length}</td>
          <td class="c-f">${esc(pub(tp))}</td>
          ${onTopicEdit ? `<td class="c-act"><button class="btn ghost tm-edit" data-topic="${esc(tp.id)}">${esc(t('tm.editBtn'))}</button></td>` : ''}
        </tr>`;
    box.innerHTML = `<div class="table-head">${modeBar()}<span class="n">${esc(t('table.topicCount', { n: list.length }))}</span>${groupBar(['category'])}
        ${onTopicNew ? `<button class="btn ghost tm-new">${esc(t('tm.newBtn'))}</button>` : ''}
        ${onCategories ? `<button class="btn ghost tm-cats-btn">${esc(t('tm.catsBtn'))}</button>` : ''}
        <span class="hint">${esc(onTopicEdit ? t('table.topicsHint') : t('table.topicsReadonly'))}</span></div>
      <div class="table-wrap"><table class="topic-table">
        <thead><tr><th scope="col"><span>${esc(t('table.topic'))}</span></th><th scope="col"><span>${esc(t('tm.folder'))}</span></th><th scope="col"><span>${esc(t('tm.category'))}</span></th><th scope="col"><span>${esc(t('table.notes'))}</span></th><th scope="col"><span>${esc(t('table.decks'))}</span></th><th scope="col"><span>${esc(t('tm.public'))}</span></th>${onTopicEdit ? '<th scope="col"></th>' : ''}</tr></thead>
        ${groupBodies(groups, span, rowHTML)}
      </table></div>`;
  };
  const renderTable = () => {
    const box = $('.note-table');
    if (view !== 'table') { box.hidden = true; return; }
    box.hidden = false;
    if (mode === 'topics') return renderTopics(box);
    if (!g) { box.innerHTML = `<p class="table-wait">${esc(t('table.loading'))}</p>`; return; }
    tableRows ||= rowsOf(g);
    const extra = tableColumns(tableRows);
    const cols = [['title', t('table.title')], ['topic', t('table.topic')], ...(tableRows.some(r => r.book) ? [['book', t('table.book')]] : []), ['date', t('table.date')], ['tags', t('table.tags')], ...extra.map(k => [k, k])];
    if (!cols.some(([k]) => k === sort.key)) sort = { key: 'date', dir: 'desc' };
    const inCat = filter === '*' ? () => true : r => (filter.startsWith('c:') ? r.category === filter.slice(2) : r.topicId === filter.slice(2));
    const keep = r => inCat(r) && matchBoard(r, boardFilter);
    const list = sortRows(filterRows(tableRows, { words, tag: tagFilter, keep }), sort.key, sort.dir);
    const gOptions = ['category', 'topic', ...(tableRows.some(r => r.book) ? ['book'] : []), 'year', 'month', 'tags', ...extra];
    const gkey = gOptions.includes(groupPref.notes) ? groupPref.notes : '';
    const titleLink = r => `<a href="${href.note(r.rel)}">${esc(r.title)}</a>${r.private ? `<span class="lock" title="${esc(t('table.private'))}" aria-label="${esc(t('table.private'))}">\u{1F512}</span>` : ''}`;
    const head = extraBar => `<div class="table-head">${modeBar()}${layoutBar()}<span class="n">${esc(t('table.count', { n: list.length, total: tableRows.length }))}</span>
        ${tagFilter ? `<button class="tag on clear-tag" title="${esc(t('table.clearTag'))}">#${esc(tagFilter)} \u2715</button>` : ''}
        ${extraBar}${boardBar()}<span class="hint">${esc(t(layout === 'cards' ? 'table.cardsHint' : 'table.readonly'))}</span></div>`;
    if (layout === 'cards') {
      // 卡片庫(參考 Heptabase 的 Card Library):每篇筆記一張卡,照目前的排序;下面列出它在哪些畫布
      const sortSel = `<label class="tb-group"><span>${esc(t('table.sortBy'))}</span><select class="sort-by">${cols.map(([k, label]) => `<option value="${esc(k)}"${k === sort.key ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label><button class="btn ghost sort-dir" aria-label="${esc(t(sort.dir === 'asc' ? 'table.sortAsc' : 'table.sortDesc'))}" title="${esc(t(sort.dir === 'asc' ? 'table.sortAsc' : 'table.sortDesc'))}">${sort.dir === 'asc' ? '\u25B2' : '\u25BC'}</button>`;
      const color = new Map(vault.topics.map(tp => [tp.id, tp.color]));
      box.innerHTML = head(sortSel) + (list.length ? `<div class="card-grid" role="list">${list.map(r => `<article class="lib-card" role="listitem" style="--kc:${esc(color.get(r.topicId) || '')}">
          <a class="lc-title" href="${href.note(r.rel)}">${esc(r.title)}</a>${r.private ? `<span class="lock" title="${esc(t('table.private'))}" aria-label="${esc(t('table.private'))}">\u{1F512}</span>` : ''}
          <small class="lc-meta">${esc([r.topic, r.date].filter(Boolean).join(' \u00b7 '))}</small>
          <p class="lc-text">${esc(plainExcerpt(r.body, 280, r.title))}</p>
          ${r.tags.length ? `<span class="kb-tags">${r.tags.map(x => `<button class="tag" data-tag="${esc(x)}">#${esc(x)}</button>`).join(' ')}</span>` : ''}
          ${boardNames.length || onAddToBoard ? `<div class="lc-boards">${refMap ? (r.boards.length ? r.boards.map(b => `<a href="${href.board(b, r.rel)}" title="${esc(t('table.openOnBoard'))}">\u25A2 ${esc(b)}</a>`).join('') : `<span class="lc-none">${esc(t('table.boardNone'))}</span>`) : ''}${onAddToBoard ? `<button class="btn ghost lc-add" data-add="${esc(r.rel)}" title="${esc(t('table.addToBoardTitle'))}">${esc(t('table.addToBoard'))}</button>` : ''}</div>` : ''}
        </article>`).join('')}</div>` : `<p class="table-empty">${esc(t('table.empty'))}</p>`);
      return;
    }
    if (layout === 'kanban') {
      // 看板(唯讀):分組依據的每一組是一欄;卡片照目前的排序
      const key = kanbanKey(gkey, extra);
      const cols = groupRows(list, key, groupOpts(key));
      const sel = `<label class="tb-group"><span>${esc(t('table.kanbanBy'))}</span><select class="group-by">${gOptions.map(k => `<option value="${esc(k)}"${k === key ? ' selected' : ''}>${esc(groupLabel(k))}</option>`).join('')}</select></label>`;
      box.innerHTML = head(sel) + (list.length ? `<div class="kanban" role="list">${cols.map(c => `<section class="kb-col" role="listitem" aria-label="${esc(c.label || t('table.groupEmpty'))}">
          <h3>${esc(c.label || t('table.groupEmpty'))}<span class="g-n">${c.rows.length}</span></h3>
          <ul>${c.rows.map(r => `<li class="kb-card">${titleLink(r)}<small>${esc([r.date, key === 'topic' ? '' : r.topic].filter(Boolean).join(' \u00b7 '))}</small>${r.tags.length ? `<span class="kb-tags">${r.tags.map(x => `<button class="tag" data-tag="${esc(x)}">#${esc(x)}</button>`).join(' ')}</span>` : ''}</li>`).join('')}</ul>
        </section>`).join('')}</div>` : `<p class="table-empty">${esc(t('table.empty'))}</p>`);
      return;
    }
    if (layout === 'calendar') {
      // 月曆(唯讀):依 date 欄位;格子裡列標題,下面是這個月的清單(手機上格子只顯示點)
      const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      calMonth ||= defaultMonth(list, today);
      const byDay = rowsByDay(list);
      const [y, m] = calMonth.split('-').map(Number);
      const lang = getLang();
      const monthName = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
      const wd = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 1 + i)));
      const inMonth = [...byDay.entries()].filter(([d]) => d.startsWith(calMonth)).sort((a, b) => a[0].localeCompare(b[0]));
      const nav = `<span class="cal-nav"><button class="btn ghost" data-cal="-1" aria-label="${esc(t('table.calPrev'))}">\u2039</button><b class="cal-month" aria-live="polite">${esc(monthName)}</b><button class="btn ghost" data-cal="1" aria-label="${esc(t('table.calNext'))}">\u203a</button><button class="btn ghost" data-cal="today">${esc(t('table.calToday'))}</button>${onJournal ? `<button class="btn ghost" data-journal="${today}" title="${esc(t('journal.todayTitle'))}">${esc(t('journal.today'))}</button>` : ''}</span>`;
      const undated = list.filter(r => !/^\d{4}-\d{2}-\d{2}/.test(String(r.date || ''))).length;
      box.innerHTML = head(nav) + `<div class="table-wrap"><table class="calendar">
          <thead><tr>${wd.map(w => `<th scope="col">${esc(w)}</th>`).join('')}</tr></thead>
          <tbody>${monthGrid(calMonth).map(w => `<tr>${w.map(d => {
            const rs = byDay.get(d.date) || [];
            return `<td class="${d.inMonth ? '' : 'out'}${d.date === today ? ' today' : ''}"><span class="cal-d">${d.day}</span>${onJournal && d.inMonth ? `<button class="cal-add" data-journal="${d.date}" title="${esc(t('journal.dayTitle', { date: d.date }))}" aria-label="${esc(t('journal.dayTitle', { date: d.date }))}">+</button>` : ''}${rs.map(r => `<a class="cal-note" href="${href.note(r.rel)}" title="${esc(r.title)}">${esc(r.title)}</a>`).join('')}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="cal-list">${inMonth.length ? `<h3>${esc(t('table.calMonthList', { n: inMonth.reduce((a, [, rs]) => a + rs.length, 0) }))}</h3><ul>${inMonth.map(([d, rs]) => `<li><time>${esc(d.slice(5))}</time><span>${rs.map(titleLink).join('<br>')}</span></li>`).join('')}</ul>` : `<p class="table-empty">${esc(t('table.calNone'))}</p>`}
        ${undated ? `<p class="hint">${esc(t('table.calUndated', { n: undated }))}</p>` : ''}</div>`;
      return;
    }
    const groups = groupRows(list, gkey, groupOpts(gkey));
    const cell = (r, k) => {
      if (k === 'title') return `<a href="${href.note(r.rel)}">${esc(r.title)}</a>${r.private ? `<span class="lock" title="${esc(t('table.private'))}" aria-label="${esc(t('table.private'))}">\u{1F512}</span>` : ''}`;
      if (k === 'tags') return r.tags.map(x => `<button class="tag" data-tag="${esc(x)}">#${esc(x)}</button>`).join(' ');
      return esc(cellText(valueOf(r, k)));
    };
    box.innerHTML = `<div class="table-head">${modeBar()}${layoutBar()}<span class="n">${esc(t('table.count', { n: list.length, total: tableRows.length }))}</span>
        ${tagFilter ? `<button class="tag on clear-tag" title="${esc(t('table.clearTag'))}">#${esc(tagFilter)} \u2715</button>` : ''}
        ${groupBar(gOptions)}${boardBar()}
        <span class="hint">${esc(t('table.readonly'))}</span></div>
      <div class="table-wrap"><table>
        <thead><tr>${cols.map(([k, label]) => `<th scope="col" aria-sort="${sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button data-sort="${esc(k)}">${esc(label)}<i>${sort.key === k ? (sort.dir === 'asc' ? '\u25B2' : '\u25BC') : ''}</i></button></th>`).join('')}</tr></thead>
        ${groupBodies(groups, cols.length, r => `<tr>${cols.map(([k]) => `<td class="c-${k === 'title' || k === 'tags' || k === 'date' ? k : 'f'}">${cell(r, k)}</td>`).join('')}</tr>`)}
      </table></div>
      ${list.length ? '' : `<p class="table-empty">${esc(t('table.empty'))}</p>`}`;
  };
  $('.note-table').addEventListener('change', e => {
    if (e.target.closest('.board-by')) { boardFilter = e.target.value; return renderTable(); }
    if (e.target.closest('.sort-by')) { sort = { key: e.target.value, dir: sort.dir }; writeJSON(SORT_KEY, sort); return renderTable(); }
    if (!e.target.closest('.group-by')) return;
    groupPref[mode] = e.target.value;
    writeJSON(GROUP_KEY, groupPref);
    renderTable();
  });
  $('.note-table').addEventListener('click', e => {
    const gt = e.target.closest('.g-toggle');
    if (gt) {
      const body = gt.closest('tbody');
      const on = !body.classList.contains('folded');
      body.classList.toggle('folded', on);
      gt.setAttribute('aria-expanded', String(!on));
      return saveFold(body.dataset.g, on);
    }
    const fa = e.target.closest('.fold-all');
    if (fa) {
      const close = fa.dataset.fold === 'close';
      folds[foldId()] = close ? [...$('.note-table').querySelectorAll('tbody.grp')].map(b => b.dataset.g) : [];
      writeJSON(FOLD_KEY, folds);
      return renderTable();
    }
    if (e.target.closest('.sort-dir')) { sort = { key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }; writeJSON(SORT_KEY, sort); return renderTable(); }
    const add = e.target.closest('.lc-add');
    if (add && onAddToBoard) {
      add.disabled = true;
      Promise.resolve(onAddToBoard(add.dataset.add)).then(name => {
        if (name && refMap) { const k = tableRows?.find(r => r.rel === add.dataset.add)?.path; if (k) { const key = fileKey(k); refMap.set(key, [...new Set([...(refMap.get(key) || []), name])]); tableRows = null; } }
        renderTable();
      }, () => { add.disabled = false; });
      return;
    }
    const lb = e.target.closest('[data-layout]');
    if (lb) { layout = lb.dataset.layout; writePref(LAYOUT_KEY, layout); return renderTable(); }
    const jb = e.target.closest('[data-journal]');
    if (jb && onJournal) return onJournal(jb.dataset.journal);
    const cb = e.target.closest('[data-cal]');
    if (cb) { calMonth = cb.dataset.cal === 'today' ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7) : shiftMonth(calMonth, Number(cb.dataset.cal)); return renderTable(); }
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; writePref(MODE_KEY, mode); return renderTable(); }
    const ed = e.target.closest('.tm-edit');
    if (ed) return onTopicEdit?.(ed.dataset.topic);
    if (e.target.closest('.tm-new')) return onTopicNew?.();
    if (e.target.closest('.tm-cats-btn')) return onCategories?.();
    const s = e.target.closest('[data-sort]');
    if (s) {
      const k = s.dataset.sort;
      sort = sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'date' ? 'desc' : 'asc' };
      writeJSON(SORT_KEY, sort);
      return renderTable();
    }
    const tg = e.target.closest('[data-tag]');
    if (tg) { tagFilter = tg.dataset.tag; return renderTable(); }
    if (e.target.closest('.clear-tag')) { tagFilter = ''; renderTable(); }
  });

  // 全文搜尋(圖譜建好之後):搜尋框有字時,在最上面列出內文也符合的筆記
  const renderResults = () => {
    const box = $('.results');
    if (!g || !words.length) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = searchGraph(g, raw, { limit: 12 }).filter(r => r.kind === 'note' && (view !== 'slides'));
    box.hidden = !hits.length;
    box.innerHTML = hits.length ? `<h2>${esc(t('shelf.fullText', { n: hits.length }))}</h2><ul>${hits.map(r => `<li><a href="${href.note(r.rel)}"><b>${esc(r.title)}</b><span>${esc(snippet(r, words))}</span></a></li>`).join('')}</ul>` : '';
  };

  root.querySelectorAll('.segmented button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.view;
    writePref(VIEW_KEY, view);
    root.querySelectorAll('.segmented button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    apply();
    window.dispatchEvent(new CustomEvent('leafpile-shelf-state')); // 側邊欄跟著標示「書庫總覽／表格」
  }));
  root.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    root.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    apply();
  }));
  const search = $('.search');
  search.addEventListener('input', () => { raw = search.value.trim(); words = raw.toLowerCase().split(/\s+/).filter(Boolean); apply(); });
  const onKey = e => {
    if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && e.target === search && search.value) { search.value = ''; search.dispatchEvent(new Event('input')); }
  };
  window.addEventListener('keydown', onKey);
  $('.refresh')?.addEventListener('click', onRefresh);
  $('.check')?.addEventListener('click', onCheck);
  $('.privacy')?.addEventListener('click', () => onPrivacy?.());
  $('.pack-btn')?.addEventListener('click', () => onPack?.());
  $('.gen-btn')?.addEventListener('click', () => onGenerate?.());
  $('.new-board')?.addEventListener('click', () => onNewBoard?.());
  $('.ro-chip')?.addEventListener('click', e => {
    const note = $('.ro-note');
    note.textContent = e.currentTarget.title;
    note.hidden = !note.hidden;
  });
  $('.new-note')?.addEventListener('click', () => onNewNote());
  $('.palette-btn')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('leafpile:palette')));
  apply();

  // ---------- 圖譜建好:補上標題、摘要、急件 ----------
  let alive = true;
  graph?.then(graphResult => {
    if (!alive) return;
    g = graphResult;
    tableRows = null;
    for (const row of root.querySelectorAll('.note-row[data-path]')) {
      const rec = g.notes.get(vault.notePath(row.dataset.path));
      if (!rec) continue;
      row.querySelector('.t').textContent = rec.title;
      row.querySelector('.x').textContent = rec.excerpt || '';
      row.querySelector('.d').textContent = rec.date || '';
      row.querySelector('.tags').innerHTML = rec.tags.map(x => `<span>#${esc(x)}</span>`).join('');
      row.classList.toggle('private', !rec.public);
      row.dataset.search = [rec.title, ...rec.tags, ...rec.aliases, row.dataset.path].join(' ').toLowerCase();
    }
    const today = new Date().toISOString().slice(0, 10);
    const urgent = [...g.notes.values()].filter(n => n.pinned && !(n.expires && n.expires < today));
    const box = $('.urgent');
    box.hidden = !urgent.length;
    box.innerHTML = urgent.length ? `<h2>${esc(t('shelf.urgent'))}</h2><ul>${urgent.map(n => `<li><a href="${href.note(n.rel)}"><b>${esc(n.title)}</b>${n.expires ? `<small>${esc(t('shelf.until', { date: n.expires }))}</small>` : ''}<span>${esc(n.excerpt)}</span></a></li>`).join('')}</ul>` : '';
    apply();
  }, () => {});

  // 側邊欄的「書庫總覽／表格／管理主題」:已經在書庫頁時直接切換,不換網址
  const onShelfNav = e => {
    const d = e.detail || {};
    if (d.mode === 'notes' || d.mode === 'topics') { mode = d.mode; writePref(MODE_KEY, mode); }
    const seg = d.view && root.querySelector(`.segmented [data-view="${d.view}"]`);
    if (seg && view !== d.view) seg.click(); else renderTable();
  };
  window.addEventListener('leafpile-shelf', onShelfNav);
  return () => { alive = false; stopCards(); window.removeEventListener('keydown', onKey); window.removeEventListener('leafpile-shelf', onShelfNav); };
}

function topicHTML(tp, vault, href) {
  const items = tp.notes?.items || [];
  const nNotes = tp.notes ? notesOfTopic(tp.notes).length : 0;
  const counts = [nNotes && t('shelf.countNotes', { n: nNotes }), tp.decks.length && t('shelf.countDecks', { n: tp.decks.length })].filter(Boolean).join(t('shelf.dot'));
  const badges = [tp.conf?.local_only === true ? `<span class="badge local" title="${esc(t('shelf.localOnlyTitle'))}">${esc(t('shelf.localOnly'))}</span>` : '', tp.conf?.public === true ? `<span class="badge public">${esc(t('shelf.publicTopic'))}</span>` : ''].join('');
  return `
  <section class="topic" data-topic="${esc(tp.id)}" style="--c:${esc(tp.color)}">
    <header><h2><i></i>${esc(tp.title)}${badges}<small class="counts">${esc(counts || t('shelf.emptyTopic'))}</small></h2>${tp.description ? `<p>${esc(tp.description)}</p>` : ''}</header>
    <div class="notes-col">
      ${items.filter(i => i.kind === 'book').length ? `<div class="books">${items.filter(i => i.kind === 'book').map(b => bookHTML(b, tp, vault, href)).join('')}</div>` : ''}
      ${items.filter(i => i.kind === 'note').length ? `<ul class="note-list">${items.filter(i => i.kind === 'note').map(n => noteRowHTML(n, tp, href)).join('')}</ul>` : ''}
    </div>
    <div class="decks-col"><div class="grid">${tp.decks.map(p => deckCardHTML(tp, p, href.deck(tp.id, p.id))).join('')}</div></div>
  </section>`;
}

function noteRowHTML(n, tp, href) {
  return `<li class="note-row" data-path="${esc(n.path)}" data-search="${esc([n.title, n.path, tp.title].join(' ').toLowerCase())}">
    <a href="${href.note(n.path)}"><span class="t">${esc(n.title)}</span><span class="x"></span><span class="m"><span class="d">${esc(n.date || '')}</span><span class="tags"></span></span></a>
  </li>`;
}

function bookHTML(b, tp, vault, href) {
  const first = b.notes[0];
  const cover = b.cover ? `<img class="cover-img" data-media="${esc(resolveMediaPath(b.cover, { projectPath: b.path, filePath: b.path + '/_book.yml' }))}" alt="">` : '';
  const status = b.status ? `<span class="status s-${esc(b.status)}">${esc(t('book.status.' + (['reading', 'done', 'paused'].includes(b.status) ? b.status : 'other'), { status: b.status }))}</span>` : '';
  return `<a class="book-card" href="${first ? href.note(first.path) : '#'}" data-search="${esc([b.title, b.author, ...b.tags, b.path, tp.title].join(' ').toLowerCase())}">
    <div class="spine" style="--c:${esc(tp.color)}">${cover}<span class="spine-title">${esc(b.title)}</span></div>
    <div class="book-info"><b>${esc(b.title)}</b>${b.author ? `<span class="author">${esc(b.author)}</span>` : ''}<span class="meta">${status}<span>${esc(t('book.count', { n: b.notes.length }))}</span></span></div>
  </a>`;
}

/** 搜尋結果裡的一小段內文(關鍵字附近)。 */
function snippet(rec, words) {
  const body = String(rec.body || rec.excerpt || '').replace(/\s+/g, ' ');
  const lower = body.toLowerCase();
  const i = Math.max(0, ...words.map(w => lower.indexOf(w)).filter(x => x >= 0).slice(0, 1));
  const from = Math.max(0, i - 30);
  return (from ? '…' : '') + body.slice(from, from + 90) + (from + 90 < body.length ? '…' : '');
}
