// 書庫掃描:把「資料來源」轉成 書庫 → 主題 → 專案(簡報)→ 章節 → 投影片。
//
// 讀取分三層,只在需要時往下讀(本機資料可能在隨身碟上,越少讀越好):
//   1. scanLibrary()  只讀資料夾清單 + _site.yml / _topic.yml / deck.yml   → 目錄頁
//   2. loadCover()    進入畫面範圍的專案才讀:章節數、第一張投影片        → 封面卡片
//   3. loadDeck()     點進簡報才讀全部 MD                                 → 播放器
// 圖片與影片則由播放器在「快要看到時」才向來源要網址。
//
// 資料來源(source)只需要實作:
//   list(path)     → Promise<{ name, kind: 'file'|'dir' }[]>   path '' 代表根目錄
//   readText(path) → Promise<string>
//   mediaURL(path) → Promise<string>

import { safeFonts } from './style.js';
import { parseYaml, YamlError } from './yaml.js';
import { join, isHidden, isMarkdown, RESERVED_DIRS, splitOrder, byOrder } from './names.js';
import { parseSlideFile } from './slide.js';
import { safeColor } from './color.js';
import { t, detectDeckLang } from './i18n.js';

export const SCHEMA_VERSION = 1;
export const PALETTE = ['#c0674a', '#5f8a64', '#4f73a6', '#b08a3a', '#8a5fa6', '#3f8f8f', '#b0566e', '#6b7a8f'];

const CONFIG = { site: '_site.yml', topic: '_topic.yml', deck: 'deck.yml' };

/** 同時最多幾個讀取,避免隨身碟或網路被塞爆。 */
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = limiter(6);

async function listSafe(source, path) {
  try { return await source.list(path); } catch { return []; }
}

async function readYaml(source, path, issues) {
  let text;
  try { text = await limit(() => source.readText(path)); } catch { return null; }
  try { return parseYaml(text) || {}; }
  catch (e) {
    issues.push({ path, message: e instanceof YamlError ? e.message : String(e.message || e) });
    return {};
  }
}

const has = (entries, name, kind = 'file') => entries.some(e => e.name === name && e.kind === kind);
const dirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).sort(byOrder);
const mds = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).sort(byOrder);

/**
 * 判斷使用者開啟的資料夾是哪一層。
 * 規則(依序):deck.yml → 簡報;_topic.yml → 主題;_site.yml → 書庫;
 * 根目錄直接有 MD → 簡報;子資料夾有 deck.yml → 主題;子資料夾有 _topic.yml → 書庫;
 * 子資料夾直接有 MD → 簡報(子資料夾是章節);孫資料夾有 deck.yml → 書庫;其他 → 書庫。
 */
export async function detectRootKind(source) {
  const root = await source.list('');
  if (has(root, CONFIG.deck)) return 'deck';
  if (has(root, CONFIG.topic)) return 'topic';
  if (has(root, CONFIG.site)) return 'library';
  if (mds(root).length) return 'deck';
  const children = dirs(root).slice(0, 8);
  const lists = await Promise.all(children.map(d => listSafe(source, d.name)));
  if (lists.some(l => has(l, CONFIG.deck))) return 'topic';
  if (lists.some(l => has(l, CONFIG.topic))) return 'library';
  if (lists.some(l => mds(l).length)) return 'deck';
  return 'library';
}

/**
 * 第 1 層:目錄。只讀資料夾清單與設定檔。
 * opts.kind:強制指定層級(Leafpile 的 slides/ 渠道一定是書庫,不必猜)。
 */
export async function scanLibrary(source, opts = {}) {
  const issues = [];
  const kind = opts.kind || await detectRootKind(source);
  const rootEntries = await source.list('');
  const label = source.label || t('lib.defaultLabel');

  if (kind === 'deck') {
    const project = await readProject(source, '', label, '_', issues);
    return finish({ kind, title: project.title, description: '', theme: project.theme, topics: [makeTopic('_', '', { name: label }, [project], 0)] });
  }
  if (kind === 'topic') {
    const conf = (await readYaml(source, CONFIG.topic, issues)) || {};
    const projects = await readProjects(source, '', rootEntries, conf, '_', issues);
    const topic = makeTopic('_', '', { name: label, ...conf, color: color(conf.color, null, CONFIG.topic, issues) }, projects, 0);
    return finish({ kind, title: topic.title, description: topic.description, theme: conf.theme, topics: [topic] });
  }

  const site = (await readYaml(source, CONFIG.site, issues)) || {};
  let topicDirs = dirs(rootEntries);
  topicDirs = applyOrder(topicDirs, site.topics);
  const topics = await Promise.all(topicDirs.map(async (d, i) => {
    const entries = await listSafe(source, d.name);
    const conf = (await readYaml(source, join(d.name, CONFIG.topic), issues)) || {};
    const projects = await readProjects(source, d.name, entries, conf, d.name, issues);
    return makeTopic(d.name, d.name, { ...conf, color: color(conf.color, null, join(d.name, CONFIG.topic), issues) }, projects, i);
  }));
  return finish({ kind, title: site.title || label, description: site.description || '', theme: site.theme, topics });

  function finish(lib) { return { ...lib, source: label, issues, scannedAt: Date.now() }; }
}

function applyOrder(list, order) {
  if (!Array.isArray(order) || !order.length) return list;
  const key = n => [n, splitOrder(n).label];
  const picked = [];
  for (const want of order.map(String)) {
    const hit = list.find(d => key(d.name).includes(want) && !picked.includes(d));
    if (hit) picked.push(hit);
  }
  return [...picked, ...list.filter(d => !picked.includes(d))];
}

function makeTopic(id, path, conf, projects, i) {
  const folder = path.split('/').pop() || conf.name || '';
  return {
    id, path,
    title: conf.name || conf.title || splitOrder(folder).label,
    description: conf.description || '',
    color: conf.color || PALETTE[i % PALETTE.length],
    category: conf.category ? String(conf.category) : '',
    projects,
  };
}

async function readProjects(source, topicPath, entries, topicConf, topicId, issues) {
  let list = dirs(entries);
  list = applyOrder(list, topicConf.order);
  const projects = await Promise.all(list.map(d => readProject(source, join(topicPath, d.name), d.name, topicId, issues)));
  if (!Array.isArray(topicConf.order)) {
    // 沒指定順序:有前綴的依前綴,其他依日期新到舊
    projects.sort((a, b) => {
      const A = splitOrder(a.folder).order, B = splitOrder(b.folder).order;
      if (A != null || B != null) return (A ?? 1e9) - (B ?? 1e9);
      return String(b.date || '').localeCompare(String(a.date || '')) || a.folder.localeCompare(b.folder, 'zh-Hant');
    });
  }
  return projects;
}

async function readProject(source, path, folder, topicId, issues) {
  const conf = (await readYaml(source, join(path, CONFIG.deck), issues)) || {};
  const label = splitOrder(folder).label;
  return {
    id: folder || '_', topicId, folder, path,
    hasConfig: Object.keys(conf).length > 0,
    title: str(conf.title) || label,
    subtitle: str(conf.subtitle),
    author: str(conf.author),
    date: conf.date != null ? String(conf.date) : (splitOrder(folder).date || ''),
    event: str(conf.event),
    tags: Array.isArray(conf.tags) ? conf.tags.map(String) : [],
    theme: str(conf.theme),
    accent: color(conf.accent, null, join(path, CONFIG.deck), issues) || safeColor(Array.isArray(conf.sections) && conf.sections[0]?.color) || '',
    coverImage: str(conf.cover_image || conf.coverImage),
    lang: detectDeckLang(conf.lang, conf.title, conf.subtitle, conf.kicker, folder, ...(Array.isArray(conf.sections) ? conf.sections.map(s => s && (s.title || s.folder)) : [])),
    brand: readBrand(conf.brand, join(path, CONFIG.deck), issues),
    config: conf,
  };
}


/** deck.yml 的 brand 欄位:logo、footer、font_display、font_body。不合法的字型名稱會回報並忽略。 */
function readBrand(b, path, issues) {
  if (!b || typeof b !== 'object') return null;
  const font = v => {
    if (v == null || v === '') return '';
    const f = safeFonts(v);
    if (!f) { issues.push({ path, message: t('issue.brandFont', { value: v }) }); return ''; }
    return f;
  };
  return { logo: str(b.logo), footer: str(b.footer), fontDisplay: font(b.font_display), fontBody: font(b.font_body) };
}

const str = v => (v == null ? '' : String(v));

/** 設定檔裡的顏色:不合法就回報並改用預設值。 */
function color(value, fallback, path, issues) {
  if (value == null || value === '') return fallback;
  const c = safeColor(value);
  if (!c) issues.push({ path, message: t('issue.color', { value }) });
  return c || fallback;
}

/** 重新讀取一份簡報的 deck.yml(即時重新載入用)。 */
export async function refreshProject(source, project) {
  return readProject(source, project.path, project.folder, project.topicId, []);
}

/** 第 2 層:封面。只列出專案資料夾,必要時讀第一張投影片。 */
export async function loadCover(source, project) {
  const entries = await listSafe(source, project.path);
  const sectionDirs = dirs(entries);
  const info = { sections: sectionDirs.length || (mds(entries).length ? 1 : 0), firstSlide: null };
  if (project.hasConfig && project.config.title) return info; // 有標題就用自動產生的標題頁當封面,不必再讀
  let file = mds(entries)[0] && join(project.path, mds(entries)[0].name);
  if (!file && sectionDirs[0]) {
    const inner = await listSafe(source, join(project.path, sectionDirs[0].name));
    if (mds(inner)[0]) file = join(project.path, sectionDirs[0].name, mds(inner)[0].name);
  }
  if (file) {
    try { info.firstSlide = parseSlideFile(await limit(() => source.readText(file)), { path: file }).slides[0]; } catch { /* 封面讀不到就用預設 */ }
  }
  return info;
}

/** 第 3 層:整份簡報。 */
export async function loadDeck(source, project) {
  const issues = [];
  const conf = project.config || {};
  const entries = await source.list(project.path);
  const confSections = Array.isArray(conf.sections) ? conf.sections.filter(s => s && typeof s === 'object') : [];

  // 章節順序一律依資料夾前綴;deck.yml 的 sections 只覆寫標題、顏色、隱藏等屬性
  const sectionDirs = dirs(entries);

  const sections = [];
  const rootFiles = mds(entries);
  if (rootFiles.length) sections.push({ folder: '', path: project.path, files: rootFiles.map(f => join(project.path, f.name)), intro: sectionDirs.length > 0 });
  await Promise.all(sectionDirs.map(async d => {
    const path = join(project.path, d.name);
    const files = mds(await source.list(path)).map(f => join(path, f.name));
    sections.push({ folder: d.name, path, files });
  }));
  const orderOf = s => s.folder === '' ? -1 : sectionDirs.findIndex(d => d.name === s.folder);
  sections.sort((a, b) => orderOf(a) - orderOf(b));

  const autoCovers = conf.section_covers !== false && conf.sectionCovers !== false;
  let colorIndex = 0;
  const built = [];
  for (const s of sections) {
    const c = confSections.find(x => x.folder === s.folder || x.folder === splitOrder(s.folder).label) || {};
    if (c.hidden) continue;
    const texts = await Promise.all(s.files.map(f => limit(() => source.readText(f)).then(text => [f, text], () => [f, null])));
    const slides = [];
    for (const [f, text] of texts) {
      if (text == null) { issues.push({ path: f, message: t('issue.readFailed') }); continue; }
      const r = parseSlideFile(text, { path: f });
      issues.push(...r.issues);
      slides.push(...r.slides.filter(sl => !sl.meta.hidden));
    }
    const title = c.title || (s.folder ? splitOrder(s.folder).label : '');
    const auto = s.folder ? PALETTE[colorIndex++ % PALETTE.length] : project.accent || PALETTE[PALETTE.length - 1];
    const secColor = color(c.color, auto, join(project.path, CONFIG.deck), issues);
    const section = { id: s.folder || '_intro', folder: s.folder, path: s.path, title, subtitle: str(c.subtitle), color: secColor, slides };
    if (autoCovers && s.folder && sections.filter(x => x.folder).length > 1 && c.cover !== false) {
      slides.unshift({ file: s.path, index: -1, meta: {}, layout: 'section', body: '', notes: str(c.notes), media: [], title, auto: true });
    }
    if (slides.length) built.push(section);
  }

  // 自動標題頁與結尾頁
  if (conf.cover !== false && conf.cover !== 'none') {
    // 標題頁放在第一個章節的最前面,不另外成一疊
    const titleSlide = { file: project.path, index: -1, meta: {}, layout: 'title', body: '', notes: str(conf.cover_notes), media: [], title: project.title, auto: true };
    if (built[0]) built[0].slides.unshift(titleSlide);
  }
  if (conf.end) {
    const last = built.at(-1);
    if (last) last.slides.push({ file: project.path, index: -1, meta: {}, layout: 'end', body: '', notes: str(conf.end_notes), media: [], title: String(conf.end), auto: true });
  }

  if (!built.some(s => s.slides.some(sl => !sl.auto))) issues.push({ path: project.path, message: t('issue.noSlides') });
  if (conf.mdslide && Number(conf.mdslide) > SCHEMA_VERSION) issues.push({ path: join(project.path, CONFIG.deck), message: t('issue.newerSchema', { version: conf.mdslide }) });

  const layout = typeof conf.layout === 'object' && conf.layout ? conf.layout : { stage: conf.layout };
  return {
    ...project,
    sections: built,
    stage: str(layout.stage || layout.default || 'pile'),
    transition: str(layout.transition || 'shuffle'),
    size: /^(small|compact|normal|large|xl)$/i.test(str(conf.size)) ? str(conf.size).toLowerCase() : '',
    issues,
  };
}

/** 給播放器用:把所有章節攤平成一個陣列,並標上章節索引。 */
export function flatten(deck) {
  const out = [];
  deck.sections.forEach((sec, si) => sec.slides.forEach((s, i) => out.push({ ...s, sec: si, i, count: sec.slides.length })));
  return out;
}
