// 筆記表格檢視的純邏輯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteFields, tableColumns, cellText, compareCells, sortRows, filterRows, valueOf } from '../app/core/table.js';
import { groupRows, groupIdsOf } from '../app/core/table.js';

test('noteFields:收自訂欄位,排除固定欄位、版型鍵、x- 開頭與物件', () => {
  const f = noteFields({ title: 'A', tags: ['x'], date: '2026-01-01', status: '讀完', rating: 4, done: true, authors: ['甲', '乙'], layout: 'cover', 'x-foo': 1, nested: { a: 1 }, mixed: [1, { b: 2 }], empty: '', when: new Date('2026-02-03T00:00:00Z') });
  assert.deepEqual(f, { status: '讀完', rating: 4, done: true, authors: ['甲', '乙'], when: '2026-02-03' });
});

test('tableColumns:出現次數多的在前,同次數依名稱,有上限', () => {
  const rows = [{ fields: { b: 1, a: 1 } }, { fields: { b: 2, c: 3 } }, { fields: { d: 1 } }];
  assert.deepEqual(tableColumns(rows), ['b', 'a', 'c', 'd']);
  assert.deepEqual(tableColumns(rows, 2), ['b', 'a']);
  assert.deepEqual(tableColumns([]), []);
});

test('cellText:清單、是非、空值', () => {
  assert.equal(cellText(['a', 'b']), 'a, b');
  assert.equal(cellText(true), '✓');
  assert.equal(cellText(false), '✗');
  assert.equal(cellText(null), '');
  assert.equal(cellText(3), '3');
});

test('compareCells / sortRows:數字照大小、文字含數字自然排序、空值永遠最後', () => {
  assert.ok(compareCells(2, 10) < 0);
  assert.ok(compareCells('第2章', '第10章') < 0);
  assert.ok(compareCells('', 'a') > 0 && compareCells('a', null) < 0);
  const rows = [
    { title: '乙', date: '2026-03-01', fields: { rating: 3 } },
    { title: '甲', date: '', fields: {} },
    { title: '丙', date: '2026-01-01', fields: { rating: 5 } },
  ];
  assert.deepEqual(sortRows(rows, 'date').map(r => r.title), ['丙', '乙', '甲']);
  assert.deepEqual(sortRows(rows, 'date', 'desc').map(r => r.title), ['乙', '丙', '甲'], '降冪時空的也在最後');
  assert.deepEqual(sortRows(rows, 'rating', 'desc').map(r => r.title), ['丙', '乙', '甲']);
  assert.equal(valueOf(rows[0], 'rating'), 3);
  assert.equal(rows[0].title, '乙', '不改原陣列');
});

test('filterRows:關鍵字比對標題與欄位值,標籤與額外條件', () => {
  const rows = [
    { title: '費曼學習法', rel: 'a.md', tags: ['學習'], fields: { status: '讀完' } },
    { title: '原子習慣', rel: 'b.md', tags: ['習慣', '學習'], fields: { status: '在讀' } },
  ];
  assert.deepEqual(filterRows(rows, { words: ['讀完'] }).map(r => r.title), ['費曼學習法']);
  assert.deepEqual(filterRows(rows, { tag: '習慣' }).map(r => r.title), ['原子習慣']);
  assert.deepEqual(filterRows(rows, { keep: r => r.rel === 'a.md' }).map(r => r.title), ['費曼學習法']);
  assert.equal(filterRows(rows, {}).length, 2);
});

// ---------- 分組 ----------

const G = [
  { title: 'a', category: 'learn', topicId: '10-r', topic: '讀書', book: '書一', date: '2026-11-02', tags: ['x', 'y'], fields: { status: '讀完', who: ['甲', '乙'] } },
  { title: 'b', category: 'work', topicId: '20-w', topic: '工作', book: '', date: '2025-03-01', tags: [], fields: { status: '讀中' } },
  { title: 'c', category: 'learn', topicId: '11-c', topic: '課程', book: '', date: '', tags: ['x'], fields: {} },
];

test('groupRows:不分組時整批一組', () => {
  assert.deepEqual(groupRows(G, '').map(g => g.rows.length), [3]);
});

test('groupRows:分類與主題照書庫順序,名稱用 labels', () => {
  const cats = groupRows(G, 'category', { order: ['work', 'learn'], labels: { learn: '學習', work: '工作' } });
  assert.deepEqual(cats.map(g => [g.id, g.label, g.rows.map(r => r.title).join('')]), [['work', '工作', 'b'], ['learn', '學習', 'ac']]);
  const tps = groupRows(G, 'topic', { order: ['10-r', '11-c', '20-w'] });
  assert.deepEqual(tps.map(g => g.id), ['10-r', '11-c', '20-w']);
});

test('groupRows:年、月由新到舊,沒有日期的放最後', () => {
  assert.deepEqual(groupRows(G, 'year').map(g => g.id), ['2026', '2025', '']);
  assert.deepEqual(groupRows(G, 'month').map(g => g.id), ['2026-11', '2025-03', '']);
});

test('groupRows:標籤與清單欄位,一列可以在好幾組;沒有值的一組放最後', () => {
  const tg = groupRows(G, 'tags');
  assert.deepEqual(tg.map(g => [g.id, g.rows.map(r => r.title).join('')]), [['x', 'ac'], ['y', 'a'], ['', 'b']]);
  assert.deepEqual(groupRows(G, 'who').map(g => g.id), ['乙', '甲', ''].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b))));
  assert.deepEqual(groupRows(G, 'status').map(g => [g.id, g.rows.length]), [['讀中', 1], ['讀完', 1], ['', 1]]);
  assert.deepEqual(groupIdsOf(G[1], 'book'), ['']);
});

test('groupRows:組內保留原本的排序', () => {
  const sorted = [G[2], G[0]];
  assert.deepEqual(groupRows(sorted, 'category').find(g => g.id === 'learn').rows.map(r => r.title), ['c', 'a']);
});

test('月曆:monthGrid 週日開始、前後補齊;shiftMonth 跨年', async () => {
  const { monthGrid, shiftMonth } = await import('../app/core/table.js');
  const g = monthGrid('2026-11'); // 2026-11-01 是週日
  assert.equal(g[0][0].date, '2026-11-01');
  assert.equal(g.length, 5);
  assert.equal(g.at(-1)[6].date, '2026-12-05');
  assert.equal(g.at(-1)[6].inMonth, false);
  assert.ok(g.every(w => w.length === 7));
  const f = monthGrid('2026-02'); // 2/1 是週日、28 天:剛好 4 週
  assert.equal(f.length, 4);
  const m = monthGrid('2026-08'); // 8/1 是週六:要 6 週
  assert.equal(m[0][6].date, '2026-08-01'); assert.equal(m.length, 6);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('月曆:rowsByDay 只收合法日期;defaultMonth 優先這個月,否則最近有筆記的月份', async () => {
  const { rowsByDay, defaultMonth } = await import('../app/core/table.js');
  const rows = [{ date: '2026-11-03' }, { date: '2026-11-03T10:00' }, { date: '' }, { date: '2026-09-30' }, { date: 'x' }];
  const by = rowsByDay(rows);
  assert.equal(by.get('2026-11-03').length, 2); assert.equal(by.size, 2);
  assert.equal(defaultMonth(rows, '2026-11-13'), '2026-11');
  assert.equal(defaultMonth([{ date: '2026-09-30' }, { date: '2027-01-01' }], '2026-11-13'), '2026-09');
  assert.equal(defaultMonth([{ date: '2027-01-01' }], '2026-11-13'), '2027-01');
  assert.equal(defaultMonth([], '2026-11-13'), '2026-11');
});

test('看板:沒選分組時有 status 用 status,否則用主題', async () => {
  const { kanbanKey } = await import('../app/core/table.js');
  assert.equal(kanbanKey('', ['rating', 'status']), 'status');
  assert.equal(kanbanKey('', ['rating']), 'topic');
  assert.equal(kanbanKey('tags', ['status']), 'tags');
});

import { matchBoard, plainExcerpt, NO_BOARD } from '../app/core/table.js';

test('matchBoard:全部、還沒放上畫布、指定畫布', () => {
  const on = { boards: ['A', 'B'] }, off = { boards: [] }, none = {};
  assert.equal(matchBoard(on, ''), true);
  assert.equal(matchBoard(on, NO_BOARD), false);
  assert.equal(matchBoard(off, NO_BOARD), true);
  assert.equal(matchBoard(none, NO_BOARD), true);
  assert.equal(matchBoard(on, 'B'), true);
  assert.equal(matchBoard(on, 'C'), false);
});

test('plainExcerpt:拿掉 Markdown 記號,太長就截斷', () => {
  const md = '# 標題\n\n> 引言 **粗體** 與 ==螢光==\n\n- [ ] 待辦\n- 項目 [[筆記#段|顯示]] 和 [[另一篇]]\n\n```js\ncode()\n```\n![圖](a.png) [連結](https://x.y)';
  assert.equal(plainExcerpt(md), '標題 引言 粗體 與 螢光 待辦 項目 顯示 和 另一篇 連結');
  assert.equal(plainExcerpt('一二三四五六', 4), '一二三…');
  assert.equal(plainExcerpt(''), '');
  assert.equal(plainExcerpt('# 同名\n內文 [[slides:讀書會]]', 280, '同名'), '內文 讀書會');
  assert.equal(plainExcerpt('# 別的\n內文', 280, '同名'), '別的 內文');
  assert.equal(plainExcerpt('| 欄 | 說明 |\n|---|:---:|\n| a | b |'), '欄 說明 a b');
});
