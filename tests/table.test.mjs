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
