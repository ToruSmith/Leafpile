// 側邊欄的純邏輯:樹狀目錄、位置、釘選與最近開過。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navTree, pathTo, pushRecent, togglePin, isPinned, parseNavState, liveEntries } from '../app/core/nav.js';

const note = (path, title, topicId) => ({ kind: 'note', path, title, topicId });
const tpA = {
  id: '10-reading', title: '讀書筆記', color: '#c00',
  notes: { items: [
    { kind: 'book', path: '10-reading/atomic', title: '原子習慣', notes: [note('10-reading/atomic/01.md', '第 1 章', '10-reading'), note('10-reading/atomic/03.md', '第 3 章', '10-reading')] },
    { kind: 'book', path: '10-reading/empty', title: '空的', notes: [] },
    note('10-reading/loose.md', '散篇', '10-reading'),
  ] },
  decks: [{ id: '2026-11-talk', title: '11 月讀書會' }],
};
const tpB = { id: '20-work', title: '工作', notes: { items: [note('20-work/a.md', 'A', '20-work')] }, decks: [] };
const tpC = { id: '30-empty', title: '沒東西', notes: { items: [] }, decks: [] };
const vault = { topics: [tpA, tpB, tpC], categories: [{ id: 'learn', name: '學習', topics: [tpA, tpC] }, { id: 'work', name: '工作', topics: [tpB] }] };

test('navTree:分類 → 主題 → 筆記本／散篇／簡報,附數量,空的不列', () => {
  const tree = navTree(vault);
  assert.deepEqual(tree.map(g => [g.id, g.name, g.count]), [['learn', '學習', 4], ['work', '工作', 1]]);
  const a = tree[0].topics[0];
  assert.equal(tree[0].topics.length, 1, '沒有筆記也沒有簡報的主題不列');
  assert.deepEqual(a.items.map(i => i.kind + ':' + (i.path || i.rel)), ['book:10-reading/atomic', 'note:10-reading/loose.md'], '空的筆記本不列');
  assert.deepEqual(a.decks.map(d => d.topicId + '/' + d.id), ['10-reading/2026-11-talk']);
  assert.equal(a.count, 4);
});

test('navTree:沒有設定分類時,只有一個 id 為 null 的群組', () => {
  const tree = navTree({ topics: [tpA, tpB], categories: [] });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, null);
  assert.deepEqual(tree[0].topics.map(t => t.id), ['10-reading', '20-work']);
});

test('pathTo:找出要展開的分類、主題、筆記本', () => {
  const tree = navTree(vault);
  assert.deepEqual(pathTo(tree, { type: 'n', id: '10-reading/atomic/03.md' }), ['c:learn', 't:10-reading', 'k:10-reading/atomic']);
  assert.deepEqual(pathTo(tree, { type: 'n', id: '10-reading/loose.md' }), ['c:learn', 't:10-reading']);
  assert.deepEqual(pathTo(tree, { type: 'd', id: '10-reading/2026-11-talk' }), ['c:learn', 't:10-reading']);
  assert.deepEqual(pathTo(tree, { type: 'n', id: 'nope.md' }), []);
  assert.deepEqual(pathTo(navTree({ topics: [tpB], categories: [] }), { type: 'n', id: '20-work/a.md' }), ['t:20-work'], '沒有分類就不含 c:');
});

test('pushRecent:最新的在前、不重複、有上限、不改原陣列', () => {
  const a = { t: 'n', id: 'a.md', title: 'A' }, b = { t: 'b', id: 'board', title: 'board' };
  let list = pushRecent([], a);
  list = pushRecent(list, b);
  const before = list;
  list = pushRecent(list, { ...a, title: 'A2' });
  assert.deepEqual(list.map(e => e.id + ':' + e.title), ['a.md:A2', 'board:board']);
  assert.equal(before.length, 2);
  let many = [];
  for (let i = 0; i < 12; i++) many = pushRecent(many, { t: 'n', id: `${i}.md`, title: String(i) });
  assert.equal(many.length, 8);
  assert.equal(many[0].id, '11.md');
});

test('togglePin / isPinned', () => {
  const a = { t: 'n', id: 'a.md', title: 'A' }, d = { t: 'd', id: 'tp/deck', title: 'D' };
  let pins = togglePin([], a);
  pins = togglePin(pins, d);
  assert.deepEqual(pins.map(e => e.id), ['a.md', 'tp/deck'], '依釘選先後');
  assert.ok(isPinned(pins, { t: 'n', id: 'a.md' }));
  pins = togglePin(pins, a);
  assert.deepEqual(pins.map(e => e.id), ['tp/deck']);
  assert.ok(!isPinned(pins, a));
});

test('parseNavState:壞資料當成空的,只留格式正確的項目', () => {
  assert.deepEqual(parseNavState(null), { pins: [], recent: [] });
  assert.deepEqual(parseNavState('{oops'), { pins: [], recent: [] });
  const s = parseNavState(JSON.stringify({ pins: [{ t: 'n', id: 'a.md', title: 'A' }, { t: 'x', id: 'bad' }, { t: 'n' }, 3], recent: 'nope' }));
  assert.deepEqual(s, { pins: [{ t: 'n', id: 'a.md', title: 'A' }], recent: [] });
});

test('liveEntries:標題換成最新的,找不到的不顯示(但不刪)', () => {
  const list = [
    { t: 'n', id: '10-reading/atomic/01.md', title: '舊標題' },
    { t: 'n', id: 'gone.md', title: '已刪' },
    { t: 'd', id: '10-reading/2026-11-talk', title: 'x' },
    { t: 'b', id: 'overview', title: 'overview' },
    { t: 'b', id: 'missing', title: 'missing' },
  ];
  const live = liveEntries(list, vault, ['overview']);
  assert.deepEqual(live.map(e => e.title), ['第 1 章', '11 月讀書會', 'overview']);
  assert.equal(list.length, 5, '原清單不變');
});
