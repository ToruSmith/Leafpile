// 書庫圖譜:在背景讀完所有筆記(與投影片裡的 [[連結]]),建立標題、連結、反向連結與搜尋索引。
// 書架不必等它:沒建好之前用檔名當標題,建好後再補上。

import { limiter } from './library.js';
import { join, isHidden, isMarkdown, RESERVED_DIRS } from './names.js';
import { parseNote, wikilinksOf } from './note.js';
import { createResolver, computeBacklinks, norm } from './links.js';
import { resolvePublic, isLocalOnly } from './privacy.js';
import { notesOfTopic } from './vault.js';

const limit = limiter(6);

/** 簡報資料夾裡所有投影片檔(第一層與章節資料夾)。 */
async function slideFiles(source, deckPath) {
  const out = [];
  let entries;
  try { entries = await source.list(deckPath); } catch { return out; }
  for (const e of entries) {
    if (e.kind === 'file' && isMarkdown(e.name)) out.push(join(deckPath, e.name));
    if (e.kind === 'dir' && !isHidden(e.name) && !RESERVED_DIRS.has(e.name.toLowerCase())) {
      try { for (const f of await source.list(join(deckPath, e.name))) if (f.kind === 'file' && isMarkdown(f.name)) out.push(join(deckPath, e.name, f.name)); } catch { /* 讀不到就略過 */ }
    }
  }
  return out;
}

/**
 * @param vault core/vault.js 的 openVault() 結果
 * @param {{ onProgress?: (done: number, total: number) => void, slides?: boolean }} [opts]
 */
export async function buildGraph(vault, { onProgress, slides = true } = {}) {
  const notes = [], decks = [], issues = [];
  const jobs = [];
  for (const tp of vault.notes.topics) {
    for (const stub of notesOfTopic(tp)) {
      const book = tp.items.find(i => i.kind === 'book' && i.path === stub.bookPath) || null;
      jobs.push(async () => {
        let text;
        try { text = await limit(() => vault.notesSource.readText(stub.path)); } catch { issues.push({ path: vault.notePath(stub.path), message: 'read' }); return; }
        const n = parseNote(text, { path: stub.path });
        // 書架上的卡片直接共用 stub:補上真正的標題與日期
        stub.title = n.title; stub.date = n.date; stub.excerpt = n.excerpt; stub.tags = n.tags; stub.pinned = n.pinned;
        notes.push({
          kind: 'note', path: vault.notePath(stub.path), rel: stub.path, topicId: tp.id, bookPath: stub.bookPath,
          title: n.title, aliases: n.aliases, date: n.date, tags: n.tags, excerpt: n.excerpt,
          pinned: n.pinned, expires: n.expires, fromDeck: n.fromDeck, links: n.links, headings: n.headings,
          public: resolvePublic({ note: n, book: book?.conf, topic: tp.conf }), localOnly: isLocalOnly(tp.conf),
          layoutKeys: n.layoutKeys, issues: n.issues, body: n.body,
          search: norm([n.title, ...n.aliases, ...n.tags, n.body].join(' ')),
          stub,
        });
      });
    }
  }
  for (const tp of vault.slides.topics) {
    for (const p of tp.projects) {
      const rec = { kind: 'deck', path: vault.deckPath(p), rel: p.path, topicId: tp.id, title: p.title, folder: p.folder, date: p.date, source: p.config?.source ? String(p.config.source) : '', links: [], project: p, search: norm([p.title, p.subtitle, p.author, ...p.tags].join(' ')) };
      decks.push(rec);
      if (!slides) continue;
      jobs.push(async () => {
        for (const f of await slideFiles(vault.slidesSource, p.path)) {
          try {
            const text = await limit(() => vault.slidesSource.readText(f));
            for (const l of wikilinksOf(text)) rec.links.push({ ...l, file: join(vault.slidesPrefix, f) });
          } catch { /* 讀不到的檔案由檢查工具回報 */ }
        }
      });
    }
  }
  let done = 0;
  onProgress?.(0, jobs.length);
  await Promise.all(jobs.map(j => j().finally(() => onProgress?.(++done, jobs.length))));
  notes.sort((a, b) => a.path.localeCompare(b.path));
  const records = [...notes, ...decks];
  const resolver = createResolver(records);
  return {
    notes: new Map(notes.map(n => [n.path, n])),
    decks: new Map(decks.map(d => [d.path, d])),
    records, resolver, issues,
    backlinks: computeBacklinks(records, resolver),
    builtAt: Date.now(),
  };
}

/**
 * 搜尋:多個關鍵字全部符合才算;標題符合的排前面。
 * @returns {object[]} 筆記與簡報紀錄
 */
export function searchGraph(graph, query, { limit: max = 50 } = {}) {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const r of graph.records) {
    if (!words.every(w => r.search.includes(w))) continue;
    const title = norm(r.title);
    hits.push({ r, score: words.filter(w => title.includes(w)).length * 10 + (title.startsWith(words[0]) ? 5 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || String(b.r.date || '').localeCompare(String(a.r.date || ''))).slice(0, max).map(h => h.r);
}
