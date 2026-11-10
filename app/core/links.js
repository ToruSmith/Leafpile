// [[連結]] 的目標比對與反向連結。純邏輯,只吃「紀錄」不讀檔案。
//
// 紀錄(由 core/graph.js 產生):
//   筆記 { kind: 'note', path: 'notes/10-reading/x.md', rel: '10-reading/x.md', topicId, title, aliases, date }
//   簡報 { kind: 'deck', path: 'slides/10-reading/2026-x', rel: '10-reading/2026-x', topicId, title, folder, date }
//
// 比對順序(docs/SPEC.md 第 5 節):title → aliases → 檔名(去前綴)→ 檔名 → 路徑。
// 多個符合時:同主題優先,再來是較新的日期;同一層仍有多個 = ambiguous(檢查工具提醒改寫成路徑)。

import { splitOrder } from './names.js';

export const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const stripExt = s => s.replace(/\.md$/i, '');

/** 一筆紀錄可以被哪些名稱找到。exact = 路徑(唯一,不算重名)。 */
function keysOf(rec) {
  const base = rec.kind === 'note' ? stripExt(rec.rel.split('/').pop()) : rec.folder || rec.rel.split('/').pop();
  const loose = [rec.title, ...(rec.aliases || []), splitOrder(base).label, base];
  const exact = rec.kind === 'note' ? [stripExt(rec.rel), stripExt(rec.path)] : [rec.rel, rec.path];
  return { loose: [...new Set(loose.filter(Boolean).map(norm))], exact: [...new Set(exact.filter(Boolean).map(norm))] };
}

/**
 * 建立比對器。
 * @param {object[]} records 筆記與簡報紀錄
 */
export function createResolver(records) {
  const maps = { note: { loose: new Map(), exact: new Map() }, deck: { loose: new Map(), exact: new Map() } };
  for (const r of records) {
    const m = maps[r.kind];
    if (!m) continue;
    const k = keysOf(r);
    for (const key of k.exact) m.exact.set(key, r);
    for (const key of k.loose) {
      if (!m.loose.has(key)) m.loose.set(key, []);
      if (!m.loose.get(key).includes(r)) m.loose.get(key).push(r);
    }
  }

  /**
   * @param {{ channel: 'notes'|'slides', target: string }} link
   * @param {{ fromTopic?: string, fromPath?: string }} [ctx]
   * @returns {{ status: 'ok'|'missing'|'ambiguous'|'self', target?: object, candidates?: object[] }}
   */
  function resolve(link, ctx = {}) {
    const kind = link.channel === 'slides' ? 'deck' : 'note';
    const m = maps[kind];
    if (!link.target) {
      // [[#標題]]:同一篇筆記裡的段落
      return kind === 'note' && ctx.fromPath ? { status: 'self' } : { status: 'missing' };
    }
    const key = norm(stripExt(link.target).replace(/^\/+/, ''));
    const exact = m.exact.get(key);
    if (exact) return { status: 'ok', target: exact };
    const found = m.loose.get(key) || [];
    if (!found.length) return { status: 'missing' };
    if (found.length === 1) return { status: 'ok', target: found[0] };
    const same = found.filter(r => ctx.fromTopic && r.topicId === ctx.fromTopic);
    const tier = same.length ? same : found;
    const sorted = [...tier].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return { status: tier.length > 1 ? 'ambiguous' : 'ok', target: sorted[0], candidates: sorted };
  }
  return { resolve };
}

/**
 * 反向連結:目標路徑 → 連到它的紀錄。
 * 每筆來源紀錄需要 links([{ channel, target }])與 topicId;簡報另外看 source(升級自哪一份筆記)。
 * 一份簡報在圖譜裡只算一個點(不是每張投影片)。
 * @returns {Map<string, { from: object, via: 'link'|'source' }[]>}
 */
export function computeBacklinks(records, resolver) {
  const out = new Map();
  const add = (target, from, via) => {
    if (!target || target === from) return;
    if (!out.has(target.path)) out.set(target.path, []);
    const list = out.get(target.path);
    if (!list.some(x => x.from === from)) list.push({ from, via });
  };
  for (const r of records) {
    for (const l of r.links || []) {
      const res = resolver.resolve(l, { fromTopic: r.topicId, fromPath: r.path });
      if (res.target) add(res.target, r, 'link');
    }
    if (r.kind === 'deck' && r.source) {
      // source 可以指向一篇筆記或一個筆記本資料夾;筆記本的每一篇都算被引用
      const src = norm(stripExt(r.source).replace(/^\/+|\/+$/g, ''));
      for (const n of records) {
        if (n.kind !== 'note') continue;
        const p = norm(stripExt(n.path));
        if (p === src || p.startsWith(src + '/')) add(n, r, 'source');
      }
    }
  }
  return out;
}
