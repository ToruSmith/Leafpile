// 側邊欄的資料:分類 → 主題 → 筆記本 → 筆記(加上簡報),以及釘選與最近開過的清單。
// 純邏輯,瀏覽器與測試共用。只讀書庫,不寫任何檔案;釘選與最近開過由呼叫端存在本機。

import { notesOfTopic } from './vault.js';

/**
 * 依書庫的分類與主題排出樹狀目錄。
 * 書庫沒有設定分類時,回傳一個 id 為 null 的群組,畫面上直接列主題。
 * titles(選填):筆記路徑 → 標題。資料夾清單只有檔名,讀完筆記內容後用它換成真正的標題。
 * @returns {{ id: string|null, name: string, count: number, topics: object[] }[]}
 */
export function navTree(vault, titles = null) {
  const topicNode = tp => {
    const items = (tp.notes?.items || []).map(i => i.kind === 'book'
      ? { kind: 'book', path: i.path, title: i.title, notes: i.notes.map(noteNode) }
      : noteNode(i)).filter(i => i.kind !== 'book' || i.notes.length);
    const decks = (tp.decks || []).map(d => ({ kind: 'deck', topicId: tp.id, id: d.id, title: d.title || d.id }));
    const count = notesOfTopic(tp.notes).length + decks.length;
    return { kind: 'topic', id: tp.id, title: tp.title, color: tp.color || '', items, decks, count };
  };
  const noteNode = n => ({ kind: 'note', rel: n.path, title: titles?.get(n.path) || n.title });
  const groups = vault.categories?.length
    ? vault.categories.map(c => ({ id: c.id, name: c.name, topics: c.topics.map(topicNode) }))
    : [{ id: null, name: '', topics: vault.topics.map(topicNode) }];
  for (const g of groups) {
    g.topics = g.topics.filter(tp => tp.count);
    g.count = g.topics.reduce((s, tp) => s + tp.count, 0);
  }
  return groups.filter(g => g.topics.length);
}

/**
 * 找出某篇筆記或某份簡報在樹裡的位置,回傳要展開的節點鍵('c:分類'、't:主題'、'k:筆記本路徑')。
 * 找不到回傳空陣列。
 */
export function pathTo(tree, target) {
  for (const g of tree) {
    for (const tp of g.topics) {
      const base = [...(g.id != null ? ['c:' + g.id] : []), 't:' + tp.id];
      if (target.type === 'd' && tp.decks.some(d => `${d.topicId}/${d.id}` === target.id)) return base;
      if (target.type !== 'n') continue;
      for (const i of tp.items) {
        if (i.kind === 'note' && i.rel === target.id) return base;
        if (i.kind === 'book' && i.notes.some(n => n.rel === target.id)) return [...base, 'k:' + i.path];
      }
    }
  }
  return [];
}

// ---------- 釘選與最近開過 ----------
// 每一項:{ t: 'n'(筆記)|'d'(簡報,id = 主題/簡報)|'b'(畫布), id, title }

const same = (a, b) => a.t === b.t && a.id === b.id;
const clean = e => ({ t: String(e.t), id: String(e.id), title: String(e.title || e.id) });

/** 把剛開的這一項放到最前面,重複的拿掉,最多 max 項。不改原陣列。 */
export function pushRecent(list, entry, max = 8) {
  const e = clean(entry);
  return [e, ...(list || []).filter(x => !same(x, e))].slice(0, max);
}

/** 釘選／取消釘選。不改原陣列;新釘選的放最後(依釘選的先後)。 */
export function togglePin(list, entry) {
  const e = clean(entry), cur = list || [];
  return cur.some(x => same(x, e)) ? cur.filter(x => !same(x, e)) : [...cur, e];
}

export const isPinned = (list, entry) => (list || []).some(x => same(x, entry));

/** 讀回存起來的清單:只留格式正確的項目,壞資料當成空的。 */
export function parseNavState(raw) {
  let v = null;
  try { v = JSON.parse(raw || 'null'); } catch { /* 壞資料 */ }
  const ok = e => e && ['n', 'd', 'b'].includes(e.t) && typeof e.id === 'string' && e.id;
  const list = x => (Array.isArray(x) ? x.filter(ok).map(clean) : []);
  return { pins: list(v?.pins), recent: list(v?.recent).slice(0, 8) };
}

/**
 * 依目前的書庫把清單裡的項目對上:標題換成最新的,找不到的(改名、刪掉、訪客模式看不到)拿掉。
 * 只影響顯示,不改存起來的清單,所以換回能看到的狀態時釘選還在。
 */
export function liveEntries(list, vault, boards = [], titles = null) {
  const notes = new Map(vault.topics.flatMap(tp => notesOfTopic(tp.notes).map(n => [n.path, titles?.get(n.path) || n.title])));
  const decks = new Map(vault.topics.flatMap(tp => (tp.decks || []).map(d => [`${tp.id}/${d.id}`, d.title || d.id])));
  const bset = new Set(boards);
  return (list || []).flatMap(e => {
    if (e.t === 'n') return notes.has(e.id) ? [{ ...e, title: notes.get(e.id) }] : [];
    if (e.t === 'd') return decks.has(e.id) ? [{ ...e, title: decks.get(e.id) }] : [];
    return bset.has(e.id) ? [e] : [];
  });
}
