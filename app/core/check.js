// 檢查書庫或單份簡報是否符合規則。網站的「檢查」按鈕、scripts/check.mjs、
// 書庫裡的單檔版 mdslide-check.mjs 都用這一份,規則只在這裡維護。
// 只使用資料來源介面(list / readText),瀏覽器與 Node 都能跑。

import { scanLibrary, loadDeck } from './library.js';
import { resolveMediaPath } from './media.js';
import { parseChartTable } from './chart.js';
import { undefinedFootnotes } from './markdown.js';
import { t } from './i18n.js';
import { isHidden, isMarkdown, RESERVED_DIRS, join } from './names.js';
import { openVault } from './vault.js';
import { buildGraph, sourceStatus } from './graph.js';
import { parseCanvas, missingFiles } from './canvas.js';
import { sectionOf } from './note.js';

export const MAX_SLIDES = 45;

/** 檔案是否存在:列出上一層資料夾來確認(本機來源會快取清單,不會重複讀)。 */
async function exists(source, path) {
  const i = path.lastIndexOf('/');
  try {
    const entries = await source.list(i < 0 ? '' : path.slice(0, i));
    return entries.some(e => e.name === path.slice(i + 1) && e.kind === 'file');
  } catch { return false; }
}

/**
 * 同一層的排序前綴:數字重複(`01-a`、`1-b`)或位數混用(`2-`、`10-`)。
 * 日期前綴(`2026-11-…`)不是排序數字,不檢查。
 * @param {string[]} names 同一層、同一種類(都是檔案或都是資料夾)的名稱
 * @returns {{ kind: 'dup' | 'width', prefix?: string, names: string[] }[]}
 */
export function prefixProblems(names) {
  const out = [];
  const nums = names
    .filter(n => !/^\d{4}-\d{2}(-\d{2})?[\s._-]/.test(n))
    .map(n => ({ name: n, m: n.match(/^(\d+)[\s._-]/) }))
    .filter(x => x.m);
  const byNum = new Map();
  for (const x of nums) {
    const k = Number(x.m[1]);
    byNum.set(k, [...(byNum.get(k) || []), x.name]);
  }
  for (const [, list] of byNum) if (list.length > 1) out.push({ kind: 'dup', prefix: list[0].match(/^\d+/)[0], names: list });
  // 位數混用:已經回報為重複的不再算一次;依數字排序,每種位數只列第一個,訊息不會太長
  const rest = nums.filter(x => byNum.get(Number(x.m[1])).length === 1).sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  const widths = new Set(rest.map(x => x.m[1].length));
  if (widths.size > 1) {
    const seen = new Set();
    out.push({ kind: 'width', names: rest.filter(x => !seen.has(x.m[1].length) && seen.add(x.m[1].length)).map(x => x.name) });
  }
  return out;
}

const visibleDirs = entries => entries.filter(e => e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())).map(e => e.name);
const mdNames = entries => entries.filter(e => e.kind === 'file' && isMarkdown(e.name)).map(e => e.name);

/** 檢查簡報資料夾與各章節資料夾裡的前綴。 */
async function orderProblems(source, project) {
  const problems = [];
  const report = (path, list) => {
    for (const p of prefixProblems(list)) {
      problems.push({ path: path || t('check.deckFolder'), message: p.kind === 'dup'
        ? t('check.dupPrefix', { prefix: p.prefix, names: p.names.join(t('check.sep')) })
        : t('check.mixedPrefix', { names: p.names.join(t('check.sep')) }) });
    }
  };
  let entries;
  try { entries = await source.list(project.path); } catch { return problems; }
  const dirs = visibleDirs(entries);
  report(project.path, mdNames(entries));
  report(project.path, dirs);
  for (const d of dirs) {
    const path = project.path ? project.path + '/' + d : d;
    try { report(path, mdNames(await source.list(path))); } catch { /* 讀不到的資料夾由其他規則回報 */ }
  }
  return problems;
}

/** 只有設定、沒有內容的投影片(自動產生的標題頁、章節頁、結尾頁不算)。 */
function isEmptySlide(sl) {
  if (sl.auto || ['title', 'section', 'end'].includes(sl.layout)) return false;
  return !sl.body.trim() && !sl.media.length && !sl.meta?.background;
}

/**
 * 檢查一份簡報。
 * @returns {{ title, date, hasConfig, total, noted, layouts: string[], sections: {title, count}[], slides: {layout, title, notes: boolean, auto: boolean}[], problems: {path, message}[] }}
 */
export async function checkDeck(source, project) {
  const deck = await loadDeck(source, project);
  const problems = [...deck.issues];
  const all = deck.sections.flatMap(s => s.slides);

  problems.push(...await orderProblems(source, project));

  for (const sl of all) {
    if (isEmptySlide(sl)) problems.push({ path: sl.file, message: t('check.emptySlide', { n: sl.index + 1 }) });
    if (sl.layout === 'chart') {
      const tbl = parseChartTable(sl.body);
      if (!tbl) problems.push({ path: sl.file, message: t('check.noTable') });
      else for (const b of tbl.bad) problems.push({ path: sl.file, message: t('check.badCell', b) });
    }
    for (const id of undefinedFootnotes(sl.body)) problems.push({ path: sl.file, message: t('check.missingFootnote', { id }) });
    for (const m of sl.media) {
      if (m.remote) continue;
      const path = resolveMediaPath(m.src, { projectPath: project.path, filePath: sl.file });
      if (!(await exists(source, path))) problems.push({ path: sl.file, message: t('check.missingMedia', { src: m.src, path: path || t('check.deckFolder') }) });
    }
    const bg = sl.style ? sl.style.bgImage : sl.meta?.background; // 背景色不是檔案,不用檢查
    if (bg && !/^(https?:|data:)/.test(String(bg))) {
      const path = resolveMediaPath(String(bg), { projectPath: project.path, filePath: sl.file });
      if (!(await exists(source, path))) problems.push({ path: sl.file, message: t('check.missingBg', { src: bg }) });
    }
  }
  if (project.coverImage && !(await exists(source, resolveMediaPath(project.coverImage, { projectPath: project.path, filePath: project.path + '/deck.yml' })))) {
    problems.push({ path: project.path || t('check.deckFolder'), message: t('check.missingCover', { src: project.coverImage }) });
  }
  if (project.brand?.logo && !/^(https?:|data:)/.test(project.brand.logo) && !(await exists(source, resolveMediaPath(project.brand.logo, { projectPath: project.path, filePath: project.path + '/deck.yml' })))) {
    problems.push({ path: project.path || t('check.deckFolder'), message: t('check.missingLogo', { src: project.brand.logo }) });
  }
  if (all.length > MAX_SLIDES) problems.push({ path: project.path || t('check.deckFolder'), message: t('check.tooMany', { n: all.length }) });

  return {
    title: deck.title,
    date: deck.date,
    hasConfig: project.hasConfig,
    total: all.length,
    noted: all.filter(s => s.notes).length,
    layouts: [...new Set(all.map(s => s.layout))],
    sections: deck.sections.map(s => ({ title: s.title || t('check.opening'), count: s.slides.length })),
    slides: all.map(s => ({ layout: s.layout, title: s.title, notes: !!s.notes, auto: !!s.auto })),
    problems,
  };
}

/**
 * 檢查整個資料夾(書庫、主題或單份簡報都可以)。
 * @param {(done: number, total: number, title: string) => void} [onProgress]
 */
export async function checkLibrary(source, onProgress, opts = {}) {
  const lib = await scanLibrary(source, opts);
  const total = lib.topics.reduce((n, tp) => n + tp.projects.length, 0);
  let done = 0;
  const topics = [];
  for (const tp of lib.topics) {
    const decks = [];
    for (const p of tp.projects) {
      onProgress?.(done, total, p.title);
      try { decks.push({ id: p.id, ...(await checkDeck(source, p)) }); }
      catch (e) { decks.push({ id: p.id, title: p.title, total: 0, noted: 0, layouts: [], sections: [], slides: [], problems: [{ path: p.path, message: t('check.unreadable', { error: e.message || e }) }] }); }
      done++;
    }
    topics.push({ id: tp.id, title: tp.title, decks });
  }
  onProgress?.(done, total, '');
  const problems = [...lib.issues, ...topics.flatMap(tp => tp.decks.flatMap(d => d.problems))];
  return { kind: lib.kind, title: lib.title, topics, problems };
}


/** 摘錄超過幾個字就提醒(簡報應該比筆記短,docs/INTEROP.md 第 3 節)。 */
export const EMBED_MAX_CHARS = 120;

/**
 * 檢查 Leafpile 書庫:簡報渠道沿用 checkLibrary,另外檢查筆記與跨渠道的連結。
 * 沒有 notes/ 與 slides/ 的資料夾(Mdslide Pile 書庫、單一簡報)只做簡報檢查。
 * problems = 會讓 CI 失敗的錯誤;warnings = 提醒(連結找不到、急件到期…)。
 * @param {{ today?: string }} [opts] today = 判斷急件到期用的日期(YYYY-MM-DD)
 */
export async function checkVault(source, onProgress, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const vault = await openVault(source);
  if (vault.kind === 'mdslide') return { ...(await checkLibrary(source, onProgress)), warnings: [], notes: null };

  const slides = vault.slidesSource
    ? await checkLibrary(vault.slidesSource, onProgress, { kind: 'library' })
    : { kind: 'library', topics: [], problems: [] };
  const pre = p => ({ ...p, path: join('slides', p.path) });
  for (const tp of slides.topics) for (const d of tp.decks) d.problems = d.problems.map(pre);
  const problems = [...vault.issues.filter(i => !i.path.startsWith('slides/') && i.level !== 'warn'), ...slides.problems.map(pre)];
  const warnings = vault.issues.filter(i => i.level === 'warn');

  const graph = await buildGraph(vault);
  const say = (level, path, message) => (level === 'warn' ? warnings : problems).push({ path, message });
  for (const i of graph.issues) problems.push({ path: i.path, message: t('issue.readFailed') });

  /** 檢查一個連結(筆記或投影片裡的)。 */
  const checkLink = (rec, l, where) => {
    const res = graph.resolver.resolve(l, { fromTopic: rec.topicId, fromPath: rec.path });
    if (res.status === 'missing') return say(l.embed && rec.kind === 'deck' ? 'error' : 'warn', where, t(l.embed ? 'check.embedMissing' : 'check.linkMissing', { link: l.raw }));
    if (res.status === 'ambiguous') say('warn', where, t('check.linkAmbiguous', { link: l.raw, paths: res.candidates.map(c => c.path).join(t('check.sep')) }));
    const target = res.status === 'self' ? rec : res.target;
    if (!l.heading || target?.kind !== 'note') return;
    const text = sectionOf(target.body, l.heading);
    if (text == null) say(l.embed && rec.kind === 'deck' ? 'error' : 'warn', where, t('check.headingMissing', { link: l.raw, title: target.title }));
    else if (l.embed && rec.kind === 'deck' && text.replace(/\s+/g, '').length > EMBED_MAX_CHARS) say('warn', where, t('check.embedLong', { link: l.raw, n: EMBED_MAX_CHARS }));
  };

  let books = 0, links = 0;
  for (const tp of vault.notes.topics) books += tp.items.filter(i => i.kind === 'book').length;
  for (const n of graph.notes.values()) {
    for (const i of n.issues) say(i.level === 'warn' ? 'warn' : 'error', n.path, i.message);
    for (const l of n.links) { links++; checkLink(n, l, n.path); }
    if (n.pinned && !n.expires) say('warn', n.path, t('check.pinnedNoExpiry'));
    if (n.expires && n.expires < today) say('warn', n.path, t('check.expired', { date: n.expires }));
  }
  for (const d of graph.decks.values()) {
    for (const l of d.links) { links++; checkLink(d, l, l.file || d.path); }
    const st = sourceStatus(graph, d).status;
    if (st === 'missing') say('warn', join(d.path, 'deck.yml'), t('check.sourceMissing', { source: d.source }));
    if (st === 'changed') say('warn', join(d.path, 'deck.yml'), t('check.sourceChanged', { source: d.source }));
  }
  for (const b of vault.boards || []) {
    let board;
    try { board = parseCanvas(await source.readText(b.path)); } catch (e) { say('error', b.path, t('check.boardBroken', { error: e.message })); continue; }
    for (const i of board.issues) say('warn', b.path, t('check.boardIssue', { issue: i }));
    for (const f of missingFiles(board, graph)) say('warn', b.path, t('check.boardMissing', { file: f }));
  }
  return {
    kind: 'leafpile', title: vault.title, topics: slides.topics, problems, warnings,
    notes: { topics: vault.notes.topics.length, notes: graph.notes.size, books, links },
  };
}

/** 把檢查結果排成純文字報告(給命令列用)。 */
export function formatReport(report, { verbose = false } = {}) {
  const out = [t('check.report.title', { title: report.title, kind: t('check.kind.' + report.kind) })];
  for (const tp of report.topics) {
    if (report.kind === 'library' || report.kind === 'leafpile') out.push('', t('check.report.topic', { title: tp.title }));
    if (!tp.decks.length) out.push(t('check.report.empty'));
    for (const d of tp.decks) {
      out.push(t('check.report.deck', { title: d.title, date: d.date ? t('check.report.date', { date: d.date }) : '', sections: d.sections.length, total: d.total, layouts: d.layouts.length, noted: d.noted, noConfig: d.hasConfig === false ? t('check.report.noConfig') : '' }));
      if (!verbose) continue;
      let k = 0;
      for (const s of d.sections) {
        out.push(t('check.report.section', s));
        for (const sl of d.slides.slice(k, k + s.count)) out.push(`        - [${sl.layout}] ${sl.title || t('check.report.untitled')}${sl.notes ? '  📝' : ''}${sl.auto ? t('check.report.auto') : ''}`);
        k += s.count;
      }
    }
  }
  if (report.notes) out.push('', t('check.report.notes', report.notes));
  if (report.warnings?.length) {
    out.push('', t('check.report.warnings', { n: report.warnings.length }));
    for (const i of report.warnings) out.push(`  - ${i.path}:${i.message}`);
  }
  if (report.problems.length) {
    out.push('', t('check.report.problems', { n: report.problems.length }));
    for (const i of report.problems) out.push(`  - ${i.path}:${i.message}`);
  } else {
    out.push('', t('check.report.ok'));
  }
  return out.join('\n');
}
