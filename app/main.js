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
import { openPrivacyPanel } from './ui/privacy-view.js';
import { renderBoard } from './ui/canvas-view.js';
import { parseCanvas, emptyCanvas, boardFileName, textToNote, boardsWith } from './core/canvas.js';
import { auditPrivacy, visitorVault, isLocalOnly } from './core/privacy.js';
import { planLinkUpdates, retitle, renamedFile, rebaseLinks, retargetSource, dirOf } from './core/move.js';
import { checkVault } from './core/check.js';
import { escapeHTML as esc, linkKey } from './core/markdown.js';
import { HttpSource, HandleSource, FileListSource, sourceFromDrop, canPickDirectory } from './sources/sources.js';
import { listRecent, remember, getRecent, forget, ensurePermission } from './sources/store.js';
import { renderShelf } from './ui/shelf.js';
import { renderReader } from './ui/notes/reader.js';
import { renderEditor, newNoteFileName, newNoteText } from './ui/notes/editor.js';
import { openPalette } from './ui/palette.js';
import { mountSidebar, recordRecent } from './ui/sidebar.js';
import { topicDialog, previewDialog, describeChange, categoriesDialog } from './ui/topic-manage.js';
import { topicConfPath, planTopicEdit, newTopicYaml, planCategories, suggestTopicPrefix } from './core/topics.js';
import { parseYaml } from './core/yaml.js';
import { openCheckPanel } from './ui/check-view.js';
import { dialog, confirmDialog, toast } from './ui/dialog.js';
import { readZip, writeZip } from './core/zip.js';
import { fileKind, walkFiles, exportPlan, parsePackText, normalizeIncoming, planImport } from './core/pack.js';
import { packDialog, importSourceDialog, pasteDialog, previewDialog as packPreview } from './ui/pack.js';
import { buildPrompt, aiURL, assembleGenerated, AI_TARGETS } from './core/generate.js';
import { generateDialog, replyDialog } from './ui/generate.js';
import { Player } from './player/player.js';
import { noteToDeck } from './player/flash.js';
import { openExportDialog } from './player/export.js';
import { startPresenter } from './player/presenter.js';
import { loadQA, saveQA } from './player/qa-store.js';
import { applyUITheme, setUIChoice, uiChoiceNow, THEMES, themeName } from './player/themes.js';
import { readPref, writePref } from './ui/prefs.js';
import { t, setLang, getLang, normalizeLang } from './core/i18n.js';

export const VERSION = '0.10.1';
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
const THEME_KEY = 'leafpile-theme';
// 需要寫入、但瀏覽器還沒給權限,而且當下不是剛按下按鈕時:先請使用者按一下「允許」(見 HandleSource.ensureWritable)
HandleSource.askPermission = () => dialog({
  title: t('perm.writeTitle'), message: t('perm.writeText'),
  buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('perm.writeAllow'), value: true, primary: true }],
}).then(r => !!r?.value);
setUIChoice(readPref(THEME_KEY) || ''); // 「外觀」選單的選擇(只存在這個瀏覽器)

const state = {
  sources: new Map(), vaults: new Map(), graphs: new Map(), sourceWarned: new Set(), visitor: false,
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
    board: name => `${base}/b/${enc(name)}`,
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
  if (mode === 'b' && a) return leaveView(), showBoard(key, a);
  // Mdslide Pile 的舊網址:#/<書庫>/<主題>/<簡報>/<第幾張>
  if (mode && a && !['n', 'e', 'f', 'd', 'go', 'b'].includes(mode)) return location.replace(hrefs(key).deck(mode, a, b, c === 'read'));
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

// ---------------- 主題管理(設定類) ----------------
// 只改 _topic.yml 與 _site.yml;每次都先預覽,寫入後可以復原(把原本的內容寫回去)。

/** _site.yml 裡的分類(包含還沒有主題的)。 */
function siteCategories(vault) {
  const list = vault.site?.categories;
  return Array.isArray(list) ? list.filter(c => c && c.id != null).map(c => ({ id: String(c.id), name: String(c.name ?? c.id), color: c.color ? String(c.color) : '' })) : [];
}

/** 讀檔(不存在回空字串)與它目前的狀態(寫入時用來確認沒被別人改過)。 */
async function readForEdit(src, path) {
  const stat = await src.stat(path);
  return { stat, text: stat == null ? '' : await src.readText(path) };
}

/** 寫入,完成後重新讀書庫;原本有檔案的話,提示上放「復原」。 */
async function writeConfig(key, path, before, text, doneMsg) {
  const src = state.sources.get(key);
  let after;
  try {
    after = await src.writeText(path, text, { expect: before.stat, mkdir: before.stat == null });
  } catch (e) {
    toast(t(String(e.message) === 'stale' ? 'tm.stale' : 'tm.writeFailed', { path }), { ms: 6000 });
    return false;
  }
  invalidate(key);
  const undo = before.stat == null ? [] : [{
    label: t('tm.undo'),
    run: async () => {
      try { await src.writeText(path, before.text, { expect: after }); invalidate(key); route(); toast(t('tm.undone')); }
      catch { toast(t('tm.undoFailed', { path }), { ms: 6000 }); }
    },
  }];
  toast(doneMsg, { ms: 8000, actions: undo });
  route();
  return true;
}

async function editTopic(key, id) {
  const vault = await getVault(key);
  const src = state.sources.get(key);
  if (!vault || !src?.canWrite) return toast(t('ne.readonly'));
  const tp = vault.topics.find(x => x.id === id);
  if (!tp) return;
  const path = topicConfPath(id);
  const before = await readForEdit(src, path);
  const conf = (before.text && parseYaml(before.text)) || {};
  const cats = siteCategories(vault);
  let last = null;
  for (;;) {
    const v = await topicDialog({ mode: 'edit', id, conf: last ? { ...conf, ...last, name: last.name } : conf, title: last?.name ?? tp.title, categories: cats });
    if (!v) return;
    last = v;
    const plan = planTopicEdit(before.text, v, id);
    if (!plan.changes.length) return toast(t('tm.noChange'));
    const ok = await previewDialog({ title: t('tm.previewTitle'), path, lines: plan.changes.map(c => describeChange(c, cats)), note: before.stat == null ? t('tm.willCreate') : t('tm.noLinks') });
    if (ok) return writeConfig(key, path, before, plan.text, t('tm.saved', { path }));
  }
}

async function newTopic(key) {
  const vault = await getVault(key);
  const src = state.sources.get(key);
  if (!vault || !src?.canWrite || !vault.notesSource) return toast(t('ne.readonly'));
  const ids = vault.topics.map(tp => tp.id).filter(x => x !== '_');
  const cats = siteCategories(vault);
  const v = await topicDialog({ mode: 'new', categories: cats, ids, prefix: suggestTopicPrefix(ids), title: '' });
  if (!v) return;
  const path = topicConfPath(v.id);
  const text = newTopicYaml(v);
  const lines = [t('tm.newFolder', { path: `notes/${v.id}/` }), ...text.trim().split('\n')];
  if (!(await previewDialog({ title: t('tm.previewNew'), path, lines, note: t('tm.newNote'), ok: t('tm.create') }))) return;
  if ((await src.stat(path)) != null) return toast(t('move.exists'));
  return writeConfig(key, path, { stat: null, text: '' }, text, t('tm.created', { name: v.name }));
}

async function editCategories(key) {
  const vault = await getVault(key);
  const src = state.sources.get(key);
  if (!vault || !src?.canWrite) return toast(t('ne.readonly'));
  const path = '_site.yml';
  const before = await readForEdit(src, path);
  const used = new Map();
  for (const tp of vault.topics) if (tp.category) used.set(tp.category, (used.get(tp.category) || 0) + 1);
  let current = siteCategories(vault);
  for (;;) {
    const next = await categoriesDialog({ categories: current, used });
    if (!next) return;
    current = next;
    const plan = planCategories(before.text, next, vault.topics);
    if (plan.blocked.length) { toast(t('tm.catBlocked', { names: plan.blocked.map(b => b.id).join(', ') }), { ms: 6000 }); continue; }
    if (!plan.changes.length) return toast(t('tm.noChange'));
    const name = id => next.find(c => c.id === id)?.name || id;
    const lines = plan.changes.map(c => c.type === 'order' ? t('tm.catOrder', { list: c.ids.map(name).join(' \u2192 ') })
      : c.type === 'add' ? t('tm.catAdded', { name: c.name, id: c.id })
      : c.type === 'remove' ? t('tm.catRemoved', { name: c.name })
      : c.type === 'rename' ? t('tm.catRenamed', { from: c.from, to: c.to })
      : t('tm.catRecolor', { name: c.name, to: c.to || t('tm.unset') }));
    const note = [t('tm.catNote'), plan.lostComments ? t('tm.lostComments', { n: plan.lostComments }) : ''].filter(Boolean).join(' ');
    if (await previewDialog({ title: t('tm.previewCats'), path, lines, note })) return writeConfig(key, path, before, plan.text, t('tm.saved', { path }));
  }
}

// ---------------- 側邊欄 ----------------
/** 掛上書庫導覽;訪客視角時只列會公開的筆記(等圖譜建好再填內容)。 */
function sideFor(key, vault, current, context) {
  const shown = state.visitor && vault.kind === 'leafpile'
    ? getGraph(key).then(g => visitorVault(vault, visibleTo(g, vault)))
    : vault;
  return mountSidebar(app, {
    lib: key, vault: shown, boards: (vault.boards || []).map(b => b.name), href: hrefs(key),
    current, context, onSearch: () => showPalette(),
    graph: vault.kind === 'leafpile' ? getGraph(key).catch(() => null) : null,
  });
}

/** 讓畫面的 cleanup 也卸下側邊欄。 */
function withSide(view, off) {
  if (!view || !off) return view;
  const prev = view.cleanup;
  view.cleanup = () => { off(); prev?.call(view); };
  return view;
}

// ---------------- 共用畫面 ----------------
function header(active = '') {
  return `<header class="topbar">
    <a class="brand" href="#/"><span class="logo leaf" aria-hidden="true"><i></i><i></i><i></i></span>Leafpile<small>${esc(t('brand.zh'))}</small></a>
    <nav>
      <a href="#/repo" class="${active === 'repo' ? 'on' : ''}">${t('nav.repo')}</a>
      <a href="#/" class="${active === 'home' ? 'on' : ''}">${t('nav.home')}</a>
      <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
      <span class="theme-menu"><button class="theme-toggle" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t('theme.menu'))}" title="${esc(t('theme.menu'))}"><i class="sw" aria-hidden="true"></i></button></span>
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
            <button class="btn ghost open-zip" title="${esc(t('home.openZipTitle'))}">${t('home.openZip')}</button>
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
  app.querySelector('.open-zip').onclick = async () => { const f = (await pickFiles({ accept: '.zip,application/zip' }))?.[0]; if (f) openZip(f); };
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
    let shown = vault, graph = vault.kind === 'leafpile' ? getGraph(key) : null;
    if (state.visitor && graph) {
      // 訪客視角:只留會公開的筆記;搜尋也只搜得到它們
      const g = await graph;
      const ok = visibleTo(g, vault);
      shown = visitorVault(vault, ok);
      const notes = new Map([...g.notes].filter(([, n]) => ok(n.rel)));
      graph = Promise.resolve({ ...g, notes, records: g.records.filter(r => r.kind !== 'note' || notes.has(r.path)) });
    }
    state.view = {
      cleanup: renderShelf(app, {
        vault: shown, sourceKey: key, href,
        header: header(key === 'repo' ? 'repo' : 'home'),
        graph,
        onPrivacy: vault.kind === 'leafpile' ? () => runPrivacy(key) : null,
        onNewBoard: vault.kind === 'leafpile' && source.canWrite ? () => newBoard(key) : null,
        onRefresh: key === 'repo' ? null : () => { invalidate(key); showShelf(key); },
        onCheck: () => runCheck(key),
        onPack: vault.kind === 'leafpile' && !state.visitor ? () => packMenu(key) : null,
        onGenerate: vault.kind === 'leafpile' && source.canWrite && !state.visitor ? () => generateFlow(key) : null,
        onNewNote: vault.notesSource?.canWrite ? () => newNote(key) : null,
        onTopicEdit: vault.kind === 'leafpile' && source.canWrite ? id => editTopic(key, id) : null,
        onTopicNew: vault.kind === 'leafpile' && source.canWrite && vault.notesSource ? () => newTopic(key) : null,
        onCategories: vault.kind === 'leafpile' && source.canWrite ? () => editCategories(key) : null,
      }),
    };
    withSide(state.view, mountSidebar(app, { lib: key, vault: shown, boards: (vault.boards || []).map(b => b.name), href, current: { type: 'shelf' }, context: 'shelf', onSearch: () => showPalette(), graph: graph?.catch(() => null) }));
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

// ---------------- 畫布 ----------------
async function showBoard(key, name) {
  loading(t('loading.library'));
  try {
    const vault = await getVault(key);
    if (!vault) return;
    applyUITheme(vault.theme || 'paper');
    const info = (vault.boards || []).find(b => b.name === name);
    if (!info) throw new UserError(t('board.notFound', { name }));
    const src = state.sources.get(key);
    src.refresh?.();
    const text = await src.readText(info.path);
    let board;
    try { board = parseCanvas(text); } catch (e) { throw new UserError(t('check.boardBroken', { error: e.message })); }
    let expect = src.canWrite ? await src.stat(info.path) : null;
    const graph = getGraph(key);
    const g = await graph.catch(() => null);
    const choices = g ? [
      ...[...g.notes.values()].map(n => ({ value: 'n:' + n.path, file: n.path, label: `${t('board.kindNote')} · ${vault.topics.find(tp => tp.id === n.topicId)?.title || ''} › ${n.title}` })),
      ...[...g.decks.values()].map(d => ({ value: 'd:' + d.path, file: `${d.path}/deck.yml`, deck: true, label: `${t('board.kindDeck')} · ${vault.topics.find(tp => tp.id === d.topicId)?.title || ''} › ${d.title}` })),
    ] : [];
    state.view = renderBoard(app, {
      board, name, header: header(key === 'repo' ? 'repo' : 'home'), href: hrefs(key), graph, choices, source: src,
      colorOf: id => vault.topics.find(tp => tp.id === id)?.color || '',
      save: src.canWrite ? async text => { expect = await src.writeText(info.path, text, { expect }); } : null,
      toNote: src.canWrite && vault.notesSource?.canWrite ? text => boardTextToNote(key, text) : null,
      reloadGraph: async () => { await getVault(key); return getGraph(key); },
    });
    withSide(state.view, sideFor(key, vault, { type: 'b', id: name, title: name }, 'board'));
    document.title = `${name} · Leafpile`;
  } catch (e) { showError(e, keyBase(key)); }
}

/** 畫布的文字卡轉成筆記:選主題,建立新筆記,回傳路徑(notes/…)讓卡片換成筆記卡。 */
async function boardTextToNote(key, text) {
  try {
    const vault = await getVault(key);
    const { title, body } = textToNote(text);
    const topics = vault.notes.topics.filter(tp => tp.id !== '_');
    const def = (topics.find(tp => /inbox/i.test(tp.id)) || topics[0])?.id || '';
    const r = await dialog({
      title: t('board.toNote'), message: t('board.toNoteHint'),
      fields: [{ name: 'title', label: t('newNote.name'), value: title }, { name: 'topic', label: t('newNote.topic'), type: 'select', value: def, options: [...topics.map(tp => ({ value: tp.id, label: tp.title })), { value: '', label: t('notes.unfiled') }] }],
      buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('newNote.create'), value: true, primary: true }],
    });
    if (!r?.value) return null;
    const name = String(r.fields.title || '').trim();
    if (!name) { toast(t('newNote.needTitle')); return null; }
    const rel = [r.fields.topic, newNoteFileName(name)].filter(Boolean).join('/');
    if ((await vault.notesSource.stat(rel)) != null) { toast(t('move.exists')); return null; }
    await vault.notesSource.writeText(rel, newNoteText(name) + (body ? body + '\n' : ''), { mkdir: true, expect: null });
    invalidate(key); // 書庫目錄也要重讀,新筆記才找得到
    toast(t('board.toNoteDone', { path: rel }), { ms: 5000 });
    return vault.notePath(rel);
  } catch (e) { noteErr(e); return null; }
}

/** 這篇筆記出現在哪些畫布(筆記頁右側欄用)。 */
async function boardsOfNote(key, rel) {
  const vault = await getVault(key);
  const src = state.sources.get(key);
  const boards = await Promise.all((vault.boards || []).map(async b => {
    try { return { name: b.name, board: parseCanvas(await src.readText(b.path)) }; } catch { return null; }
  }));
  return boardsWith(boards.filter(Boolean), vault.notePath(rel));
}

async function newBoard(key) {
  try {
    const vault = await getVault(key);
    const src = state.sources.get(key);
    if (!src?.canWrite) return toast(t('ne.readonly'));
    const r = await dialog({ title: t('board.newTitle'), fields: [{ name: 'name', label: t('board.newName'), placeholder: t('board.newPlaceholder') }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('board.create'), value: true, primary: true }] });
    if (!r?.value) return;
    const file = boardFileName(r.fields.name || '');
    const name = file.replace(/\.canvas$/, '');
    if ((vault.boards || []).some(b => b.name === name) || (await src.stat(`boards/${file}`)) != null) return toast(t('move.exists'));
    await src.writeText(`boards/${file}`, emptyCanvas(), { mkdir: true, expect: null });
    invalidate(key);
    location.hash = hrefs(key).board(name);
  } catch (e) { noteErr(e); }
}

/** 訪客看不看得到這篇:公開、而且不在只留本機的主題。 */
const visibleTo = (g, vault) => rel => { const r = g.notes.get(vault.notePath(rel)); return !!r && r.public && !r.localOnly; };

/** 發布前檢查:重新讀每篇筆記與每張投影片(不用圖譜裡可能過時的內容)。 */
function runPrivacy(key) {
  openPrivacyPanel(document.body, async () => {
    const vault = await getVault(key);
    state.sources.get(key)?.refresh?.();
    state.graphs.delete(key);
    const g = await getGraph(key);
    const src = state.sources.get(key);
    const items = await Promise.all([...g.notes.values()].map(async n => ({
      rel: n.rel, title: n.title, public: n.public, localOnly: n.localOnly, text: await vault.notesSource.readText(n.rel).catch(() => ''),
    })));
    const localTopics = new Set(vault.topics.filter(tp => isLocalOnly(tp.conf) || isLocalOnly(tp.notes?.conf)).map(tp => tp.id));
    for (const d of g.decks.values()) {
      for (const path of await mdFilesUnder(src, d.path)) {
        items.push({ kind: 'slide', rel: path, title: d.title, public: false, localOnly: localTopics.has(d.topicId), text: await src.readText(path).catch(() => '') });
      }
    }
    return auditPrivacy(items);
  }, { href: hrefs(key), visitor: state.visitor, onVisitor: on => setVisitor(on) });
}

/** 訪客視角開關:畫面下方一直有提示條,可以隨時結束。 */
function setVisitor(on) {
  state.visitor = on;
  document.querySelector('.visitor-bar')?.remove();
  document.body.classList.toggle('visitor', on);
  if (on) {
    const bar = document.createElement('div');
    bar.className = 'visitor-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>👁 ${esc(t('privacy.visitorBar'))}</span><button class="btn ghost">${esc(t('privacy.visitorOff'))}</button>`;
    bar.querySelector('button').onclick = () => setVisitor(false);
    document.body.append(bar);
  }
  route();
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
    if (state.visitor && r.vault.kind === 'leafpile' && !visibleTo(await getGraph(key), r.vault)(rel)) {
      app.innerHTML = `${header(key === 'repo' ? 'repo' : 'home')}<main class="hidden-note"><h1>${esc(t('privacy.hiddenTitle'))}</h1><p>${esc(t('privacy.hiddenText'))}</p><p><a class="btn ghost" href="${hrefs(key).shelf}">${esc(t('nav.backShelf'))}</a></p></main>`;
      state.view = null;
      return;
    }
    state.view = {
      cleanup: renderReader(app, {
        vault: r.vault, rel, note: r.note, topic: r.topic, book: r.book, heading,
        header: header(key === 'repo' ? 'repo' : 'home'),
        href: hrefs(key), graph: getGraph(key),
        canEdit: !!r.vault.notesSource.canWrite || r.vault.notesSource.kind === 'repo',
        canPromote: !!state.sources.get(key)?.canWrite,
        boards: r.vault.boards?.length ? boardsOfNote(key, rel) : null,
      }),
    };
    withSide(state.view, sideFor(key, r.vault, { type: 'n', id: rel, title: r.note.title }, 'note'));
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
    await vault.notesSource.writeText(rel, newNoteText(title), { expect: null });
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
    recordRecent(key, { t: 'd', id: `${topicId}/${projectId}`, title: project.title || projectId });
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
    remindSource(key, vault, project, deckKey, topicId);
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
async function remindSource(key, vault, project, deckKey, topicId) {
  if (vault.kind !== 'leafpile' || project.config?.source_hash == null || state.sourceWarned.has(deckKey)) return;
  try {
    const st = await freshSourceStatus(key, vault, project);
    if (st?.status !== 'changed' || state.playerKey !== deckKey) return;
    state.sourceWarned.add(deckKey);
    const actions = [];
    if (st.notes.length) actions.push({ label: t('deck.openSourceShort'), run: () => { location.hash = hrefs(key).note(st.notes[0].rel); } });
    if (state.sources.get(key)?.canWrite) actions.push({ label: t('deck.markSyncedShort'), run: () => markSynced(key, topicId, project.id) });
    toast(t('deck.sourceChanged'), { ms: 15000, actions });
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
  for (const [path, text] of Object.entries(files)) await src.writeText(path, text, { mkdir: true, expect: null });
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

// ---------------- 筆記的改名、搬移、封存(docs/INTEROP.md 第 7 節) ----------------

const noteErr = e => toast(e instanceof UserError ? e.message
  : e.message === 'denied' ? t('ne.denied') : e.message === 'stale' ? t('ne.staleTitle') : e.message === 'exists' ? t('move.exists')
  : t('ne.saveFailed', { error: e.message || e }), { ms: 6000 });

/** 所有 .md(遞迴),給簡報資料夾用:找出哪幾張投影片連到這篇。 */
async function mdFilesUnder(src, dir) {
  const out = [];
  for (const e of await src.list(dir).catch(() => [])) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === 'dir' && !e.name.startsWith('_') && !e.name.startsWith('.')) out.push(...(await mdFilesUnder(src, p)));
    else if (e.kind === 'file' && /\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** 搬移的目的地:主題資料夾與筆記本資料夾。 */
function noteFolders(vault) {
  const out = [];
  for (const tp of vault.notes.topics) {
    out.push({ value: tp.path, label: tp.id === '_' ? t('notes.unfiled') : tp.title });
    for (const b of tp.items.filter(i => i.kind === 'book')) out.push({ value: b.path, label: `${tp.id === '_' ? '' : tp.title} › ${b.title}` });
  }
  return out;
}

/** 改名(mode = 'rename')或搬到別的資料夾(mode = 'move'),並更新連到這篇的 [[連結]]。 */
async function relocateNote(key, rel, mode) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const src = state.sources.get(key), notes = vault.notesSource;
    if (!src?.canWrite || !notes?.move) return toast(t('ne.readonly'));
    const r = await loadNote(key, rel);
    const name = rel.split('/').pop(), from0 = dirOf(rel);
    const ask = mode === 'rename'
      ? await dialog({ title: t('move.renameTitle'), message: t('move.renameHint'), fields: [{ name: 'title', label: t('move.newTitle'), value: r.note.title }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('move.next'), value: true, primary: true }] })
      : await dialog({ title: t('move.moveTitle'), message: t('move.moveHint'), fields: [{ name: 'dir', label: t('move.dest'), type: 'select', value: from0, options: noteFolders(vault) }], buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('move.next'), value: true, primary: true }] });
    if (!ask?.value) return;
    const title = mode === 'rename' ? String(ask.fields.title || '').trim() : r.note.title;
    const dir = mode === 'move' ? ask.fields.dir : from0;
    if (!title) return toast(t('newNote.needTitle'));
    const toRel = [dir, title === r.note.title ? name : renamedFile(name, title)].filter(Boolean).join('/');
    if (toRel === rel && title === r.note.title) return toast(t('move.nothing'));

    // 用最新的檔案建圖譜:改名前看到的連結一定要是現在的
    state.graphs.delete(key);
    const g = await getGraph(key);
    const from = g.notes.get(vault.notePath(rel));
    if (!from) throw new UserError(t('err.noNote', { path: rel }));
    const topicOf = p => p.split('/')[1] || '_';
    const toTopic = dir.split('/')[0] || '_';
    const to = { path: vault.notePath(toRel), rel: toRel, topicId: toTopic, title };

    // 可能連到這篇的檔案:反向連結裡的筆記,與簡報資料夾裡的每一張投影片
    const files = [], stats = new Map(), seen = new Set();
    const addFile = async path => {
      if (seen.has(path) || path === from.path) return;
      seen.add(path);
      const [text, st] = await Promise.all([src.readText(path), src.stat(path)]);
      files.push({ path, text, topicId: topicOf(path) });
      stats.set(path, st);
    };
    const refs = g.backlinks.get(from.path) || [];
    for (const b of refs) {
      if (b.from.kind === 'note') await addFile(b.from.path);
      else for (const p of await mdFilesUnder(src, b.from.path)) await addFile(p);
    }
    const plan = planLinkUpdates({ records: g.records, files, from, to });
    // 升級來源:deck.yml 的 source 指到這篇
    const ymls = [];
    for (const d of g.decks.values()) {
      if (!d.source) continue;
      const path = `${d.path}/deck.yml`;
      const text = await src.readText(path).catch(() => null);
      const next = text != null && retargetSource(text, from.path, to.path);
      if (next) { ymls.push({ path, text: next }); stats.set(path, await src.stat(path)); }
    }
    const noteText = rebaseLinks(title === r.note.title ? r.text : retitle(r.text, title, r.note.title), from0, dir);

    const changed = [...plan.edits.map(e => e.path), ...ymls.map(y => y.path)];
    const lines = [
      t(mode === 'rename' ? 'move.summaryRename' : 'move.summaryMove', { from: rel, to: toRel, title }),
      plan.count || ymls.length ? t('move.summaryLinks', { links: plan.count, files: changed.length }) : t('move.summaryNoLinks'),
      ...changed.slice(0, 8).map(p => '· ' + p),
      ...(changed.length > 8 ? [t('move.andMore', { n: changed.length - 8 })] : []),
    ];
    if (!(await confirmDialog(lines.join('\n'), t(mode === 'rename' ? 'move.doRename' : 'move.doMove')))) return;

    // 先搬筆記本身(失敗就什麼都沒改),再改其他檔案
    const done = await notes.move(rel, toRel, noteText, { expect: await notes.stat(rel) });
    const failed = [];
    for (const e of [...plan.edits, ...ymls]) {
      try { await src.writeText(e.path, e.text, { expect: stats.get(e.path) }); } catch (err) { failed.push(`${e.path}(${err.message})`); }
    }
    invalidate(key);
    if (failed.length) toast(t('move.partial', { n: failed.length, files: failed.join('、') }), { ms: 12000 });
    else toast(t('move.done', { path: done, links: plan.count }), { ms: 5000 });
    location.hash = hrefs(key).note(done);
  } catch (e) { noteErr(e); }
}

/** 封存:搬到 _archive/notes/(不刪除)。連到它的連結不改,檢查工具會列出。 */
async function archiveNote(key, rel) {
  try {
    const vault = await getVault(key);
    if (!vault) return;
    const notes = vault.notesSource;
    if (!notes?.canWrite || !notes.archive) return toast(t('ne.readonly'));
    const g = await getGraph(key);
    const refs = (g.backlinks.get(vault.notePath(rel)) || []).map(b => b.from.title);
    const msg = [t('move.archiveAsk', { path: rel }), ...(refs.length ? [t('move.archiveRefs', { n: refs.length }), ...refs.slice(0, 8).map(x => '· ' + x)] : [])];
    if (!(await confirmDialog(msg.join('\n'), t('move.doArchive')))) return;
    const to = await notes.archive(rel);
    invalidate(key);
    toast(t('move.archived', { path: to }), { ms: 6000 });
    location.hash = hrefs(key).shelf;
  } catch (e) { noteErr(e); }
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
window.addEventListener('leafpile:note-action', e => {
  const { action, rel } = e.detail, key = state.current.key;
  if (action === 'archive') archiveNote(key, rel); else relocateNote(key, rel, action);
});

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
      if (vault.kind === 'leafpile') act(t('privacy.title'), () => runPrivacy(key));
      for (const b of vault.boards || []) act(t('board.open', { name: b.name }), () => { location.hash = href.board(b.name); });
      if (vault.kind === 'leafpile' && state.sources.get(key)?.canWrite) act(t('board.newTitle'), () => newBoard(key));
      if (vault.kind === 'leafpile') act(t(state.visitor ? 'privacy.visitorOff' : 'privacy.visitorOn'), () => setVisitor(!state.visitor));
      const project = deck && g && vault.kind === 'leafpile' ? findDeck(vault, deck.topicId, deck.projectId) : null;
      let st = null;
      try { st = project ? await freshSourceStatus(key, vault, project) : null; } catch { /* 讀不到就不顯示這兩項 */ }
      if (st?.notes.length) act(t('deck.openSource'), () => { location.hash = href.note(st.notes[0].rel); });
      if ((st?.status === 'changed' || st?.status === 'untracked') && state.sources.get(key)?.canWrite) act(t(st.status === 'changed' ? 'deck.markSynced' : 'deck.trackSource'), () => markSynced(key, deck.topicId, deck.projectId));
      if (vault.notesSource?.canWrite) act(t('palette.newNote'), () => newNote(key, rel ? findNote(vault, rel)?.topic.id : undefined));
      if (vault.kind === 'leafpile' && state.sources.get(key)?.canWrite) act(t('palette.generate'), () => generateFlow(key));
      if (vault.kind === 'leafpile') act(t('palette.pack'), () => packMenu(key));
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
  act(t('palette.theme'), () => {
    const list = ['', ...THEMES], next = list[(list.indexOf(uiChoiceNow()) + 1) % list.length];
    chooseTheme(next);
    toast(t('theme.now', { name: next ? themeName(next) : t('theme.auto') }));
  });
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

// ---------------- 外觀(介面主題) ----------------
// 只影響書庫、筆記、畫布等介面;簡報照自己的 deck.yml。選擇存在這個瀏覽器,不寫進書庫。
function chooseTheme(name) {
  writePref(THEME_KEY, name || null);
  setUIChoice(name);
  document.querySelectorAll('.theme-pop [role=menuitemradio]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themePick === (name || ''))));
}
function closeThemeMenu() {
  document.querySelector('.theme-pop')?.remove();
  document.querySelectorAll('.theme-toggle[aria-expanded=true]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function openThemeMenu(btn) {
  closeThemeMenu();
  const cur = uiChoiceNow();
  const item = (id, label) => `<button role="menuitemradio" aria-checked="${cur === id}" data-theme-pick="${esc(id)}"><i class="sw" ${id ? `data-theme="${esc(id)}"` : 'data-auto'} aria-hidden="true"></i>${esc(label)}</button>`;
  const pop = document.createElement('div');
  pop.className = 'theme-pop';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', t('theme.menu'));
  pop.innerHTML = item('', t('theme.auto')) + THEMES.map(id => item(id, themeName(id))).join('') + `<p>${esc(t('theme.hint'))}</p>`;
  btn.parentElement.append(pop);
  btn.setAttribute('aria-expanded', 'true');
  pop.querySelector('[aria-checked=true]')?.focus();
}
document.addEventListener('click', e => {
  const btn = e.target.closest('.theme-toggle');
  if (btn) return btn.getAttribute('aria-expanded') === 'true' ? closeThemeMenu() : openThemeMenu(btn);
  const pick = e.target.closest('[data-theme-pick]');
  if (pick) { chooseTheme(pick.dataset.themePick); return closeThemeMenu(); }
  if (!e.target.closest('.theme-pop')) closeThemeMenu();
});
document.addEventListener('keydown', e => {
  const pop = document.querySelector('.theme-pop');
  if (!pop) return;
  if (e.key === 'Escape') { e.stopPropagation(); const b = pop.parentElement.querySelector('.theme-toggle'); closeThemeMenu(); b?.focus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...pop.querySelectorAll('[role=menuitemradio]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }
}, true);

// ---------------- 書庫包:匯出、匯入、直接開 zip ----------------
// 規則在 core/pack.js(哪些檔案、怎麼合併),這裡負責讀寫檔案、下載與復原。

const readLibraryFile = (src, path) => (fileKind(path) === 'binary' ? src.readBytes(path) : src.readText(path));

function downloadBytes(bytes, name, type = 'application/zip') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const packName = (title, publicOnly) => `${String(title || 'leafpile').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'leafpile'}-${new Date().toISOString().slice(0, 10)}${publicOnly ? '-public' : ''}.zip`;
const packError = e => (e instanceof UserError ? e.message : /^zip:/.test(e?.message || '') ? t('pack.zipError') : e?.message === 'denied' ? t('ne.denied') : t('pack.failed', { error: e?.message || e }));

/** 選一個檔案(或資料夾裡的所有檔案)。取消就回傳 null。 */
function pickFiles({ accept = '', dir = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (dir) { input.webkitdirectory = true; input.multiple = true; }
    input.addEventListener('change', () => resolve(input.files?.length ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

async function zipToFiles(file) {
  const { files, skipped } = await readZip(new Uint8Array(await file.arrayBuffer()));
  return { files: [...files, ...skipped.map(s => ({ path: s.path, data: '' }))], label: file.name };
}

async function packMenu(key) {
  const src = state.sources.get(key);
  const choice = await packDialog({ canImport: !!src?.canWrite });
  if (choice === 'import') return importPack(key);
  if (choice) return exportPack(key, choice === 'public');
}

async function exportPack(key, publicOnly) {
  try {
    const vault = await getVault(key);
    const src = state.sources.get(key);
    toast(t('pack.exporting'));
    const graph = publicOnly ? await getGraph(key) : null;
    const { include, skipped } = exportPlan(await walkFiles(src), { vault, graph, publicOnly });
    if (!include.length) return toast(t('pack.empty'));
    const entries = [];
    for (const path of include) entries.push({ path, data: await readLibraryFile(src, path) });
    downloadBytes(await writeZip(entries), packName(vault.title, publicOnly));
    const priv = skipped.filter(s => s.reason === 'private').length;
    toast(t(publicOnly ? 'pack.exportedPublic' : 'pack.exported', { n: include.length, priv }), {
      ms: 9000, actions: publicOnly ? [{ label: t('privacy.button'), run: () => runPrivacy(key) }] : [],
    });
  } catch (e) { toast(packError(e), { ms: 7000 }); }
}

async function importPack(key) {
  try {
    const how = await importSourceDialog();
    if (!how) return;
    let got = null;
    if (how === 'text') {
      const text = await pasteDialog();
      if (text == null) return;
      const files = parsePackText(text);
      if (!files.length) throw new UserError(t('pack.noFilesInText'));
      got = { files, label: t('pack.labelText') };
    } else if (how === 'zip') {
      const f = (await pickFiles({ accept: '.zip,application/zip' }))?.[0];
      if (!f) return;
      got = await zipToFiles(f);
    } else {
      got = await pickFolderFiles();
      if (!got) return;
    }
    await importFiles(key, got.files, got.label);
  } catch (e) { toast(packError(e), { ms: 8000 }); }
}

/** 選一個資料夾來匯入:Chrome/Edge 用資料夾選擇器;其他瀏覽器用 <input webkitdirectory>。只讀書庫會用到的檔案。 */
async function pickFolderFiles() {
  let src, label;
  if (canPickDirectory()) {
    let h;
    try { h = await window.showDirectoryPicker({ id: 'leafpile-import', mode: 'read' }); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    src = new HandleSource(h); label = h.name;
  } else {
    const list = await pickFiles({ dir: true });
    if (!list) return null;
    src = FileListSource.fromInput(list); label = src.label;
  }
  const raw = await walkFiles(src);
  const paths = normalizeIncoming(raw.map(path => ({ path, data: '' }))); // 順序不變,只去掉外層資料夾
  const files = [];
  for (let i = 0; i < paths.length; i++) {
    const keep = fileKind(paths[i].path) && !/^_archive\//.test(paths[i].path);
    files.push({ path: paths[i].path, data: keep ? await readLibraryFile(src, raw[i]) : '' });
  }
  return { files, label };
}

/** 規劃 → 預覽 → 寫入 → 可以復原。絕不覆蓋既有檔案(見 core/pack.js)。 */
async function importFiles(key, files, label) {
  const src = state.sources.get(key);
  if (!src?.canWrite) return toast(t('ne.readonly'));
  const plan = await planImport(normalizeIncoming(files), {
    exists: async p => (await src.stat(p)) != null,
    read: p => readLibraryFile(src, p),
  });
  if (!(await packPreview(plan, { label }))) return;
  const written = [], failed = [];
  let siteOld = null;
  for (const it of plan.items) {
    if (!['add', 'rename', 'merge'].includes(it.action)) continue;
    try {
      if (it.action === 'merge') {
        await src.writeText(it.path, it.data, { expect: await src.stat(it.path) });
        siteOld = it.old;
      } else if (it.kind === 'binary') {
        await src.writeFile(it.path, it.data, { expect: null });
        written.push(it.path);
      } else {
        await src.writeText(it.path, it.data, { mkdir: true, expect: null });
        written.push(it.path);
      }
    } catch (e) {
      failed.push(`${it.path}(${packError(e)})`);
      if (e.message === 'denied') break;
    }
  }
  invalidate(key);
  route();
  const d = new Date(), two = x => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`; // 本地時間
  const undo = async () => {
    let n = 0, site = false;
    for (const p of written) {
      try { await src.archive(p, ['_archive', `import-${stamp}`, ...p.split('/').slice(0, -1)].join('/')); n++; } catch { /* 已經被移走或改過:略過 */ }
    }
    if (siteOld != null) { try { await src.writeText('_site.yml', siteOld); site = true; } catch { /* 略過 */ } }
    invalidate(key); route();
    toast([n ? t('pack.undone', { n, dir: `_archive/import-${stamp}` }) : '', site ? t('pack.siteRestored') : ''].filter(Boolean).join(' '), { ms: 7000 });
  };
  const done = written.length + (siteOld != null ? 1 : 0);
  if (failed.length) await dialog({ title: t('pack.someFailed', { n: failed.length }), list: failed, buttons: [{ label: t('dialog.ok'), value: true, primary: true }] });
  if (done) toast(t('pack.imported', { n: done }), { ms: 15000, actions: [{ label: t('tm.undo'), run: undo }, { label: t('lib.check'), run: () => runCheck(key) }] });
}

/** 首頁「開啟 zip 書庫包」或把 zip 拖進來:任何瀏覽器都能看(唯讀)。 */
async function openZip(file) {
  try {
    const { files } = await zipToFiles(file);
    const list = normalizeIncoming(files.filter(f => typeof f.data !== 'string')); // 略過的項目(data 是 '')不放
    const name = file.name.replace(/\.zip$/i, '');
    useSession(new FileListSource(list.map(f => ({ file: new File([f.data], f.path.split('/').pop()), path: f.path })), name));
  } catch (e) { showError(new UserError(packError(e))); }
}

// ---------------- 用 AI 生成(筆記、簡報、畫布) ----------------
// 填資料 → 複製提示詞並開啟 AI → 貼回回覆 → 組成檔案(core/generate.js)→ 匯入預覽(importFiles)。
async function generateFlow(key) {
  try {
    const vault = await getVault(key);
    const topics = vault.topics.filter(tp => tp.id !== '_' && tp.notes).map(tp => ({ id: tp.id, title: tp.title }));
    const g = await generateDialog({ topics });
    if (!g) return;
    const newTopic = !g.topicId;
    const topicId = g.topicId || '01-inbox';
    const topicName = newTopic ? t('gen.inboxName') : vault.topics.find(tp => tp.id === topicId)?.title || topicId;
    const prompt = buildPrompt({ kind: g.kind, title: g.title, topic: topicName, extra: g.extra, data: g.data });
    let copied = false;
    try { await navigator.clipboard.writeText(prompt); copied = true; } catch { /* 沒有權限:下一步的方框裡可以手動複製 */ }
    const target = AI_TARGETS.find(a => a.id === g.target);
    if (target) window.open(aiURL(target.id, prompt), '_blank', 'noopener');
    toast(t(copied ? 'gen.copied' : 'gen.copyFailed'), { ms: copied ? 3000 : 7000 });
    const reply = await replyDialog({ prompt, opened: target?.name || '' });
    if (reply == null) return;
    const files = assembleGenerated({ kind: g.kind, text: reply, title: g.title, topicId, topicName, newTopic, theme: vault.theme || 'paper', lang: getLang() });
    if (!files.length) return toast(t('gen.empty'), { ms: 6000 });
    await importFiles(key, files, t('gen.labelAI'));
  } catch (e) { toast(packError(e), { ms: 8000 }); }
}

// ---------------- 拖放資料夾 ----------------
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', async e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (state.player || state.view?.isDirty) return;
  try {
    // zip 書庫包:在可以寫入的書庫頁 → 匯入(會先預覽);其他地方 → 直接開來看(唯讀)
    const zip = [...(e.dataTransfer.files || [])].find(f => /\.zip$/i.test(f.name));
    if (zip) {
      const m = location.hash.match(/^#\/(local\/[^/?]+)$/);
      if (m && state.sources.get(m[1])?.canWrite && (await getVault(m[1]))?.kind === 'leafpile') return await importFiles(m[1], (await zipToFiles(zip)).files, zip.name);
      return await openZip(zip);
    }
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
