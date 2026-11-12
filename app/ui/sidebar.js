// 側邊欄:書庫導覽(唯讀)。系統入口、釘選、最近開過、畫布、分類與主題的樹狀目錄。
// 寬螢幕放在左邊,可收起;窄螢幕(1100px 以下)從頁首的 ☰ 叫出成抽屜。
// 只讀書庫;釘選、最近開過、收合狀態存在本機(prefs.js),不寫任何檔案。

import { t } from '../core/i18n.js';
import { escapeHTML as esc } from '../core/markdown.js';
import { navTree, pathTo, pushRecent, togglePin, isPinned, parseNavState, liveEntries } from '../core/nav.js';
import { readPref, writePref, readJSON, writeJSON } from './prefs.js';

const SIDE_KEY = 'leafpile-side';
const NAV_KEY = lib => `leafpile-nav:${lib}`;
const WIDE = '(min-width: 1101px)';

// 使用者手動展開／收起過的節點、捲動位置:同一次瀏覽內換頁時保留(依書庫)
const opened = new Map(), closed = new Map(), scrollPos = new Map();
const setOf = (m, lib) => { if (!m.has(lib)) m.set(lib, new Set()); return m.get(lib); };

const loadNav = lib => parseNavState(readPref(NAV_KEY(lib)));
const saveNav = (lib, s) => writePref(NAV_KEY(lib), JSON.stringify(s));

/** 記一筆「最近開過」(簡報播放頁沒有側邊欄,也要記)。 */
export function recordRecent(lib, entry) {
  const s = loadNav(lib);
  saveNav(lib, { ...s, recent: pushRecent(s.recent, entry) });
}

// 小圖示(單色,跟著文字顏色)
const svg = d => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  shelf: svg('<path d="M2.5 3v10M5.5 3v10M8.5 4l3 9M13.5 13h-11"/>'),
  table: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6 6.5V13"/>'),
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>'),
  n: svg('<path d="M4 2h5.5L12 4.5V14H4z"/><path d="M6 7.5h4M6 10h4"/>'),
  d: svg('<rect x="2" y="3" width="12" height="8.5" rx="1"/><path d="M8 11.5V14M5.5 14h5"/>'),
  b: svg('<rect x="2" y="2.5" width="5" height="4" rx="1"/><rect x="9" y="9.5" width="5" height="4" rx="1"/><path d="M7 4.5h2.5a1.5 1.5 0 0 1 1.5 1.5v3.5"/>'),
  book: svg('<path d="M3 3.5c2-1 4-1 5 .5 1-1.5 3-1.5 5-.5V13c-2-1-4-1-5 .5-1-1.5-3-1.5-5-.5z"/><path d="M8 4v9.5"/>'),
  pin: svg('<path d="M9.5 2.5 13.5 6.5 11 8l-.5 3.5-5-5L9 6z"/><path d="M5.5 10.5 2.5 13.5"/>'),
  fold: svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  x: svg('<path d="m4.5 4.5 7 7m0-7-7 7"/>'),
};

/**
 * 掛上側邊欄。
 * @param {HTMLElement} app
 * @param {{ lib: string, vault: object|Promise<object>, boards?: string[], href: object,
 *   current?: { type: 'shelf'|'n'|'d'|'b', id?: string, title?: string },
 *   context?: 'shelf'|'note'|'board', onSearch?: () => void }} opts
 * @returns {() => void} 卸下(移除元素與監聽)
 */
export function mountSidebar(app, { lib, vault, boards = [], href, current = { type: 'shelf' }, context = 'shelf', onSearch, graph = null }) {
  const body = document.body, wide = matchMedia(WIDE);
  const pref = readJSON(SIDE_KEY, {}) || {};
  const prefKey = context === 'board' ? 'board' : 'page';
  const collapsedDefault = context === 'board'; // 畫布需要寬畫面,預設收起
  const isCollapsed = () => (typeof pref[prefKey] === 'boolean' ? pref[prefKey] : collapsedDefault);

  if (['n', 'd', 'b'].includes(current.type) && current.id) recordRecent(lib, { t: current.type, id: current.id, title: current.title || current.id });

  const aside = document.createElement('aside');
  aside.className = 'side-nav';
  aside.setAttribute('aria-label', t('side.label'));
  const backdrop = document.createElement('div');
  backdrop.className = 'sn-backdrop';
  const topbar = app.querySelector('.topbar');
  const btn = document.createElement('button');
  btn.className = 'side-btn';
  btn.innerHTML = '<span aria-hidden="true">☰</span>';
  btn.setAttribute('aria-label', t('side.toggle'));
  btn.title = t('side.toggle');
  topbar?.prepend(btn);
  (topbar ? topbar.after.bind(topbar) : app.prepend.bind(app))(aside);
  app.append(backdrop);
  body.classList.add('has-side');
  body.classList.toggle('side-board', context === 'board');

  const syncTop = () => body.style.setProperty('--side-top', `${topbar ? Math.round(topbar.getBoundingClientRect().height) : 0}px`);
  const syncState = () => {
    body.classList.toggle('side-collapsed', isCollapsed());
    btn.setAttribute('aria-expanded', String(wide.matches ? !isCollapsed() : body.classList.contains('side-open')));
  };
  const setOpen = on => { body.classList.toggle('side-open', on); syncState(); if (on) requestAnimationFrame(() => aside.querySelector('.sn-scroll a, .sn-scroll button')?.focus({ preventScroll: true })); };
  const setCollapsed = on => { pref[prefKey] = on; writeJSON(SIDE_KEY, pref); syncState(); };
  btn.addEventListener('click', () => (wide.matches ? setCollapsed(!isCollapsed()) : setOpen(!body.classList.contains('side-open'))));
  backdrop.addEventListener('click', () => setOpen(false));
  const onWide = () => { body.classList.remove('side-open'); syncState(); syncTop(); };
  wide.addEventListener('change', onWide);
  window.addEventListener('resize', syncTop);
  const onKey = e => { if (e.key === 'Escape' && body.classList.contains('side-open')) { setOpen(false); btn.focus(); } };
  window.addEventListener('keydown', onKey);
  syncTop(); syncState();

  let alive = true, v = null, titles = null;
  const render = () => {
    if (!alive || !v) return;
    const tree = navTree(v, titles);
    const st = loadNav(lib);
    const pins = liveEntries(st.pins, v, boards, titles), recent = liveEntries(st.recent, v, boards, titles).filter(e => !isPinned(st.pins, e) && !(e.t === current.type && e.id === current.id)).slice(0, 6);
    const op = setOf(opened, lib), cl = setOf(closed, lib);
    const auto = new Set(pathTo(tree, { type: current.type, id: current.id }));
    // 目前這篇所在的位置一律展開(就算之前手動收起過);其餘照使用者的選擇,沒選過就用預設
    const isOpen = (k, def) => auto.has(k) || (!cl.has(k) && (op.has(k) || def));
    const cur = (type, id) => (current.type === type && current.id === id ? ' aria-current="page"' : '');
    const linkOf = e => (e.t === 'n' ? href.note(e.id) : e.t === 'd' ? href.deck(...e.id.split('/')) : href.board(e.id));
    const entry = (e, act) => `<li><a href="${linkOf(e)}"${cur(e.t, e.id)} class="sn-item">${ICON[e.t]}<span>${esc(e.title)}</span></a>${act}</li>`;
    const canPin = ['n', 'd', 'b'].includes(current.type) && current.id;
    const pinnedNow = canPin && isPinned(st.pins, { t: current.type, id: current.id });
    const noteLi = n => `<li><a href="${href.note(n.rel)}" class="sn-item sn-leaf"${cur('n', n.rel)}><span>${esc(n.title)}</span></a></li>`;
    const deckLi = d => `<li><a href="${href.deck(d.topicId, d.id)}" class="sn-item sn-leaf"${cur('d', `${d.topicId}/${d.id}`)}>${ICON.d}<span>${esc(d.title)}</span></a></li>`;
    const topic = tp => `<details data-k="t:${esc(tp.id)}"${isOpen('t:' + tp.id, false) ? ' open' : ''}>
        <summary class="sn-item"><i class="dot" style="--c:${esc(tp.color)}"></i><span>${esc(tp.title)}</span><small>${tp.count}</small></summary>
        <ul>${tp.items.map(i => (i.kind === 'book'
          ? `<li><details data-k="k:${esc(i.path)}"${isOpen('k:' + i.path, false) ? ' open' : ''}><summary class="sn-item">${ICON.book}<span>${esc(i.title)}</span><small>${i.notes.length}</small></summary><ul>${i.notes.map(noteLi).join('')}</ul></details></li>`
          : noteLi(i))).join('')}${tp.decks.map(deckLi).join('')}</ul>
      </details>`;
    const groups = tree.map(g => (g.id == null
      ? g.topics.map(topic).join('')
      : `<details data-k="c:${esc(g.id)}" class="sn-cat"${isOpen('c:' + g.id, true) ? ' open' : ''}><summary class="sn-item"><span>${esc(g.name)}</span><small>${g.count}</small></summary>${g.topics.map(topic).join('')}</details>`)).join('');
    const prevScroll = aside.querySelector('.sn-scroll')?.scrollTop ?? scrollPos.get(lib) ?? 0;
    aside.innerHTML = `<div class="sn-top">
        <a class="sn-lib" href="${href.shelf}" title="${esc(t('side.shelf'))}">${esc(v.title || t('side.shelf'))}</a>
        <button class="sn-fold" aria-label="${esc(t('side.collapse'))}" title="${esc(t('side.collapse'))}">${ICON.fold}</button>
      </div>
      <div class="sn-scroll">
        <ul class="sn-sys">
          <li><a class="sn-item" href="${href.shelf}" data-view="all"${current.type === 'shelf' ? ' aria-current="page"' : ''}>${ICON.shelf}<span>${esc(t('side.shelf'))}</span></a></li>
          <li><a class="sn-item" href="${href.shelf}" data-view="table">${ICON.table}<span>${esc(t('side.table'))}</span></a></li>
          ${onSearch ? `<li><button class="sn-item sn-search">${ICON.search}<span>${esc(t('side.search'))}</span><kbd>Ctrl K</kbd></button></li>` : ''}
        </ul>
        <section class="sn-sec"><h3>${esc(t('side.pins'))}${canPin ? `<button class="sn-pin-cur" aria-pressed="${pinnedNow}" title="${esc(t(pinnedNow ? 'side.unpinThis' : 'side.pinThis'))}">${ICON.pin}<span>${esc(t(pinnedNow ? 'side.unpinThis' : 'side.pinThis'))}</span></button>` : ''}</h3>
          ${pins.length ? `<ul>${pins.map(e => entry(e, `<button class="sn-act" data-unpin="${esc(e.t)}|${esc(e.id)}" aria-label="${esc(t('side.unpin'))}" title="${esc(t('side.unpin'))}">${ICON.x}</button>`)).join('')}</ul>` : `<p class="sn-empty">${esc(t('side.pinsEmpty'))}</p>`}
        </section>
        ${recent.length ? `<section class="sn-sec"><h3>${esc(t('side.recent'))}</h3><ul>${recent.map(e => entry(e, `<button class="sn-act" data-pin="${esc(e.t)}|${esc(e.id)}|${esc(e.title)}" aria-label="${esc(t('side.pin'))}" title="${esc(t('side.pin'))}">${ICON.pin}</button>`)).join('')}</ul></section>` : ''}
        ${boards.length ? `<section class="sn-sec"><details data-k="boards"${isOpen('boards', boards.length <= 5 || current.type === 'b') ? ' open' : ''}><summary class="sn-h"><span>${esc(t('side.boards'))}</span><small>${boards.length}</small></summary><ul>${boards.map(b => `<li><a class="sn-item" href="${href.board(b)}"${cur('b', b)}>${ICON.b}<span>${esc(b)}</span></a></li>`).join('')}</ul></details></section>` : ''}
        <section class="sn-sec sn-tree"><h3>${esc(t('side.topics'))}</h3>${groups || `<p class="sn-empty">${esc(t('side.topicsEmpty'))}</p>`}</section>
      </div>`;
    const sc = aside.querySelector('.sn-scroll');
    sc.scrollTop = prevScroll;
    // 第一次打開時,目前這篇不在視線內才捲過去(只捲側邊欄,不動頁面)
    const here = aside.querySelector('.sn-tree [aria-current]');
    if (here && !prevScroll) {
      const a = here.getBoundingClientRect(), b = sc.getBoundingClientRect();
      if (a.bottom > b.bottom || a.top < b.top) sc.scrollTop += a.top - b.top - b.height / 3;
    }
  };

  aside.addEventListener('toggle', e => {
    const k = e.target.dataset?.k;
    if (!k) return;
    const op = setOf(opened, lib), cl = setOf(closed, lib);
    if (e.target.open) { op.add(k); cl.delete(k); } else { cl.add(k); op.delete(k); }
  }, true);
  aside.addEventListener('scroll', e => { if (e.target.classList?.contains('sn-scroll')) scrollPos.set(lib, e.target.scrollTop); }, true);
  aside.addEventListener('click', e => {
    if (e.target.closest('.sn-fold')) return wide.matches ? setCollapsed(true) : setOpen(false);
    if (e.target.closest('.sn-search')) { setOpen(false); return onSearch?.(); }
    // 只認側邊欄自己的「書庫總覽／表格」連結(書庫頁外層也有 data-view,不能用 closest 一路往上找)
    const viewLink = e.target.closest('.sn-sys a[data-view]');
    const view = viewLink && aside.contains(viewLink) ? viewLink.dataset.view : '';
    if (view) {
      // 已經在書庫頁:直接切換顯示;否則記下要的顯示再過去
      const seg = document.querySelector(`.segmented [data-view="${view}"]`);
      if (seg && location.hash === href.shelf) { e.preventDefault(); seg.click(); setOpen(false); return; }
      writePref('leafpile-shelf-view', view);
    }
    const pin = e.target.closest('[data-pin], [data-unpin]');
    if (pin) {
      e.preventDefault();
      const [type, id, ...rest] = (pin.dataset.pin || pin.dataset.unpin).split('|');
      const s = loadNav(lib);
      saveNav(lib, { ...s, pins: togglePin(s.pins, { t: type, id, title: rest.join('|') || id }) });
      return render();
    }
    if (e.target.closest('.sn-pin-cur')) {
      const s = loadNav(lib);
      saveNav(lib, { ...s, pins: togglePin(s.pins, { t: current.type, id: current.id, title: current.title || current.id }) });
      return render();
    }
    if (e.target.closest('a[href]')) setOpen(false);
  });

  aside.innerHTML = `<div class="sn-scroll"><p class="sn-empty">${esc(t('side.loading'))}</p></div>`;
  Promise.resolve(vault).then(x => { v = x; render(); }).catch(() => { if (alive) aside.innerHTML = ''; });
  // 筆記內容讀完(圖譜建好)後,把檔名換成筆記標題
  Promise.resolve(graph).then(g => {
    if (!g?.notes) return;
    titles = new Map([...g.notes.values()].map(n => [n.rel, n.title]));
    render();
  }).catch(() => { /* 沒有圖譜就維持檔名 */ });

  return () => {
    alive = false;
    scrollPos.set(lib, aside.querySelector('.sn-scroll')?.scrollTop || 0);
    wide.removeEventListener('change', onWide);
    window.removeEventListener('resize', syncTop);
    window.removeEventListener('keydown', onKey);
    aside.remove(); backdrop.remove(); btn.remove();
    body.classList.remove('has-side', 'side-open', 'side-collapsed', 'side-board');
  };
}
