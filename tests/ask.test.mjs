// 對卡片問 AI(core/ask.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../app/core/i18n.js';
import { askContext, buildAskPrompt, privateCount } from '../app/core/ask.js';

const board = {
  nodes: [
    { id: 'g', type: 'group', label: '第三章', x: 0, y: 0, width: 800, height: 400 },
    { id: 'a', type: 'text', text: '# 論點\n習慣比目標重要', x: 20, y: 40, width: 200, height: 100 },
    { id: 'b', type: 'file', file: 'notes/x.md', x: 300, y: 40, width: 200, height: 100 },
    { id: 'c', type: 'text', text: '外面的反例:有人靠目標成功', x: 1000, y: 40, width: 200, height: 100 },
    { id: 'img', type: 'file', file: 'boards/media/a.png', x: 600, y: 40, width: 100, height: 100 },
  ],
  edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', label: '例子' }, { id: 'e2', fromNode: 'b', toNode: 'c', label: '反駁' }],
};
const read = n => n.type === 'text' ? { title: n.text.split('\n')[0].replace(/^#\s*/, ''), text: n.text }
  : n.file === 'notes/x.md' ? { title: '原子習慣', text: '每天進步 1%', private: true } : null;

test('askContext:群組展開成卡片;圖片略過;連線鄰居與卡片之間的連線分開', () => {
  const ctx = askContext(board, ['g'], read);
  assert.deepEqual(ctx.cards.map(c => c.id), ['a', 'b']);
  assert.deepEqual(ctx.neighbors.map(n => [n.id, n.label, n.via]), [['c', '反駁', '原子習慣']]);
  assert.deepEqual(ctx.links, [{ from: '論點', to: '原子習慣', label: '例子' }]);
  assert.deepEqual(ctx.groups, ['第三章']);
  assert.equal(privateCount(ctx), 1);
});

test('buildAskPrompt:帶問題、卡片全文、連線與鄰居開頭;沒問題用預設', () => {
  setLang('zh-Hant');
  const ctx = askContext(board, ['g'], read);
  const p = buildAskPrompt(ctx, '這兩個說法衝突嗎?');
  assert.match(p, /我的問題:這兩個說法衝突嗎?|我的問題：這兩個說法衝突嗎?/);
  assert.match(p, /=== 卡片：原子習慣 ===\n每天進步 1%/);
  assert.match(p, /論點 → 原子習慣（例子）/);
  assert.match(p, /外面的反例/);
  assert.match(p, /第三章/);
  assert.ok(!/\n{3,}/.test(p));
  const d = buildAskPrompt({ cards: [{ title: 'x', text: 'y' }] });
  assert.match(d, /整理這幾張卡片的重點/);
  setLang('en');
  assert.match(buildAskPrompt({ cards: [{ title: 'x', text: 'y' }] }), /=== Card: x ===/);
  setLang('zh-Hant');
});

test('buildAskPrompt:太長的卡片截斷,總量有上限', () => {
  const big = 'x'.repeat(20000);
  const p = buildAskPrompt({ cards: Array.from({ length: 8 }, (_, i) => ({ title: 'c' + i, text: big })) });
  assert.ok(p.length < 34000, String(p.length));
  assert.match(p, /內容略過/);
});
