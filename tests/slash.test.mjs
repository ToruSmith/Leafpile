// 斜線選單的純邏輯(core/slash.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slashQuery, filterSlash, applySlash, stamp, SLASH_ITEMS } from '../app/core/slash.js';

const item = id => SLASH_ITEMS.find(x => x.id === id);

test('slashQuery:只有行首或空白後的 / 才算', () => {
  assert.deepEqual(slashQuery('/', 1), { start: 0, query: '' });
  assert.deepEqual(slashQuery('abc\n  /h', 8), { start: 6, query: 'h' });
  assert.deepEqual(slashQuery('文字 /待', 5), { start: 3, query: '待' });
  assert.equal(slashQuery('https://x.y/a', 13), null, '網址');
  assert.equal(slashQuery('1/2', 3), null, '日期或分數');
  assert.equal(slashQuery('a/b/c', 5), null, '路徑');
  assert.equal(slashQuery('/h x', 4), null, '查詢字中間有空白就結束');
});

test('slashQuery:程式碼區塊與 front matter 裡不算', () => {
  const code = '```\n/h';
  assert.equal(slashQuery(code, code.length), null);
  const closed = '```\nx\n```\n/h';
  assert.deepEqual(slashQuery(closed, closed.length), { start: closed.length - 2, query: 'h' });
  const fm = '---\ntitle: a\n/x';
  assert.equal(slashQuery(fm + '\n---\n', fm.length), null);
  const after = '---\ntitle: a\n---\n/x';
  assert.deepEqual(slashQuery(after, after.length), { start: after.length - 2, query: 'x' });
});

test('filterSlash:開頭相符排前面;中文別名與顯示標籤都找得到', () => {
  assert.equal(filterSlash('').length, SLASH_ITEMS.length);
  assert.equal(filterSlash('h2')[0].id, 'h2');
  assert.equal(filterSlash('待辦')[0].id, 'todo');
  assert.equal(filterSlash('tab')[0].id, 'table');
  assert.equal(filterSlash('分隔')[0].id, 'divider');
  assert.ok(filterSlash('xyz-none').length === 0);
  assert.equal(filterSlash('引', id => (id === 'quote' ? '引言' : id))[0].id, 'quote');
});

test('applySlash:行首直接插入,游標放在該放的位置', () => {
  const r = applySlash('/h2', { start: 0, query: 'h2' }, item('h2'));
  assert.deepEqual(r, { text: '## ', selStart: 3, selEnd: 3 });
  const c = applySlash('a\n/code', { start: 2, query: 'code' }, item('code'));
  assert.equal(c.text, 'a\n```\n\n```');
  assert.equal(c.selStart, 6);
  const l = applySlash('看 /link', { start: 2, query: 'link' }, item('link'));
  assert.equal(l.text, '看 [[]]');
  assert.equal(l.selStart, 4);
});

test('applySlash:區塊不在行首就先換行;自成一塊的後面還有字也換行', () => {
  const r = applySlash('文字 /todo', { start: 3, query: 'todo' }, item('todo'));
  assert.equal(r.text, '文字\n- [ ] ');
  const t2 = applySlash('前 /table 後', { start: 2, query: 'table' }, item('table'), { cols: ['欄 1', '欄 2'] });
  assert.equal(t2.text, '前\n| 欄 1 | 欄 2 |\n| --- | --- |\n|  |  |\n 後');
  assert.equal(t2.text.slice(t2.selStart, t2.selEnd), '欄 1');
  const en = applySlash('/table', { start: 0, query: 'table' }, item('table'));
  assert.equal(en.text, '| Col 1 | Col 2 |\n| --- | --- |\n|  |  |');
  assert.equal(en.text.slice(en.selStart, en.selEnd), 'Col 1');
});

test('applySlash:日期與現在時間(本地時間)', () => {
  const d = new Date(2026, 10, 14, 9, 5);
  assert.equal(stamp('date', d), '2026-11-14');
  assert.equal(stamp('now', d), '2026-11-14 09:05');
  assert.equal(applySlash('今天 /date', { start: 3, query: 'date' }, item('date'), { now: d }).text, '今天 2026-11-14');
});
