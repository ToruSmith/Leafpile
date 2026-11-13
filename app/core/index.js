// 書庫索引:一次列出所有筆記、簡報、畫布,以及它們之間的連結,給 AI(與人)先看全貌再動手。
// 用的時候才產生、不存檔,所以不會有「索引過期」的問題。
// 網站的關聯圖(graph.js)與檢查工具共用同一套資料,這裡只是換一種輸出。
//
//   node leafpile-check.mjs <書庫> --index          Markdown(給 AI 讀)
//   node leafpile-check.mjs <書庫> --index=json     JSON(給程式讀)
//   加上 --public 只列公開的筆記(要把索引交給外部服務時用)

import { openVault } from './vault.js';
import { buildGraph } from './graph.js';
import { parseCanvas, resolveFile } from './canvas.js';
import { cellText } from './table.js';
import { t } from './i18n.js';

/** 主題 id → 筆記本路徑 → 筆記本標題 */
function bookTitles(vault) {
  const out = new Map();
  for (const tp of vault.notes?.topics || []) for (const i of tp.items || []) if (i.kind === 'book') out.set(i.path, i.title || i.path);
  return out;
}

/**
 * 組出索引資料(純資料,JSON 直接輸出;Markdown 由 indexMarkdown 排版)。
 * @param {{ vault: object, graph: object, boards?: { name: string, path: string, board: object }[] }} input
 * @param {{ publicOnly?: boolean, now?: string }} [opts]
 */
export function buildIndex({ vault, graph, boards = [] }, { publicOnly = false, now = new Date().toISOString() } = {}) {
  const books = bookTitles(vault);
  const keep = rec => rec.kind !== 'note' || !publicOnly || rec.public;
  const ref = rec => ({ kind: rec.kind, path: rec.path, title: rec.title });

  const linksOf = rec => {
    const out = [], missing = [], seen = new Set();
    for (const l of rec.links || []) {
      const res = graph.resolver.resolve(l, { fromTopic: rec.topicId, fromPath: rec.path });
      const target = res.status === 'self' ? null : res.target;
      if (target) {
        if (!keep(target) || seen.has(target.path)) continue;
        seen.add(target.path);
        out.push({ ...ref(target), ...(l.embed ? { embed: true } : {}) });
      } else if (res.status === 'missing' || res.status === 'ambiguous') missing.push(l.raw);
    }
    return { links: out, missing: [...new Set(missing)] };
  };
  const backOf = rec => (graph.backlinks.get(rec.path) || []).filter(b => keep(b.from)).map(b => ({ ...ref(b.from), via: b.via }));

  const boardRefs = new Map(); // 筆記或簡報的路徑 → 出現在哪些畫布
  const boardList = boards.map(b => {
    const cards = [];
    for (const n of b.board.nodes || []) {
      if (n.type !== 'file') continue;
      const r = resolveFile(n.file, graph);
      if (r.kind === 'missing' || !keep(r.rec)) continue;
      if (!cards.some(c => c.path === r.rec.path)) cards.push(ref(r.rec));
      if (!boardRefs.has(r.rec.path)) boardRefs.set(r.rec.path, []);
      if (!boardRefs.get(r.rec.path).includes(b.name)) boardRefs.get(r.rec.path).push(b.name);
    }
    const texts = (b.board.nodes || []).filter(n => n.type === 'text').length;
    const groups = (b.board.nodes || []).filter(n => n.type === 'group').map(n => String(n.label || '')).filter(Boolean);
    return { name: b.name, path: b.path, cards, texts, groups };
  });

  const notes = [...graph.notes.values()].filter(keep).map(n => ({
    path: n.path, title: n.title, topic: n.topicId,
    book: n.bookPath ? { path: n.bookPath, title: books.get(n.bookPath) || n.bookPath } : null,
    date: n.date || '', tags: n.tags || [], aliases: n.aliases || [],
    public: !!n.public, ...(n.localOnly ? { localOnly: true } : {}),
    ...(n.pinned ? { pinned: true, expires: n.expires || '' } : {}),
    ...(n.fromDeck ? { fromDeck: n.fromDeck } : {}),
    fields: n.fields || {},
    headings: (n.headings || []).map(h => ({ level: h.level, text: h.text })),
    excerpt: n.excerpt || '',
    ...linksOf(n),
    backlinks: backOf(n),
    boards: boardRefs.get(n.path) || [],
  }));
  const decks = [...graph.decks.values()].map(d => ({
    path: d.path, title: d.title, topic: d.topicId, date: d.date || '',
    source: d.source || '', ...linksOf(d), backlinks: backOf(d), boards: boardRefs.get(d.path) || [],
  }));

  const catOf = new Map();
  for (const c of vault.categories || []) for (const tp of c.topics) catOf.set(tp.id, c.id);
  const topics = (vault.topics || []).map(tp => ({
    id: tp.id, title: tp.title, description: tp.description || '', category: catOf.get(tp.id) ?? tp.category ?? '',
    public: tp.conf?.public === true, ...(tp.conf?.local_only === true ? { localOnly: true } : {}),
    notes: notes.filter(n => n.topic === tp.id).length, decks: decks.filter(d => d.topic === tp.id).length,
  }));

  return {
    leafpileIndex: 1,
    generated: now,
    library: { title: vault.title || '', kind: vault.kind, publicOnly },
    counts: { topics: topics.length, notes: notes.length, decks: decks.length, boards: boardList.length },
    categories: (vault.categories || []).map(c => ({ id: c.id, name: c.name, topics: c.topics.map(tp => tp.id) })),
    topics, notes, decks, boards: boardList,
  };
}

const code = s => '`' + String(s).replace(/`/g, "'") + '`';
const list = (items, max = 12) => (items.length > max ? [...items.slice(0, max), t('index.more', { n: items.length - max })] : items).join(t('index.sep'));
const name = r => `${r.title} ${code(r.path)}`;

/** 把索引排成 Markdown:依分類 → 主題分段,每篇一行,有內容的細節才往下縮排。 */
export function indexMarkdown(idx) {
  const out = [];
  const c = idx.counts;
  out.push(`# ${t('index.title', { title: idx.library.title })}`, '');
  out.push(t('index.summary', { topics: c.topics, notes: c.notes, decks: c.decks, boards: c.boards, date: idx.generated.slice(0, 16).replace('T', ' ') }));
  if (idx.library.publicOnly) out.push('', t('index.publicOnly'));
  out.push('', t('index.howto'), '');

  const topicById = new Map(idx.topics.map(tp => [tp.id, tp]));
  const catName = new Map(idx.categories.map(x => [x.id, x.name]));
  const ordered = [...idx.categories.flatMap(x => x.topics), ...idx.topics.map(tp => tp.id)].filter((id, i, a) => a.indexOf(id) === i);

  for (const id of ordered) {
    const tp = topicById.get(id);
    if (!tp) continue;
    const notes = idx.notes.filter(n => n.topic === id), decks = idx.decks.filter(d => d.topic === id);
    if (!notes.length && !decks.length) continue;
    const cat = catName.get(tp.category);
    const flags = [tp.public ? t('index.topicPublic') : '', tp.localOnly ? t('index.localOnly') : ''].filter(Boolean);
    out.push(`## ${cat ? cat + ' › ' : ''}${tp.title} ${code(tp.id)}${flags.length ? ' · ' + flags.join(' · ') : ''}`);
    if (tp.description) out.push('', tp.description);
    out.push('');
    for (const n of notes) {
      const meta = [n.date, n.tags.map(x => '#' + x).join(' '), n.public ? t('index.public') : t('index.private'), n.pinned ? t('index.pinned', { date: n.expires }) : '', n.book ? t('index.book', { title: n.book.title }) : ''].filter(Boolean);
      out.push(`- **${n.title}** ${code(n.path)} · ${meta.join(' · ')}`);
      const sub = [];
      const fields = Object.entries(n.fields).map(([k, v]) => `${k}: ${cellText(v)}`);
      if (n.aliases.length) sub.push(t('index.aliases', { list: n.aliases.join(t('index.sep')) }));
      if (fields.length) sub.push(t('index.fields', { list: fields.join(t('index.sep')) }));
      const hs = n.headings.filter(h => h.level <= 2 && h.text !== n.title).map(h => h.text);
      if (hs.length) sub.push(t('index.headings', { list: list(hs, 10) }));
      if (n.links.length) sub.push(t('index.links', { list: list(n.links.map(name)) }));
      if (n.missing.length) sub.push(t('index.missing', { list: n.missing.join(t('index.sep')) }));
      if (n.backlinks.length) sub.push(t('index.backlinks', { list: list(n.backlinks.map(name)) }));
      if (n.boards.length) sub.push(t('index.onBoards', { list: n.boards.join(t('index.sep')) }));
      if (n.fromDeck) sub.push(t('index.fromDeck', { path: code(n.fromDeck) }));
      for (const s of sub) out.push(`  - ${s}`);
    }
    for (const d of decks) {
      out.push(`- ${t('index.deck')} **${d.title}** ${code(d.path)}${d.date ? ' · ' + d.date : ''}`);
      if (d.source) out.push(`  - ${t('index.source', { path: code(d.source) })}`);
      if (d.links.length) out.push(`  - ${t('index.links', { list: list(d.links.map(name)) })}`);
      if (d.missing.length) out.push(`  - ${t('index.missing', { list: d.missing.join(t('index.sep')) })}`);
      if (d.boards.length) out.push(`  - ${t('index.onBoards', { list: d.boards.join(t('index.sep')) })}`);
    }
    out.push('');
  }

  if (idx.boards.length) {
    out.push(`## ${t('index.boards')}`, '');
    for (const b of idx.boards) {
      out.push(`- **${b.name}** ${code(b.path)} · ${t('index.boardStats', { cards: b.cards.length, texts: b.texts })}`);
      if (b.groups.length) out.push(`  - ${t('index.groups', { list: b.groups.join(t('index.sep')) })}`);
      if (b.cards.length) out.push(`  - ${t('index.cards', { list: list(b.cards.map(name), 20) })}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** 從資料來源產生索引(命令列用;網站已經有圖譜時可以直接呼叫 buildIndex)。 */
export async function libraryIndex(source, opts = {}) {
  const vault = await openVault(source);
  const graph = await buildGraph(vault);
  const boards = [];
  for (const b of vault.boards || []) {
    try { boards.push({ ...b, board: parseCanvas(await source.readText(b.path)) }); } catch { /* 壞掉的畫布由檢查工具回報 */ }
  }
  return buildIndex({ vault, graph, boards }, opts);
}
