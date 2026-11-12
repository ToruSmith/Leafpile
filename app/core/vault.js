// Leafpile 書庫:一個資料夾、兩個渠道(notes/ 筆記、slides/ 簡報),同名主題自動配對。
// 規則見 docs/SPEC.md 第 1、9 節。
//
// 開啟的資料夾沒有 notes/ 也沒有 slides/ 時,整個資料夾當成簡報渠道(相容 Mdslide Pile 書庫)。

import { parseYaml, YamlError } from './yaml.js';
import { join, isHidden, isMarkdown, RESERVED_DIRS, splitOrder, byOrder } from './names.js';
import { scanLibrary, limiter, PALETTE } from './library.js';
import { safeColor } from './color.js';
import { t } from './i18n.js';

export const LEAFPILE_SCHEMA = 1;
export const CHANNELS = ['notes', 'slides'];
export const ARCHIVE_DIR = '_archive';

const limit = limiter(6);
const listSafe = async (source, path) => { try { return await source.list(path); } catch { return []; } };
const dirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).sort(byOrder);
const mds = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).sort(byOrder);
const str = v => v == null ? '' : String(v).trim();

export async function readYaml(source, path, issues) {
  let text;
  try { text = await limit(() => source.readText(path)); } catch { return null; }
  try {
    const v = parseYaml(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    issues?.push({ path, message: e instanceof YamlError ? e.message : String(e.message || e) });
    return {};
  }
}

/**
 * 把書庫的一個子資料夾包成獨立的資料來源(路徑自動加上前綴)。
 * 寫入、監看、封存都會轉給原來的來源;封存一律搬到書庫根目錄的 _archive/,保留原本的相對路徑。
 */
export function subSource(parent, prefix) {
  const p = path => join(prefix, path);
  const sub = {
    kind: parent.kind,
    label: parent.label,
    prefix,
    parent,
    base: parent.base ? parent.base + prefix + '/' : undefined,
    list: path => parent.list(p(path)),
    readText: path => parent.readText(p(path)),
    mediaURL: path => parent.mediaURL(p(path)),
    releaseMedia: () => parent.releaseMedia?.(),
  };
  if (parent.refresh) sub.refresh = () => parent.refresh();
  if (parent.canWrite) {
    Object.defineProperty(sub, 'canWrite', { get: () => parent.canWrite });
    sub.ensureWritable = () => parent.ensureWritable();
    sub.stat = path => parent.stat(p(path));
    sub.writeText = (path, text, opts) => parent.writeText(p(path), text, opts);
    if (parent.move) sub.move = async (from, to, text, opts) => (await parent.move(p(from), p(to), text, opts)).slice(prefix.length + 1);
    sub.archive = async path => {
      const full = p(path);
      const dir = full.split('/').slice(0, -1).join('/');
      const to = await parent.archive(full, join(ARCHIVE_DIR, dir));
      return to;
    };
  }
  if (parent.watch) sub.watch = (paths, onChange, interval) => parent.watch(paths.map(x => p(x)), onChange, interval);
  return sub;
}

/** 依前綴或日期排序:有數字前綴的依前綴(章節),有日期的新到舊,其他依名稱。 */
function sortItems(items) {
  return items.sort((a, b) => {
    const A = splitOrder(a.name), B = splitOrder(b.name);
    if (A.order != null || B.order != null) return (A.order ?? 1e9) - (B.order ?? 1e9) || byOrder(a, b);
    if (A.date || B.date) return String(B.date || '').localeCompare(String(A.date || '')) || byOrder(a, b);
    return byOrder(a, b);
  });
}

function noteStub(path, topicId, bookPath) {
  const file = path.split('/').pop();
  const n = splitOrder(file);
  return { kind: 'note', path, file, name: file, topicId, bookPath, title: n.label, date: n.date || '' };
}

/** 筆記本:一個子資料夾。裡面更深的資料夾也算(最多三層),依路徑排序。 */
async function readBook(source, path, topicId, issues) {
  const entries = await listSafe(source, path);
  const conf = (await readYaml(source, join(path, '_book.yml'), issues)) || {};
  const notes = [];
  const walk = async (dir, list, depth) => {
    for (const f of mds(list)) notes.push(noteStub(join(dir, f.name), topicId, path));
    if (depth >= 3) return;
    for (const d of dirs(list)) await walk(join(dir, d.name), await listSafe(source, join(dir, d.name)), depth + 1);
  };
  await walk(path, entries, 1);
  const folder = path.split('/').pop();
  const n = splitOrder(folder);
  return {
    kind: 'book', path, folder, name: folder, topicId, conf,
    title: str(conf.title) || n.label,
    author: str(conf.author),
    status: str(conf.status),
    cover: str(conf.cover),
    date: conf.date != null ? String(conf.date) : (n.date || ''),
    tags: Array.isArray(conf.tags) ? conf.tags.map(String) : [],
    public: typeof conf.public === 'boolean' ? conf.public : undefined,
    notes,
  };
}

/** 筆記渠道的目錄:只讀資料夾清單與 _topic.yml / _book.yml,不讀筆記內容。 */
export async function scanNotes(source) {
  const issues = [];
  const root = await listSafe(source, '');
  const topics = await Promise.all(dirs(root).map(async d => {
    const entries = await listSafe(source, d.name);
    const conf = (await readYaml(source, join(d.name, '_topic.yml'), issues)) || {};
    const loose = mds(entries).map(f => noteStub(join(d.name, f.name), d.name, ''));
    const books = await Promise.all(dirs(entries).map(x => readBook(source, join(d.name, x.name), d.name, issues)));
    const items = sortItems([...loose, ...books.filter(b => b.notes.length || Object.keys(b.conf).length)]);
    return { id: d.name, path: d.name, conf, title: str(conf.name || conf.title) || splitOrder(d.name).label, items };
  }));
  const rootNotes = mds(root).map(f => noteStub(f.name, '_', ''));
  if (rootNotes.length) topics.unshift({ id: '_', path: '', conf: {}, title: t('notes.unfiled'), items: sortItems(rootNotes) });
  return { topics, issues };
}

/** 一個主題裡所有的筆記(含筆記本裡的)。 */
export const notesOfTopic = topic => (topic?.items || []).flatMap(i => i.kind === 'book' ? i.notes : [i]);

/**
 * 開啟書庫。只讀資料夾清單與設定檔(第 1 層),筆記內容由 core/graph.js 在背景讀取。
 * @returns 書庫物件:{ kind: 'leafpile'|'mdslide', title, description, theme, categories, topics, slides, notes, ... }
 */
export async function openVault(source) {
  const root = await source.list('');
  const hasDir = n => root.some(e => e.kind === 'dir' && e.name === n);
  const label = source.label || t('lib.defaultLabel');

  if (!hasDir('notes') && !hasDir('slides')) {
    const slides = await scanLibrary(source);
    return assemble({ kind: 'mdslide', title: slides.title, description: slides.description, theme: slides.theme, site: {}, issues: [], slides, slidesSource: source, slidesPrefix: '', notes: { topics: [], issues: [] }, notesSource: null, boards: [] });
  }

  const issues = [];
  const site = (await readYaml(source, '_site.yml', issues)) || {};
  if (site.leafpile && Number(site.leafpile) > LEAFPILE_SCHEMA) issues.push({ path: '_site.yml', message: t('issue.newerLeafpile', { version: site.leafpile }) });
  const slidesSource = hasDir('slides') ? subSource(source, 'slides') : null;
  const notesSource = hasDir('notes') ? subSource(source, 'notes') : null;
  const boards = hasDir('boards')
    ? (await source.list('boards').catch(() => [])).filter(e => e.kind === 'file' && /\.canvas$/i.test(e.name) && !e.name.startsWith('.'))
      .map(e => ({ name: e.name.replace(/\.canvas$/i, ''), path: `boards/${e.name}` })).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const [slides, notes] = await Promise.all([
    slidesSource ? scanLibrary(slidesSource, { kind: 'library' }) : { kind: 'library', topics: [], issues: [] },
    notesSource ? scanNotes(notesSource) : { topics: [], issues: [] },
  ]);
  return assemble({ kind: 'leafpile', title: str(site.title) || label, description: str(site.description), theme: str(site.theme), site, issues, slides, slidesSource, slidesPrefix: 'slides', notes, notesSource, boards });
}

function assemble(v) {
  const prefixIssues = (list, prefix) => list.map(i => ({ ...i, path: prefix ? join(prefix, i.path) : i.path }));
  const ids = [...new Set([...v.notes.topics.map(x => x.id), ...v.slides.topics.map(x => x.id)])]
    .sort((a, b) => a === '_' ? -1 : b === '_' ? 1 : byOrder({ name: a }, { name: b }));
  const topics = ids.map((id, i) => {
    const n = v.notes.topics.find(x => x.id === id);
    const s = v.slides.topics.find(x => x.id === id);
    const conf = n?.conf || {};
    return {
      id,
      title: n?.title || s?.title || splitOrder(id).label,
      description: str(conf.description) || s?.description || '',
      color: safeColor(conf.color) || s?.color || PALETTE[i % PALETTE.length],
      category: str(conf.category) || s?.category || '',
      conf,
      notes: n || null,
      decks: s?.projects || [],
      slidesTopic: s || null,
    };
  });
  const categories = readCategories(v.site.categories, topics);
  return {
    ...v,
    topics,
    categories,
    issues: [...v.issues, ...prefixIssues(v.notes.issues, 'notes'), ...prefixIssues(v.slides.issues, v.slidesPrefix)],
    deckPath: project => join(v.slidesPrefix, project.path),
    notePath: rel => join('notes', rel),
    scannedAt: Date.now(),
  };
}

/** _site.yml 的 categories;沒有列出的分類放在最後的「其他」。 */
function readCategories(list, topics) {
  const out = (Array.isArray(list) ? list : [])
    .filter(c => c && typeof c === 'object' && c.id != null)
    .map(c => ({ id: String(c.id), name: str(c.name) || String(c.id), color: safeColor(c.color) || '' }));
  const known = new Set(out.map(c => c.id));
  const rest = topics.filter(tp => !known.has(tp.category));
  if (rest.length && out.length) out.push({ id: '', name: t('shelf.otherCategory'), color: '' });
  for (const c of out) c.topics = topics.filter(tp => c.id ? tp.category === c.id : !known.has(tp.category));
  return out.filter(c => c.topics.length);
}

/** 找筆記(rel = 在 notes/ 裡的路徑)。 */
export function findNote(vault, rel) {
  for (const tp of vault.notes.topics) for (const n of notesOfTopic(tp)) if (n.path === rel) return { note: n, topic: tp, book: tp.items.find(i => i.kind === 'book' && i.path === n.bookPath) || null };
  return null;
}

/** 找簡報。 */
export function findDeck(vault, topicId, projectId) {
  return vault.slides.topics.find(tp => tp.id === topicId)?.projects.find(p => p.id === projectId) || null;
}
