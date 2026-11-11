// 入口與路由。網址格式(<書庫> = repo | session | local/<id>):
//   #/                                   首頁(選擇書庫)
//   #/<書庫>                              書架(筆記 + 簡報)
//   #/<書庫>/n/<筆記路徑>[/<段落>]          閱讀筆記
//   #/<書庫>/e/<筆記路徑>                   編輯筆記
//   #/<書庫>/f/<筆記路徑>[/<第幾張>]        快閃播放(筆記暫時當簡報)
//   #/<書庫>/d/<主題>/<簡報>[/<第幾張>[/read]]  播放簡報
//   #/<書庫>/go/<連結>/<來自哪篇筆記>        解析 [[連結]] 後轉過去
//   #/presenter                          講者視窗
// 筆記路徑是 notes/ 裡的相對路徑,整段編碼成一個網址片段。

import { loadDeck, refreshProject } from './core/library.js';
import { openVault, findNote, findDeck, notesOfTopic } from './core/vault.js';
import { buildGraph, sourceStatus, compareSource } from './core/graph.js';
import { parseNote, slugify, splitFrontMatter, wikilinksOf } from './core/note.js';
import { expandEmbeds, promoteNote, promoteBook, distillDeck, withSourceHash } from './core/bridge.js';
import { checkVault } from './core/check.js';
import { escapeHTML as esc, linkKey } from './core/markdown.js';
import { HttpSource, HandleSource, FileListSource, sourceFromDrop, canPickDirectory } from './sources/sources.js';
import { listRecent, remember, getRecent, forget, ensurePermission } from './sources/store.js';
import { renderShelf } from './ui/shelf.js';
import { renderReader } from './ui/notes/reader.js';
import { renderEditor, newNoteFileName, newNoteText } from './ui/notes/editor.js';
import { openPalette } from './ui/palette.js';
import { openCheckPanel } from './ui/check-view.js';
import { dialog, confirmDialog, toast } from './ui/dialog.js';
import { Player } from './player/player.js';
import { noteToDeck } from './player/flash.js';
import { openExportDialog } from './player/export.js';
import { startPresenter } from './player/presenter.js';
import { loadQA, saveQA } from './player/qa-store.js';
import { applyUITheme } from './player/themes.js';
import { t, setLang, getLang, normalizeLang } from './core/i18n.js';

export const VERSION = '0.2.0';
const REPO_URL = 'https://github.com/ToruSmith/Leafpile';
const MDSLIDE_URL = 'https://github.com/ToruSmith/Mdslide-Pile';

const app = document.getElementById('app');
const enc = encodeURIComponent;

// ---------------- 介面語言 ----------------
// 順序:使用者選擇(localStorage)→ 瀏覽器語言(zh 開頭 = 繁中,其他 = 英文)→ 繁中
const LANG_KEY = 'leafpile-lang';
function pickLang() {
  let saved = null;
  try { saved = normalizeLang(localStorage.getItem(LANG_KEY)); } catch { /* 隱私模式 */ }
  if (saved) return saved;
  const nav = navigator.language;
  return nav ? (normalizeLang(nav) === 'zh-Hant' ? 'zh-Hant' : 'en') : 'zh-Hant';
}
function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = getLang();
  document.body.dataset.drop = t('drop.hint');
}
applyLang(pickLang());

const state = {
  sources: new Map(), vaults: new Map(), graphs: new Map(), sourceWarned: new Set(),
  session: null,
  player: null, playerKey: '',
  view: null,            // { cleanup?, isDirty? } 目前畫面
  stopWatch: null,
  current: { key: '', rel: '', deck: null }, // 給指令面板用:目前在哪個書庫、哪篇筆記、哪份簡報
};

class UserError extends Error {}

// ---------------- 網址 ----------------
const keyBase = key => '#/' + key.split('/').map(enc).join('/');
function hrefs(key) {
  const base = keyBase(key);
  return {
    shelf: base,
    note: (rel, heading) => `${base}/n/${enc(rel)}${heading ? '/' + enc(heading) : ''}`,
    edit: rel => `${base}/e/${enc(rel)}`,
    flash: (rel, n) => `${base}/f/${enc(rel)}${n ? '/' + n : ''}`,
    deck: (topicId, projectId, n, read) => `${base}/d/${enc(topicId)}/${enc(projectId)}${n ? '/' + n : ''}${read ? '/read' : ''}`,
    go: (link, fromRel) => `${base}/go/${enc(JSON.stringify({ c: link.channel, t: link.target, h: link.heading }))}/${enc(fromRel)}`,
  };
}

// ---------------- 路由 ----------------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  if (parts[0] === 'presenter') return startPresenter(app);

  let key, rest;
  if (parts[0] === 'repo' || parts[0] === 'session') { key = parts[0]; rest = parts.slice(1); }
  else if (parts[0] === 'local' && parts[1]) { key = `local/${parts[1]}`; rest = parts.slice(2); }
  else { leaveView(); state.current = { key: '', rel: '', deck: null }; return home(); }

  const [mode, a, b, c, d] = rest;
  state.current = { key, rel: ['n', 'e', 'f'].includes(mode) ? a || '' : '', deck: mode === 'd' && a && b ? { topicId: a, projectId: b } : null };
  if (mode === 'd' && a && b) return showDeck(key, a, b, Number(c || 1) - 1, d === 'read');
  if (mode === 'f' && a) return showFlash(key, a, Number(b || 1) - 1);
  if (mode === 'n' && a) return leaveView(), showNote(key, a, b);
  if (mode === 'e' && a) return leaveView(), showEditor(key, a);
  if (mode === 'go' && a) return followLink(key, a, b || '');
  // Mdslide Pile 的舊網址:#/<書庫>/<主題>/<簡報>/<第幾張>
  if (mode && a && !['n', 'e', 'f', 'd', 'go'].includes(mode)) return location.replace(hrefs(key).deck(mode, a, b, c === 'read'));
  leaveView();
  return showShelf(key);
}

function leavePlayer() {
  state.player?.destroy();
  state.player = null;
  state.playerKey = '';
  state.stopWatch?.();
  state.stopWatch = null;
}

function leaveView() {
  leavePlayer();
  state.view?.cleanup?.();
  state.view = null;
}

// 編輯中還沒存檔就要離開:先問(按「取消」就回到編輯畫面)
let lastHash = location.hash, ignoreHash = false;
window.addEventListener('hashchange', async () => {
  if (ignoreHash) { ignoreHash = false; lastHash = location.hash; return; }
  if (state.view?.isDirty?.()) {
    const target = location.hash;
    ignoreHash = true;
    location.hash = lastHash;
    if (await confirmDialog(t('ne.leaveAsk'), t('ne.leave'))) { state.view.isDirty = () => false; location.hash = target; }
    return;
  }
  lastHash = location.hash;
  route();
});

// ---------------- 資料來源與書庫 ----------------
async function getSource(key) {
  if (state.sources.has(key)) return state.sources.get(key);
  let src = null;
  if (key === 'repo') src = await HttpSource.open();
  else if (key === 'session') src = state.session;
  else if (key.startsWith('local/')) {
    const rec = await getRecent(key.slice(6));
    if (!rec) throw new UserError(t('err.noRecord'));
    if (!(await ensurePermission(rec.handle))) return { needsPermission: rec };
    src = new HandleSource(rec.handle, rec.id);
  }
  if (!src) throw new UserError(t('err.sessionGone'));
  state.sources.set(key, src);
  return src;
}

/** 取得書庫(第 1 層,只讀資料夾)。回傳 null 代表已經改顯示授權畫面。 */
async function getVault(key) {
  const source = await getSource(key);
  if (source.needsPermission) { permissionScreen(source.needsPermission); return null; }
  if (!state.vaults.has(key)) {
    state.vaults.set(key, await openVault(source));
    state.graphs.delete(key);
  }
  return state.vaults.get(key);
}

/** 圖譜(背景讀完所有筆記)。同一個書庫只建一次,書庫重新讀取時才重建。 */
function getGraph(key) {
  const vault = state.vaults.get(key);
  if (!vault) return Promise.reject(new Error('no vault'));
  if (!state.graphs.has(key)) {
    const p = buildGraph(vault);
    p.catch(e => console.warn('graph', e));
    state.graphs.set(key, p);
  }
  return state.graphs.get(key);
}

/** 檔案改過之後:清掉快取,下次重新讀。 */
function invalidate(key) {
  state.sources.get(key)?.refresh?.();
  state.vaults.delete(key);
  state.graphs.delete(key);
}

// ---------------- 共用畫面 ----------------
function header(active = '') {
  return `<header class="topbar">
    <a class="brand" href="#/"><span class="logo leaf" aria-hidden="true"><i></i><i></i><i></i></span>Leafpile<small>${esc(t('brand.zh'))}</small></a>
    <nav>
      <a href="#/repo" class="${active === 'repo' ? 'on' : ''}">${t('nav.repo')}</a>
      <a href="#/" class="${active === 'home' ? 'on' : ''}">${t('nav.home')}</a>
      <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
      <button class="lang-toggle" aria-label="${esc(t('lang.label'))}" title="${esc(t('lang.label'))}"><b class="${getLang() === 'zh-Hant' ? 'on' : ''}">${t('lang.zhShort')}</b> / <b class="${getLang() === 'en' ? 'on' : ''}">EN</b></button>
    </nav>
  </header>`;
}

function loading(msg = t('loading')) {
  app.innerHTML = `<div class="loading"><div class="spinner"><i></i><i></i><i></i></div><p>${esc(msg)}</p></div>`;
}

// 連不上網路時,各瀏覽器丟出的錯誤:Chrome「Failed to fetch」、Firefox「NetworkError…」、Safari「Load failed」
const isNetworkError = err => err instanceof TypeError && /fetch|network|load failed/i.test(err.message);

function showError(err, back = '#/') {
  console.error(err);
  const offline = isNetworkError(err) || navigator.onLine === false;
  const msg = err instanceof UserError ? err.message : offline ? t('err.offline') : (err.message || String(err));
  app.innerHTML = `${header()}<div class="error-box"><h2>${t(offline ? 'err.offlineTitle' : 'err.title')}</h2><p>${esc(msg)}</p><a class="btn" href="${back}">${t(back === '#/' ? 'nav.backHome' : 'nav.backShelf')}</a></div>`;
}

function permissionScreen(rec) {
  app.innerHTML = `${header('home')}<div class="error-box"><h2>${t('perm.title', { name: esc(rec.name) })}</h2><p>${t('perm.text')}</p><button class="btn primary grant">${t('perm.grant')}</button> <a class="btn ghost" href="#/">${t('nav.backHome')}</a></div>`;
  app.querySelector('.grant').onclick = async () => {
    try {
      if (await ensurePermission(rec.handle, true)) { await remember(rec.handle); route(); }
    } catch { showError(new UserError(t('err.cannotRead'))); }
  };
}

// ---------------- 首頁 ----------------
async function home() {
  applyUITheme('paper');
  document.title = t('doc.title');
  const recent = await listRecent();
  let repoOK = true;
  try { await getSource('repo'); } catch { repoOK = false; }
  app.innerHTML = `
    ${header('home')}
    <main class="home">
      <section class="hero">
        <div class="hero-text">
          <div class="eyebrow">${t('home.eyebrow')}</div>
          <h1>${t('home.title')}</h1>
          <p>${t('home.lead')}</p>
          <div class="actions">
            <button class="btn primary open-folder">${t('home.open')}</button>
            ${repoOK ? `<a class="btn ghost" href="#/repo">${t('home.repo')}</a>` : ''}
          </div>
          <p class="small">${canPickDirectory() ? t('home.tipPicker') : t('home.tipNoPicker')}</p>
        </div>
        <div class="hero-art leaf-art" aria-hidden="true">
          ${Array.from({ length: 4 }, (_, i) => `<b style="--i:${i}"><em></em><em></em><em></em></b>`).join('')}
          ${Array.from({ length: 5 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}
        </div>
      </section>
      ${recent.length ? `<section class="recent"><h2>${t('home.recent')}</h2><ul>${recent.map(r => `
        <li><a href="#/local/${r.id}"><b>${esc(r.name)}</b><small>${new Date(r.lastOpened).toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}</small></a><button class="forget" data-id="${r.id}" title="${esc(t('home.forget'))}" aria-label="${esc(t('home.forget'))}">×</button></li>`).join('')}</ul></section>` : ''}
      <section class="howto">
        <div><b>1</b><h3>${t('home.step1.title')}</h3><p>${t('home.step1.text')}</p></div>
        <div><b>2</b><h3>${t('home.step2.title')}</h3><p>${t('home.step2.text')}</p></div>
        <div><b>3</b><h3>${t('home.step3.title')}</h3><p>${t('home.step3.text')}</p></div>
      </section>
      <p class="foot-note">${t('home.rules')}<a href="${REPO_URL}/blob/main/${t('home.guidePath')}" target="_blank" rel="noopener">${t('home.guideName')}</a> · ${t('home.engine')}<a href="${MDSLIDE_URL}" target="_blank" rel="noopener">Mdslide Pile</a> · v${VERSION}</p>
      <input type="file" class="dir-input" webkitdirectory directory multiple hidden>
    </main>`;

  app.querySelector('.open-folder').onclick = openFolder;
  app.querySelectorAll('.forget').forEach(b => b.onclick = async e => { e.preventDefault(); await forget(b.dataset.id); home(); });
  const input = app.querySelector('.dir-input');
  input.onchange = () => { if (input.files.length) useSession(FileListSource.fromInput(input.files)); };
}

async function openFolder() {
  if (canPickDirectory()) {
    try {
      const handle = await window.showDirectoryPicker({ id: 'leafpile-library', mode: 'read' });
      const id = await remember(handle);
      state.sources.delete(`local/${id}`);
      invalidate(`local/${id}`);
      location.hash = `#/local/${id}`;
    } catch (e) { if (e.name !== 'AbortError') showError(e); }
  } else {
    app.querySelector('.dir-input')?.click();
  }
}

async function useSession(source) {
  if (source instanceof HandleSource) {
    const id = await remember(source.handle);
    state.sources.delete(`local/${id}`); invalidate(`local/${id}`);
    location.hash = `#/local/${id}`;
    return;
  }
  state.session = source;
  state.sources.delete('session');
  invalidate('session');
  leaveView();
  if (location.hash === '#/session') route(); else location.hash = '#/session';
}

// ---------------- 書架 ----------------
async function showShelf(key) {
  loading(t('loading.library'));
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const href = hrefs(key);
    if (vault.kind === 'mdslide' && vault.slides.kind === 'deck' && vault.topics[0]?.decks.length === 1) {
      // 開的是單一簡報資料夾:直接進播放器
      const tp = vault.topics[0];
      location.replace(href.deck(tp.id, tp.decks[0].id));
      return;
    }
    const source = state.sources.get(key);
    state.view = {
      cleanup: renderShelf(app, {
        vault, sourceKey: key, href,
        header: header(key === 'repo' ? 'repo' : 'home'),
        graph: vault.kind === 'leafpile' ? getGraph(key) : null,
        onRefresh: key === 'repo' ? null : () => { invalidate(key); showShelf(key); },
        onCheck: () => runCheck(key),
        onNewNote: vault.notesSource?.canWrite ? () => newNote(key) : null,
      }),
    };
    document.title = `${vault.title} · Leafpile`;
    if (source.kind === 'handle') watchVault(key, vault);
  } catch (e) { showError(e); }
}

/** 本機資料夾(Chrome / Edge):書架開著時,主題資料夾有變化就重新整理。 */
function watchVault(key, vault) {
  const src = state.sources.get(key);
  if (!src?.watch) return;
  const dirs = [''];
  if (vault.kind === 'leafpile') {
    for (const ch of ['notes', 'slides']) if (vault[ch + 'Source']) dirs.push(ch, ...vault.topics.map(tp => `${ch}/${tp.id}`));
  }
  const stop = src.watch(dirs, () => {
    if (state.view?.isDirty?.()) return;
    invalidate(key);
    if (location.hash === keyBase(key)) showShelf(key);
  }, 2500);
  const prev = state.view.cleanup;
  state.view.cleanup = () => { stop(); prev?.(); };
}

function runCheck(key) {
  const source = state.sources.get(key);
  source.refresh?.(); // 讀最新的檔案(使用者可能剛改過)
  openCheckPanel(document.body, onProgress => checkVault(source, onProgress));
}

// ---------------- 筆記 ----------------
async function loadNote(key, rel) {
  const vault = await getVault(key);
  if (!vault) return null;
  if (!vault.notesSource) throw new UserError(t('err.noNotes'));
  const found = findNote(vault, rel);
  if (!found) throw new UserError(t('err.noNote', { path: rel }));
  const text = await vault.notesSource.readText(rel);
  return { vault, ...found, text, note: parseNote(text, { path: rel }) };
}

async function showNote(key, rel, heading) {
  loading(t('loading.note'));
  try {
    const r = await loadNote(key, rel);
    if (!r) return;
    state.view = {
      cleanup: renderReader(app, {
        vault: r.vault, rel, note: r.note, topic: r.topic, book: r.book, heading,
        header: header(key === 'repo' ? 'repo' : 'home'),
        href: hrefs(key), graph: getGraph(key),
        canEdit: !!r.vault.notesSource.canWrite || r.vault.notesSource.kind === 'repo',
        canPromote: !!state.sources.get(key)?.canWrite,
      }),
    };
    document.title = `${r.note.title} · Leafpile`;
  } catch (e) { showError(e, keyBase(key)); }
}

async function showEditor(key, rel) {
  loading(t('loading.note'));
  try {
    const r = await loadNote(key, rel);
    if (!r) return;
    const ed = renderEditor(app, {
      vault: r.vault, libId: key, rel, text: r.text,
      header: header(key === 'repo' ? 'repo' : 'home'),
      href: hrefs(key), graph: getGraph(key),
      onSaved: () => { state.graphs.delete(key); },
    });
    state.view = ed;
    document.title = `${t('ne.docTitle', { title: r.note.title })} · Leafpile`;
  } catch (e) { showError(e, keyBase(key)); }
}

async function newNote(key, topicId) {
  const vault = await getVault(key);
  if (!vault?.notesSource?.canWrite) return toast(t('ne.readonly'));
  const topics = vault.notes.topics.filter(tp => tp.id !== '_');
  const def = topicId || (topics.find(tp => /inbox/i.test(tp.id)) || topics[0])?.id || '';
  const r = await dialog({
    title: t('newNote.title'),
    fields: [
      { name: 'title', label: t('newNote.name'), placeholder: t('newNote.placeholder') },
      { name: 'topic', label: t('newNote.topic'), type: 'select', value: def, options: [...topics.map(tp => ({ value: tp.id, label: tp.title })), { value: '', label: t('notes.unfiled') }] },
    ],
    buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('newNote.create'), value: true, primary: true }],
  });
  if (!r?.value) return;
  const title = r.fields.title.trim();
  if (!title) return toast(t('newNote.needTitle'));
  const rel = [r.fields.topic, newNoteFileName(title)].filter(Boolean).join('/');
  try {
    if ((await vault.notesSource.stat(rel)) !== null) return toast(t('newNote.exists'));
    await vault.notesSource.writeText(rel, newNoteText(title));
    invalidate(key);
    location.hash = hrefs(key).edit(rel);
  } catch (e) { toast(e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e })); }
}

/** [[連結]]:用圖譜解析後轉過去。 */
async function followLink(key, raw, fromRel) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const href = hrefs(key);
    let link;
    try { const j = JSON.parse(raw); link = { channel: j.c === 'slides' ? 'slides' : 'notes', target: String(j.t || ''), heading: String(j.h || '') }; } catch { link = { channel: 'notes', target: raw, heading: '' }; }
    loading(t('loading.link'));
    const g = await getGraph(key);
    const from = fromRel ? findNote(vault, fromRel) : null;
    const res = g.resolver.resolve(link, { fromTopic: from?.topic.id, fromPath: fromRel && vault.notePath(fromRel) });
    const back = fromRel ? href.note(fromRel) : href.shelf;
    if (res.status === 'self') return location.replace(href.note(fromRel, link.heading ? slugify(link.heading) : ''));
    if (!res.target) { location.replace(back); return toast(t('note.linkMissingToast', { link: link.target })); }
    if (res.status === 'ambiguous') toast(t('note.linkAmbiguousToast', { n: res.candidates.length }));
    if (res.target.kind === 'note') return location.replace(href.note(res.target.rel, link.heading ? slugify(link.heading) : ''));
    return location.replace(href.deck(res.target.topicId, res.target.project.id));
  } catch (e) { showError(e, keyBase(key)); }
}

// ---------------- 播放 ----------------
async function showFlash(key, rel, start) {
  const flashKey = `${key}/f/${rel}`;
  if (state.player && state.playerKey === flashKey) { state.player.goTo(start); return; }
  leaveView();
  loading(t('loading.deck'));
  try {
    const r = await loadNote(key, rel);
    if (!r) return;
    const deck = noteToDeck(r.note, { rel, theme: r.vault.theme, color: r.topic.conf?.color || r.vault.topics.find(tp => tp.id === r.topic.id)?.color, topicTitle: r.topic.title });
    const href = hrefs(key);
    state.playerKey = flashKey;
    describeDeckLinks(key, r.vault, deck, r.topic.id);
    state.player = new Player(app, {
      deck, source: r.vault.notesSource, start, theme: r.vault.theme,
      onExport: p => exportWithLinks(key, r.vault, p, r.topic.id),
      onExit: () => { location.hash = href.note(rel); },
      onIndex: i => history.replaceState(null, '', href.flash(rel, i + 1)),
    });
    lastHash = location.hash;
    document.title = `▶ ${r.note.title} · Leafpile`;
  } catch (e) { showError(e, keyBase(key)); }
}

async function showDeck(key, topicId, projectId, start, reading = false) {
  const deckKey = `${key}/d/${topicId}/${projectId}`;
  if (state.player && state.playerKey === deckKey) {
    if (reading && !state.player.reader) state.player.openReading();
    else if (!reading && state.player.reader) state.player.closeReading();
    else if (!state.player.reader) state.player.goTo(start);
    return;
  }
  leaveView();
  loading(t('loading.deck'));
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const source = vault.slidesSource;
    const project = findDeck(vault, topicId, projectId);
    if (!project) throw new UserError(t('err.noDeck'));
    const deck = await withEmbeds(key, vault, await loadDeck(source, project));
    if (!deck.sections.length) throw new UserError(t('err.emptyDeck'));
    const href = hrefs(key);
    const single = vault.kind === 'mdslide' && vault.slides.kind === 'deck';
    state.playerKey = deckKey;
    // 即時重新載入:只有 Chrome / Edge 的資料夾(HandleSource)偵測得到檔案變動
    let current = project, busy = false;
    const reload = state.sources.get(key)?.kind === 'handle' ? async () => {
      if (busy) return null;
      busy = true;
      try {
        source.refresh?.();
        state.vaults.delete(key); state.graphs.delete(key); // 回到書架時重新讀取(標題可能改了)
        current = await refreshProject(source, current);
        return await withEmbeds(key, vault, await loadDeck(source, current));
      } finally { busy = false; }
    } : null;
    describeDeckLinks(key, vault, deck, topicId);
    state.player = new Player(app, {
      deck, source, start, reading, theme: deck.theme || vault.theme, onReload: reload,
      qaKey: vault.kind === 'leafpile' ? deckKey : '', // 講後筆記只在 Leafpile 書庫產生
      onExport: p => exportWithLinks(key, vault, p, topicId),
      onExit: () => { location.hash = single ? '#/' : href.shelf; },
      onIndex: (i, read) => history.replaceState(null, '', href.deck(topicId, projectId, i + 1, read ?? state.player?.reader)),
    });
    lastHash = location.hash;
    document.title = `${deck.title} · Leafpile`;
    remindSource(key, vault, project, deckKey);
    if (reload) {
      const dirs = [...new Set([deck.path, ...deck.sections.map(s => s.path)])];
      state.stopWatch = source.watch(dirs, async () => {
        const next = await reload();
        if (next && state.player) { describeDeckLinks(key, vault, next, topicId); state.player.replaceDeck(next); }
      });
    }
  } catch (e) { showError(e, keyBase(key)); }
}

/**
 * 投影片裡的 [[連結]]:用圖譜解析出目標的標題與路徑,存在 deck.links(播放時當提示文字,匯出時一起帶走)。
 * 背景進行、不擋播放;回傳的 Promise 給匯出用(匯出前一定要等它)。
 */
function describeDeckLinks(key, vault, deck, topicId) {
  if (vault.kind !== 'leafpile' || deck.links) return Promise.resolve();
  const found = new Map();
  for (const sec of deck.sections) for (const sl of sec.slides) for (const l of wikilinksOf([sl.title, sl.body, sl.notes].filter(Boolean).join('\n'))) found.set(linkKey(l), l);
  if (!found.size) return Promise.resolve();
  return getGraph(key).then(g => {
    const links = {};
    for (const [k, l] of found) {
      const r = g.resolver.resolve(l, { fromTopic: topicId });
      links[k] = r.target ? { kind: r.target.kind, title: r.target.title, path: r.target.path } : { missing: true };
    }
    deck.links = links;
  }, () => { /* 圖譜建不起來:提示文字退回連結本身寫的目標 */ });
}

async function exportWithLinks(key, vault, player, topicId) {
  await describeDeckLinks(key, vault, player.deck, topicId);
  return openExportDialog(player);
}

/** 來源筆記在升級之後改過:開簡報時提醒一次(背景比對,不擋播放)。 */
async function remindSource(key, vault, project, deckKey) {
  if (vault.kind !== 'leafpile' || project.config?.source_hash == null || state.sourceWarned.has(deckKey)) return;
  try {
    const st = await freshSourceStatus(key, vault, project);
    if (st?.status !== 'changed' || state.playerKey !== deckKey) return;
    state.sourceWarned.add(deckKey);
    toast(t('deck.sourceChanged'), { ms: 8000 });
  } catch { /* 圖譜建不起來就不提醒 */ }
}

/**
 * 簡報與來源筆記的狀態,用「現在」的筆記內容比對:圖譜只用來找出是哪幾篇筆記
 * (圖譜可能是稍早建的,筆記之後才在別的編輯器裡改過)。
 */
async function freshSourceStatus(key, vault, project) {
  const g = await getGraph(key);
  const rec = g.decks.get(vault.deckPath(project));
  if (!rec?.source) return null;
  const { notes } = sourceStatus(g, rec);
  vault.notesSource.refresh?.();
  const fresh = await Promise.all(notes.map(async n => ({ path: n.path, body: parseNote(await vault.notesSource.readText(n.rel), { path: n.rel }).body })));
  return { ...compareSource(rec.sourceHash, fresh), notes, rec };
}

/** 「簡報已跟上來源筆記」:更新 deck.yml 的 source_hash(只改這一行)。 */
async function markSynced(key, topicId, projectId) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const src = state.sources.get(key);
    if (!src.canWrite) return toast(t('bridge.needWrite'));
    const project = findDeck(vault, topicId, projectId);
    const st = project ? await freshSourceStatus(key, vault, project) : null;
    if (!st?.hash) return toast(t('check.sourceMissing', { source: st?.rec?.source || '' }));
    const path = `${vault.deckPath(project)}/deck.yml`;
    const expect = await src.stat(path);
    await src.writeText(path, withSourceHash(await src.readText(path), st.hash), { expect });
    invalidate(key);
    state.sourceWarned.add(`${key}/d/${topicId}/${projectId}`);
    toast(t('deck.markedSynced'));
  } catch (e) { toast(e.message === 'stale' ? t('ne.staleTitle') : e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e }), { ms: 5000 }); }
}

/** 摘錄嵌入:投影片裡的 ![[筆記#標題]] 換成筆記內容(只在有用到時才等圖譜)。 */
async function withEmbeds(key, vault, deck) {
  if (vault.kind !== 'leafpile' || !vault.notesSource) return deck;
  if (!deck.sections.some(sec => sec.slides.some(sl => sl.body?.includes('![[')))) return deck;
  try {
    const g = await getGraph(key);
    const topicId = deck.topicId;
    const missing = await expandEmbeds(deck, {
      resolve: link => { const r = g.resolver.resolve(link, { fromTopic: topicId }); return r.target?.kind === 'note' ? r.target : null; },
      readNote: async rec => splitFrontMatter(await vault.notesSource.readText(rec.rel)).body,
    });
    deck.issues.push(...missing);
  } catch (e) { console.warn('embeds', e); }
  return deck;
}

// ---------------- 橋接:升級成簡報、講後筆記 ----------------
/** 一次寫入多個新檔案(已存在就停下來,絕不覆蓋)。 */
async function writeNew(src, files) {
  for (const path of Object.keys(files)) if ((await src.stat(path)) !== null) throw new UserError(t('promote.exists', { path }));
  for (const [path, text] of Object.entries(files)) await src.writeText(path, text, { mkdir: true });
}

async function promote(key, rel) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    if (vault.kind !== 'leafpile') return toast(t('bridge.needVault'));
    const src = state.sources.get(key);
    if (!src.canWrite) return toast(t('bridge.needWrite'));
    const r = await loadNote(key, rel);
    let scope = 'note';
    if (r.book && r.book.notes.length > 1) {
      const pick = await dialog({ title: t('promote.button'), fields: [{ name: 'scope', label: t('promote.scope'), type: 'select', value: 'note', options: [{ value: 'note', label: t('promote.scopeNote') }, { value: 'book', label: t('promote.scopeBook') }] }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('dialog.ok'), value: true, primary: true }] });
      if (!pick?.value) return;
      scope = pick.fields.scope;
    }
    let result;
    if (scope === 'book') {
      const notes = await Promise.all(r.book.notes.map(async n => parseNote(await vault.notesSource.readText(n.path), { path: n.path })));
      result = promoteBook({ title: r.book.title, notes }, { source: vault.notePath(r.book.path), author: r.book.author, theme: vault.theme || 'paper', lang: notes[0]?.lang || '', tags: r.book.tags });
    } else result = promoteNote(r.note, { source: vault.notePath(rel), theme: vault.theme || 'paper' });
    const topic = r.topic.id === '_' ? '' : r.topic.id;
    if (!(await confirmDialog(t('promote.ask', { topic, folder: result.folder, sections: result.sections, slides: result.slides }), t('promote.create')))) return;
    const base = ['slides', topic, result.folder].filter(Boolean).join('/');
    await writeNew(src, Object.fromEntries(Object.entries(result.files).map(([f, text]) => [`${base}/${f}`, text])));
    invalidate(key);
    toast(t('promote.done', { path: base, sections: result.sections, slides: result.slides }), { ms: 5000 });
    location.hash = topic ? hrefs(key).deck(topic, result.folder) : hrefs(key).shelf;
  } catch (e) { toast(e instanceof UserError ? e.message : e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e }), { ms: 5000 }); }
}

async function distill(key, topicId, projectId) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    if (vault.kind !== 'leafpile') return toast(t('bridge.needVault'));
    const src = state.sources.get(key);
    if (!src.canWrite) return toast(t('bridge.needWrite'));
    const project = findDeck(vault, topicId, projectId);
    if (!project) return;
    const deck = await loadDeck(vault.slidesSource, project);
    const qaKey = `${key}/d/${topicId}/${projectId}`;
    const qa = loadQA(qaKey);
    const { file, text } = distillDeck(deck, { deckPath: vault.deckPath(project), qa });
    const ask = t('distill.ask', { topic: topicId, file }) + (qa.length ? ' ' + t('distill.withQA', { n: qa.length }) : '');
    if (!(await confirmDialog(ask, t('distill.create')))) return;
    const rel = `${topicId}/${file}`;
    await writeNew(src, { [`notes/${rel}`]: text });
    if (qa.length) saveQA(qaKey, []); // 已經寫進筆記了,下一場重新開始
    invalidate(key);
    toast(t('distill.done', { path: `notes/${rel}` }), { ms: 5000 });
    location.hash = hrefs(key).edit(rel);
  } catch (e) { toast(e instanceof UserError ? e.message : e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e }), { ms: 5000 }); }
}
window.addEventListener('leafpile:promote', e => promote(state.current.key, e.detail));

// ---------------- 指令面板(Ctrl+K / ⌘K) ----------------
async function paletteItems() {
  const { key, rel, deck } = state.current;
  const items = [];
  const act = (title, run, hint = '') => items.push({ kind: 'action', title, hint, run });
  if (key) {
    const vault = state.vaults.get(key);
    const href = hrefs(key);
    if (vault) {
      let g = null;
      try { g = await Promise.race([getGraph(key), new Promise(r => setTimeout(() => r(null), 400))]); } catch { /* 還沒建好就用目錄 */ }
      if (rel) {
        act(t('palette.flashThis'), () => { location.hash = href.flash(rel); }, 'P');
        if (vault.notesSource?.canWrite) act(t('palette.editThis'), () => { location.hash = href.edit(rel); }, 'E');
        if (vault.kind === 'leafpile' && state.sources.get(key)?.canWrite) act(t('promote.button'), () => promote(key, rel));
      }
      if (deck && vault.kind === 'leafpile' && state.sources.get(key)?.canWrite) act(t('distill.action'), () => distill(key, deck.topicId, deck.projectId));
      const project = deck && g && vault.kind === 'leafpile' ? findDeck(vault, deck.topicId, deck.projectId) : null;
      let st = null;
      try { st = project ? await freshSourceStatus(key, vault, project) : null; } catch { /* 讀不到就不顯示這兩項 */ }
      if (st?.notes.length) act(t('deck.openSource'), () => { location.hash = href.note(st.notes[0].rel); });
      if ((st?.status === 'changed' || st?.status === 'untracked') && state.sources.get(key)?.canWrite) act(t(st.status === 'changed' ? 'deck.markSynced' : 'deck.trackSource'), () => markSynced(key, deck.topicId, deck.projectId));
      if (vault.notesSource?.canWrite) act(t('palette.newNote'), () => newNote(key, rel ? findNote(vault, rel)?.topic.id : undefined));
      act(t('palette.shelf'), () => { location.hash = href.shelf; });
      act(t('palette.check'), () => runCheck(key));
      if (g) {
        for (const r of g.records) items.push(r.kind === 'note'
          ? { kind: 'note', title: r.title, hint: r.rel, search: r.search, run: () => { location.hash = href.note(r.rel); } }
          : { kind: 'deck', title: r.title, hint: r.rel, search: r.search, run: () => { location.hash = href.deck(r.topicId, r.project.id); } });
      } else {
        for (const tp of vault.topics) {
          if (tp.notes) for (const n of notesOfTopic(tp.notes)) items.push({ kind: 'note', title: n.title, hint: n.path, run: () => { location.hash = href.note(n.path); } });
          for (const p of tp.decks) items.push({ kind: 'deck', title: p.title, hint: `${tp.title} / ${p.folder}`, run: () => { location.hash = href.deck(tp.id, p.id); } });
        }
      }
    }
  }
  act(t('palette.openFolder'), () => { location.hash = '#/'; setTimeout(openFolder, 50); });
  act(t('palette.repo'), () => { location.hash = '#/repo'; });
  act(t('palette.home'), () => { location.hash = '#/'; });
  act(t('palette.lang'), toggleLang);
  return items;
}

let paletteBusy = false;
async function showPalette() {
  if (paletteBusy || document.querySelector('.lp-dialog')) return;
  paletteBusy = true;
  try {
    const items = await paletteItems();
    openPalette({ items: () => items });
  } finally { paletteBusy = false; }
}
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !location.hash.startsWith('#/presenter')) {
    e.preventDefault();
    e.stopImmediatePropagation(); // 播放器的 K 是播放影片
    showPalette();
  }
}, true);
window.addEventListener('leafpile:palette', showPalette);

// ---------------- 切換語言 ----------------
function toggleLang() {
  const next = getLang() === 'zh-Hant' ? 'en' : 'zh-Hant';
  try { localStorage.setItem(LANG_KEY, next); } catch { /* 隱私模式 */ }
  applyLang(next);
  for (const k of [...state.vaults.keys()]) { state.vaults.delete(k); state.graphs.delete(k); } // 提醒訊息是讀取時產生的,換語言要重讀
  leaveView();
  route();
}
document.addEventListener('click', e => { if (e.target.closest('.lang-toggle')) toggleLang(); });

// ---------------- 拖放資料夾 ----------------
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', async e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (state.player || state.view?.isDirty) return;
  try {
    const src = await sourceFromDrop(e.dataTransfer);
    if (src) useSession(src); else showError(new UserError(t('err.dropFolder')));
  } catch (err) { showError(err); }
});

route();

// 離線也能用:把網站本身快取起來(你的筆記與簡報不會被快取)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // updateViaCache: 'none':檢查新版時不要用瀏覽器快取(GitHub Pages 會快取 10 分鐘)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  // 新版接手後,目前這一頁還是舊程式:提示重新整理(不自動重新整理,以免打斷正在播放的簡報或編輯)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.querySelector('.update-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>${esc(t('update.ready'))}</span><button class="btn primary" data-u="reload">${esc(t('update.reload'))}</button><button class="btn ghost" data-u="later">${esc(t('update.later'))}</button>`;
    bar.addEventListener('click', e => {
      const u = e.target.closest('[data-u]')?.dataset.u;
      if (u === 'reload') location.reload();
      if (u === 'later') bar.remove();
    });
    document.body.append(bar);
  });
}
