// 筆記表格檢視的純邏輯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteFields, tableColumns, cellText, compareCells, sortRows, filterRows, valueOf } from '../app/core/table.js';

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
