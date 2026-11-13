// 書庫索引(--index):內容正確、--public 不洩漏私人筆記、Markdown 與 JSON 都能產生。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorySource } from './helpers.mjs';
import { libraryIndex, indexMarkdown } from '../app/core/index.js';
import { nodeSource } from '../scripts/node-source.mjs';
import { setLang } from '../app/core/i18n.js';

const lib = () => memorySource({
  '_site.yml': 'leafpile: 1\ntitle: 測試書庫\ncategories:\n  - id: learning\n    name: 學習\n',
  'notes/10-reading/_topic.yml': 'name: 讀書\ncategory: learning\npublic: true\n',
  'notes/10-reading/2026-11-book/_book.yml': 'title: 一本書\n',
  'notes/10-reading/2026-11-book/01-a.md': '---\ntitle: 甲\ntags: [書]\nstatus: 讀完\n---\n# 甲\n\n## 重點\n\n連到 [[乙]] 與 [[秘密]] 與 [[不存在]]。\n',
  'notes/10-reading/2026-11-book/02-b.md': '---\ntitle: 乙\n---\n# 乙\n\n回到 [[甲]]。\n',
  'notes/10-reading/secret.md': '---\ntitle: 秘密\npublic: false\n---\n# 秘密\n\n[[甲]]\n',
  'slides/10-reading/2026-11-share/deck.yml': 'title: 分享\nsource: notes/10-reading/2026-11-book\n',
  'slides/10-reading/2026-11-share/01-x.md': '# x\n\n![[甲#重點]]\n',
  'boards/map.canvas': JSON.stringify({ nodes: [
    { id: 'a', type: 'file', file: 'notes/10-reading/2026-11-book/01-a.md', x: 0, y: 0, width: 100, height: 60 },
    { id: 's', type: 'file', file: 'notes/10-reading/secret.md', x: 200, y: 0, width: 100, height: 60 },
    { id: 'g', type: 'group', label: '第一組', x: -10, y: -10, width: 400, height: 100 },
    { id: 't', type: 'text', text: 'hi', x: 0, y: 200, width: 100, height: 60 },
  ], edges: [] }),
});

test('index:筆記的路徑、欄位、章節、連結、被連、畫布', async () => {
  const idx = await libraryIndex(lib(), { now: '2026-11-13T00:00:00Z' });
  assert.deepEqual(idx.counts, { topics: 1, notes: 3, decks: 1, boards: 1 });
  const a = idx.notes.find(n => n.title === '甲');
  assert.equal(a.path, 'notes/10-reading/2026-11-book/01-a.md');
  assert.equal(a.book.title, '一本書');
  assert.deepEqual(a.tags, ['書']);
  assert.equal(a.fields.status, '讀完');
  assert.ok(a.headings.some(h => h.text === '重點' && h.level === 2));
  assert.deepEqual(a.links.map(l => l.title).sort(), ['乙', '秘密']);
  assert.deepEqual(a.missing, ['[[不存在]]']);
  assert.ok(a.backlinks.some(b => b.title === '乙'));
  assert.ok(a.backlinks.some(b => b.kind === 'deck'), '簡報的摘錄與 source 也算被連');
  assert.deepEqual(a.boards, ['map']);
  const d = idx.decks[0];
  assert.equal(d.source, 'notes/10-reading/2026-11-book');
  assert.ok(d.links.some(l => l.title === '甲' && l.embed));
  assert.deepEqual(idx.boards[0].groups, ['第一組']);
  assert.equal(idx.boards[0].texts, 1);
  assert.equal(idx.topics[0].category, 'learning');
});

test('index --public:私人筆記不出現在任何地方', async () => {
  const idx = await libraryIndex(lib(), { publicOnly: true });
  // 公開筆記自己的內文(摘要)提到「秘密」不算;私人筆記本身的路徑與記錄都不能出現
  assert.ok(!JSON.stringify(idx).includes('secret.md'), '私人筆記的路徑不能出現');
  const refs = [...idx.notes, ...idx.notes.flatMap(n => [...n.links, ...n.backlinks]), ...idx.decks.flatMap(d => [...d.links, ...d.backlinks]), ...idx.boards.flatMap(b => b.cards)];
  assert.ok(!refs.some(r => r.title === '秘密'), '私人筆記不能出現在任何清單裡');
  assert.equal(idx.counts.notes, 2);
  assert.equal(idx.boards[0].cards.length, 1);
  setLang('zh-Hant');
  assert.ok(!indexMarkdown(idx).includes('秘密'));
});

test('index:Markdown 依分類與主題分段,範例書庫也能產生', async () => {
  setLang('zh-Hant');
  const md = indexMarkdown(await libraryIndex(lib(), { now: '2026-11-13T00:00:00Z' }));
  assert.match(md, /^# .*測試書庫/);
  assert.match(md, /## 學習 › 讀書 `10-reading`/);
  assert.match(md, /- \*\*甲\*\* `notes\/10-reading\/2026-11-book\/01-a\.md`/);
  assert.match(md, /\[\[不存在\]\]/);
  const real = await libraryIndex(nodeSource(new URL('../content', import.meta.url).pathname));
  assert.ok(real.notes.length >= 5 && real.decks.length >= 3);
  assert.ok(indexMarkdown(real).length > 500);
});
